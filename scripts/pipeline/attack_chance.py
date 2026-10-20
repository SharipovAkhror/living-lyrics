"""How often a random word start still lands on a vocal attack.

    python3 scripts/pipeline/attack_chance.py --choose <slug> [<slug>…]

Runs after every song in the job has been aligned and before qa. It reads
work/<slug>/align-report.json and the vocal stem, measures attack density and
the chance that a shifted word start still passes the attack test, and writes
docs/analysis/bench/attack-chance.json and attack-chance.md.

Singing puts an attack on almost every note. If those attacks sit about 0.2 s
apart, a time 0.15 s off the true start is still within 0.10 s of some attack,
and the attack test does not prove the word.

The word rule is chosen per song and per language, not on the pooled words.
For each pair with at least 30 placed words, `attack-h0.7-one` (a strong attack
plus one independent clock within 0.10 s) is kept when its own chance is at or
under 15 %. Otherwise `attack-h0.7-two` (both clocks) is kept when that chance
is at or under 15 %. A language with fewer than 30 words inherits the song's
decision. If a required slice is over 15 % on both, the measurement fails and
qa does not run. The older tolerance grid is still scored and stored. It does
not become the rule, and it does not rescue a slice that missed both witness
tests.

A word is refuted, separately from being unproved, when both clocks agree with
each other and both sit far from MMS, or when the only clock is far from MMS
and a strong attack sits on that clock but not on MMS. The cutoffs start at
0.20 s and 0.30 s. They step stricter only when that pair refutes more than
15 % of placed words. Missing the cap does not by itself fail the run.

A line is proved when its start is within 0.30 s of the cue, no word is
refuted, and at least K of its words are proved (at least two). K is the
smallest share whose line chance is at or under 5 % for every aligner that
placed a line. The line chance shifts that placer's starts inside the line by
the same ±0.15, ±0.25 or ±0.4 s, and rotates them. The cue is not retested on
the shifted start. Witness clocks stay put. One-word lines are left out of
that rate. A placer still over 5 % at K = 1 is excluded from proof; the others
may still pass.

Exit 2 when a song has no stem or no align report, when a required slice stays
over 15 %, or when no K keeps the line chance at or under 5 %. qa must not run
on an unmeasured rule.

A phoneme witness is admitted after that choice, per song and language. Its
word chance must stay at or under 15 %, and the same line measurement on the
stamped clocks must stay at or under 5 % and prove strictly more lines. The
search only proposes the stamp. The measurement after the stamp is the judge.
A mismatch, or any error in that search, publishes the unstamped rule. The
witness role does not place a line and does not refute a word. A separate
pass may hand a refuted line to a later placer, and may place a still-open
Latin line from the phoneme aligner. Each of those is kept only when proved
lines rise and every gate still holds. A choir feature (the level-rise
envelope, or the vowel nucleus) is kept only when the choir sample itself
stays inside those caps and the solo lines do not change.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys

import numpy as np

import placement as P
import qa_sync as Q
from common import ROOT, load_audio, song_dir, vocal_stem, work_dir

LIMIT = 0.15
SHIFTS = (0.15, 0.25, 0.40)
HEIGHTS = (0.5, 0.7, 0.9, 1.2)
TOLS = (0.10, 0.08, 0.06, 0.05, 0.04)
SECOND_TOL = Q.SECOND_WORD_TOL
MIN_WORDS = 30
LINE_LIMIT = 0.05
LINE_SHARES = (0.25, 0.33, 0.40, 0.50, 0.60, 0.67, 0.75, 0.80, 0.90, 1.00)
REFUTE_CAP = 0.15
REFUTE_PROPOSAL = (0.20, 0.30)
REFUTE_STEPS = ((0.20, 0.30), (0.20, 0.40), (0.30, 0.30), (0.30, 0.40))
REFUTE_GRID = tuple((both_far, only_far) for both_far in (0.15, 0.20, 0.30) for only_far in (0.20, 0.30, 0.40))
WITNESS_HEIGHT = 0.7


def is_current(rule: dict) -> bool:
    return (abs(float(rule['tol']) - 0.10) < 1e-9
            and abs(float(rule['peak_height']) - 0.5) < 1e-9
            and not rule.get('require_rise')
            and not rule.get('require_second'))


def iter_rules() -> list[dict]:
    rules = []
    for height in HEIGHTS:
        for tol in TOLS:
            for rise in (False, True):
                for second in (False, True):
                    if rise and second:
                        continue
                    name = f'tol-{tol:.2f}-h{height:.1f}'
                    if rise:
                        name += '-rise'
                    if second:
                        name += '-second'
                    rules.append({
                        'name': name,
                        'tol': tol,
                        'choir_tol': round(tol * 2, 2),
                        'peak_height': height,
                        'require_rise': rise,
                        'require_second': second,
                    })
    return rules


def witness_rules() -> list[dict]:
    """Strong attack plus one independent clock, then both. Measured before the older grid."""
    base = {
        'tol': 0.10,
        'choir_tol': 0.20,
        'peak_height': 0.7,
        'require_rise': False,
        'require_second': False,
        'agree_tol': SECOND_TOL,
    }
    return [
        dict(base, name='attack-h0.7-one', witnesses='one'),
        dict(base, name='attack-h0.7-two', witnesses='two'),
    ]


def median_interval(peaks: np.ndarray) -> float | None:
    if len(peaks) < 2:
        return None
    gaps = np.diff(np.sort(np.asarray(peaks, dtype=float)))
    gaps = gaps[gaps > 1e-6]
    if len(gaps) == 0:
        return None
    return float(np.median(gaps))


def intervals_in_spans(peaks: np.ndarray, spans: list[tuple[float, float]]) -> list[float]:
    gaps: list[float] = []
    if len(peaks) == 0:
        return gaps
    ordered = np.sort(np.asarray(peaks, dtype=float))
    for a, b in spans:
        sel = ordered[(ordered >= a) & (ordered <= b)]
        if len(sel) >= 2:
            gaps.extend(float(g) for g in np.diff(sel) if g > 1e-6)
    return gaps


def _near_mask(times: np.ndarray, peaks: np.ndarray, tol: float) -> np.ndarray:
    if len(times) == 0:
        return np.zeros(0, dtype=bool)
    if len(peaks) == 0:
        return np.zeros(len(times), dtype=bool)
    dist = np.abs(times[:, None] - np.asarray(peaks, dtype=float)[None, :]).min(axis=1)
    return dist <= tol + 1e-12


def hit_count(records: list[dict], peaks: np.ndarray, shift: float, rule: dict,
              fill_peaks: np.ndarray | None = None) -> tuple[int, int]:
    """How many probe times pass this rule's attack test, and how many were tested.

    `fill_peaks` adds the envelope. A time hits when either curve is inside the
    group tolerance. The line probe still prefers the spectral peak when that
    peak is already inside the tolerance; for this binary rate the two agree.
    """
    if not records:
        return 0, 0
    hits = 0
    for group, tol in (('solo', float(rule['tol'])), ('choir', float(rule['choir_tol'])), ('other', float(rule['tol']))):
        rows = [r for r in records if r.get('group', 'solo') == group]
        if not rows:
            continue
        times = np.array([float(r['t']) + shift for r in rows], dtype=float)
        mask = _near_mask(times, peaks, tol)
        if fill_peaks is not None and len(fill_peaks):
            mask = mask | _near_mask(times, fill_peaks, tol)
        mode = rule.get('witnesses')
        if mode in ('one', 'two'):
            agree = float(rule.get('agree_tol', SECOND_TOL))

            def column(key: str) -> np.ndarray:
                return np.array([np.nan if r.get(key) is None else float(r[key]) for r in rows])

            sec = column('second')
            third = column('third')
            sec_ok = np.isfinite(sec) & (np.abs(sec - times) <= agree + 1e-12)
            third_ok = np.isfinite(third) & (np.abs(third - times) <= agree + 1e-12)
            legacy = sec_ok & third_ok if mode == 'two' else (sec_ok | third_ok)
            roles = np.array([r.get('phoneme_role') or 'off' for r in rows])
            phon = column('phoneme')
            phon_ok = np.isfinite(phon) & (np.abs(phon - times) <= agree + 1e-12)
            witness_ok = np.array(legacy, dtype=bool)
            if np.any(roles != 'off'):
                witness_ok = np.where(roles == 'only', phon_ok, witness_ok)
                witness_ok = np.where(roles == 'or', legacy | phon_ok, witness_ok)
                witness_ok = np.asarray(witness_ok, dtype=bool)
            mask = mask & witness_ok
        elif rule.get('require_second'):
            seconds = np.array([np.nan if r.get('second') is None else float(r['second']) for r in rows])
            mask = mask & np.isfinite(seconds) & (np.abs(seconds - times) <= SECOND_TOL)
        hits += int(mask.sum())
    return hits, len(records)


def hit_rate(records: list[dict], peaks: np.ndarray, shift: float, rule: dict) -> float | None:
    """Share of probe times that pass. None when there are no words."""
    hits, n = hit_count(records, peaks, shift, rule)
    if n == 0:
        return None
    return hits / n


def shuffled_records(lines: list[dict]) -> list[dict]:
    """Each word takes the next word's start inside its line. One-word lines are left out."""
    out = []
    for line in lines:
        words = line['words']
        if len(words) < 2:
            continue
        rotated = words[1:] + words[:1]
        for word, src in zip(words, rotated):
            moved = dict(word)
            moved['t'] = float(src['t'])
            out.append(moved)
    return out


def chance_of(records: list[dict], peaks: np.ndarray, rule: dict, shuffled: list[dict] | None = None) -> dict:
    """Pass rate at each shift magnitude (both signs pooled) and after a within-line rotation."""
    rates = {}
    for mag in SHIFTS:
        parts = []
        weights = []
        for sign in (mag, -mag):
            rate = hit_rate(records, peaks, sign, rule)
            if rate is None:
                continue
            parts.append(rate)
            weights.append(len(records))
        rates[f'{mag:.2f}'] = None if not parts else float(sum(p * w for p, w in zip(parts, weights)) / sum(weights))
    rot = shuffled if shuffled is not None else []
    rates['shuffle'] = hit_rate(rot, peaks, 0.0, rule)
    nums = [v for v in rates.values() if v is not None]
    rates['chance'] = None if not nums else float(max(nums))
    return rates


def true_proof(lines: list[dict], peaks: np.ndarray, rule: dict) -> tuple[int, int]:
    """Words on placed lines that prove_words accepts, in song order."""
    proved = 0
    total = 0
    prev: float | None = None
    for line in lines:
        tol = float(rule['choir_tol']) if line.get('group') == 'choir' else float(rule['tol'])
        align_words = []
        presnap: list[float | None] = []
        line_prev: float | None = None
        for word in line['words']:
            align_words.append({
                'roman': word['roman'],
                'ctc_s': word['t'],
                'ctc_e': word.get('ctc_e'),
                'second_s': word.get('second'),
                'third_s': word.get('third'),
                'phoneme_s': word.get('phoneme'),
                'phoneme_role': word.get('phoneme_role'),
            })
            owned = None if prev is None else prev + tol
            dt = Q.nearest_attack(float(word['t']), peaks, owned)
            presnap.append(dt)
            prev = float(word['t'])
        for word in Q.prove_words(
                align_words, presnap, tol,
                require_second=bool(rule.get('require_second')),
                witnesses=rule.get('witnesses'),
                agree_tol=float(rule.get('agree_tol', SECOND_TOL))):
            total += 1
            if word['path'] != 'fail':
                proved += 1
    return proved, total


def choose(rows: list[dict]) -> dict:
    """Pick the word rule. See the module docstring. `rows` are measured candidates."""
    def eligible(row: dict) -> bool:
        chance = row.get('chance')
        return chance is not None and float(chance) <= LIMIT + 1e-12

    for name, why in (('attack-h0.7-one', 'witness-one'), ('attack-h0.7-two', 'witness-two')):
        row = next((item for item in rows if item.get('name') == name), None)
        if row is not None and eligible(row):
            out = dict(row)
            out['within_limit'] = True
            out['why'] = why
            return out

    current = next((row for row in rows if is_current(row)), None)
    if current is not None and eligible(current):
        out = dict(current)
        out['within_limit'] = True
        out['why'] = 'current'
        return out
    pool = [row for row in rows if eligible(row)]
    if pool:
        pool.sort(key=lambda row: (
            -float(row.get('true_rate') or 0.0),
            -float(row['tol']),
            float(row['peak_height']),
            1 if row.get('require_second') else 0,
            1 if row.get('require_rise') else 0,
            row['name'],
        ))
        out = dict(pool[0])
        out['within_limit'] = True
        out['why'] = 'tightened'
        return out
    ranked = [row for row in rows if row.get('chance') is not None]
    if not ranked:
        out = dict(Q.default_word_rule())
        out['chance'] = None
        out['true_rate'] = None
        out['within_limit'] = False
        out['why'] = 'unmeasured'
        return out
    ranked.sort(key=lambda row: (float(row['chance']), -float(row.get('true_rate') or 0.0), row['name']))
    out = dict(ranked[0])
    out['within_limit'] = False
    out['why'] = 'none-under-limit'
    return out


def _round(x: float | None, nd: int = 4) -> float | None:
    if x is None:
        return None
    return round(float(x), nd)


def _ru(x: float | None, nd: int = 3) -> str:
    if x is None:
        return '—'
    return f'{float(x):.{nd}f}'.replace('.', ',')


def _phoneme_clock(word: dict) -> float | None:
    """First completed espeak model's start. A missing key is a model that did not run."""
    table = word.get('phoneme_models') or {}
    for name in ('xlsr-53-espeak', 'lv-60-espeak'):
        if name not in table:
            continue
        value = table.get(name)
        return None if value is None else float(value)
    return None


def _report_index(report: dict) -> tuple[dict, dict, dict]:
    """Next cue, report order and the raw line, keyed by id.

    The next cue is the following line's cue, not the next cue that exists.
    A line with no cue leaves the previous line uncapped.
    """
    raw_lines = report.get('lines') or []
    next_by: dict = {}
    upcoming = None
    for raw in reversed(raw_lines):
        next_by[raw.get('id')] = upcoming
        upcoming = None if raw.get('cue_start') is None else float(raw['cue_start'])
    order = {raw.get('id'): index for index, raw in enumerate(raw_lines)}
    by_id = {raw.get('id'): raw for raw in raw_lines}
    return next_by, order, by_id


def placed_lines(report: dict, bias: dict | None = None, adopt: dict | None = None,
                 only_good: bool = True) -> list[dict]:
    """Word rows in report order. `only_good` keeps placed lines, which is the word-chance pool.

    The line measurement asks for every line that has a pre-snap start, including
    ones that were not placed, so peak ownership can cross them the way qa does.
    `placed` records the original status. A line with no lettered start is left out.
    `wi` is the index in the report word list, punctuation included. `i` stays the
    index among lettered words. Raw placer clocks stay beside the witness slots.
    """
    lines = []
    timing = {'bias': bias or {}, 'adopt': adopt or {}}
    next_by, order, _by_id = _report_index(report)
    for line in report.get('lines') or []:
        good = line.get('status') == 'good'
        if only_good and not good:
            continue
        words = []
        adjusted = Q.apply_rule_times(line.get('words') or [], line.get('lang'), timing) or []
        kept = []
        for wi, word in enumerate(adjusted):
            if not word.get('roman') or word.get('ctc_s') is None:
                continue
            kept.append((wi, word))
        prev_span = None
        prev_roman = None
        for index, (wi, word) in enumerate(kept):
            span = None
            if word.get('ctc_e') is not None:
                span = float(word['ctc_e']) - float(word['ctc_s'])
            words.append({
                't': float(word['ctc_s']),
                'ctc_e': None if word.get('ctc_e') is None else float(word['ctc_e']),
                'second': None if word.get('second_s') is None else float(word['second_s']),
                'third': None if word.get('third_s') is None else float(word['third_s']),
                'roman': word['roman'],
                'group': line.get('group') or 'solo',
                'lang': line.get('lang') or '?',
                'line': line['id'],
                'w': word.get('w') or '',
                'i': index,
                'wi': wi,
                'n': len(kept),
                'prev_span': prev_span,
                'prev_roman': prev_roman,
                's': None if word.get('s') is None else float(word['s']),
                'second_kind': word.get('second_kind'),
                'third_kind': word.get('third_kind'),
                'phones': dict(word.get('phoneme_models') or {}),
                'vowels': dict(word.get('vowel_models') or {}),
                'clock_mms': None if word.get('clock_mms') is None else float(word['clock_mms']),
                'clock_second': None if word.get('clock_second') is None else float(word['clock_second']),
                'clock_stable': None if word.get('clock_stable') is None else float(word['clock_stable']),
                'clock_phoneme': _phoneme_clock(word),
            })
            prev_span = span
            prev_roman = word.get('roman')
        if not words:
            continue
        end = max(w['ctc_e'] if w['ctc_e'] is not None else w['t'] for w in words)
        placed_by = line.get('placed_by')
        if not placed_by and good:
            placed_by = 'mms'
        lines.append({
            'id': line['id'],
            'lang': line.get('lang') or '?',
            'group': line.get('group') or 'solo',
            'placed': good,
            'placed_by': placed_by,
            'cue_start': None if line.get('cue_start') is None else float(line['cue_start']),
            'ctc_start': None if line.get('ctc_start') is None else float(line['ctc_start']),
            'section': line.get('section'),
            'next_cue': next_by.get(line['id']),
            'order': order.get(line['id'], 0),
            'span': (min(w['t'] for w in words) - 0.05, end + 0.05),
            'words': words,
        })
    return lines


def _flat(lines: list[dict]) -> list[dict]:
    return [word for line in lines for word in line['words']]


def evaluate(lines: list[dict], peak_sets: dict[tuple[float, bool], np.ndarray]) -> list[dict]:
    shuffled = shuffled_records(lines)
    rows = []
    flat = _flat(lines)
    for rule in witness_rules() + iter_rules():
        peaks = peak_sets[(float(rule['peak_height']), bool(rule['require_rise']))]
        rates = chance_of(flat, peaks, rule, shuffled)
        proved, total = true_proof(lines, peaks, rule)
        row = dict(rule)
        row['shifts'] = {k: _round(v) for k, v in rates.items() if k != 'chance'}
        row['chance'] = _round(rates['chance'])
        row['true_proved'] = proved
        row['true_total'] = total
        row['true_rate'] = None if total == 0 else _round(proved / total)
        # choose() compares the unrounded chance. Keep the exact value for the decision
        # and the rounded one for the file by deciding before rounding.
        row['_chance'] = rates['chance']
        row['_true_rate'] = None if total == 0 else proved / total
        rows.append(row)
    return rows


def choose_measured(rows: list[dict]) -> dict:
    packed = []
    for row in rows:
        item = dict(row)
        item['chance'] = row.get('_chance')
        item['true_rate'] = row.get('_true_rate')
        packed.append(item)
    chosen = choose(packed)
    # Attach the rounded public numbers from the matching measured row.
    match = next((row for row in rows if row['name'] == chosen.get('name')), None)
    if match is not None:
        chosen['chance'] = match['chance']
        chosen['true_rate'] = match['true_rate']
        chosen['true_proved'] = match['true_proved']
        chosen['true_total'] = match['true_total']
        chosen['shifts'] = match['shifts']
    else:
        chosen['chance'] = _round(chosen.get('chance'))
        chosen['true_rate'] = _round(chosen.get('true_rate'))
    chosen.pop('_chance', None)
    chosen.pop('_true_rate', None)
    return chosen


def _why_ru(chosen: dict, current_chance: float | None) -> str:
    if chosen.get('why') == 'per-slice':
        share = chosen.get('line_share')
        if not chosen.get('within_limit'):
            return ('Свидетели смотрятся отдельно по каждой песне и каждому языку, где слов не меньше 30. '
                    'Где слов меньше, решение берётся по песне. '
                    'Либо у такой пары оба правила свидетелей выше 15 %, либо ни одна доля строки '
                    'не держит случайный проход строки не выше 5 %. Проверка на этом правиле не запускается.')
        return (f"Свидетели выбраны по песне и языку. Строка доказана, когда её начало не дальше 0,3 с от реплики, "
                f"ни одно слово не опровергнуто и доказано не меньше {_ru(share, 2)} её слов (не меньше двух). "
                f"Случайный проход строки {_ru(chosen.get('chance'), 3)}. "
                f"Доказано строк {chosen.get('true_proved', '—')} из {chosen.get('true_total', '—')} кандидатов.")
    if chosen.get('why') == 'witness-one':
        return (f"Сильная атака (сила 0,7) и согласие хотя бы одного независимого выравнивателя "
                f"в пределах 0,10 с дают случайный проход {_ru(chosen.get('chance'), 3)}. "
                f"Это не выше 15 %, поэтому согласие обоих не требуется. "
                f"Доля доказанных слов {_ru(chosen.get('true_rate'), 3)}.")
    if chosen.get('why') == 'witness-two':
        return (f"Согласие одного независимого выравнивателя даёт случайный проход выше 15 %. "
                f"Выбрано согласие обоих при сильной атаке: случайный проход {_ru(chosen.get('chance'), 3)}, "
                f"доля доказанных слов {_ru(chosen.get('true_rate'), 3)}.")
    if chosen.get('why') == 'current':
        return (f"Допуск 0,10 с (хор 0,20 с) и сила пика 0,5 уже дают случайный проход "
                f"{_ru(chosen.get('chance'), 3)}. Он не выше 15 %, ужесточение не нужно.")
    if chosen.get('why') == 'unmeasured':
        return 'Поставленных слов нет, случайный проход не из чего считать.'
    bits = [f"допуск {_ru(chosen.get('tol'), 2)} с", f"хор {_ru(chosen.get('choir_tol'), 2)} с",
            f"сила пика {_ru(chosen.get('peak_height'), 1)}"]
    if chosen.get('require_rise'):
        bits.append('только подъём энергии')
    if chosen.get('require_second'):
        bits.append('согласие второго выравнивателя')
    body = (f"У допуска 0,10 с случайный проход {_ru(current_chance, 3)}. "
            f"Выбрано {', '.join(bits)}: случайный проход {_ru(chosen.get('chance'), 3)}, "
            f"доля доказанных слов {_ru(chosen.get('true_rate'), 3)}.")
    if not chosen.get('within_limit'):
        body += ' Ни одно правило не уложилось в 15 %.'
    return body


def density_table(slug: str, lines: list[dict], peaks: np.ndarray) -> list[dict]:
    rows = [{
        'song': slug,
        'lang': '*',
        'peaks': int(len(peaks)),
        'median_interval': _round(median_interval(peaks), 3),
        'placed_words': sum(len(line['words']) for line in lines),
        'placed_lines': len(lines),
    }]
    by_lang: dict[str, list[dict]] = {}
    for line in lines:
        by_lang.setdefault(line['lang'], []).append(line)
    for lang, group in sorted(by_lang.items()):
        spans = [line['span'] for line in group]
        inside = intervals_in_spans(peaks, spans)
        n_peaks = 0
        if len(peaks):
            ordered = np.sort(peaks)
            for a, b in spans:
                n_peaks += int(((ordered >= a) & (ordered <= b)).sum())
        rows.append({
            'song': slug,
            'lang': lang,
            'peaks': n_peaks,
            'median_interval': _round(float(np.median(inside)) if inside else None, 3),
            'placed_words': sum(len(line['words']) for line in group),
            'placed_lines': len(group),
        })
    return rows


def slice_rates(records: list[dict], peaks: np.ndarray, rule: dict) -> dict:
    shuffled = shuffled_records(_records_to_lines(records))
    rates = chance_of(records, peaks, rule, shuffled)
    return {k: _round(v) for k, v in rates.items()}


def _records_to_lines(records: list[dict]) -> list[dict]:
    lines: dict[str, dict] = {}
    for rec in records:
        key = rec.get('line') or ''
        bucket = lines.setdefault(key, {'words': []})
        bucket['words'].append(rec)
    return list(lines.values())


def _why_label(why: str | None) -> str:
    return {
        'slice-one': 'один, по языку',
        'slice-two': 'оба, по языку',
        'song-fallback': 'как у песни',
        'over-limit': 'выше 15 %',
    }.get(why or '', why or '—')


def _fill_ru(fill: dict) -> str:
    """One paragraph for the bench report. Numbers come from the measurement."""
    if not fill:
        return ('Заливка огибающей не измерялась. Это не свидетель: пик подъёма уровня '
                'закрывает слово только там, где спектральной атаки внутри допуска группы нет.')
    kept = 'В правиле есть.' if fill.get('kept') else f"В правиле нет: {fill.get('why') or 'не измерена'}."
    return (
        'Заливка огибающей — не свидетель и не постановщик. Слово без спектральной атаки внутри допуска группы '
        'может опереться на пик подъёма уровня, если тот внутри того же допуска. '
        'Спектральная атака внутри допуска остаётся. Огибающая не опровергает. '
        f"Слов {fill.get('words', 0)}, проход слова {_ru(fill.get('word_chance'), 3)}, "
        f"проход строки {_ru(fill.get('line_chance'), 3)}, "
        f"доказано {fill.get('proved', 0)} против {fill.get('base_proved', 0)}. {kept}"
    )


def render_md(payload: dict) -> str:
    chosen = payload['chosen']
    songs = list(payload.get('songs') or [])
    lines = [
        '# Случайный проход атаки и строки',
        '',
        'Замер на вокальном стеме после выравнивания всех песен задания и до проверки. '
        'Правило слова выбирается по каждой паре песня/язык, где поставленных слов не меньше 30. '
        'Где слов меньше, пара берёт решение песни. '
        'Один свидетель — сильная атака (сила 0,7, соло 0,10 с, хор 0,20 с) и хотя бы один независимый выравниватель в пределах 0,10 с. '
        'Оба свидетеля — та же атака и оба выравнивателя. '
        'Случайный проход слова — худшая доля из сдвигов ±0,15, ±0,25, ±0,40 с и перемешивания начал внутри строки. '
        'Часы свидетелей при сдвиге остаются на месте. Предел слова 15 %.',
        '',
        'Опровержение — отдельный счёт. Слово опровергнуто, если оба свидетеля, у которых есть время, согласны между собой '
        '(не дальше 0,10 с) и оба дальше выбранного порога от MMS, либо единственный свидетель дальше своего порога '
        'и рядом с его временем есть сильная атака, которой нет у MMS. Нет свидетеля — не опровержение. '
        'Предложенные пороги 0,20 с и 0,30 с. Они ужесточаются, только если эта пара опровергает больше 15 % поставленных слов.',
        '',
        'Строка-кандидат — поставленная строка соло или хора, у которой есть реплика и не меньше двух слов. '
        'Случайный проход строки считается отдельно для каждого постановщика: сдвигаются его начала, '
        'на одно и то же ±0,15, ±0,25 или ±0,40 с, и отдельно перемешиваются. '
        'Свидетели — остальные выравниватели, не он сам, и при сдвиге остаются на месте. '
        'Реплика при сдвиге заново не проверяется: она уже выполнена у поставленной строки. '
        'Строка проходит пробу, если ни одно слово не опровергнуто и доказано не меньше доли K (не меньше двух слов). '
        'Предел строки 5 % у каждого постановщика, у которого есть строки. '
        'Берётся наименьшее K, которое удерживает всех таких постановщиков: у него больше всего доказанных строк. '
        'Постановщик, который и при K = 1,00 выше 5 %, из доказательства исключается. Остальные при этом могут пройти.',
        '',
        'Фонемный свидетель, если его часы есть в отчёте выравнивания, допускается отдельно. '
        'Роль и модель — в столбце «фонема». Разбор пар — `docs/analysis/bench/phoneme-choice.md`, '
        'хор — `docs/analysis/bench/chorus.md`. Пороги те же: слово не выше 15 %, строка не выше 5 %.',
        '',
        _fill_ru(payload.get('attack_fill') or {}),
        '',
        _why_ru(chosen, payload.get('current_chance')),
        '',
        f"Правило: `{chosen.get('name')}`. Случайный проход строки {_ru(chosen.get('chance'), 3)}. "
        f"Доказано строк {chosen.get('true_proved', '—')} из {chosen.get('true_total', '—')}.",
        '',
        '## Свидетели по песне и языку',
        '',
        '«Один» и «оба» — собственный случайный проход этой пары. '
        '«Проход правила» — проход того режима, который реально применён. '
        'У языка короче 30 слов это проход песни, а не его собственный.',
        '',
        '| песня | язык | слов | один | оба | правило | проход правила | почему | фонема |',
        '|---|---|---:|---:|---:|---|---:|---|---|',
    ]
    for row in payload.get('scopes') or []:
        mode = {'one': 'один', 'two': 'оба'}.get(row.get('witnesses') or '', '—')
        phone = {'or': 'или', 'only': 'только'}.get(row.get('phoneme') or '', 'нет')
        model = row.get('phoneme_model') or ''
        phone_cell = phone if phone == 'нет' or not model else f'{phone}, {model}'
        lines.append(
            f"| {row['song']} | {row['lang']} | {row['words']} | {_ru(row.get('one_chance'), 3)} | "
            f"{_ru(row.get('two_chance'), 3)} | {mode} | {_ru(row.get('chance'), 3)} | {_why_label(row.get('why'))} | "
            f"{phone_cell} |"
        )
    refute = chosen.get('refute') or {}
    lines += [
        '',
        '## Опровержение слова',
        '',
        f"Выбрано: оба свидетеля дальше {_ru(refute.get('both_far'), 2)} с от MMS при согласии ≤ {_ru(refute.get('both_agree'), 2)} с, "
        f"единственный свидетель дальше {_ru(refute.get('only_far'), 2)} с и сильная атака у него, а не у MMS "
        f"(окно атаки {_ru(refute.get('attack_tol'), 2)} с). "
        f"Опровергнуто {refute.get('refuted', '—')} из {refute.get('words', '—')} "
        f"({_ru(refute.get('rate'), 3)}). "
        f"Из них оба свидетеля в стороне: {refute.get('witnesses', 0)}, единственный свидетель с атакой: {refute.get('attack', 0)}. "
        + ('Пара уложилась в 15 %.' if refute.get('within_cap') else 'Пара не уложилась в 15 %; взята самая строгая из сетки.'),
        '',
        '| оба дальше | один дальше | опровергнуто | слов | доля |',
        '|---:|---:|---:|---:|---:|',
    ]
    for row in payload.get('refute_grid') or []:
        mark = ''
        if (refute.get('both_far') is not None and abs(float(row['both_far']) - float(refute['both_far'])) < 1e-9
                and abs(float(row['only_far']) - float(refute['only_far'])) < 1e-9):
            mark = ' ←'
        lines.append(
            f"| {_ru(row['both_far'], 2)}{mark} | {_ru(row['only_far'], 2)} | {row['refuted']} | {row['words']} | {_ru(row.get('rate'), 3)} |"
        )
    lines += [
        '',
        '| песня | язык | слов | опровергнуто | оба свидетеля | один свидетель |',
        '|---|---|---:|---:|---:|---:|',
    ]
    for row in refute.get('by') or []:
        lines.append(
            f"| {row['song']} | {row['lang']} | {row['words']} | {row['refuted']} | {row['witnesses']} | {row['attack']} |"
        )
    lines += [
        '',
        '## Доля строки',
        '',
        'Случайный проход строки — худшая из долей ±0,15, ±0,25, ±0,40 с и перемешивания. '
        'Доказано — строки, которые проходят правило на своих временах.',
        '',
        '| K | проход строки | ' + ' | '.join(songs) + ' | всего |',
        '|---:|---:|' + '---:|' * len(songs) + '---:|',
    ]
    for row in payload.get('line_table') or []:
        cells = ' | '.join(str((row.get('by_song') or {}).get(song, 0)) for song in songs)
        mark = ' ←' if chosen.get('line_share') is not None and abs(float(row['k']) - float(chosen['line_share'])) < 1e-9 else ''
        lines.append(f"| {_ru(row['k'], 2)}{mark} | {_ru(row.get('chance'), 3)} | {cells} | {row.get('proved', 0)} |")
    lines += [
        '',
        '## Постановщики',
        '',
        'Проход строки — отдельно у того, кто поставил строку. Окна MMS и стем htdemucs_ft — один постановщик, `mms`. '
        'Исключённый постановщик в доказанные строки не входит: его проход на K = 1,00 всё ещё выше 5 %.',
        '',
        '| постановщик | кандидатов | доказано | проход | исключён |',
        '|---|---:|---:|---:|---|',
    ]
    for row in chosen.get('primaries') or []:
        lines.append(
            f"| {row.get('name')} | {row.get('candidates', 0)} | {row.get('proved', 0)} | "
            f"{_ru(row.get('chance'), 3)} | {'да' if row.get('blocked') else 'нет'} |"
        )
    if not chosen.get('primaries'):
        lines.append('| — | 0 | 0 | — | — |')
    lines += [
        '',
        '## Плотность атак',
        '',
        '| песня | язык | пиков | медиана промежутка, с | поставлено строк | слов |',
        '|---|---|---:|---:|---:|---:|',
    ]
    for row in payload.get('density') or []:
        lines.append(
            f"| {row['song']} | {row['lang']} | {row['peaks']} | {_ru(row.get('median_interval'), 3)} | "
            f"{row['placed_lines']} | {row['placed_words']} |"
        )
    lines += [
        '',
        '## Кандидаты по сумме слов',
        '',
        'Это прежний перебор на всех поставленных словах вместе. Он в файл пишется и решение по песне и языку не подменяет. '
        'Полный перебор — в `attack-chance.json`.',
        '',
        '| правило | допуск | сила | подъём | второй / свидетели | худшая доля | доказано слов |',
        '|---|---:|---:|---|---|---:|---:|',
    ]
    show = []
    for row in payload.get('candidates') or []:
        if is_current(row) or row.get('witnesses') in ('one', 'two') or (row.get('chance') is not None and row['chance'] <= LIMIT):
            show.append(row)
    show.sort(key=lambda row: (0 if row.get('witnesses') in ('one', 'two') else 1, row.get('chance') if row.get('chance') is not None else 9))
    for row in show:
        lines.append(
            f"| {row['name']} | {_ru(row['tol'], 2)} | {_ru(row['peak_height'], 1)} | "
            f"{'да' if row.get('require_rise') else 'нет'} | {_witness_cell(row)} | "
            f"{_ru(row.get('chance'), 3)} | {_ru(row.get('true_rate'), 3)} |"
        )
    lines.append('')
    return '\n'.join(lines)


def _witness_cell(row: dict) -> str:
    if row.get('witnesses') == 'one':
        return 'один'
    if row.get('witnesses') == 'two':
        return 'оба'
    return 'да' if row.get('require_second') else 'нет'


def load_review() -> dict:
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'aligner-review.json'
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _peak_sets(sig: Q.Signals) -> dict[tuple[float, bool], np.ndarray]:
    sets = {}
    for height in HEIGHTS:
        base = Q.onset_peak_times(sig, min_height=height)
        sets[(height, False)] = base
        sets[(height, True)] = Q.peaks_on_rise(sig, base, height)
    return sets


def _slice_chance(records: list[dict], peaks: np.ndarray, rule: dict) -> float | None:
    if not records:
        return None
    shuffled = shuffled_records(_records_to_lines(records))
    return chance_of(records, peaks, rule, shuffled)['chance']


def _pick_mode(one: float | None, two: float | None) -> tuple[str | None, float | None, str]:
    if one is not None and float(one) <= LIMIT + 1e-12:
        return 'one', float(one), 'slice-one'
    if two is not None and float(two) <= LIMIT + 1e-12:
        return 'two', float(two), 'slice-two'
    return None, None, 'over-limit'


def measure_scope_rows(per_song: list[dict]) -> list[dict]:
    """Unrounded one-witness and two-witness chance for each song and language."""
    one_rule, two_rule = witness_rules()
    rows = []
    for song in per_song:
        peaks = song['sets'][(WITNESS_HEIGHT, False)]
        flat = _flat(song['lines'])
        by_lang: dict[str, list[dict]] = {}
        for word in flat:
            by_lang.setdefault(word['lang'], []).append(word)
        groups = [('*', flat)] + sorted(by_lang.items())
        for lang, recs in groups:
            rows.append({
                'song': song['slug'],
                'lang': lang,
                'words': len(recs),
                'one': _slice_chance(recs, peaks, one_rule),
                'two': _slice_chance(recs, peaks, two_rule),
            })
    return rows


def assign_scopes(slices: list[dict]) -> tuple[list[dict], bool]:
    """Witness mode per song and language. False when a required slice stays over 15 %.

    A language with at least MIN_WORDS placed words is judged on its own chance.
    A shorter language inherits the song row, even when its own chance is lower.
    """
    if not slices:
        return [], False
    by_song: dict[str, dict[str, dict]] = {}
    for row in slices:
        by_song.setdefault(row['song'], {})[row['lang']] = row
    out = []
    ok = True
    for song, langs in by_song.items():
        song_row = langs.get('*')
        song_mode, song_chance, song_why = _pick_mode(
            None if song_row is None else song_row.get('one'),
            None if song_row is None else song_row.get('two'),
        )
        if song_mode is None:
            ok = False
        for lang, row in langs.items():
            n = int(row.get('words') or 0)
            one = row.get('one')
            two = row.get('two')
            if lang == '*':
                mode, chance, why = song_mode, song_chance, song_why
            elif n >= MIN_WORDS:
                mode, chance, why = _pick_mode(one, two)
                if mode is None:
                    ok = False
            else:
                mode = song_mode
                chance = song_chance
                why = 'song-fallback' if song_mode else 'over-limit'
                if mode is None:
                    ok = False
            out.append({
                'song': song,
                'lang': lang,
                'words': n,
                'witnesses': mode,
                'chance': chance,
                'one_chance': one,
                'two_chance': two,
                'why': why,
            })
    return out, ok


def _refute_cut(both_far: float, only_far: float) -> dict:
    return {'both_agree': 0.10, 'both_far': both_far, 'only_far': only_far, 'attack_tol': 0.10}


def measure_refute(per_song: list[dict]) -> list[dict]:
    """How many placed words each cutoff refutes. Peaks are height 0.7, with no ownership."""
    rows = []
    for both_far, only_far in REFUTE_GRID:
        cut = _refute_cut(both_far, only_far)
        refuted = words = 0
        both_n = only_n = 0
        by: dict[tuple[str, str], dict] = {}
        for song in per_song:
            peaks = song['sets'][(WITNESS_HEIGHT, False)]
            for line in song['lines']:
                lang = line.get('lang') or '?'
                bucket = by.setdefault((song['slug'], lang), {'words': 0, 'refuted': 0, 'witnesses': 0, 'attack': 0})
                for word in line['words']:
                    words += 1
                    bucket['words'] += 1
                    why = Q.word_refuted(
                        {'ctc_s': word['t'], 'second_s': word.get('second'), 'third_s': word.get('third')},
                        peaks, cut)
                    if not why:
                        continue
                    refuted += 1
                    bucket['refuted'] += 1
                    if why == 'witnesses-agree-elsewhere':
                        both_n += 1
                        bucket['witnesses'] += 1
                    else:
                        only_n += 1
                        bucket['attack'] += 1
        rows.append({
            'both_far': both_far,
            'only_far': only_far,
            'refuted': refuted,
            'words': words,
            'rate': None if words == 0 else refuted / words,
            'witnesses': both_n,
            'attack': only_n,
            'by': [{'song': song, 'lang': lang, **counts} for (song, lang), counts in sorted(by.items())],
        })
    return rows


def choose_refute(rows: list[dict]) -> dict:
    """Keep 0.20 s / 0.30 s unless that pair refutes more than 15 % of placed words.

    A looser pair is reported and never chosen. Above the cap, take the least
    strict pair that is at least this strict on both axes and still under the cap.
    If none is, keep 0.30 s / 0.40 s and record the miss. The run does not fail
    on the refutation cap alone.
    """
    def find(both_far: float, only_far: float) -> dict:
        for row in rows:
            if abs(float(row['both_far']) - both_far) < 1e-9 and abs(float(row['only_far']) - only_far) < 1e-9:
                return row
        return {'both_far': both_far, 'only_far': only_far, 'refuted': 0, 'words': 0, 'rate': 0.0,
                'witnesses': 0, 'attack': 0, 'by': []}

    def rate_of(row: dict) -> float:
        n = int(row.get('words') or 0)
        if n <= 0:
            return 0.0
        if row.get('rate') is not None:
            return float(row['rate'])
        return int(row.get('refuted') or 0) / n

    proposal = find(*REFUTE_PROPOSAL)
    picked = proposal
    within = rate_of(proposal) <= REFUTE_CAP + 1e-12
    if not within:
        picked = None
        for both_far, only_far in REFUTE_STEPS:
            if both_far + 1e-12 < REFUTE_PROPOSAL[0] or only_far + 1e-12 < REFUTE_PROPOSAL[1]:
                continue
            row = find(both_far, only_far)
            if int(row.get('words') or 0) > 0 and rate_of(row) <= REFUTE_CAP + 1e-12:
                picked = row
                within = True
                break
        if picked is None:
            picked = find(0.30, 0.40)
            within = rate_of(picked) <= REFUTE_CAP + 1e-12
    out = dict(picked)
    out['both_agree'] = 0.10
    out['attack_tol'] = 0.10
    out['within_cap'] = within
    out['cap'] = REFUTE_CAP
    out['rate'] = None if int(out.get('words') or 0) == 0 else rate_of(out)
    return out


def _line_candidate(line: dict) -> bool:
    """A placed solo or choir line with a cue and at least two lettered words.

    A one-word line can never meet the minimum of two proved words, so it is
    left out of both the numerator and the denominator of the line chance.
    An uncued line cannot be proved either, and is left out for the same reason.
    """
    if not line.get('placed') or line.get('group') not in ('solo', 'choir'):
        return False
    words = line.get('words') or []
    if len(words) < 2:
        return False
    cue = line.get('cue_start')
    start = line.get('ctc_start')
    if cue is None or start is None:
        return False
    return round(abs(float(start) - float(cue)), 3) <= Q.PROOF_CUE_TOL


def _mode_of_line(modes: dict, line: dict) -> str:
    song = line.get('song')
    lang = line.get('lang') or '?'
    mode = modes.get((song, lang)) or modes.get((song, '*'))
    return mode if mode in ('one', 'two') else 'two'


def _probe_parts(words: list[dict], peaks: np.ndarray, group: str | None, mode: str,
                 refute: dict, prev: float | None,
                 fill_peaks: np.ndarray | None = None) -> tuple[list[dict], list[str | None]]:
    """Proved-word rows and refutation flags. The share K is applied by the caller.

    `fill_peaks` may supply the attack when the spectral peak is outside the
    group tolerance. Refutation still reads `peaks`, so the envelope cannot
    refute a word and cannot move a spectral hit that was already inside.
    """
    tol = 0.20 if group == 'choir' else 0.10
    align_words = []
    presnap: list[float | None] = []
    cursor = prev
    for word in words:
        item = {
            'roman': word.get('roman') or 'x',
            'ctc_s': float(word['t']),
            'ctc_e': word.get('ctc_e'),
            'second_s': word.get('second'),
            'third_s': word.get('third'),
            'phoneme_s': word.get('phoneme'),
            'phoneme_role': word.get('phoneme_role'),
        }
        align_words.append(item)
        owned = None if cursor is None else cursor + tol
        t = float(word['t'])
        if fill_peaks is not None:
            presnap.append(Q.fill_attack(t, peaks, fill_peaks, owned, tol))
        else:
            presnap.append(Q.nearest_attack(t, peaks, owned))
        cursor = t
    proved = Q.prove_words(align_words, presnap, tol, witnesses=mode, agree_tol=SECOND_TOL)
    flags = [Q.word_refuted(word, peaks, refute) for word in align_words]
    return proved, flags


def _probe_line(words: list[dict], peaks: np.ndarray, group: str | None, mode: str,
                refute: dict, share: float, prev: float | None) -> bool:
    proved, flags = _probe_parts(words, peaks, group, mode, refute, prev)
    return Q.line_word_ok(proved, flags, share)


def line_probe_parts(lines: list[dict], peaks: np.ndarray, modes: dict, refute: dict,
                     shift: float = 0.0, shuffle: bool = False, primary: str | None = None,
                     choir_peaks: np.ndarray | None = None,
                     fill_peaks: np.ndarray | None = None) -> list[dict]:
    """One row per candidate line: proved words and refutation flags under this probe.

    The same shift and the same previous-line start as `line_pass_count`. K is not
    applied here, so one probe can be scored at every share.
    """
    prev: float | None = None
    incoming: list[float | None] = []
    for line in lines:
        incoming.append(prev)
        if line.get('words'):
            prev = float(line['words'][-1]['t'])
    out = []
    for i, line in enumerate(lines):
        if not _line_candidate(line):
            continue
        family = P.primary_family(line.get('placed_by'))
        if primary is not None and family != primary:
            continue
        src = line['words']
        moved = []
        if shuffle:
            rotated = src[1:] + src[:1]
            for word, donor in zip(src, rotated):
                item = dict(word)
                item['t'] = float(donor['t'])
                moved.append(item)
        else:
            for word in src:
                item = dict(word)
                item['t'] = float(word['t']) + float(shift)
                moved.append(item)
        use_peaks = choir_peaks if line.get('group') == 'choir' and choir_peaks is not None else peaks
        proved, flags = _probe_parts(
            moved, use_peaks, line.get('group'), _mode_of_line(modes, line), refute, incoming[i],
            fill_peaks=fill_peaks)
        out.append({
            'id': line.get('id'),
            'lang': line.get('lang') or '?',
            'song': line.get('song'),
            'family': family,
            'proved': proved,
            'flags': flags,
        })
    return out


def line_pass_count(lines: list[dict], peaks: np.ndarray, modes: dict, refute: dict, share: float,
                    shift: float = 0.0, shuffle: bool = False, primary: str | None = None,
                    choir_peaks: np.ndarray | None = None,
                    fill_peaks: np.ndarray | None = None) -> tuple[int, int]:
    """Candidate lines that still pass after one shared shift, or after a rotation.

    The cue belongs to the real line and is not applied to the shifted first word.
    The previous line contributes its real, unshifted start. Inside the line the
    moved starts own the peaks. Witness clocks stay on the word they were measured for.
    """
    parts = line_probe_parts(lines, peaks, modes, refute, shift=shift, shuffle=shuffle, primary=primary,
                             choir_peaks=choir_peaks, fill_peaks=fill_peaks)
    hits = sum(1 for item in parts if Q.line_word_ok(item['proved'], item['flags'], share))
    return hits, len(parts)


def measure_line_table(per_song: list[dict], modes: dict, refute: dict, primary: str | None = None) -> list[dict]:
    cut = _refute_cut(float(refute.get('both_far', 0.20)), float(refute.get('only_far', 0.30)))
    rows = []
    for share in LINE_SHARES:
        shift_hits = {mag: [0, 0] for mag in SHIFTS}
        shuf = [0, 0]
        true_hits = [0, 0]
        by_song = {}
        for song in per_song:
            peaks = song['sets'][(WITNESS_HEIGHT, False)]
            choir_peaks = song.get('envelope_peaks') if song.get('use_choir_envelope') else None
            fill_peaks = song.get('envelope_peaks') if song.get('use_attack_fill') else None
            lines = song['all_lines']
            for mag in SHIFTS:
                for sign in (mag, -mag):
                    h, n = line_pass_count(lines, peaks, modes, cut, share, shift=sign, primary=primary,
                                           choir_peaks=choir_peaks, fill_peaks=fill_peaks)
                    shift_hits[mag][0] += h
                    shift_hits[mag][1] += n
            h, n = line_pass_count(lines, peaks, modes, cut, share, shuffle=True, primary=primary,
                                   choir_peaks=choir_peaks, fill_peaks=fill_peaks)
            shuf[0] += h
            shuf[1] += n
            h, n = line_pass_count(lines, peaks, modes, cut, share, primary=primary,
                                   choir_peaks=choir_peaks, fill_peaks=fill_peaks)
            true_hits[0] += h
            true_hits[1] += n
            by_song[song['slug']] = h
        rates = {}
        for mag, (h, n) in shift_hits.items():
            rates[f'{mag:.2f}'] = None if n == 0 else h / n
        rates['shuffle'] = None if shuf[1] == 0 else shuf[0] / shuf[1]
        nums = [v for v in rates.values() if v is not None]
        rows.append({
            'k': share,
            'chance': None if not nums else max(nums),
            'proved': true_hits[0],
            'candidates': true_hits[1],
            'by_song': by_song,
            'shifts': rates,
        })
    return rows


def choose_k(rows: list[dict]) -> dict:
    """The K under 5 % with the most proved lines, which is the smallest such K.

    A higher share only removes lines, so chance and the true count do not rise
    with K. If none is at or under 5 %, the measurement fails closed.
    """
    eligible = [row for row in rows if row.get('chance') is not None and float(row['chance']) <= LINE_LIMIT + 1e-12]
    if eligible:
        eligible.sort(key=lambda row: (-int(row.get('proved') or 0), float(row['k'])))
        out = dict(eligible[0])
        out['within_limit'] = True
        return out
    ranked = [row for row in rows if row.get('chance') is not None]
    if not ranked:
        return {'k': None, 'chance': None, 'proved': 0, 'candidates': 0, 'by_song': {}, 'shifts': {},
                'within_limit': False}
    ranked.sort(key=lambda row: (float(row['chance']), float(row['k'])))
    out = dict(ranked[0])
    out['within_limit'] = False
    return out


PRIMARY_FAMILIES = ('mms', 'stable-ts', 'second', 'phoneme')


def measure_primary_tables(per_song: list[dict], modes: dict, refute: dict) -> dict[str, list[dict]]:
    """One K grid per placer. MMS windows and the ft stem are the MMS clock."""
    return {name: measure_line_table(per_song, modes, refute, primary=name) for name in PRIMARY_FAMILIES}


def _row_at(rows: list[dict], share: float) -> dict:
    return next(row for row in rows if abs(float(row['k']) - float(share)) < 1e-9)


def choose_with_primaries(tables: dict[str, list[dict]]) -> dict:
    """Smallest K whose every used placer is at or under 5 %, preferring more proved lines.

    A placer with no candidates is unused. A placer still over 5 % at K = 1 is
    removed and the choice repeats. If none remain, the measurement fails closed.
    """
    active = {name: rows for name, rows in tables.items()}
    blocked: list[str] = []
    while active:
        best = None
        shares = [float(row['k']) for row in next(iter(active.values()))]
        for share in shares:
            per = []
            proved = 0
            candidates = 0
            by_song: dict[str, int] = {}
            chances = []
            ok = True
            used = 0
            for name, rows in active.items():
                row = _row_at(rows, share)
                n = int(row.get('candidates') or 0)
                chance = row.get('chance')
                per.append({
                    'name': name,
                    'chance': chance,
                    'proved': int(row.get('proved') or 0),
                    'candidates': n,
                    'blocked': False,
                    'by_song': row.get('by_song') or {},
                    'shifts': row.get('shifts') or {},
                })
                if n == 0:
                    continue
                used += 1
                proved += int(row.get('proved') or 0)
                candidates += n
                for song, hits in (row.get('by_song') or {}).items():
                    by_song[song] = by_song.get(song, 0) + int(hits)
                if chance is None or float(chance) > LINE_LIMIT + 1e-12:
                    ok = False
                else:
                    chances.append(float(chance))
            if used == 0 or not ok:
                continue
            item = {
                'k': share,
                'chance': max(chances) if chances else None,
                'proved': proved,
                'candidates': candidates,
                'by_song': by_song,
                'primaries': per,
                'within_limit': True,
                'shifts': {},
            }
            if best is None or (proved, -share) > (int(best['proved']), -float(best['k'])):
                best = item
        if best is not None:
            best['blocked_primaries'] = list(blocked)
            best['primaries'] = list(best['primaries']) + _blocked_at(tables, blocked)
            return best
        worst_name = None
        worst_chance = -1.0
        for name, rows in active.items():
            row = _row_at(rows, 1.0)
            if int(row.get('candidates') or 0) == 0:
                continue
            chance = 1.0 if row.get('chance') is None else float(row['chance'])
            if chance > worst_chance:
                worst_chance = chance
                worst_name = name
        if worst_name is None or worst_chance <= LINE_LIMIT + 1e-12:
            break
        blocked.append(worst_name)
        del active[worst_name]
    return {
        'k': None, 'chance': None, 'proved': 0, 'candidates': 0, 'by_song': {}, 'shifts': {},
        'primaries': _blocked_at(tables, blocked), 'blocked_primaries': blocked, 'within_limit': False,
    }


def _blocked_at(tables: dict[str, list[dict]], blocked: list[str]) -> list[dict]:
    """The K = 1 row of a placer that never got under 5 %. That chance is why it was excluded."""
    out = []
    for name in blocked:
        rows = tables.get(name) or []
        row = _row_at(rows, 1.0) if rows else {}
        out.append({
            'name': name,
            'chance': row.get('chance'),
            'proved': int(row.get('proved') or 0),
            'candidates': int(row.get('candidates') or 0),
            'blocked': True,
            'by_song': row.get('by_song') or {},
            'shifts': row.get('shifts') or {},
        })
    return out


def _public_primary(row: dict) -> dict:
    return {
        'name': row.get('name'),
        'chance': _round(row.get('chance')),
        'proved': int(row.get('proved') or 0),
        'candidates': int(row.get('candidates') or 0),
        'blocked': bool(row.get('blocked')),
        'by_song': row.get('by_song') or {},
        'shifts': {key: _round(value) for key, value in (row.get('shifts') or {}).items()},
    }


def _public_scope(scope: dict) -> dict:
    return {
        'song': scope['song'],
        'lang': scope['lang'],
        'words': scope['words'],
        'witnesses': scope.get('witnesses'),
        'chance': _round(scope.get('chance')),
        'one_chance': _round(scope.get('one_chance')),
        'two_chance': _round(scope.get('two_chance')),
        'why': scope.get('why'),
        'phoneme': scope.get('phoneme') if scope.get('phoneme') in ('or', 'only') else 'off',
        'phoneme_model': scope.get('phoneme_model') if isinstance(scope.get('phoneme_model'), str) else None,
        'phoneme_chance': _round(scope.get('phoneme_chance')),
    }


def _public_line(row: dict) -> dict:
    return {
        'k': row.get('k'),
        'chance': _round(row.get('chance')),
        'proved': row.get('proved') or 0,
        'candidates': row.get('candidates') or 0,
        'by_song': row.get('by_song') or {},
        'shifts': {key: _round(value) for key, value in (row.get('shifts') or {}).items()},
    }


def collect_refutations(per_song: list[dict], refute: dict) -> list[dict]:
    """Placed words the chosen cutoffs refute, with a place to listen. The cutoffs stay."""
    import whisper_witness as W

    rows = []
    for song in per_song:
        peaks = song['sets'][(WITNESS_HEIGHT, False)]
        for line in song['lines']:
            if not line.get('placed'):
                continue
            for word in line['words']:
                why = Q.word_refuted(
                    {'ctc_s': word['t'], 'second_s': word.get('second'), 'third_s': word.get('third')},
                    peaks, refute)
                if not why:
                    continue
                d2 = None if word.get('second') is None else round(float(word['second']) - float(word['t']), 3)
                d3 = None if word.get('third') is None else round(float(word['third']) - float(word['t']), 3)
                when = word.get('s')
                if when is None:
                    when = word.get('t')
                rows.append(W.annotate({
                    'song': song['slug'],
                    'id': line['id'],
                    'time': None if when is None else float(when),
                    'w': word.get('w') or '',
                    'i': word.get('i'),
                    'n': word.get('n'),
                    'prev_span': word.get('prev_span'),
                    'prev_roman': word.get('prev_roman'),
                    'why': why,
                    'placed_by': line.get('placed_by'),
                    'second': None if word.get('second') is None else float(word['second']),
                    'third': None if word.get('third') is None else float(word['third']),
                    'second_kind': word.get('second_kind'),
                    'third_kind': word.get('third_kind'),
                    'd2': d2,
                    'd3': d3,
                }))
    rows.sort(key=lambda row: (str(row.get('song') or ''), float(row['time']) if row.get('time') is not None else 0.0, str(row.get('id') or '')))
    return rows


def _phoneme_error_decision(exc: BaseException) -> dict:
    """A phoneme failure publishes the unstamped rule. It must not fail the run by itself."""
    reason = f'error: {exc.__class__.__name__}: {exc}'
    return {
        'admitted': False,
        'kept': False,
        'rejected_reason': reason,
        'pairs': [],
        'long': [],
        'k': None,
        'chance': None,
        'proved': None,
        'search': None,
        'choir_attack': 'spectral',
        'choir_clock': 'phone',
        'chorus': {
            'adopted': False,
            'variant': None,
            'words': 0,
            'word_chance': None,
            'line_chance': None,
            'proved': None,
            'base_proved': None,
            'why': 'замер не собран',
            'describe': {},
            'variants': [],
            'error': reason,
        },
    }


def _drop_phoneme_stamp(decision: dict, reason: str) -> None:
    """The search proposed a stamp the official remeasure did not keep."""
    decision['kept'] = False
    decision['rejected_reason'] = reason
    decision['choir_attack'] = 'spectral'
    decision['choir_clock'] = 'phone'
    chorus = decision.get('chorus')
    if isinstance(chorus, dict) and chorus.get('adopted'):
        chorus['adopted'] = False
        chorus['why'] = 'перебор предложил признак, официальный пересчёт его не оставил'


def _stamp_phoneme_scopes(scopes: list[dict], decision: dict) -> None:
    """Copy a kept assignment onto scope rows. A short language inherits the song row.

    An explicit language row wins in qa, including off, so a short language must
    carry the song role on its own row. A rejected stamp leaves every row off.
    """
    import phoneme_choice as Phone

    kept = bool(decision.get('kept'))
    pairs = {(row['song'], row['lang']): row for row in decision.get('pairs') or []}
    long = {
        (row[0], row[1]) for row in decision.get('long') or []
        if isinstance(row, (list, tuple)) and len(row) == 2
    }
    for scope in scopes:
        scope['phoneme'] = 'off'
        scope['phoneme_model'] = None
        scope['phoneme_chance'] = None
        if not kept:
            continue
        role, model = Phone._lookup(decision, scope['song'], str(scope['lang']))
        if role not in ('or', 'only'):
            continue
        scope['phoneme'] = role
        scope['phoneme_model'] = model
        key = (scope['song'], str(scope['lang']))
        src = pairs.get(key) if key in long else pairs.get((scope['song'], '*'))
        if src is not None:
            scope['phoneme_chance'] = src.get('word_chance')


def _public_refute(row: dict) -> dict:
    out = {key: value for key, value in row.items() if key != 'by'}
    if out.get('rate') is not None:
        out['rate'] = _round(out['rate'])
    by = []
    for item in row.get('by') or []:
        by.append(dict(item))
    out['by'] = by
    return out


def fill_ok(words: int, word_chance: float | None, within_limit: bool,
            proved: int, base_proved: int) -> bool:
    """Envelope fill for a missing spectral attack, or not.

    At least 30 placed words. Word chance at or under 15 %. Every placer's
    line chance at or under 5 %. Proved lines strictly rise. Solo lines may
    change: the short-share gap is in the solo, and a choir-only envelope
    already failed that test.
    """
    if int(words) < MIN_WORDS:
        return False
    if word_chance is None or float(word_chance) > LIMIT + 1e-12:
        return False
    if not within_limit:
        return False
    return int(proved) > int(base_proved)


def _fill_rule(mode: str) -> dict:
    return {
        'tol': 0.10,
        'choir_tol': 0.20,
        'agree_tol': SECOND_TOL,
        'require_second': False,
        'witnesses': mode if mode in ('one', 'two') else 'two',
    }


def fill_word_chance(per_song: list[dict], modes: dict) -> tuple[int, float | None]:
    """Random-pass of spectral-or-envelope, witnesses unchanged.

    The previous-word claim is not applied here. The line probe applies it,
    and that probe is what has to stay at or under 5 %.
    """
    buckets = []
    words = 0
    for song in per_song:
        spectral = song['sets'][(WITNESS_HEIGHT, False)]
        envelope = song.get('envelope_peaks')
        if envelope is None:
            envelope = np.zeros(0)
        grouped: dict[str, list[dict]] = {}
        lines_by_mode: dict[str, list[dict]] = {}
        for line in song['lines']:
            if not line.get('placed') or not line.get('words'):
                continue
            mode = _mode_of_line(modes, line)
            grouped.setdefault(mode, []).extend(line['words'])
            lines_by_mode.setdefault(mode, []).append(line)
            words += len(line['words'])
        for mode, recs in grouped.items():
            buckets.append((
                recs, spectral, envelope, _fill_rule(mode),
                shuffled_records(lines_by_mode[mode]),
            ))
    if words == 0:
        return 0, None
    rates = []
    for mag in SHIFTS:
        hits = n = 0
        for recs, spectral, envelope, rule, _shuf in buckets:
            for sign in (mag, -mag):
                h, c = hit_count(recs, spectral, sign, rule, fill_peaks=envelope)
                hits += h
                n += c
        if n:
            rates.append(hits / n)
    hits = n = 0
    for _recs, spectral, envelope, rule, shuf in buckets:
        if not shuf:
            continue
        h, c = hit_count(shuf, spectral, 0.0, rule, fill_peaks=envelope)
        hits += h
        n += c
    if n:
        rates.append(hits / n)
    if not rates:
        return words, None
    return words, float(max(rates))


def _fill_why(words: int, word_chance: float | None, within_limit: bool,
              proved: int, base_proved: int, kept: bool) -> str:
    if kept:
        return 'принят'
    if int(words) < MIN_WORDS:
        return 'слов меньше 30'
    if word_chance is None or float(word_chance) > LIMIT + 1e-12:
        return 'проход слова выше 15 %'
    if not within_limit:
        return 'проход строки выше 5 %'
    if int(proved) <= int(base_proved):
        return 'доказанных строк не больше'
    return 'не уложился в те же пороги'


def _public_fill(report: dict) -> dict:
    return {
        'kept': bool(report.get('kept')),
        'words': int(report.get('words') or 0),
        'word_chance': _round(report.get('word_chance')),
        'line_chance': _round(report.get('line_chance')),
        'proved': int(report.get('proved') or 0),
        'base_proved': int(report.get('base_proved') or 0),
        'within_limit': bool(report.get('within_limit')),
        'why': report.get('why') or '',
    }


def _measure_attack_fill(per_song: list[dict], modes: dict, refute: dict, baseline: dict) -> dict:
    """Remeasure the line grid with the envelope fill. Keep it only when fill_ok passes."""
    for song in per_song:
        song['use_attack_fill'] = True
    print('атака: заливка огибающей', flush=True)
    tables = measure_primary_tables(per_song, modes, refute)
    got = choose_with_primaries(tables)
    n_words, chance = fill_word_chance(per_song, modes)
    base_n = int(baseline.get('proved') or 0)
    got_n = int(got.get('proved') or 0)
    within = bool(got.get('within_limit'))
    kept = fill_ok(n_words, chance, within, got_n, base_n)
    if not kept:
        for song in per_song:
            song['use_attack_fill'] = False
    why = _fill_why(n_words, chance, within, got_n, base_n, kept)
    print(
        f'заливка огибающей: {why}, доказано {got_n} против {base_n}, '
        f'проход слова {chance}, проход строки {got.get("chance")}',
        flush=True,
    )
    return {
        'kept': kept,
        'words': n_words,
        'word_chance': chance,
        'line_chance': got.get('chance'),
        'proved': got_n,
        'base_proved': base_n,
        'within_limit': within,
        'why': why,
        'tables': tables,
        'picked': got,
    }


def _empty_fill(base_proved: int, why: str) -> dict:
    return {
        'kept': False,
        'words': 0,
        'word_chance': None,
        'line_chance': None,
        'proved': 0,
        'base_proved': base_proved,
        'within_limit': False,
        'why': why,
        'tables': None,
        'picked': None,
    }


def _modes_of(scopes: list[dict]) -> dict:
    return {
        (row['song'], row['lang']): row['witnesses']
        for row in scopes if row.get('witnesses') in ('one', 'two')
    }


def _snapshot(per_song: list[dict]) -> list[tuple]:
    return [(song, copy.deepcopy(song['all_lines'])) for song in per_song]


def _refresh_placed(song: dict) -> None:
    song['lines'] = [line for line in song['all_lines'] if line.get('placed')]


def _restore(per_song: list[dict], snap: list[tuple]) -> None:
    for song, lines in snap:
        song['all_lines'] = lines
        _refresh_placed(song)


def _remeasure(per_song: list[dict], refute: dict) -> tuple:
    """Scopes and the line grid on the lines as they stand. The refute cut is not retuned."""
    scope_rows = measure_scope_rows(per_song)
    scopes, scopes_ok = assign_scopes(scope_rows)
    modes = _modes_of(scopes)
    tables = measure_primary_tables(per_song, modes, refute)
    picked = choose_with_primaries(tables)
    return scopes, scopes_ok, modes, tables, picked


def _rises(scopes_ok: bool, picked: dict, baseline_n: int) -> bool:
    if not scopes_ok or not picked.get('within_limit'):
        return False
    return int(picked.get('proved') or 0) > int(baseline_n)


def _section_bounds(slug: str) -> dict[str, tuple[float, float]]:
    """Vocal section id to (start, end). Missing lyrics leaves the section check off."""
    path = song_dir(slug) / 'lyrics.json'
    if not path.exists():
        return {}
    try:
        lyrics = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    out = {}
    for sec in lyrics.get('sections') or []:
        if sec.get('kind') != 'vocal' or sec.get('id') is None:
            continue
        if sec.get('start') is None or sec.get('end') is None:
            continue
        out[str(sec['id'])] = (float(sec['start']), float(sec['end']))
    return out


def _retouch_spans(line: dict) -> None:
    prev_span = None
    prev_roman = None
    words = line.get('words') or []
    for word in words:
        word['prev_span'] = prev_span
        word['prev_roman'] = prev_roman
        word['n'] = len(words)
        if word.get('ctc_e') is None:
            prev_span = None
        else:
            prev_span = float(word['ctc_e']) - float(word['t'])
        prev_roman = word.get('roman')
    if words:
        end = max(word['ctc_e'] if word.get('ctc_e') is not None else word['t'] for word in words)
        line['span'] = (min(float(word['t']) for word in words) - 0.05, float(end) + 0.05)
        line['ctc_start'] = float(words[0]['t'])


def _write_placer(line: dict, proposal: dict) -> bool:
    """Replace the lettered starts. A phoneme placer is not left as its own witness."""
    starts = proposal.get('starts') or []
    ends = proposal.get('ends') or []
    witnesses = proposal.get('witnesses') or []
    words = line.get('words') or []
    if len(words) != len(starts) or len(words) != len(ends):
        return False
    if witnesses and len(witnesses) != len(words):
        return False
    for index, word in enumerate(words):
        word['t'] = float(starts[index])
        word['ctc_e'] = float(ends[index])
        if witnesses:
            second, second_kind, third, third_kind = witnesses[index]
            word['second'] = None if second is None else float(second)
            word['third'] = None if third is None else float(third)
            word['second_kind'] = second_kind
            word['third_kind'] = third_kind
        if proposal.get('by') == 'phoneme':
            word['phones'] = {}
            word['vowels'] = {}
            word.pop('phoneme', None)
            word.pop('phoneme_role', None)
    line['placed'] = True
    line['placed_by'] = proposal.get('by')
    _retouch_spans(line)
    return True


def _retime_row(slug: str, line: dict, proposal: dict) -> dict:
    witnesses = proposal.get('witnesses') or []
    words = []
    for index, word in enumerate(line.get('words') or []):
        second = third = second_kind = third_kind = None
        if index < len(witnesses):
            second, second_kind, third, third_kind = witnesses[index]
        words.append({
            'wi': word.get('wi'),
            'ctc_s': round(float(proposal['starts'][index]), 3),
            'ctc_e': round(float(proposal['ends'][index]), 3),
            'second_s': None if second is None else float(second),
            'third_s': None if third is None else float(third),
            'second_kind': second_kind,
            'third_kind': third_kind,
        })
    return {'song': slug, 'id': line.get('id'), 'by': proposal.get('by'), 'words': words}


def _group_retime(moves: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for row in moves:
        item = {key: value for key, value in row.items() if key != 'song'}
        out.setdefault(str(row.get('song') or ''), []).append(item)
    return out


def _apply_handoffs(per_song: list[dict], refute: dict, sections: dict, allow_phoneme: bool) -> list[dict]:
    moves = []
    for song in per_song:
        peaks = song['sets'][(WITNESS_HEIGHT, False)]
        bounds = sections.get(song['slug']) or {}
        for line in song['all_lines']:
            if not line.get('placed') or line.get('group') not in ('solo', 'choir'):
                continue
            proposal = P.handoff_proposal(
                line, line.get('next_cue'), peaks, refute,
                bounds.get(line.get('section')), allow_phoneme=allow_phoneme)
            if not proposal or not _write_placer(line, proposal):
                continue
            moves.append(_retime_row(song['slug'], line, proposal))
        _refresh_placed(song)
    return moves


def _latin_words(rec: dict, starts: list) -> list[tuple] | None:
    """Lettered words whose phoneme start exists. One missing lettered start refuses the line."""
    out = []
    for wi, word in enumerate(rec.get('words') or []):
        if not word.get('roman'):
            continue
        start = starts[wi] if wi < len(starts) else None
        if start is None:
            return None
        out.append((wi, word, float(start)))
    return out or None


def _line_from_report(slug: str, rec: dict, words_src: list[tuple], order: int, next_cue) -> dict:
    words = []
    prev_span = None
    prev_roman = None
    for index, (wi, word, start) in enumerate(words_src):
        item = {
            't': float(start),
            'ctc_e': None,
            'second': None if word.get('second_s') is None else float(word['second_s']),
            'third': None if word.get('third_s') is None else float(word['third_s']),
            'roman': word.get('roman') or '',
            'group': rec.get('group') or 'solo',
            'lang': rec.get('lang') or '?',
            'line': rec['id'],
            'w': word.get('w') or '',
            'i': index,
            'wi': wi,
            'n': len(words_src),
            'prev_span': prev_span,
            'prev_roman': prev_roman,
            's': None if word.get('s') is None else float(word['s']),
            'second_kind': word.get('second_kind'),
            'third_kind': word.get('third_kind'),
            'phones': {},
            'vowels': {},
            'clock_mms': None if word.get('clock_mms') is None else float(word['clock_mms']),
            'clock_second': None if word.get('clock_second') is None else float(word['clock_second']),
            'clock_stable': None if word.get('clock_stable') is None else float(word['clock_stable']),
            'clock_phoneme': float(start),
        }
        words.append(item)
        prev_roman = item['roman']
    return {
        'id': rec['id'],
        'lang': rec.get('lang') or '?',
        'group': rec.get('group') or 'solo',
        'song': slug,
        'placed': False,
        'placed_by': None,
        'cue_start': None if rec.get('cue_start') is None else float(rec['cue_start']),
        'ctc_start': None,
        'section': rec.get('section'),
        'next_cue': next_cue,
        'order': order,
        'span': (words[0]['t'] - 0.05, words[-1]['t'] + 0.05) if words else (0.0, 0.0),
        'words': words,
    }


def _apply_latin(per_song: list[dict], sections: dict) -> list[dict]:
    """Place still-open Latin lines from the aligner's stored phoneme starts."""
    moves = []
    for song in per_song:
        proposals = song.get('latin_place') or {}
        if not proposals:
            continue
        by_id = {line['id']: line for line in song['all_lines']}
        report_by = song.get('report_by_id') or {}
        next_by = song.get('next_by_id') or {}
        order_by = song.get('order_by_id') or {}
        bounds = sections.get(song['slug']) or {}
        pending = []
        for line_id, spec in proposals.items():
            rec = report_by.get(line_id)
            if not isinstance(spec, dict) or rec is None:
                continue
            if rec.get('lang') != 'la' or rec.get('status') == 'good':
                continue
            if rec.get('group') not in ('solo', 'choir'):
                continue
            existing = by_id.get(line_id)
            if existing is not None and existing.get('placed'):
                continue
            words_src = _latin_words(rec, list(spec.get('starts') or []))
            if not words_src:
                continue
            lettered = [start for _wi, _word, start in words_src]
            replace = existing is None or len(existing.get('words') or []) != len(words_src)
            if replace:
                target = _line_from_report(
                    song['slug'], rec, words_src, int(order_by.get(line_id) or 0), next_by.get(line_id))
            else:
                target = existing
            proposal = P.consider_phoneme_place(
                lettered, target.get('cue_start'), target.get('next_cue'), bounds.get(rec.get('section')))
            if not proposal:
                continue
            proposal['witnesses'] = [
                P.witness_slots('phoneme', word.get('clock_mms'), word.get('clock_second'), word.get('clock_stable'))
                for word in target.get('words') or []
            ]
            if not _write_placer(target, proposal):
                continue
            if replace:
                if existing is not None:
                    song['all_lines'] = [
                        line for line in song['all_lines'] if line.get('id') != line_id
                    ]
                pending.append(target)
            moves.append(_retime_row(song['slug'], target, proposal))
        if pending:
            song['all_lines'].extend(pending)
            song['all_lines'].sort(key=lambda line: int(line.get('order') or 0))
        _refresh_placed(song)
    return moves


def _measure_placement(per_song: list[dict], refute: dict, baseline_n: int) -> tuple:
    """Handoff, then the Latin phoneme placer. Each stays only when the gates rise.

    A phoneme family still over 5 % is not published: handoff is retried without
    it, and a blocked Latin step is dropped whole. The refute cut is the one
    already chosen. Returns retime rows and, when something was kept, the
    measurement that matches the lines left in place.
    """
    origin = _snapshot(per_song)
    stable = origin
    sections = {song['slug']: _section_bounds(song['slug']) for song in per_song}
    retime: dict[str, list[dict]] = {}
    kept = None
    base_n = int(baseline_n)

    def adopt(scopes, modes, tables, picked, moves) -> None:
        nonlocal kept, base_n, stable
        kept = (scopes, modes, tables, picked)
        base_n = int(picked.get('proved') or 0)
        for slug, rows in _group_retime(moves).items():
            retime.setdefault(slug, []).extend(rows)
        stable = _snapshot(per_song)

    try:
        moves = _apply_handoffs(per_song, refute, sections, True)
        if not moves:
            print('передача: опровергнутых строк для следующего постановщика нет', flush=True)
        else:
            scopes, ok, modes, tables, picked = _remeasure(per_song, refute)
            blocked = set(picked.get('blocked_primaries') or [])
            if _rises(ok, picked, baseline_n) and 'phoneme' not in blocked:
                adopt(scopes, modes, tables, picked, moves)
                print(f"передача: оставлена, доказано {picked.get('proved')} против {baseline_n}", flush=True)
            else:
                _restore(per_song, origin)
                why = 'фонемный постановщик выше 5 %' if 'phoneme' in blocked else 'порог не удержан'
                moves = _apply_handoffs(per_song, refute, sections, False)
                if not moves:
                    print(f'передача не оставлена ({why})', flush=True)
                else:
                    scopes, ok, modes, tables, picked = _remeasure(per_song, refute)
                    blocked = set(picked.get('blocked_primaries') or [])
                    if _rises(ok, picked, baseline_n) and 'phoneme' not in blocked:
                        adopt(scopes, modes, tables, picked, moves)
                        print(f"передача без фонемы: оставлена ({why}), доказано {picked.get('proved')}", flush=True)
                    else:
                        _restore(per_song, origin)
                        print(f'передача не оставлена ({why})', flush=True)
        before_latin = _snapshot(per_song)
        latin_moves = _apply_latin(per_song, sections)
        if latin_moves:
            scopes, ok, modes, tables, picked = _remeasure(per_song, refute)
            blocked = set(picked.get('blocked_primaries') or [])
            if _rises(ok, picked, base_n) and 'phoneme' not in blocked:
                was = base_n
                adopt(scopes, modes, tables, picked, latin_moves)
                print(f"латынь: поставлена, доказано {picked.get('proved')} против {was}", flush=True)
            else:
                _restore(per_song, before_latin)
                print(
                    f"латынь не оставлена: доказано {picked.get('proved')} против {base_n}, "
                    f"within_limit {bool(picked.get('within_limit'))}, "
                    f"фонема исключена {'phoneme' in blocked}",
                    flush=True,
                )
        else:
            print('латынь: предложений нет', flush=True)
    except Exception as e:
        _restore(per_song, stable)
        print(f'постановка не допущена ({e.__class__.__name__}: {e})', flush=True)
        return (retime, kept) if kept is not None else ({}, None)
    if kept is None:
        return retime, None
    return retime, kept


def _accept_stamp(per_song: list[dict], decision: dict, modes: dict, refute: dict,
                  baseline_picked: dict) -> tuple:
    """Official remeasure of a phoneme stamp. A per-line mix remeasures word chance too.

    The pair stamp does not. A mix that misses either gate is cleared and the
    pair stamp is measured again, on the modes from before the mix. If that
    also misses, the stamp is dropped and the unstamped rule stands.
    """
    import phoneme_choice as Phone

    Phone.apply(per_song, decision)
    base_n = int(baseline_picked.get('proved') or 0)
    overrides = dict(decision.get('line_roles') or {})
    measure_modes = modes
    new_scopes = None
    if overrides:
        scope_rows = measure_scope_rows(per_song)
        trial_scopes, trial_ok = assign_scopes(scope_rows)
        if not trial_ok:
            decision['line_roles'] = {}
            decision['cover_rejected'] = 'проход слова смеси выше 15 %'
            Phone.apply(per_song, decision)
            overrides = {}
        else:
            measure_modes = _modes_of(trial_scopes)
            new_scopes = trial_scopes
    tables = measure_primary_tables(per_song, measure_modes, refute)
    stamped = choose_with_primaries(tables)
    stamped_n = int(stamped.get('proved') or 0)
    ok = bool(stamped.get('within_limit')) and stamped_n > base_n
    if overrides and not ok:
        decision['line_roles'] = {}
        decision['cover_rejected'] = (
            f'покрытие не удержало порог: доказано {stamped_n} против {base_n}, '
            f'within_limit {bool(stamped.get("within_limit"))}'
        )
        Phone.apply(per_song, decision)
        tables = measure_primary_tables(per_song, modes, refute)
        stamped = choose_with_primaries(tables)
        stamped_n = int(stamped.get('proved') or 0)
        ok = bool(stamped.get('within_limit')) and stamped_n > base_n
        new_scopes = None
    decision['baseline_proved'] = base_n
    decision['official_proved'] = stamped_n
    decision['official_chance'] = stamped.get('chance')
    if ok:
        decision['kept'] = True
        return True, tables, stamped, new_scopes
    Phone.clear(per_song)
    reason = (
        f'официальный пересчёт: доказано {stamped_n} против {base_n}, '
        f'within_limit {bool(stamped.get("within_limit"))}'
    )
    if decision.get('cover_rejected'):
        reason = f"{decision['cover_rejected']}; {reason}"
    _drop_phoneme_stamp(decision, reason)
    return False, None, None, None


def build_payload(slugs: list[str]) -> dict:
    import features as F

    review = load_review()
    bias = {}
    for key, value in (review.get('bias') or {}).items():
        try:
            bias[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    adopt = {str(k): str(v) for k, v in (review.get('adopt') or {}).items() if isinstance(v, str) and v}
    per_song = []
    for slug in slugs:
        report_path = work_dir(slug) / 'align-report.json'
        if not report_path.exists():
            raise SystemExit(f'{slug}: нет work/{slug}/align-report.json')
        audio, is_stem = vocal_stem(slug, None)
        if not is_stem:
            raise SystemExit(f'{slug}: нет вокального стема')
        report = json.loads(report_path.read_text(encoding='utf-8'))
        sig = Q.Signals(load_audio(audio, F.SR))
        next_by, order_by, report_by = _report_index(report)
        all_lines = placed_lines(report, bias, adopt, only_good=False)
        for line in all_lines:
            line['song'] = slug
        lines = [line for line in all_lines if line.get('placed')]
        phone_summary = (report.get('summary') or {}).get('phoneme') or {}
        per_song.append({
            'slug': slug, 'lines': lines, 'all_lines': all_lines,
            'sets': _peak_sets(sig), 'base': Q.onset_peak_times(sig),
            'envelope_peaks': Q.envelope_peak_times(sig, min_height=WITNESS_HEIGHT),
            'use_choir_envelope': False,
            'latin_place': phone_summary.get('latin_place') or {},
            'report_by_id': report_by,
            'next_by_id': next_by,
            'order_by_id': order_by,
        })
    print(f'атака: пики {len(per_song)} песен', flush=True)
    # The pooled grid stays in the file as context. The decision is the per-slice
    # witness mode plus the line share, not the winner of that grid.
    rows = _evaluate_pooled(per_song)
    current = next((row for row in rows if is_current(row)), None)
    scope_rows = measure_scope_rows(per_song)
    scopes, scopes_ok = assign_scopes(scope_rows)
    refute_rows = measure_refute(per_song)
    refute = choose_refute(refute_rows)
    modes = {(row['song'], row['lang']): row['witnesses'] for row in scopes if row.get('witnesses') in ('one', 'two')}
    # Baseline first, with no phoneme stamp and the spectral attack. The search
    # proposes a stamp. The same measurement after apply() keeps it only when
    # the line chance stays at or under 5 % and more lines are proved.
    print('атака: базовый проход строк', flush=True)
    baseline_tables = measure_primary_tables(per_song, modes, refute)
    baseline_picked = choose_with_primaries(baseline_tables)
    print(f"атака: без фонемы доказано {baseline_picked.get('proved')}", flush=True)
    placement_retime, placed_kept = _measure_placement(
        per_song, refute, int(baseline_picked.get('proved') or 0))
    if placed_kept is not None:
        scopes, modes, baseline_tables, baseline_picked = placed_kept
        scopes_ok = True
    primary_tables = baseline_tables
    picked = baseline_picked
    decision: dict = {
        'admitted': False, 'kept': False, 'rejected_reason': None, 'pairs': [], 'long': [],
        'k': None, 'chance': None, 'proved': None, 'search': None,
        'choir_attack': 'spectral', 'choir_clock': 'phone',
        'chorus': {'adopted': False, 'why': 'часов нет', 'describe': {}, 'words': 0, 'variants': []},
    }
    try:
        import phoneme_choice as Phone
        decision = Phone.choose(per_song, modes, refute)
        print(
            f"фонема предложена: {bool(decision.get('admitted'))}, "
            f"поиск {decision.get('search')}, доказано {decision.get('proved')}",
            flush=True,
        )
        if decision.get('admitted'):
            print('атака: официальный пересчёт со штампом', flush=True)
            kept_stamp, stamped_tables, stamped, new_scopes = _accept_stamp(
                per_song, decision, modes, refute, baseline_picked)
            if kept_stamp:
                primary_tables = stamped_tables
                picked = stamped
                if new_scopes is not None:
                    scopes = new_scopes
                    modes = _modes_of(scopes)
                    scopes_ok = True
            else:
                primary_tables = baseline_tables
                picked = baseline_picked
        else:
            Phone.clear(per_song)
    except Exception as e:
        try:
            import phoneme_choice as Phone
            Phone.clear(per_song)
        except Exception:
            pass
        decision = _phoneme_error_decision(e)
        primary_tables = baseline_tables
        picked = baseline_picked
        print(f'фонемный свидетель не допущен ({e.__class__.__name__}: {e})', flush=True)
    try:
        fill_report = _measure_attack_fill(per_song, modes, refute, picked)
    except Exception as e:
        for song in per_song:
            song['use_attack_fill'] = False
        fill_report = _empty_fill(int(picked.get('proved') or 0), f'замер не собран: {e.__class__.__name__}')
        print(f'заливка огибающей не допущена ({e.__class__.__name__}: {e})', flush=True)
    if fill_report.get('kept') and fill_report.get('tables') is not None:
        primary_tables = fill_report['tables']
        picked = fill_report['picked']
    blocked = set(picked.get('blocked_primaries') or [])
    line_rows = []
    for share in LINE_SHARES:
        proved = 0
        candidates = 0
        by_song: dict[str, int] = {}
        chances = []
        for name, table in primary_tables.items():
            if name in blocked:
                continue
            row = _row_at(table, share)
            n = int(row.get('candidates') or 0)
            if n == 0:
                continue
            proved += int(row.get('proved') or 0)
            candidates += n
            for song, hits in (row.get('by_song') or {}).items():
                by_song[song] = by_song.get(song, 0) + int(hits)
            if row.get('chance') is not None:
                chances.append(float(row['chance']))
        line_rows.append({
            'k': share,
            'chance': None if not chances else max(chances),
            'proved': proved,
            'candidates': candidates,
            'by_song': by_song,
            'shifts': {},
        })
    _stamp_phoneme_scopes(scopes, decision)
    if decision.get('kept'):
        choir_attack = decision.get('choir_attack') if decision.get('choir_attack') in ('spectral', 'envelope') else 'spectral'
        choir_clock = decision.get('choir_clock') if decision.get('choir_clock') in ('phone', 'vowel') else 'phone'
    else:
        choir_attack, choir_clock = 'spectral', 'phone'
    public_scopes = [_public_scope(row) for row in scopes]
    public_lines = [_public_line(row) for row in line_rows]
    public_refute = _public_refute(refute)
    public_grid = [_public_refute(row) for row in refute_rows]
    share = picked.get('k')
    chosen = {
        'name': 'unmeasured' if share is None else f'line-{float(share):.2f}',
        'tol': 0.10,
        'choir_tol': 0.20,
        'peak_height': WITNESS_HEIGHT,
        'require_rise': False,
        'require_second': False,
        'witnesses': None,
        'agree_tol': SECOND_TOL,
        'scopes': public_scopes,
        'refute': public_refute,
        'line_share': share,
        'line_min_words': 2,
        'line_chance': _round(picked.get('chance')),
        'line_limit': LINE_LIMIT,
        'chance': _round(picked.get('chance')),
        'primaries': [_public_primary(row) for row in (picked.get('primaries') or [])],
        'blocked_primaries': list(picked.get('blocked_primaries') or []),
        'true_proved': picked.get('proved') or 0,
        'true_total': picked.get('candidates') or 0,
        'true_rate': None if not picked.get('candidates') else _round((picked.get('proved') or 0) / picked['candidates']),
        'shifts': {key: _round(value) for key, value in (picked.get('shifts') or {}).items()},
        'within_limit': bool(scopes_ok and picked.get('within_limit')),
        'why': 'per-slice',
        'bias': bias,
        'adopt': adopt,
        'choir_attack': choir_attack,
        'choir_clock': choir_clock,
        'attack_fill': bool(fill_report.get('kept')),
        'line_roles': dict(decision.get('line_roles') or {}) if decision.get('kept') else {},
        'retime': placement_retime,
    }
    density = []
    for song in per_song:
        density.extend(density_table(song['slug'], song['lines'], song['base']))
    public_rows = []
    for row in rows:
        public_rows.append({k: v for k, v in row.items() if not k.startswith('_')})
    return {
        'limit': LIMIT,
        'line_limit': LINE_LIMIT,
        'min_words': MIN_WORDS,
        'shifts': list(SHIFTS),
        'songs': list(slugs),
        'placed_lines': sum(len(song['lines']) for song in per_song),
        'placed_words': sum(len(line['words']) for song in per_song for line in song['lines']),
        'current_chance': None if current is None else current.get('chance'),
        'scopes_ok': scopes_ok,
        'chosen': chosen,
        'scopes': public_scopes,
        'refute_grid': public_grid,
        'line_table': public_lines,
        'density': density,
        'candidates': public_rows,
        'phoneme': decision,
        'attack_fill': _public_fill(fill_report),
        '_refutations': collect_refutations(per_song, refute),
    }


def _evaluate_pooled(per_song: list[dict]) -> list[dict]:
    """Score every candidate across songs. Chance is the max shift rate on the pooled words.

    Peaks stay per song: a word is compared only with attacks in its own recording.
    """
    rows = []
    for rule in witness_rules() + iter_rules():
        hit_num = {f'{mag:.2f}': [0, 0] for mag in SHIFTS}
        hit_num['shuffle'] = [0, 0]
        proved = 0
        total = 0
        for song in per_song:
            peaks = song['sets'][(float(rule['peak_height']), bool(rule['require_rise']))]
            flat = _flat(song['lines'])
            shuffled = shuffled_records(song['lines'])
            for mag in SHIFTS:
                for sign in (mag, -mag):
                    hits, n = hit_count(flat, peaks, sign, rule)
                    hit_num[f'{mag:.2f}'][0] += hits
                    hit_num[f'{mag:.2f}'][1] += n
            hits, n = hit_count(shuffled, peaks, 0.0, rule)
            hit_num['shuffle'][0] += hits
            hit_num['shuffle'][1] += n
            p, n = true_proof(song['lines'], peaks, rule)
            proved += p
            total += n
        rates = {}
        for key, (hits, n) in hit_num.items():
            rates[key] = None if n == 0 else hits / n
        nums = [v for v in rates.values() if v is not None]
        chance = None if not nums else max(nums)
        row = dict(rule)
        row['shifts'] = {k: _round(v) for k, v in rates.items()}
        row['chance'] = _round(chance)
        row['true_proved'] = proved
        row['true_total'] = total
        row['true_rate'] = None if total == 0 else _round(proved / total)
        row['_chance'] = chance
        row['_true_rate'] = None if total == 0 else proved / total
        rows.append(row)
    return rows


def render_placement(slugs: list[str]) -> str:
    """The placement chain, from each song's align report. Rules are not changed here."""
    lines = [
        '# Постановка',
        '',
        'Первый проход — MMS в окне реплики. Строка поставлена, когда структурные проверки пройдены '
        'и начало не дальше 0,30 с от реплики. Таблица ниже — строки соло и хора, которые этот проход не поставил. '
        '«Нет пути» — выравниватель не справился. «Структура» — путь есть, но проверки не пройдены. '
        '«|Δ| > 0,3» — структура пройдена, а начало дальше 0,30 с. '
        'Окно, ft, stable-ts и второй выравниватель — кто из цепочки сам прошёл бы те же две проверки. '
        'Берётся первый. Спор реплики и трёх часов — отдельная таблица: правила из-за неё не меняются.',
        '',
    ]
    for slug in slugs:
        path = work_dir(slug) / 'align-report.json'
        lines.append(f'## {slug}')
        lines.append('')
        if not path.exists():
            lines.append('Отчёта выравнивания нет.')
            lines.append('')
            continue
        report = json.loads(path.read_text(encoding='utf-8'))
        place = (report.get('summary') or {}).get('placement') or {}
        by = place.get('by') or {}
        if by:
            bits = ', '.join(f'{name} — {n}' for name, n in sorted(by.items()))
            lines.append(f'Кто поставил строки соло и хора: {bits}.')
        else:
            lines.append('Поставленных строк соло и хора нет.')
        lines.append('')
        lines.append('| язык | MMS не поставил | нет пути | структура | из них далеко | только \\|Δ\\| > 0,3 | окно | ft | stable структура | stable ≤ 0,3 | stable поставил бы | второй структура | второй ≤ 0,3 | второй поставил бы |')
        lines.append('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
        for row in place.get('unplaced') or []:
            lines.append(
                f"| {row.get('lang')} | {row.get('unplaced', 0)} | {row.get('missing', 0)} | {row.get('structure', 0)} | "
                f"{row.get('structure_far', 0)} | {row.get('delta', 0)} | {row.get('window_placed', 0)} | {row.get('ft_placed', 0)} | "
                f"{row.get('stable_structure', 0)} | {row.get('stable_near', 0)} | {row.get('stable_placed', 0)} | "
                f"{row.get('second_structure', 0)} | {row.get('second_near', 0)} | {row.get('second_placed', 0)} |"
            )
        if not place.get('unplaced'):
            lines.append('| — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |')
        lines.append('')
        disputes = place.get('dispute') or []
        lines.append(f"Строк, где MMS стоит от реплики дальше 0,30 с и не дальше 0,70 с: {place.get('dispute_n', len(disputes))}. "
                     f"Все три часа согласны между собой (≤ 0,10 с): {place.get('dispute_agree', 0)}. "
                     f"И при этом на сильной атаке: {place.get('dispute_attack', 0)}.")
        lines.append('')
        lines.append('| id | язык | группа | реплика | MMS | второй | stable-ts | \\|Δ\\| | разброс | согласны | атака | до атаки |')
        lines.append('|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|')
        shown = [row for row in disputes if row.get('attack')]
        for row in shown:
            lines.append(
                f"| {row.get('id')} | {row.get('lang')} | {row.get('group')} | {_ru(row.get('cue'), 3)} | "
                f"{_ru(row.get('mms'), 3)} | {_ru(row.get('second'), 3)} | {_ru(row.get('stable'), 3)} | "
                f"{_ru(row.get('delta'), 3)} | {_ru(row.get('span'), 3)} | {'да' if row.get('agree') else 'нет'} | "
                f"{'да' if row.get('attack') else 'нет'} | {_ru(row.get('attack_dt'), 3)} |"
            )
        if not shown:
            lines.append('| — | — | — | — | — | — | — | — | — | нет | нет | — |')
        lines.append('')
        choir = place.get('choir') or {}
        if choir:
            lines.append('Хор. «Финал» — строки `eckhart-f-*`. Остальные хоровые строки — куплеты. Вместе это группа хора.')
            lines.append('')
            lines.append('| часть | строк | поставлено | медиана \\|Δ\\| MMS | спор 0,3–0,7 | трое согласны | на атаке | промежуток реплик, медиана | минимум |')
            lines.append('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
            for key, label in (('all', 'хор'), ('verses', 'куплеты'), ('finale', 'финал')):
                part = choir.get(key) or {}
                counts = part.get('by') or {}
                who = ', '.join(f'{name} {n}' for name, n in sorted(counts.items())) or '—'
                lines.append(
                    f"| {label} | {part.get('n', 0)} | {part.get('placed', 0)} ({who}) | {_ru(part.get('median_mms_delta'), 3)} | "
                    f"{part.get('dispute', 0)} | {part.get('dispute_agree', 0)} | {part.get('dispute_attack', 0)} | "
                    f"{_ru(part.get('cue_gap_median'), 3)} | {_ru(part.get('cue_gap_min'), 3)} |"
                )
            lines.append('')
        ft = place.get('ft') or {}
        skipped = ft.get('skipped_ids') or []
        lines.append(
            f"htdemucs_ft: запущен {'да' if ft.get('ran') else 'нет'}, отрезков {ft.get('clips', 0)}, "
            f"пропущено оценкой бюджета {len(skipped)}, не отделено на ходу {ft.get('skipped', 0)}, "
            f"заняло {_ru(ft.get('elapsed_s'), 1)} с из {_ru(ft.get('budget_s'), 0)} с."
            + (f" Причина: {ft.get('error')}." if ft.get('error') else '')
        )
        lines.append('')
    lines.append('')
    return '\n'.join(lines)


def render_witness(slugs: list[str]) -> str:
    """Whisper model comparison from the align summaries. Numbers come from the run."""
    import whisper_witness as W

    songs = []
    for slug in slugs:
        path = work_dir(slug) / 'align-report.json'
        if not path.exists():
            songs.append({'slug': slug, 'model': None, 'rows': [], 'missing': True})
            continue
        report = json.loads(path.read_text(encoding='utf-8'))
        summary = report.get('summary') or {}
        songs.append({
            'slug': slug,
            'model': summary.get('placement_model') or summary.get('stable_model'),
            'proof_models': summary.get('proof_models') or {},
            'budget_s': summary.get('whisper_budget_s'),
            'rows': summary.get('whisper_witness') or [],
        })
    return W.render_witness(songs)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--choose', action='store_true', help='measure and write the bench table')
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    if not args.choose:
        ap.error('нужен --choose')
    payload = build_payload(args.slugs)
    refutations = payload.pop('_refutations', [])
    out_dir = ROOT / 'docs' / 'analysis' / 'bench'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'attack-chance.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    # A report renderer must not cancel qa. The json above is what qa reads.
    try:
        (out_dir / 'attack-chance.md').write_text(render_md(payload), encoding='utf-8')
    except Exception as e:
        print(f'attack-chance.md не записан ({e.__class__.__name__}: {e})')
    try:
        (out_dir / 'placement.md').write_text(render_placement(args.slugs), encoding='utf-8')
    except Exception as e:
        print(f'placement.md не записан ({e.__class__.__name__}: {e})')
    try:
        import whisper_witness as W
        cut = (payload.get('chosen') or {}).get('refute') or {}
        shift_rows = []
        for slug in args.slugs:
            path = work_dir(slug) / 'align-report.json'
            if not path.exists():
                continue
            shift_rows.extend(W.window_rows_from_report(json.loads(path.read_text(encoding='utf-8')), slug))
        (out_dir / 'refutation.md').write_text(
            W.render_refutation(refutations, cut.get('both_far'), cut.get('only_far'))
            + '\n'
            + W.window_shift_paragraph(W.window_shift(shift_rows))
            + '\n',
            encoding='utf-8')
    except Exception as e:
        print(f'refutation.md не записан ({e.__class__.__name__}: {e})')
    try:
        (out_dir / 'whisper-witness.md').write_text(render_witness(args.slugs), encoding='utf-8')
    except Exception as e:
        print(f'whisper-witness.md не записан ({e.__class__.__name__}: {e})')
    phone = payload.get('phoneme') or {}
    try:
        import phoneme_choice as Phone
        (out_dir / 'phoneme-choice.md').write_text(Phone.render_choice(phone), encoding='utf-8')
    except Exception as e:
        print(f'phoneme-choice.md не записан ({e.__class__.__name__}: {e})')
    try:
        import phoneme_choice as Phone
        (out_dir / 'chorus.md').write_text(Phone.render_chorus(phone.get('chorus') or {}), encoding='utf-8')
    except Exception as e:
        print(f'chorus.md не записан ({e.__class__.__name__}: {e})')
    chosen = payload['chosen']
    refute = chosen.get('refute') or {}
    print(f"правило {chosen.get('name')}: случайный проход строки {chosen.get('chance')}, "
          f"доказано строк {chosen.get('true_proved')} из {chosen.get('true_total')}, "
          f"within_limit {chosen.get('within_limit')}")
    for row in chosen.get('primaries') or []:
        print(f"постановщик {row.get('name')}: проход {row.get('chance')}, "
              f"{row.get('proved')} из {row.get('candidates')}, исключён {row.get('blocked')}")
    print(f"опровергнуто {refute.get('refuted')} из {refute.get('words')} "
          f"(оба дальше {refute.get('both_far')} с, один дальше {refute.get('only_far')} с, "
          f"within_cap {refute.get('within_cap')})")
    for scope in chosen.get('scopes') or []:
        if scope.get('lang') == '*':
            print(f"{scope['song']}: {scope.get('witnesses')} проход {scope.get('chance')} ({scope.get('why')})")
    print(f"фонема оставлена {bool(phone.get('kept'))}, поиск {phone.get('search')}, "
          f"по перебору {phone.get('proved')}, хор {chosen.get('choir_attack')}/{chosen.get('choir_clock')}")
    fill = payload.get('attack_fill') or {}
    print(f"заливка огибающей {bool(fill.get('kept'))}: {fill.get('why')}, "
          f"{fill.get('proved')} против {fill.get('base_proved')}")
    if not chosen.get('within_limit'):
        return 2
    have = set(payload.get('songs') or [])
    missing = [slug for slug in args.slugs if slug not in have]
    if missing:
        print('нет песен: ' + ', '.join(missing))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
