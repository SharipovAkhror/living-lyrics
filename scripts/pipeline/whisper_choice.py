"""Choose the proof witness per song and language by how many lines it proves.

    python3 scripts/pipeline/whisper_choice.py --choose <slug> [<slug>…]

Reads work/<slug>/align-report.json. Every finished Whisper model has already
written its word starts on the placed windows (`stable_models`). This step does
not run Whisper.

For each pair the model is the one that proves the most lines inside a joint
assignment. The assignment has to pass the existing caps: word chance at or
under 15 % by the same per-language rule as attack_chance.py, and line chance
at or under 5 % for every placer. K is one share for all songs, the smallest
that passes. A language under 30 placed words still inherits its song, as before.

The chosen clocks are written back through clock_stable and witness_slots.
Published word times are not moved. Agreement with MMS is reported and is not
a tie-break.
"""
from __future__ import annotations

import argparse
import copy
import itertools
import json
import sys
from dataclasses import dataclass

import numpy as np

import attack_chance as A
import placement as P
import qa_sync as Q
import whisper_witness as W
from common import ROOT, load_audio, vocal_stem, work_dir

FAMILIES = A.PRIMARY_FAMILIES
CUTS = A.REFUTE_STEPS
REAL = 0
N_PROBE = 8
SHIFT_PROBES = ((1, 0.15), (2, -0.15), (3, 0.25), (4, -0.25), (5, 0.40), (6, -0.40))
SHUFFLE = 7


def _clock_round(value, kind: str | None):
    """Same rounding as align._clock_round. Whisper keeps two decimals."""
    if value is None:
        return None
    if kind in ('mms', 'stable-ts'):
        return round(float(value), 3)
    return round(float(value), 2)


def _ru(value, nd: int = 3) -> str:
    if value is None:
        return '—'
    return f'{float(value):.{nd}f}'.replace('.', ',')


def chance_of_probes(probes: dict[str, tuple[int, int]]) -> float | None:
    """Max of the pooled shift rates and the shuffle rate. None when there are no words."""
    rates = []
    for mag in A.SHIFTS:
        plus = probes.get(f'{mag:.2f}+')
        minus = probes.get(f'{mag:.2f}-')
        if not plus or not minus:
            continue
        n = plus[1] + minus[1]
        if n <= 0:
            continue
        rates.append((plus[0] + minus[0]) / n)
    shuffle = probes.get('shuffle')
    if shuffle and shuffle[1] > 0:
        rates.append(shuffle[0] / shuffle[1])
    if not rates:
        return None
    return float(max(rates))


def _add_probes(left: dict[str, tuple[int, int]], right: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int]]:
    out = dict(left)
    for key, (hits, n) in right.items():
        old_h, old_n = out.get(key, (0, 0))
        out[key] = (old_h + int(hits), old_n + int(n))
    return out


def _word_probes(records: list[dict], peaks: np.ndarray, rule: dict) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for mag in A.SHIFTS:
        for sign, suffix in ((mag, '+'), (-mag, '-')):
            hits, n = A.hit_count(records, peaks, sign, rule)
            out[f'{mag:.2f}{suffix}'] = (int(hits), int(n))
    shuffled = A.shuffled_records(A._records_to_lines(records))
    hits, n = A.hit_count(shuffled, peaks, 0.0, rule)
    out['shuffle'] = (int(hits), int(n))
    return out


def line_chance_of(probe_hits, n: int) -> float | None:
    """Worst probe rate. Both signs of one magnitude share the candidate count."""
    if n <= 0:
        return None
    rates = []
    for pos, neg in ((1, 2), (3, 4), (5, 6)):
        rates.append((int(probe_hits[pos]) + int(probe_hits[neg])) / (2 * n))
    rates.append(int(probe_hits[SHUFFLE]) / n)
    return float(max(rates))


def apply_models(report: dict, by_lang: dict[str, str], peaks: np.ndarray | None = None) -> None:
    """Rewrite clock_stable from the chosen model and recompute the witness slots.

    Word s/e, the text and placed_by stay. A model that was not measured on a
    word leaves no stable clock, unless that word only has the placement model
    and that is the one being applied.
    """
    summary = report.setdefault('summary', {})
    placement = summary.get('placement_model') or summary.get('stable_model')
    summary['placement_model'] = placement
    summary['proof_models'] = {str(lang): str(model) for lang, model in by_lang.items()}
    for line in report.get('lines') or []:
        lang = line.get('lang') or '?'
        model = by_lang.get(lang)
        if not model:
            continue
        placed_by = line.get('placed_by')
        for word in line.get('words') or []:
            stored = word.get('stable_models') or {}
            if model in stored and stored[model] is not None:
                stable = round(float(stored[model]), 3)
            elif not stored and model == placement and word.get('clock_stable') is not None:
                stable = word.get('clock_stable')
            else:
                stable = None
            word['clock_stable'] = stable
            slot2, kind2, slot3, kind3 = P.witness_slots(
                placed_by, word.get('clock_mms'), word.get('clock_second'), stable)
            word['second_s'] = _clock_round(slot2, kind2)
            word['third_s'] = _clock_round(slot3, kind3)
            word['second_kind'] = kind2
            word['third_kind'] = kind3
        if peaks is None or line.get('group') not in ('solo', 'choir'):
            continue

        def _first(key: str):
            for word in line.get('words') or []:
                if word.get('roman') and word.get(key) is not None:
                    return float(word[key])
            return None

        line['dispute'] = P.dispute_row(
            line.get('id'), lang, line.get('group'), line.get('cue_start'),
            _first('clock_mms'), _first('clock_second'), _first('clock_stable'), peaks)


def _median_delta(report: dict, lang: str, model: str) -> float | None:
    deltas = []
    for line in report.get('lines') or []:
        if line.get('status') != 'good' or (line.get('lang') or '?') != lang:
            continue
        for word in line.get('words') or []:
            if not word.get('roman'):
                continue
            mms = word.get('clock_mms')
            got = (word.get('stable_models') or {}).get(model)
            if mms is None or got is None:
                continue
            deltas.append(abs(float(got) - float(mms)))
    median = W._median(deltas)
    return None if median is None else round(float(median), 3)


@dataclass
class Cell:
    words: int
    one: dict
    two: dict
    refute: np.ndarray
    hits: np.ndarray
    cand: np.ndarray
    median: float | None


@dataclass
class Variant:
    models: tuple
    modes: tuple
    word_chance: tuple
    word_why: tuple
    word_ok: bool
    hits: np.ndarray | None
    lang_hits: np.ndarray | None
    refute: np.ndarray | None
    words: int


def _modes_for(slug: str, langs: list[str], models: tuple, cells: dict) -> tuple[bool, dict, list]:
    one_pool: dict[str, tuple[int, int]] = {}
    two_pool: dict[str, tuple[int, int]] = {}
    words = 0
    for lang, model in zip(langs, models):
        cell = cells[(lang, model)]
        one_pool = _add_probes(one_pool, cell.one)
        two_pool = _add_probes(two_pool, cell.two)
        words += cell.words
    rows = [{
        'song': slug, 'lang': '*', 'words': words,
        'one': chance_of_probes(one_pool), 'two': chance_of_probes(two_pool),
    }]
    for lang, model in zip(langs, models):
        cell = cells[(lang, model)]
        rows.append({
            'song': slug, 'lang': lang, 'words': cell.words,
            'one': chance_of_probes(cell.one), 'two': chance_of_probes(cell.two),
        })
    scopes, ok = A.assign_scopes(rows)
    by = {(row['song'], row['lang']): row for row in scopes}
    return ok, by, rows


def _build_variant(song: dict, models: tuple) -> Variant:
    ok, by, _rows = _modes_for(song['slug'], song['langs'], models, song['cells'])
    modes = []
    chances = []
    whys = []
    for lang in song['langs']:
        row = by[(song['slug'], lang)]
        modes.append(row.get('witnesses') or '')
        chances.append(row.get('chance'))
        whys.append(row.get('why'))
    if not ok or any(mode not in ('one', 'two') for mode in modes):
        return Variant(models, tuple(modes), tuple(chances), tuple(whys), False, None, None, None, 0)
    n_lang = len(song['langs'])
    n_cut = len(CUTS)
    n_fam = len(FAMILIES)
    n_k = len(A.LINE_SHARES)
    hits = np.zeros((n_cut, n_fam, n_k, N_PROBE), dtype=np.int32)
    lang_hits = np.zeros((n_lang, n_cut, n_fam, n_k, N_PROBE), dtype=np.int32)
    refute = np.zeros(n_cut, dtype=np.int32)
    words = 0
    for index, (lang, model, mode) in enumerate(zip(song['langs'], models, modes)):
        cell = song['cells'][(lang, model)]
        mode_i = 0 if mode == 'one' else 1
        block = cell.hits[mode_i]
        hits += block
        lang_hits[index] = block
        refute += cell.refute
        words += cell.words
    return Variant(models, tuple(modes), tuple(chances), tuple(whys), True, hits, lang_hits, refute, words)


def decide_lines(hits: np.ndarray, cand: np.ndarray) -> dict:
    """Smallest K whose every used placer is at or under 5 %, else the nearest miss.

    `hits` is (family, K, probe) for one refutation cutoff. A placer over 5 %
    even at K = 1 is removed and the choice repeats, matching choose_with_primaries.
    """
    active = [i for i, n in enumerate(cand) if int(n) > 0]
    blocked: list[int] = []
    nearest = None
    while active:
        best = None
        for ki, share in enumerate(A.LINE_SHARES):
            ok = True
            proved = 0
            chances = []
            used = 0
            for fi in active:
                n = int(cand[fi])
                if n <= 0:
                    continue
                used += 1
                chance = line_chance_of(hits[fi, ki], n)
                proved += int(hits[fi, ki, REAL])
                if chance is None or chance > A.LINE_LIMIT + 1e-12:
                    ok = False
                else:
                    chances.append(float(chance))
            if used and not ok:
                worst = max(
                    (1.0 if line_chance_of(hits[fi, ki], int(cand[fi])) is None
                     else float(line_chance_of(hits[fi, ki], int(cand[fi])))
                     for fi in active if int(cand[fi]) > 0),
                    default=1.0)
                rank = (worst, -proved, float(share))
                if nearest is None or rank < nearest[0]:
                    nearest = (rank, ki, worst, proved)
            if used == 0 or not ok:
                continue
            rank = (proved, -float(share))
            if best is None or rank > best[0]:
                best = (rank, ki, max(chances) if chances else None, proved)
        if best is not None:
            return {
                'ok': True,
                'k_index': best[1],
                'k': float(A.LINE_SHARES[best[1]]),
                'chance': best[2],
                'proved': best[3],
                'blocked': [FAMILIES[i] for i in blocked],
            }
        last = len(A.LINE_SHARES) - 1
        worst_i = None
        worst_c = -1.0
        for fi in active:
            n = int(cand[fi])
            if n <= 0:
                continue
            chance = line_chance_of(hits[fi, last], n)
            value = 1.0 if chance is None else float(chance)
            if value > worst_c:
                worst_c = value
                worst_i = fi
        if worst_i is None or worst_c <= A.LINE_LIMIT + 1e-12:
            break
        blocked.append(worst_i)
        active = [i for i in active if i != worst_i]
    out = {
        'ok': False, 'k_index': None, 'k': None, 'chance': None, 'proved': 0,
        'blocked': [FAMILIES[i] for i in blocked],
    }
    if nearest is not None:
        out['nearest_k'] = float(A.LINE_SHARES[nearest[1]])
        out['nearest_chance'] = nearest[2]
        out['nearest_proved'] = nearest[3]
    return out


def _cut_index(refute: np.ndarray, words: int) -> int:
    rows = []
    for index, (both_far, only_far) in enumerate(CUTS):
        refuted = int(refute[index])
        rows.append({
            'both_far': both_far,
            'only_far': only_far,
            'refuted': refuted,
            'words': words,
            'rate': 0.0 if words <= 0 else refuted / words,
        })
    chosen = A.choose_refute(rows)
    both = float(chosen['both_far'])
    only = float(chosen['only_far'])
    for index, cut in enumerate(CUTS):
        if abs(cut[0] - both) < 1e-9 and abs(cut[1] - only) < 1e-9:
            return index
    raise RuntimeError(f'refute cut {both}/{only} is outside the measured grid')


def eval_variants(variants: list[Variant], songs: list[dict]) -> dict:
    """Word gate is already on the variant. Line gate is joint, one K for every song."""
    if any(not variant.word_ok or variant.hits is None for variant in variants):
        chances = []
        for variant in variants:
            chances.extend(None if value is None else float(value) for value in variant.word_chance)
        return {
            'ok': False, 'word_ok': False, 'k': None, 'k_index': None, 'chance': None,
            'proved': 0, 'cut_index': 0, 'blocked': [], 'pair_proved': [],
            'pair_line_chance': [], 'pair_word_chance': chances, 'words': 0, 'refuted': 0,
        }
    hits = variants[0].hits
    refute = variants[0].refute
    words = variants[0].words
    cand = songs[0]['cand']
    for variant, song in zip(variants[1:], songs[1:]):
        hits = hits + variant.hits
        refute = refute + variant.refute
        words += variant.words
        cand = cand + song['cand']
    cut_i = _cut_index(refute, words)
    decision = decide_lines(hits[cut_i], cand)
    blocked = set(decision['blocked'])
    pair_proved = []
    pair_line = []
    pair_word = []
    for variant, song in zip(variants, songs):
        for lang_i, chance in enumerate(variant.word_chance):
            proved = 0
            chances = []
            for fi, name in enumerate(FAMILIES):
                n = int(song['cand_lang'][lang_i, fi])
                if name in blocked or n <= 0 or decision['k_index'] is None:
                    continue
                row = variant.lang_hits[lang_i, cut_i, fi, decision['k_index']]
                proved += int(row[REAL])
                chances.append(line_chance_of(row, n))
            pair_proved.append(proved)
            nums = [value for value in chances if value is not None]
            pair_line.append(None if not nums else max(nums))
            pair_word.append(None if chance is None else float(chance))
    return {
        'ok': bool(decision['ok']),
        'word_ok': True,
        'k': decision['k'],
        'k_index': decision['k_index'],
        'chance': decision['chance'],
        'proved': int(decision['proved']) if decision['ok'] else 0,
        'cut_index': cut_i,
        'blocked': list(decision['blocked']),
        'pair_proved': pair_proved,
        'pair_line_chance': pair_line,
        'pair_word_chance': pair_word,
        'words': words,
        'refuted': int(refute[cut_i]),
        'nearest_k': decision.get('nearest_k'),
        'nearest_chance': decision.get('nearest_chance'),
        'nearest_proved': decision.get('nearest_proved'),
    }


def search(songs: list[dict]) -> dict | None:
    """The valid assignment that puts the most pairs on their own maximum.

    Ties break toward more proved lines, then the earlier pair, then the model
    name in alphabet order. Agreement is not a key.
    """
    lists = []
    for song in songs:
        usable = [variant for variant in song['variants'] if variant.word_ok]
        if not usable:
            return None
        lists.append(usable)
    pair_n = sum(len(song['langs']) for song in songs)
    max_proved = [0] * pair_n
    model_max: list[dict[str, int]] = [{} for _ in range(pair_n)]
    found = False
    for combo in itertools.product(*lists):
        decision = eval_variants(list(combo), songs)
        if not decision['ok']:
            continue
        found = True
        cursor = 0
        for variant in combo:
            for model, proved in zip(variant.models, decision['pair_proved'][cursor:]):
                if proved > max_proved[cursor]:
                    max_proved[cursor] = proved
                best = model_max[cursor].get(model)
                if best is None or proved > best:
                    model_max[cursor][model] = proved
                cursor += 1
    if not found:
        return None
    best = None
    best_key = None
    for combo in itertools.product(*lists):
        decision = eval_variants(list(combo), songs)
        if not decision['ok']:
            continue
        at = sum(1 for got, cap in zip(decision['pair_proved'], max_proved) if got == cap)
        model_tuple = tuple(model for variant in combo for model in variant.models)
        key = (-at, -int(decision['proved']), tuple(-p for p in decision['pair_proved']), model_tuple)
        if best_key is None or key < best_key:
            best_key = key
            best = {
                'combo': list(combo),
                'decision': decision,
                'max_proved': list(max_proved),
                'model_max': model_max,
                'at_max': at,
            }
    return best


def _check_word(records: list[dict], peaks: np.ndarray, probes: dict, rule: dict) -> None:
    direct = A._slice_chance(records, peaks, rule)
    mine = chance_of_probes(probes)
    if direct is None and mine is None:
        return
    if direct is None or mine is None or abs(float(direct) - float(mine)) > 1e-9:
        raise RuntimeError(f'word chance drifted: direct {direct} cached {mine}')


def _check_lines(all_lines: list[dict], peaks: np.ndarray, song: dict, cells: dict, model: str) -> None:
    modes = {(song['slug'], lang): 'one' for lang in song['langs']}
    refute = A._refute_cut(*CUTS[0])
    share = A.LINE_SHARES[-1]
    hits, n = A.line_pass_count(all_lines, peaks, modes, refute, share, shift=0.0)
    cached = 0
    last = len(A.LINE_SHARES) - 1
    for lang in song['langs']:
        cached += int(cells[(lang, model)].hits[0, 0, :, last, REAL].sum())
    if cached != hits:
        raise RuntimeError(f'{song["slug"]} {model}: line proof {cached} != {hits}')
    _hits, n_direct = A.line_pass_count(all_lines, peaks, modes, refute, share, shift=0.15)
    cached_n = int(sum(int(cells[(lang, model)].cand.sum()) for lang in song['langs']))
    if cached_n != n or cached_n != n_direct:
        raise RuntimeError(f'{song["slug"]} {model}: candidates {cached_n} != {n}')


def _prepare_song(slug: str, report: dict, peaks: np.ndarray, bias: dict, adopt: dict) -> dict:
    base = A.placed_lines(report, bias, adopt, only_good=True)
    for line in base:
        line['song'] = slug
    langs = sorted({line['lang'] for line in base})
    if not langs:
        raise RuntimeError(f'{slug}: no placed words to choose a witness for')
    present = set()
    for line in report.get('lines') or []:
        if line.get('status') != 'good':
            continue
        for word in line.get('words') or []:
            present.update((word.get('stable_models') or {}).keys())
    models = [name for name in W.MODELS if name in present]
    if not models:
        raise RuntimeError(f'{slug}: placed windows have no saved Whisper clocks')
    one_rule, two_rule = A.witness_rules()
    cells: dict[tuple[str, str], Cell] = {}
    shape = (2, len(CUTS), len(FAMILIES), len(A.LINE_SHARES), N_PROBE)
    for model in models:
        copied = copy.deepcopy(report)
        apply_models(copied, {lang: model for lang in langs})
        all_lines = A.placed_lines(copied, bias, adopt, only_good=False)
        for line in all_lines:
            line['song'] = slug
        placed = [line for line in all_lines if line.get('placed')]
        grouped: dict[str, list] = {lang: [] for lang in langs}
        for line in placed:
            if line['lang'] in grouped:
                grouped[line['lang']].append(line)
        partial: dict[str, dict] = {}
        for lang in langs:
            records = A._flat(grouped[lang])
            one = _word_probes(records, peaks, one_rule)
            two = _word_probes(records, peaks, two_rule)
            _check_word(records, peaks, one, one_rule)
            _check_word(records, peaks, two, two_rule)
            refute = np.zeros(len(CUTS), dtype=np.int32)
            for cut_i, cut in enumerate(CUTS):
                spec = A._refute_cut(*cut)
                for line in grouped[lang]:
                    for word in line['words']:
                        why = Q.word_refuted(
                            {'ctc_s': word['t'], 'second_s': word.get('second'), 'third_s': word.get('third')},
                            peaks, spec)
                        if why:
                            refute[cut_i] += 1
            partial[lang] = {
                'words': len(records),
                'one': one,
                'two': two,
                'refute': refute,
                'hits': np.zeros(shape, dtype=np.int32),
                'cand': np.zeros(len(FAMILIES), dtype=np.int32),
            }
        for mode_i, mode in enumerate(('one', 'two')):
            modes = {(slug, item): mode for item in langs}
            for cut_i, cut in enumerate(CUTS):
                spec = A._refute_cut(*cut)
                probes = [(REAL, 0.0, False)] + [(index, shift, False) for index, shift in SHIFT_PROBES]
                probes.append((SHUFFLE, 0.0, True))
                for probe_i, shift, shuffle in probes:
                    parts = A.line_probe_parts(all_lines, peaks, modes, spec, shift=shift, shuffle=shuffle)
                    for item in parts:
                        bucket = partial.get(item['lang'])
                        if bucket is None:
                            continue
                        fi = FAMILIES.index(item['family'])
                        if mode_i == 0 and cut_i == 0 and probe_i == REAL:
                            bucket['cand'][fi] += 1
                        for ki, share in enumerate(A.LINE_SHARES):
                            if Q.line_word_ok(item['proved'], item['flags'], share):
                                bucket['hits'][mode_i, cut_i, fi, ki, probe_i] += 1
        for lang, item in partial.items():
            cells[(lang, model)] = Cell(
                item['words'], item['one'], item['two'], item['refute'], item['hits'], item['cand'],
                _median_delta(report, lang, model))
        _check_lines(all_lines, peaks, {'slug': slug, 'langs': langs}, cells, model)
    cand = np.zeros(len(FAMILIES), dtype=np.int32)
    for lang in langs:
        cand += cells[(lang, models[0])].cand
    cand_lang = np.zeros((len(langs), len(FAMILIES)), dtype=np.int32)
    for li, lang in enumerate(langs):
        cand_lang[li] = cells[(lang, models[0])].cand
        for model in models[1:]:
            if not np.array_equal(cand_lang[li], cells[(lang, model)].cand):
                raise RuntimeError(f'{slug} {lang}: candidates differ between models')
    variants = []
    for combo in itertools.product(models, repeat=len(langs)):
        variants.append(_build_variant({
            'slug': slug, 'langs': langs, 'cells': cells, 'cand': cand, 'cand_lang': cand_lang,
        }, combo))
    word_ok = sum(1 for variant in variants if variant.word_ok)
    print(f'{slug}: языков {len(langs)}, моделей {len(models)}, '
          f'раскладок в пределе слова {word_ok} из {len(variants)}', flush=True)
    return {
        'slug': slug,
        'langs': langs,
        'models': models,
        'cells': cells,
        'cand': cand,
        'cand_lang': cand_lang,
        'variants': variants,
    }


def _assignment(songs: list[dict], combo: list[Variant]) -> dict[str, dict[str, str]]:
    out = {}
    for song, variant in zip(songs, combo):
        out[song['slug']] = {lang: model for lang, model in zip(song['langs'], variant.models)}
    return out


def _pair_rows(songs: list[dict], found: dict) -> list[dict]:
    rows = []
    cursor = 0
    decision = found['decision']
    for song, variant in zip(songs, found['combo']):
        for lang_i, lang in enumerate(song['langs']):
            model = variant.models[lang_i]
            cell = song['cells'][(lang, model)]
            rows.append({
                'song': song['slug'],
                'lang': lang,
                'model': model,
                'mode': variant.modes[lang_i],
                'why_scope': variant.word_why[lang_i],
                'proved': decision['pair_proved'][cursor],
                'max_proved': found['max_proved'][cursor],
                'model_max': dict(found['model_max'][cursor]),
                'word_chance': decision['pair_word_chance'][cursor],
                'line_chance': decision['pair_line_chance'][cursor],
                'median': cell.median,
                'words': cell.words,
                'candidates': int(song['cand_lang'][lang_i].sum()),
            })
            cursor += 1
    return rows


def _uniform(songs: list[dict]) -> list[dict]:
    rows = []
    for model in W.MODELS:
        missing = [song['slug'] for song in songs if model not in song['models']]
        if missing:
            rows.append({'model': model, 'ran': False, 'missing': missing, 'ok': False, 'proved': 0})
            continue
        combo = []
        for song in songs:
            match = next(variant for variant in song['variants'] if all(name == model for name in variant.models))
            combo.append(match)
        decision = eval_variants(combo, songs)
        by_song = {}
        cursor = 0
        for song, variant in zip(songs, combo):
            proved = 0
            if decision['pair_proved']:
                proved = sum(decision['pair_proved'][cursor:cursor + len(song['langs'])])
            cursor += len(song['langs'])
            by_song[song['slug']] = proved
        worst_word = None
        for value in decision['pair_word_chance']:
            if value is None:
                continue
            worst_word = value if worst_word is None else max(worst_word, value)
        rows.append({
            'model': model,
            'ran': True,
            'missing': [],
            'ok': bool(decision['ok']),
            'word_ok': bool(decision['word_ok']),
            'proved': int(decision['proved']),
            'k': decision['k'],
            'line_chance': decision['chance'],
            'word_chance': worst_word,
            'by_song': by_song,
            'blocked': decision['blocked'],
        })
    return rows


def _per_song(songs: list[dict], combo: list[Variant]) -> list[dict]:
    rows = []
    for song, variant in zip(songs, combo):
        decision = eval_variants([variant], [song])
        rows.append({
            'song': song['slug'],
            'ok': bool(decision['ok']),
            'k': decision['k'],
            'chance': decision['chance'],
            'proved': int(decision['proved']),
        })
    return rows


def _why(row: dict) -> str:
    bits = []
    for model in W.MODELS:
        if model in row['model_max']:
            bits.append(f'{model} {row["model_max"][model]}')
        else:
            bits.append(f'{model} —')
    text = 'В допустимых раскладках доказано строк: ' + ', '.join(bits) + '. '
    if row['proved'] == row['max_proved']:
        text += f"Выбрана `{row['model']}`: у этой пары это максимум, {row['proved']} строк."
    else:
        text += (
            f"Выбрана `{row['model']}` с {row['proved']} строками: максимум пары {row['max_proved']} "
            'не совмещается с максимумами остальных пар.'
        )
    if row['why_scope'] == 'song-fallback':
        text += ' Слов меньше 30, поэтому проход слова взят у песни, как и раньше.'
    return text


def render(result: dict) -> str:
    decision = result['decision']
    cut = CUTS[decision['cut_index']]
    per_song = result['per_song']
    per_sum = sum(row['proved'] for row in per_song if row['ok'])
    lines = [
        '# Выбор свидетеля',
        '',
        'Для каждой пары песня/язык берётся модель, при которой доказано больше всего строк. '
        'Считаются только раскладки, где проход слова не выше 15 % (тем же правилом, что и раньше: '
        'язык короче 30 слов наследует песню) и где одно общее K держит проход строки каждого '
        'постановщика не выше 5 %. K — наименьшая такая доля. Согласие с MMS в выбор не входит, '
        'медиана ниже только для чтения.',
        '',
        'K одно на все песни, а не по песне. Предел 5 % — свойство постановщика: общий замер '
        'устойчивее, и отдельное K на песню пропустило бы постановщика, который на песнях вместе '
        'предел не держит. На выбранных моделях отдельное K дало бы '
        + ', '.join(
            f"{row['song']} K = {_ru(row['k'], 2)} ({row['proved']} строк)" if row['ok']
            else f"{row['song']} без доли в пределе"
            for row in per_song
        )
        + f", всего {per_sum}. Общее K = {_ru(decision['k'], 2)} доказывает {decision['proved']}. "
        'В доказательство идёт общее.',
        '',
        f"Выбрано общее K = {_ru(decision['k'], 2)}, случайный проход строки {_ru(decision['chance'])}, "
        f"доказано {decision['proved']}. Опровержение {_ru(cut[0], 2)} / {_ru(cut[1], 2)}: "
        f"{decision['refuted']} из {decision['words']}.",
        '',
        'Пар на своём максимуме: ' + f"{result['at_max']} из {len(result['pairs'])}.",
        '',
        '| песня | язык | модель | доказано | проход слова | проход строки | медиана \\|свидетель − MMS\\| |',
        '|---|---|---|---:|---:|---:|---:|',
    ]
    for row in result['pairs']:
        lines.append(
            f"| {row['song']} | {row['lang']} | `{row['model']}` | {row['proved']} | "
            f"{_ru(row['word_chance'])} | {_ru(row['line_chance'])} | {_ru(row['median'])} |"
        )
    lines += ['', '## Почему эта модель', '']
    for row in result['pairs']:
        lines.append(f"- {row['song']} / {row['lang']}. {_why(row)}")
    lines += [
        '',
        'Проход строки в таблице пары — худший проход её собственных строк на выбранном K. '
        'Предел проверяется не по паре, а по постановщику на всех песнях вместе: '
        f"он {_ru(decision['chance'])}.",
        '',
        '## Одна модель на все пары',
        '',
        'Та же проверка. Это не выбор, а сравнение.',
        '',
        '| модель | в пределе | K | доказано | проход строки | худший проход слова |',
        '|---|---|---:|---:|---:|---:|',
    ]
    for row in result['uniform']:
        if not row['ran']:
            lines.append(f"| `{row['model']}` | нет | — | — | — | — |")
            continue
        lines.append(
            f"| `{row['model']}` | {'да' if row['ok'] else 'нет'} | {_ru(row['k'], 2)} | {row['proved']} | "
            f"{_ru(row['line_chance'])} | {_ru(row['word_chance'])} |"
        )
    shift = result.get('window_shift') or {}
    lines += ['', '## Первое слово другого окна MMS', '', W.window_shift_paragraph(shift), '']
    return '\n'.join(lines)


def _official(slugs: list[str], reports: dict, peaks: dict, bias: dict, adopt: dict) -> dict:
    per_song = []
    for slug in slugs:
        all_lines = A.placed_lines(reports[slug], bias, adopt, only_good=False)
        for line in all_lines:
            line['song'] = slug
        per_song.append({
            'slug': slug,
            'lines': [line for line in all_lines if line.get('placed')],
            'all_lines': all_lines,
            'sets': {A.WITNESS_HEIGHT: {False: peaks[slug]}},
        })
    # measure_scope_rows and the line table only read sets[(0.7, False)].
    fixed = []
    for song in per_song:
        song = dict(song)
        song['sets'] = {(A.WITNESS_HEIGHT, False): peaks[song['slug']]}
        fixed.append(song)
    scopes, scopes_ok = A.assign_scopes(A.measure_scope_rows(fixed))
    refute = A.choose_refute(A.measure_refute(fixed))
    modes = {(row['song'], row['lang']): row['witnesses'] for row in scopes if row.get('witnesses') in ('one', 'two')}
    picked = A.choose_with_primaries(A.measure_primary_tables(fixed, modes, refute))
    return {'scopes_ok': scopes_ok, 'scopes': scopes, 'refute': refute, 'picked': picked}


def _close(left, right) -> bool:
    if left is None or right is None:
        return left is None and right is None
    return abs(float(left) - float(right)) <= 1e-9


def verify(result: dict, official: dict) -> None:
    picked = official['picked']
    decision = result['decision']
    if not official['scopes_ok'] or not picked.get('within_limit') or not decision['ok']:
        raise RuntimeError('the chosen assignment is outside the caps')
    if not _close(picked.get('k'), decision['k']) or int(picked.get('proved') or 0) != int(decision['proved']):
        raise RuntimeError(
            f"choice {decision['k']} / {decision['proved']} != measured {picked.get('k')} / {picked.get('proved')}")
    by_song = picked.get('by_song') or {}
    got: dict[str, int] = {}
    for row in result['pairs']:
        got[row['song']] = got.get(row['song'], 0) + int(row['proved'])
    for slug, proved in by_song.items():
        if int(proved) != int(got.get(slug, 0)):
            raise RuntimeError(f'{slug}: pair sum {got.get(slug, 0)} != measured {proved}')
    scopes = {(row['song'], row['lang']): row for row in official['scopes']}
    for row in result['pairs']:
        scope = scopes.get((row['song'], row['lang']))
        if scope is None or scope.get('witnesses') != row['mode']:
            raise RuntimeError(f"{row['song']} {row['lang']}: witness mode drifted")
        if not _close(scope.get('chance'), row['word_chance']):
            raise RuntimeError(
                f"{row['song']} {row['lang']}: word chance {row['word_chance']} != {scope.get('chance')}")
    blocked = set(picked.get('blocked_primaries') or [])
    if blocked != set(decision['blocked']):
        raise RuntimeError(f"blocked placers {decision['blocked']} != {sorted(blocked)}")


def choose(slugs: list[str], reports: dict, peaks: dict, bias: dict | None = None,
           adopt: dict | None = None) -> dict:
    bias = bias or {}
    adopt = adopt or {}
    songs = [_prepare_song(slug, reports[slug], peaks[slug], bias, adopt) for slug in slugs]
    found = search(songs)
    if found is None:
        raise RuntimeError('no assignment keeps the word chance and the line chance inside the caps')
    assignment = _assignment(songs, found['combo'])
    for slug, by_lang in assignment.items():
        apply_models(reports[slug], by_lang, peaks[slug])
    decision = found['decision']
    result = {
        'assignment': assignment,
        'decision': decision,
        'pairs': _pair_rows(songs, found),
        'uniform': _uniform(songs),
        'per_song': _per_song(songs, found['combo']),
        'at_max': found['at_max'],
        'window_shift': W.window_shift([
            row for slug in slugs for row in W.window_rows_from_report(reports[slug], slug)
        ]),
    }
    verified = _official(slugs, reports, peaks, bias, adopt)
    verify(result, verified)
    result['official_k'] = verified['picked'].get('k')
    result['official_proved'] = verified['picked'].get('proved')
    return result


def _load_bias() -> tuple[dict, dict]:
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'aligner-review.json'
    if not path.exists():
        return {}, {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}, {}
    bias = {}
    for key, value in (data.get('bias') or {}).items():
        try:
            bias[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    adopt = {str(k): str(v) for k, v in (data.get('adopt') or {}).items() if isinstance(v, str) and v}
    return bias, adopt


def _peaks(slug: str) -> np.ndarray:
    import features as F

    audio, is_stem = vocal_stem(slug, None)
    if not is_stem:
        raise RuntimeError(f'{slug}: no vocal stem')
    sig = Q.Signals(load_audio(audio, F.SR))
    return Q.onset_peak_times(sig, min_height=A.WITNESS_HEIGHT)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--choose', action='store_true')
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    if not args.choose:
        ap.error('нужен --choose')
    try:
        bias, adopt = _load_bias()
        reports = {}
        peaks = {}
        for slug in args.slugs:
            path = work_dir(slug) / 'align-report.json'
            if not path.exists():
                raise RuntimeError(f'{slug}: нет work/{slug}/align-report.json')
            reports[slug] = json.loads(path.read_text(encoding='utf-8'))
            peaks[slug] = _peaks(slug)
        result = choose(args.slugs, reports, peaks, bias, adopt)
    except Exception as e:
        print(f'выбор свидетеля не собран ({e.__class__.__name__}: {e})', flush=True)
        return 2
    out_dir = ROOT / 'docs' / 'analysis' / 'bench'
    out_dir.mkdir(parents=True, exist_ok=True)
    public = {
        'k': result['decision']['k'],
        'line_chance': result['decision']['chance'],
        'proved': result['decision']['proved'],
        'refuted': result['decision']['refuted'],
        'words': result['decision']['words'],
        'cut': list(CUTS[result['decision']['cut_index']]),
        'blocked': result['decision']['blocked'],
        'at_max': result['at_max'],
        'assignment': result['assignment'],
        'pairs': result['pairs'],
        'uniform': result['uniform'],
        'per_song': result['per_song'],
        'window_shift': result['window_shift'],
    }
    (out_dir / 'whisper-choice.json').write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding='utf-8')
    (out_dir / 'whisper-choice.md').write_text(render(result), encoding='utf-8')
    for slug in args.slugs:
        report = reports[slug]
        path = work_dir(slug) / 'align-report.json'
        path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
        cache_path = ROOT / 'docs' / 'analysis' / slug / 'whisper-clocks.json'
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        summary = report.get('summary') or {}
        cache = W.clock_cache(report, summary.get('placement_model'), summary.get('proof_models') or {})
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        named = ', '.join(f'{lang} {model}' for lang, model in sorted((summary.get('proof_models') or {}).items()))
        print(f'{slug}: свидетель {named}', flush=True)
    decision = result['decision']
    print(f"K {decision['k']}: доказано {decision['proved']}, проход строки {decision['chance']}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
