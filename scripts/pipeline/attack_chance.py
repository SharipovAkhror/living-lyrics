"""How often a random word start still lands on a vocal attack.

    python3 scripts/pipeline/attack_chance.py --choose <slug> [<slug>…]

Runs after every song in the job has been aligned and before qa. It reads
work/<slug>/align-report.json and the vocal stem, measures attack density and
the chance that a shifted word start still passes the attack test, and writes
docs/analysis/bench/attack-chance.json and attack-chance.md.

Singing puts an attack on almost every note. If those attacks sit about 0.2 s
apart, a time 0.15 s off the true start is still within 0.10 s of some attack,
and the attack test does not prove the word.

The first candidates are the witness rules. `attack-h0.7-one` is a strong attack
(height 0.7, solo 0.10 s, choir 0.20 s) plus at least one independent clock
(the calibrated second aligner, or stable-ts) within 0.10 s of the probe.
`attack-h0.7-two` needs both clocks. The one-witness rule is kept when its
chance is already at or under 15 %. Otherwise the two-witness rule is tried.
Only if both are over 15 % does the older grid run: a smaller tolerance, a
higher peak, an energy rise, or a required second aligner. The plain 0.10 s /
height 0.5 rule does not override a witness rule that already qualifies.

The chance test shifts placed-line word starts by ±0.15, ±0.25 and ±0.4 s and
rotates starts inside each line. The witness clocks stay where they were
measured. A probe passes when it is within tolerance of some attack and, for a
witness rule, of enough of those fixed clocks. The shuffle keeps each word's
clocks and takes the next word's start. The true-proof rate uses
qa_sync.prove_words, ownership included. Bias and adoption come from
aligner-review.json and are copied onto the chosen rule.

Exit 2 when a song has no stem or no align report, or when no rule keeps the
chance at or under 15 %. qa must not run on an unmeasured rule.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

import qa_sync as Q
from common import ROOT, load_audio, vocal_stem, work_dir

LIMIT = 0.15
SHIFTS = (0.15, 0.25, 0.40)
HEIGHTS = (0.5, 0.7, 0.9, 1.2)
TOLS = (0.10, 0.08, 0.06, 0.05, 0.04)
SECOND_TOL = Q.SECOND_WORD_TOL


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


def hit_count(records: list[dict], peaks: np.ndarray, shift: float, rule: dict) -> tuple[int, int]:
    """How many probe times pass this rule's attack test, and how many were tested."""
    if not records:
        return 0, 0
    hits = 0
    for group, tol in (('solo', float(rule['tol'])), ('choir', float(rule['choir_tol'])), ('other', float(rule['tol']))):
        rows = [r for r in records if r.get('group', 'solo') == group]
        if not rows:
            continue
        times = np.array([float(r['t']) + shift for r in rows], dtype=float)
        mask = _near_mask(times, peaks, tol)
        mode = rule.get('witnesses')
        if mode in ('one', 'two'):
            agree = float(rule.get('agree_tol', SECOND_TOL))

            def column(key: str) -> np.ndarray:
                return np.array([np.nan if r.get(key) is None else float(r[key]) for r in rows])

            sec = column('second')
            third = column('third')
            sec_ok = np.isfinite(sec) & (np.abs(sec - times) <= agree + 1e-12)
            third_ok = np.isfinite(third) & (np.abs(third - times) <= agree + 1e-12)
            mask = mask & (sec_ok & third_ok if mode == 'two' else (sec_ok | third_ok))
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


def placed_lines(report: dict, bias: dict | None = None, adopt: dict | None = None) -> list[dict]:
    lines = []
    timing = {'bias': bias or {}, 'adopt': adopt or {}}
    for line in report.get('lines') or []:
        if line.get('status') != 'good':
            continue
        words = []
        adjusted = Q.apply_rule_times(line.get('words') or [], line.get('lang'), timing) or []
        for word in adjusted:
            if not word.get('roman') or word.get('ctc_s') is None:
                continue
            words.append({
                't': float(word['ctc_s']),
                'ctc_e': None if word.get('ctc_e') is None else float(word['ctc_e']),
                'second': None if word.get('second_s') is None else float(word['second_s']),
                'third': None if word.get('third_s') is None else float(word['third_s']),
                'roman': word['roman'],
                'group': line.get('group') or 'solo',
                'lang': line.get('lang') or '?',
                'line': line['id'],
            })
        if not words:
            continue
        end = max(w['ctc_e'] if w['ctc_e'] is not None else w['t'] for w in words)
        lines.append({
            'id': line['id'],
            'lang': line.get('lang') or '?',
            'group': line.get('group') or 'solo',
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


def render_md(payload: dict) -> str:
    chosen = payload['chosen']
    lines = [
        '# Случайный проход атаки',
        '',
        'Замер на вокальном стеме, только по поставленным строкам, после выравнивания всех песен задания и до проверки. '
        'Плотность — медиана промежутка между атаками при силе пика 0,5. '
        'Случайный проход — доля начал, которые после сдвига всё ещё оказываются не дальше допуска от какой-нибудь атаки '
        '(для правила с обязательным вторым выравнивателем — ещё и не дальше 0,10 с от его начала). '
        'Перемешивание — каждое слово получает начало следующего слова той же строки. '
        'В зачёт идёт худшая из этих долей. Предел 15 %. Доля доказанных — слова поставленных строк, которые проходят полное доказательство, включая путь без атаки.',
        '',
        _why_ru(chosen, payload.get('current_chance')),
        '',
        f"Правило: `{chosen.get('name')}`. Случайный проход {_ru(chosen.get('chance'), 3)}. "
        f"Доказано слов {chosen.get('true_proved', '—')} из {chosen.get('true_total', '—')}.",
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
        '## Случайный проход по песням и языкам',
        '',
        'Базовое правило — допуск 0,10 с, хор 0,20 с, сила пика 0,5. '
        'Рядом то же для выбранного правила, если оно другое.',
        '',
        '| песня | язык | слов | ±0,15 | ±0,25 | ±0,40 | перемешивание | худшая | правило |',
        '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ]
    for row in payload.get('by_slice') or []:
        rates = row['rates']
        lines.append(
            f"| {row['song']} | {row['lang']} | {row['words']} | {_ru(rates.get('0.15'), 3)} | "
            f"{_ru(rates.get('0.25'), 3)} | {_ru(rates.get('0.40'), 3)} | {_ru(rates.get('shuffle'), 3)} | "
            f"{_ru(rates.get('chance'), 3)} | {row['rule']} |"
        )
    lines += [
        '',
        '## Кандидаты',
        '',
        'Показаны правило, которое уже стоит в коде, выбранное и те, что уложились в 15 %. '
        'Полный перебор — в `attack-chance.json`.',
        '',
        '| правило | допуск | сила | подъём | второй / свидетели | худшая доля | доказано слов |',
        '|---|---:|---:|---|---|---:|---:|',
    ]
    show = []
    for row in payload.get('candidates') or []:
        if row['name'] == chosen.get('name') or is_current(row) or (row.get('chance') is not None and row['chance'] <= LIMIT):
            show.append(row)
    show.sort(key=lambda row: (0 if row['name'] == chosen.get('name') else 1, -(row.get('true_rate') or 0)))
    for row in show:
        mark = ' ←' if row['name'] == chosen.get('name') else ''
        lines.append(
            f"| {row['name']}{mark} | {_ru(row['tol'], 2)} | {_ru(row['peak_height'], 1)} | "
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
        lines = placed_lines(report, bias, adopt)
        per_song.append({'slug': slug, 'lines': lines, 'sets': _peak_sets(sig), 'base': Q.onset_peak_times(sig)})
    # One rule is chosen on the pooled placed lines, not on the first song alone.
    pooled: list[dict] = []
    for song in per_song:
        pooled.extend(song['lines'])
    # Peak sets differ per recording. A candidate's chance is the worst song-pooled
    # rate: each song is scored on its own peaks, then the hits are summed.
    rows = _evaluate_pooled(per_song)
    if not pooled:
        chosen = choose([])
    else:
        chosen = choose_measured(rows)
    chosen['bias'] = bias
    chosen['adopt'] = adopt
    current = next((row for row in rows if is_current(row)), None)
    density = []
    slices = []
    base_rule = next(rule for rule in iter_rules() if is_current(rule))
    chosen_rule = {k: chosen[k] for k in (
        'name', 'tol', 'choir_tol', 'peak_height', 'require_rise', 'require_second', 'witnesses', 'agree_tol',
    ) if k in chosen}
    for song in per_song:
        density.extend(density_table(song['slug'], song['lines'], song['base']))
        flat = _flat(song['lines'])
        by_lang: dict[str, list[dict]] = {}
        for word in flat:
            by_lang.setdefault(word['lang'], []).append(word)
        groups = [('*', flat)] + sorted(by_lang.items())
        for lang, recs in groups:
            for rule in (base_rule, chosen_rule):
                if rule.get('name') == base_rule['name'] and chosen_rule.get('name') == base_rule['name'] and rule is not base_rule:
                    continue
                peaks = song['sets'][(float(rule['peak_height']), bool(rule.get('require_rise')))]
                slices.append({
                    'song': song['slug'],
                    'lang': lang,
                    'words': len(recs),
                    'rule': rule['name'],
                    'rates': slice_rates(recs, peaks, rule),
                })
    public_rows = []
    for row in rows:
        public_rows.append({k: v for k, v in row.items() if not k.startswith('_')})
    return {
        'limit': LIMIT,
        'shifts': list(SHIFTS),
        'songs': list(slugs),
        'placed_lines': sum(len(song['lines']) for song in per_song),
        'placed_words': sum(len(line['words']) for song in per_song for line in song['lines']),
        'current_chance': None if current is None else current.get('chance'),
        'chosen': chosen,
        'density': density,
        'by_slice': slices,
        'candidates': public_rows,
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--choose', action='store_true', help='measure and write the bench table')
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    if not args.choose:
        ap.error('нужен --choose')
    payload = build_payload(args.slugs)
    out_dir = ROOT / 'docs' / 'analysis' / 'bench'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'attack-chance.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    (out_dir / 'attack-chance.md').write_text(render_md(payload), encoding='utf-8')
    chosen = payload['chosen']
    print(f"правило {chosen.get('name')}: случайный проход {chosen.get('chance')}, "
          f"доказано {chosen.get('true_rate')}, within_limit {chosen.get('within_limit')}")
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
