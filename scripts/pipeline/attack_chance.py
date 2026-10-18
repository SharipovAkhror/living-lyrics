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
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

import placement as P
import qa_sync as Q
from common import ROOT, load_audio, vocal_stem, work_dir

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


def placed_lines(report: dict, bias: dict | None = None, adopt: dict | None = None,
                 only_good: bool = True) -> list[dict]:
    """Word rows in report order. `only_good` keeps placed lines, which is the word-chance pool.

    The line measurement asks for every line that has a pre-snap start, including
    ones that were not placed, so peak ownership can cross them the way qa does.
    `placed` records the original status. A line with no lettered start is left out.
    """
    lines = []
    timing = {'bias': bias or {}, 'adopt': adopt or {}}
    for line in report.get('lines') or []:
        good = line.get('status') == 'good'
        if only_good and not good:
            continue
        words = []
        adjusted = Q.apply_rule_times(line.get('words') or [], line.get('lang'), timing) or []
        kept = []
        for word in adjusted:
            if not word.get('roman') or word.get('ctc_s') is None:
                continue
            kept.append(word)
        prev_span = None
        prev_roman = None
        for index, word in enumerate(kept):
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
                'n': len(kept),
                'prev_span': prev_span,
                'prev_roman': prev_roman,
                's': None if word.get('s') is None else float(word['s']),
                'second_kind': word.get('second_kind'),
                'third_kind': word.get('third_kind'),
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
        '| песня | язык | слов | один | оба | правило | проход правила | почему |',
        '|---|---|---:|---:|---:|---|---:|---|',
    ]
    for row in payload.get('scopes') or []:
        mode = {'one': 'один', 'two': 'оба'}.get(row.get('witnesses') or '', '—')
        lines.append(
            f"| {row['song']} | {row['lang']} | {row['words']} | {_ru(row.get('one_chance'), 3)} | "
            f"{_ru(row.get('two_chance'), 3)} | {mode} | {_ru(row.get('chance'), 3)} | {_why_label(row.get('why'))} |"
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


def _probe_line(words: list[dict], peaks: np.ndarray, group: str | None, mode: str,
                refute: dict, share: float, prev: float | None) -> bool:
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
        }
        align_words.append(item)
        owned = None if cursor is None else cursor + tol
        presnap.append(Q.nearest_attack(float(word['t']), peaks, owned))
        cursor = float(word['t'])
    proved = Q.prove_words(align_words, presnap, tol, witnesses=mode, agree_tol=SECOND_TOL)
    flags = [Q.word_refuted(word, peaks, refute) for word in align_words]
    return Q.line_word_ok(proved, flags, share)


def line_pass_count(lines: list[dict], peaks: np.ndarray, modes: dict, refute: dict, share: float,
                    shift: float = 0.0, shuffle: bool = False, primary: str | None = None) -> tuple[int, int]:
    """Candidate lines that still pass after one shared shift, or after a rotation.

    The cue belongs to the real line and is not applied to the shifted first word.
    The previous line contributes its real, unshifted start. Inside the line the
    moved starts own the peaks. Witness clocks stay on the word they were measured for.
    """
    prev: float | None = None
    incoming: list[float | None] = []
    for line in lines:
        incoming.append(prev)
        if line.get('words'):
            prev = float(line['words'][-1]['t'])
    hits = 0
    n = 0
    for i, line in enumerate(lines):
        if not _line_candidate(line):
            continue
        if primary is not None and P.primary_family(line.get('placed_by')) != primary:
            continue
        n += 1
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
        if _probe_line(moved, peaks, line.get('group'), _mode_of_line(modes, line), refute, share, incoming[i]):
            hits += 1
    return hits, n


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
            lines = song['all_lines']
            for mag in SHIFTS:
                for sign in (mag, -mag):
                    h, n = line_pass_count(lines, peaks, modes, cut, share, shift=sign, primary=primary)
                    shift_hits[mag][0] += h
                    shift_hits[mag][1] += n
            h, n = line_pass_count(lines, peaks, modes, cut, share, shuffle=True, primary=primary)
            shuf[0] += h
            shuf[1] += n
            h, n = line_pass_count(lines, peaks, modes, cut, share, primary=primary)
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


PRIMARY_FAMILIES = ('mms', 'stable-ts', 'second')


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


def _public_refute(row: dict) -> dict:
    out = {key: value for key, value in row.items() if key != 'by'}
    if out.get('rate') is not None:
        out['rate'] = _round(out['rate'])
    by = []
    for item in row.get('by') or []:
        by.append(dict(item))
    out['by'] = by
    return out


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
        all_lines = placed_lines(report, bias, adopt, only_good=False)
        for line in all_lines:
            line['song'] = slug
        lines = [line for line in all_lines if line.get('placed')]
        per_song.append({
            'slug': slug, 'lines': lines, 'all_lines': all_lines,
            'sets': _peak_sets(sig), 'base': Q.onset_peak_times(sig),
        })
    # The pooled grid stays in the file as context. The decision is the per-slice
    # witness mode plus the line share, not the winner of that grid.
    rows = _evaluate_pooled(per_song)
    current = next((row for row in rows if is_current(row)), None)
    scope_rows = measure_scope_rows(per_song)
    scopes, scopes_ok = assign_scopes(scope_rows)
    refute_rows = measure_refute(per_song)
    refute = choose_refute(refute_rows)
    modes = {(row['song'], row['lang']): row['witnesses'] for row in scopes if row.get('witnesses') in ('one', 'two')}
    primary_tables = measure_primary_tables(per_song, modes, refute)
    picked = choose_with_primaries(primary_tables)
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
            'model': summary.get('stable_model'),
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
        (out_dir / 'refutation.md').write_text(
            W.render_refutation(refutations, cut.get('both_far'), cut.get('only_far')), encoding='utf-8')
    except Exception as e:
        print(f'refutation.md не записан ({e.__class__.__name__}: {e})')
    try:
        (out_dir / 'whisper-witness.md').write_text(render_witness(args.slugs), encoding='utf-8')
    except Exception as e:
        print(f'whisper-witness.md не записан ({e.__class__.__name__}: {e})')
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
