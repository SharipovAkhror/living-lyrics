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
stamped clocks must stay at or under 5 %. The search only proposes the stamp.
The witness role does not place a line and does not refute a word. A separate
pass may hand a refuted line to a later placer, and may place a still-open
Latin line from the phoneme aligner. A choir-wide vowel clock stays off unless
its own measurement fits. Filling a missing spectral attack, a syllable nucleus
on a long sung vowel, and a wider gate for a translation cue are separate
configurations of the same kind. The wider gate is also measured together with
the fill, the nucleus and the phoneme stamp: a line outside 0.30 s otherwise
never sees those attacks. A lone witness that sits closer to another lettered
word of the same line does not refute this word. Two clocks that agree still
do. The cutoffs stay 0.20 s and 0.30 s. A hearing is not a clock.

Every configuration that stays inside both caps is joined with the baseline.
A line is proved when any joined configuration proves it. The join is one
configuration: its word chance and its line chance are measured again on the
shifted probes, and it is kept only when the line chance is still at or under
5 %. A line the baseline proved is left out only when keeping it would put
that chance over 5 %, and the chance that blocked it is recorded. A higher
total does not replace a lower one.
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


def _vowel_clock(word: dict) -> float | None:
    """Syllable-nucleus time. A stamped `vowel` wins; otherwise the finished espeak model."""
    if word.get('vowel') is not None:
        return float(word['vowel'])
    table = word.get('vowels') or {}
    for name in ('xlsr-53-espeak', 'lv-60-espeak'):
        if table.get(name) is not None:
            return float(table[name])
    return None


def hit_mask(records: list[dict], peaks: np.ndarray, shift: float, rule: dict,
             fill_peaks: np.ndarray | None = None) -> np.ndarray:
    """One boolean per record, in input order. Empty input returns an empty array.

    `fill_peaks` adds the envelope. A nucleus clock, when the rule asks for it,
    covers a long vowel whose spectral peak is outside the group tolerance.
    The nucleus stays on the unshifted word: the shifted start hits only when
    it lands within tolerance of that fixed clock.
    """
    if not records:
        return np.zeros(0, dtype=bool)
    out = np.zeros(len(records), dtype=bool)
    groups = {}
    for index, rec in enumerate(records):
        groups.setdefault(rec.get('group', 'solo'), []).append(index)
    for group, indexes in groups.items():
        tol = float(rule['choir_tol']) if group == 'choir' else float(rule['tol'])
        rows = [records[i] for i in indexes]
        times = np.array([float(r['t']) + shift for r in rows], dtype=float)
        mask = _near_mask(times, peaks, tol)
        if fill_peaks is not None and len(fill_peaks):
            mask = mask | _near_mask(times, fill_peaks, tol)
        if rule.get('nucleus'):
            vowels = np.array([np.nan if _vowel_clock(r) is None else _vowel_clock(r) for r in rows])
            long = np.array([
                Q.long_vowel(
                    r.get('roman') or '',
                    r.get('own_t', r.get('t')),
                    r.get('own_e', r.get('ctc_e')),
                ) for r in rows
            ])
            nucleus_ok = long & np.isfinite(vowels) & (np.abs(vowels - times) <= tol + 1e-12)
            mask = mask | nucleus_ok
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
            lang = column('lang_clock')
            lang_ok = np.isfinite(lang) & (np.abs(lang - times) <= agree + 1e-12)
            lang_roles = np.array([r.get('lang_role') or 'off' for r in rows])
            if np.any(lang_roles != 'off'):
                witness_ok = np.where(lang_roles == 'only', lang_ok, witness_ok)
                witness_ok = np.where(lang_roles == 'or', witness_ok | lang_ok, witness_ok)
                witness_ok = np.asarray(witness_ok, dtype=bool)
            pair_on = np.array([bool(r.get('pair')) for r in rows])
            if np.any(pair_on):
                close = (
                    np.isfinite(phon) & np.isfinite(lang)
                    & (np.abs(phon - lang) <= agree + 1e-12))
                pair_ok = close & phon_ok & lang_ok
                witness_ok = np.where(pair_on, witness_ok | pair_ok, witness_ok)
                witness_ok = np.asarray(witness_ok, dtype=bool)
            mask = mask & witness_ok
        elif rule.get('require_second'):
            seconds = np.array([np.nan if r.get('second') is None else float(r['second']) for r in rows])
            mask = mask & np.isfinite(seconds) & (np.abs(seconds - times) <= SECOND_TOL)
        out[np.array(indexes, dtype=int)] = mask
    return out


def hit_count(records: list[dict], peaks: np.ndarray, shift: float, rule: dict,
              fill_peaks: np.ndarray | None = None) -> tuple[int, int]:
    """How many probe times pass this rule's attack test, and how many were tested.

    `fill_peaks` adds the envelope. A time hits when either curve is inside the
    group tolerance. The line probe still prefers the spectral peak when that
    peak is already inside the tolerance; for this binary rate the two agree.
    """
    if not records:
        return 0, 0
    mask = hit_mask(records, peaks, shift, rule, fill_peaks=fill_peaks)
    return int(mask.sum()), len(records)


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
                'lang_s': word.get('lang_clock'),
                'lang_role': word.get('lang_role'),
                'pair': word.get('pair'),
                'overrule': word.get('overrule'),
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
                'langs': dict(word.get('lang_models') or {}),
                'clock_mms': None if word.get('clock_mms') is None else float(word['clock_mms']),
                'clock_second': None if word.get('clock_second') is None else float(word['clock_second']),
                'clock_stable': None if word.get('clock_stable') is None else float(word['clock_stable']),
                'clock_phoneme': _phoneme_clock(word),
                'clock_stem': None if word.get('clock_stem') is None else float(word['clock_stem']),
                'stable_models': {
                    str(name): float(value)
                    for name, value in (word.get('stable_models') or {}).items()
                    if value is not None
                },
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
            'cue_end': None if line.get('cue_end') is None else float(line['cue_end']),
            'cue_lang': line.get('cue_lang'),
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


def _refute_cut(both_far: float, only_far: float, off: dict | None = None) -> dict:
    cut = {'both_agree': 0.10, 'both_far': both_far, 'only_far': only_far, 'attack_tol': 0.10}
    if isinstance(off, dict) and off:
        cut['off'] = off
    return cut


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


def _line_candidate(line: dict, translation_half: float | None = None) -> bool:
    """A placed solo or choir line with a cue and at least two lettered words.

    A one-word line can never meet the minimum of two proved words, so it is
    left out of both the numerator and the denominator of the line chance.
    An uncued line cannot be proved either, and is left out for the same reason.
    A same-language cue stays inside 0.30 s. A translation cue may use the
    measured half when the caller is pricing that wider gate.
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
    if (translation_half is not None
            and P.cue_is_translation(line.get('lang'), line.get('cue_lang'))):
        return P.in_translation_window(
            float(start), float(cue), line.get('prev_end'), line.get('next_cue'), float(translation_half))
    return round(abs(float(start) - float(cue)), 3) <= Q.PROOF_CUE_TOL


def _mode_of_line(modes: dict, line: dict) -> str:
    song = line.get('song')
    lang = line.get('lang') or '?'
    mode = modes.get((song, lang)) or modes.get((song, '*'))
    return mode if mode in ('one', 'two') else 'two'


def _probe_parts(words: list[dict], peaks: np.ndarray, group: str | None, mode: str,
                 refute: dict, prev: float | None,
                 fill_peaks: np.ndarray | None = None,
                 nucleus: bool = False,
                 nearest: bool = False) -> tuple[list[dict], list[str | None]]:
    """Proved-word rows and refutation flags. The share K is applied by the caller.

    `fill_peaks` may supply the attack when the spectral peak is outside the
    group tolerance. Refutation still reads `peaks`, so the envelope cannot
    refute a word and cannot move a spectral hit that was already inside.
    `nucleus` may supply that attack from the word's own vowel clock when the
    romanisation is a long sung vowel. The clock is not shifted.
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
            'own_t': word.get('own_t', word.get('t')),
            'own_e': word.get('own_e', word.get('ctc_e')),
            'second_s': word.get('second'),
            'third_s': word.get('third'),
            'second_kind': word.get('second_kind') or 'whisperx',
            'third_kind': word.get('third_kind') or 'stable-ts',
            'song': word.get('song'),
            'lang': word.get('lang'),
            'phoneme_s': word.get('phoneme'),
            'phoneme_role': word.get('phoneme_role'),
            'lang_s': word.get('lang_clock'),
            'lang_role': word.get('lang_role'),
            'pair': bool(word.get('pair')),
            'overrule': bool(word.get('overrule')),
            'vowel_s': _vowel_clock(word) if nucleus else None,
        }
        align_words.append(item)
        owned = None if cursor is None else cursor + tol
        t = float(word['t'])
        if fill_peaks is not None:
            presnap.append(Q.fill_attack(t, peaks, fill_peaks, owned, tol))
        else:
            presnap.append(Q.nearest_attack(t, peaks, owned))
        cursor = t
    proved = Q.prove_words(
        align_words, presnap, tol, witnesses=mode, agree_tol=SECOND_TOL, nucleus=nucleus)
    flags = []
    for index, word in enumerate(align_words):
        siblings = None
        if nearest:
            siblings = [
                float(other['ctc_s']) for other_i, other in enumerate(align_words)
                if other_i != index and other.get('ctc_s') is not None
            ]
        flags.append(Q.word_refuted(word, peaks, refute, siblings))
    return proved, flags


def _probe_line(words: list[dict], peaks: np.ndarray, group: str | None, mode: str,
                refute: dict, share: float, prev: float | None) -> bool:
    proved, flags = _probe_parts(words, peaks, group, mode, refute, prev)
    return Q.line_word_ok(proved, flags, share)


def line_probe_parts(lines: list[dict], peaks: np.ndarray, modes: dict, refute: dict,
                     shift: float = 0.0, shuffle: bool = False, primary: str | None = None,
                     choir_peaks: np.ndarray | None = None,
                     fill_peaks: np.ndarray | None = None,
                     nucleus: bool = False,
                     translation_half: float | None = None,
                     nearest: bool = False) -> list[dict]:
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
        if not _line_candidate(line, translation_half):
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
                item['own_t'] = float(word['t'])
                item['own_e'] = word.get('ctc_e')
                item['t'] = float(donor['t'])
                item['song'] = line.get('song')
                item['lang'] = line.get('lang')
                moved.append(item)
        else:
            for word in src:
                item = dict(word)
                item['own_t'] = float(word['t'])
                item['own_e'] = word.get('ctc_e')
                item['t'] = float(word['t']) + float(shift)
                item['song'] = line.get('song')
                item['lang'] = line.get('lang')
                moved.append(item)
        window_fail = False
        if (translation_half is not None and moved
                and P.cue_is_translation(line.get('lang'), line.get('cue_lang'))
                and line.get('cue_start') is not None):
            window_fail = not P.in_translation_window(
                float(moved[0]['t']), float(line['cue_start']),
                line.get('prev_end'), line.get('next_cue'), float(translation_half))
        use_peaks = choir_peaks if line.get('group') == 'choir' and choir_peaks is not None else peaks
        proved, flags = _probe_parts(
            moved, use_peaks, line.get('group'), _mode_of_line(modes, line), refute, incoming[i],
            fill_peaks=fill_peaks, nucleus=nucleus, nearest=nearest)
        out.append({
            'id': line.get('id'),
            'lang': line.get('lang') or '?',
            'song': line.get('song'),
            'family': family,
            'proved': proved,
            'flags': flags,
            'window_fail': window_fail,
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
    cut = _refute_cut(
        float(refute.get('both_far', 0.20)), float(refute.get('only_far', 0.30)),
        refute.get('off') if isinstance(refute.get('off'), dict) else None)
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


def _share_index(share) -> int | None:
    if share is None:
        return None
    for index, item in enumerate(LINE_SHARES):
        if abs(float(item) - float(share)) < 1e-9:
            return index
    return None


def _copy_line_map(lines: dict) -> dict:
    out = {}
    for lid, info in (lines or {}).items():
        out[str(lid)] = {
            'family': info.get('family') or 'mms',
            'bits': np.array(info.get('bits'), dtype=bool),
            'song': info.get('song'),
        }
    return out


def _copy_word_map(words: dict) -> dict:
    out = {}
    for lid, mat in (words or {}).items():
        arr = np.asarray(mat, dtype=bool)
        if arr.size == 0:
            continue
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        out[str(lid)] = arr[:, :7].copy()
    return out


def _or_line_map(dst: dict, src: dict) -> None:
    for lid, info in (src or {}).items():
        key = str(lid)
        bits = np.array(info.get('bits'), dtype=bool)
        prev = dst.get(key)
        if prev is None:
            dst[key] = {'family': info.get('family') or 'mms', 'bits': bits, 'song': info.get('song')}
        else:
            prev['bits'] = prev['bits'] | bits


def _or_word_map(dst: dict, src: dict, only: set | None = None) -> None:
    for lid, mat in (src or {}).items():
        key = str(lid)
        if only is not None and key not in only:
            continue
        arr = np.asarray(mat, dtype=bool)
        if arr.size == 0:
            continue
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        arr = arr[:, :7]
        prev = dst.get(key)
        if prev is None or prev.shape != arr.shape:
            dst[key] = arr.copy()
        else:
            dst[key] = prev | arr


def _true_ids(lines: dict, ki: int) -> list[str]:
    out = []
    for lid, info in lines.items():
        bits = np.asarray(info.get('bits'), dtype=bool)
        if bits.shape[0] > ki and bool(bits[ki, 0]):
            out.append(str(lid))
    return out


def _family_line_chance(lines: dict, ki: int) -> tuple[float | None, list[str], int]:
    """Max over placers of the pooled shift rate, the proved ids, and the candidate count.

    Same reduction as the phoneme tables: each magnitude pools both signs, the
    shuffle is its own rate, and the line chance is the max of those rates.
    """
    by_family: dict[str, list[tuple[str, np.ndarray]]] = {}
    for lid, info in lines.items():
        bits = np.asarray(info.get('bits'), dtype=bool)
        if bits.ndim != 2 or bits.shape[1] < 8 or bits.shape[0] <= ki:
            continue
        family = info.get('family') or 'mms'
        by_family.setdefault(family, []).append((str(lid), bits))
    chances = []
    proved: list[str] = []
    candidates = 0
    for rows in by_family.values():
        count = len(rows)
        if count == 0:
            continue
        candidates += count
        probe = [0] * 8
        for lid, bits in rows:
            if bool(bits[ki, 0]):
                proved.append(lid)
            for col in range(8):
                probe[col] += int(bool(bits[ki, col]))
        rates = []
        for index, _mag in enumerate(SHIFTS):
            hits = probe[1 + 2 * index] + probe[2 + 2 * index]
            rates.append(hits / (2 * count))
        rates.append(probe[7] / count)
        chances.append(max(rates))
    if not chances:
        return None, proved, candidates
    return max(chances), proved, candidates


def _word_chance_from(words: dict) -> float | None:
    """Max of the three pooled shift rates and the within-line rotation.

    Each mask is one word: six signed shifts, then the rotation.
    """
    mats = []
    for mat in (words or {}).values():
        arr = np.asarray(mat, dtype=bool)
        if arr.size == 0:
            continue
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.shape[1] < 7:
            continue
        mats.append(arr[:, :7])
    if not mats:
        return None
    stack = np.concatenate(mats, axis=0)
    count = int(stack.shape[0])
    if count == 0:
        return None
    rates = []
    for index in range(3):
        hits = int(stack[:, 2 * index].sum() + stack[:, 2 * index + 1].sum())
        rates.append(hits / (2 * count))
    rates.append(float(stack[:, 6].sum()) / count)
    return max(rates)


def _extra_rate(maps: list[dict], line_ids, ki: int) -> float | None:
    """Pooled ±half passes of the translation lines that are in this join.

    A line pays only when a joined member recorded the wider probe for it.
    """
    hits = 0
    count = 0
    seen = set()
    for lid in line_ids:
        key = str(lid)
        if key in seen:
            continue
        pair = None
        for item in maps:
            if key not in (item or {}):
                continue
            value = item[key]
            arr = np.asarray(value, dtype=bool)
            if arr.ndim == 1 and arr.size >= 2:
                pair = (bool(arr[0]), bool(arr[1]))
            elif arr.ndim == 2 and arr.shape[0] > ki and arr.shape[1] >= 2:
                pair = (bool(arr[ki, 0]), bool(arr[ki, 1]))
            break
        if pair is None:
            continue
        seen.add(key)
        count += 1
        hits += int(pair[0]) + int(pair[1])
    if count == 0:
        return None
    return hits / (2 * count)


def _add_proved_lines(dst_lines: dict, dst_words: dict, member: dict, ids: list[str],
                      baseline_ids: set[str]) -> None:
    """Add lines this member proves. A baseline line keeps its own probe bits."""
    lines = member.get('lines') or {}
    words = member.get('words') or {}
    for lid in ids:
        if lid in baseline_ids:
            continue
        info = lines.get(lid)
        if info is None:
            continue
        dst_lines[lid] = {
            'family': info.get('family') or 'mms',
            'bits': np.array(info.get('bits'), dtype=bool),
            'song': info.get('song'),
        }
        if lid in words:
            _or_word_map(dst_words, {lid: words[lid]})


def admit_union(members: list[dict], baseline_name: str = 'baseline') -> dict:
    """Join every admitted configuration with the baseline.

    The full join ORs the probe bits. It is kept when that chance is still at
    or under 5 % and the word chance is still at or under 15 %. Otherwise the
    baseline stays and other lines are added one by one while the same caps
    hold. A baseline line is never removed here. K stays the baseline K.
    """
    usable = [item for item in members if item]
    base = next((item for item in usable if item.get('baseline') or item.get('name') == baseline_name), None)
    empty = {
        'proved': [], 'k': None, 'chance': None, 'word_chance': None, 'within_limit': False,
        'full_or': False, 'lost': [], 'lost_chance': None, 'lost_detail': {}, 'word_lost': [],
        'line_member': {}, 'members': [], 'baseline_ids': [], 'candidates': 0,
    }
    if base is None:
        return empty
    ki = _share_index(base.get('k'))
    if ki is None:
        return empty
    base_lines = _copy_line_map(base.get('lines') or {})
    base_words = _copy_word_map(base.get('words') or {})
    _base_chance, base_proved, _base_n = _family_line_chance(base_lines, ki)
    baseline_ids = set(base_proved)

    def evaluate(lines: dict, words: dict, extras: list[dict]) -> tuple:
        chance, proved, count = _family_line_chance(lines, ki)
        extra = _extra_rate(extras, list(lines), ki)
        if extra is not None:
            chance = extra if chance is None else max(float(chance), float(extra))
        return chance, _word_chance_from(words), proved, count

    def fits(chance, word_chance, proved) -> bool:
        if chance is None or float(chance) > LINE_LIMIT + 1e-12:
            return False
        if not baseline_ids <= set(proved):
            return False
        # The word cap can refuse an extra line. It cannot drop a baseline line,
        # and a baseline that already passed its own slices is not failed here
        # when the only proved lines are that baseline.
        if word_chance is not None and float(word_chance) > LIMIT + 1e-12:
            if set(proved) - baseline_ids:
                return False
        return True

    def priced_apart(item: dict) -> bool:
        # wide-fill and the other combined gates are not folded into the full
        # join. An earlier member already recorded a ±half probe without that
        # attack, and the first map would bill the new line at that cheaper rate.
        return str(item.get('name') or '').startswith('wide-')

    def line_blocked(chance) -> bool:
        return chance is None or float(chance) > LINE_LIMIT + 1e-12

    admitted = [
        item for item in usable
        if item is not base and item.get('within_limit') and not priced_apart(item)
    ]
    full_lines = _copy_line_map(base_lines)
    full_words = _copy_word_map(base_words)
    full_extra = [dict(base.get('extra') or {})]
    for item in admitted:
        _or_line_map(full_lines, item.get('lines') or {})
        _or_word_map(full_words, item.get('words') or {})
        full_extra.append(dict(item.get('extra') or {}))
    full_chance, full_wc, full_proved, full_n = evaluate(full_lines, full_words, full_extra)
    full_ok = fits(full_chance, full_wc, full_proved)
    line_member = {lid: str(base.get('name') or baseline_name) for lid in baseline_ids}
    if full_ok:
        current_lines, current_words, current_extra = full_lines, full_words, full_extra
        current_chance, current_wc, current_n = full_chance, full_wc, full_n
        used = [str(base.get('name') or baseline_name)]
        for item in admitted:
            name = str(item.get('name') or '')
            if name and name not in used:
                used.append(name)
            for lid in _true_ids(item.get('lines') or {}, ki):
                if lid not in line_member:
                    line_member[lid] = name
        full_flag = True
    else:
        current_lines = _copy_line_map(base_lines)
        current_words = _copy_word_map(base_words)
        current_extra = [dict(base.get('extra') or {})]
        current_chance, current_wc, _proved, current_n = evaluate(current_lines, current_words, current_extra)
        used = [str(base.get('name') or baseline_name)]
        full_flag = False

    lost_detail: dict[str, float] = {}
    word_lost: list[str] = []

    def commit(lines, words, extras, chance, word_chance, count, name: str, added: list[str]) -> None:
        nonlocal current_lines, current_words, current_extra, current_chance, current_wc, current_n
        current_lines, current_words, current_extra = lines, words, extras
        current_chance, current_wc, current_n = chance, word_chance, count
        if name and name not in used:
            used.append(name)
        for lid in added:
            if lid not in line_member:
                line_member[lid] = name

    def try_ids(item: dict, ids: list[str]) -> bool:
        if not ids:
            return False
        name = str(item.get('name') or '')
        trial_lines = _copy_line_map(current_lines)
        trial_words = _copy_word_map(current_words)
        _add_proved_lines(trial_lines, trial_words, item, ids, baseline_ids)
        trial_extra = list(current_extra)
        owned = item.get('extra') or {}
        if owned:
            # A combined wide gate pays its own ±half for the lines it is adding.
            # Lines already in the join keep the earlier map: repricing them
            # would drop a line the previous measurement kept.
            if priced_apart(item):
                first = {}
                for lid in ids:
                    key = str(lid)
                    if key in owned:
                        first[key] = owned[key]
                if first:
                    trial_extra = [first] + trial_extra
            trial_extra.append(dict(owned))
        chance, word_chance, proved, count = evaluate(trial_lines, trial_words, trial_extra)
        if fits(chance, word_chance, proved) and all(lid in proved for lid in ids):
            commit(trial_lines, trial_words, trial_extra, chance, word_chance, count, name, ids)
            return True
        if line_blocked(chance):
            recorded = float(chance) if chance is not None else 1.0
            for lid in ids:
                if lid in line_member:
                    continue
                prev = lost_detail.get(lid)
                if prev is None or recorded > prev:
                    lost_detail[lid] = recorded
        else:
            for lid in ids:
                if lid not in line_member and lid not in word_lost:
                    word_lost.append(lid)
        return False

    pool = []
    seen = set()
    for item in usable:
        if item is base or id(item) in seen:
            continue
        if not item.get('within_limit') and not item.get('partial'):
            continue
        seen.add(id(item))
        pool.append(item)
    for item in pool:
        if full_flag and item.get('within_limit') and not item.get('partial'):
            continue
        fresh = [lid for lid in _true_ids(item.get('lines') or {}, ki) if lid not in line_member]
        fresh.sort()
        if item.get('within_limit') and len(fresh) > 1:
            if try_ids(item, fresh):
                continue
        for lid in fresh:
            if lid in line_member:
                continue
            try_ids(item, [lid])

    final_chance, final_wc, final_proved, final_n = evaluate(current_lines, current_words, current_extra)
    lost = sorted(lid for lid in lost_detail if lid not in final_proved and lid not in baseline_ids)
    lost_chance = None
    if lost:
        lost_chance = max(lost_detail[lid] for lid in lost)
    return {
        'proved': sorted(final_proved),
        'k': float(LINE_SHARES[ki]),
        'chance': final_chance,
        'word_chance': final_wc,
        'within_limit': fits(final_chance, final_wc, final_proved),
        'full_or': full_flag,
        'lost': lost,
        'lost_chance': lost_chance,
        'lost_detail': {lid: lost_detail[lid] for lid in lost},
        'word_lost': sorted(lid for lid in word_lost if lid not in final_proved),
        'line_member': {lid: line_member[lid] for lid in final_proved if lid in line_member},
        'members': used,
        'baseline_ids': sorted(baseline_ids),
        'candidates': final_n,
    }


def pass_keeps_baseline(result: dict, baseline_ids) -> bool:
    """False when a baseline line is missing and no line-cap above 5 % explains it."""
    proved = set(result.get('proved') or [])
    detail = result.get('lost_detail') or {}
    lost = set(result.get('lost') or [])
    for lid in baseline_ids:
        key = str(lid)
        if key in proved:
            continue
        chance = detail.get(key)
        if chance is None and key in lost:
            chance = result.get('lost_chance')
        if chance is None or float(chance) <= LINE_LIMIT + 1e-12:
            return False
    return True


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
                    {
                        'ctc_s': word['t'],
                        'second_s': word.get('second'),
                        'third_s': word.get('third'),
                        'second_kind': word.get('second_kind') or 'whisperx',
                        'third_kind': word.get('third_kind') or 'stable-ts',
                        'song': song['slug'],
                        'lang': line.get('lang'),
                    },
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
        'cue_end': None if rec.get('cue_end') is None else float(rec['cue_end']),
        'cue_lang': rec.get('cue_lang'),
        'ctc_start': None,
        'section': rec.get('section'),
        'next_cue': next_cue,
        'order': order,
        'span': (words[0]['t'] - 0.05, words[-1]['t'] + 0.05) if words else (0.0, 0.0),
        'words': words,
    }


def _apply_latin(per_song: list[dict], sections: dict, only_lang: str | None = None) -> list[dict]:
    """Place still-open lines from the aligner's stored phoneme starts.

    `open_place` wins over `latin_place`. A report that only has `latin_place`
    still places Latin and nothing else. `only_lang` keeps one language so a
    later language can be restored without dropping the one already kept.
    """
    moves = []
    for song in per_song:
        proposals = song.get('open_place') or None
        legacy = proposals is None
        if legacy:
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
            lang = str(spec.get('lang') or rec.get('lang') or '')
            if only_lang is not None and lang != only_lang:
                continue
            if legacy and lang != 'la':
                continue
            if rec.get('status') == 'good':
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
                lettered, target.get('cue_start'), target.get('next_cue'), bounds.get(rec.get('section')),
                limit=P.cue_accept_limit(target.get('lang'), target.get('cue_lang')))
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
        import phoneme as PhonePlace

        any_open = False
        for lang in PhonePlace.OPEN_LANG_ORDER:
            before_lang = _snapshot(per_song)
            lang_moves = _apply_latin(per_song, sections, only_lang=lang)
            if not lang_moves:
                continue
            any_open = True
            scopes, ok, modes, tables, picked = _remeasure(per_song, refute)
            blocked = set(picked.get('blocked_primaries') or [])
            if _rises(ok, picked, base_n) and 'phoneme' not in blocked:
                was = base_n
                adopt(scopes, modes, tables, picked, lang_moves)
                print(f"фонема {lang}: поставлена, доказано {picked.get('proved')} против {was}", flush=True)
            else:
                _restore(per_song, before_lang)
                print(
                    f"фонема {lang} не оставлена: доказано {picked.get('proved')} против {base_n}, "
                    f"within_limit {bool(picked.get('within_limit'))}, "
                    f"фонема исключена {'phoneme' in blocked}",
                    flush=True,
                )
        if not any_open:
            print('фонема: открытых строк нет', flush=True)
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


def _stamp_neighbours(per_song: list[dict]) -> None:
    """Previous cue end, so a translation window can stop at the neighbour."""
    for song in per_song:
        ordered = sorted(song.get('all_lines') or [], key=lambda line: int(line.get('order') or 0))
        for index, line in enumerate(ordered):
            prev = None
            for earlier in range(index - 1, -1, -1):
                if ordered[earlier].get('cue_end') is not None:
                    prev = float(ordered[earlier]['cue_end'])
                    break
            line['prev_end'] = prev


def _probe_columns() -> list[tuple[float, bool]]:
    columns = [(0.0, False)]
    for mag in SHIFTS:
        columns.append((float(mag), False))
        columns.append((-float(mag), False))
    columns.append((0.0, True))
    return columns


def _capture_word_masks(per_song: list[dict], modes: dict, *, fill: bool = False,
                        nucleus: bool = False, translation_half: float | None = None,
                        blocked: set | None = None) -> dict:
    """Ordinary shift masks. A blocked placer is scored for ownership and then left out.

    A translation line outside 0.30 s enters only when this member is pricing the
    wider gate. Its words then pay the ordinary shifts. The ±half probe stays a
    line probe, not a second word shift.
    """
    blocked = blocked or set()
    out = {}
    for song in per_song:
        peaks = song['sets'][(WITNESS_HEIGHT, False)]
        fill_peaks = song.get('envelope_peaks') if fill else None
        for line in song.get('all_lines') or []:
            if not _line_candidate(line, translation_half):
                continue
            if P.primary_family(line.get('placed_by')) in blocked:
                continue
            rule = dict(_fill_rule(_mode_of_line(modes, line)))
            if nucleus:
                rule['nucleus'] = True
            recs = []
            for word in line.get('words') or []:
                item = dict(word)
                item['own_t'] = float(word['t'])
                item['own_e'] = word.get('ctc_e')
                recs.append(item)
            if not recs:
                continue
            use_peaks = peaks
            if (line.get('group') == 'choir' and song.get('use_choir_envelope')
                    and song.get('envelope_peaks') is not None):
                use_peaks = song['envelope_peaks']
            cols = []
            for mag in SHIFTS:
                for sign in (mag, -mag):
                    cols.append(hit_mask(recs, use_peaks, float(sign), rule, fill_peaks=fill_peaks))
            if len(recs) >= 2:
                rotated = recs[1:] + recs[:1]
                shuffled = []
                for word, donor in zip(recs, rotated):
                    moved = dict(word)
                    moved['t'] = float(donor['t'])
                    shuffled.append(moved)
                shuffle_mask = hit_mask(shuffled, use_peaks, 0.0, rule, fill_peaks=fill_peaks)
            else:
                shuffle_mask = np.zeros(len(recs), dtype=bool)
            mat = np.zeros((len(recs), 7), dtype=bool)
            for wi in range(len(recs)):
                for col in range(6):
                    mat[wi, col] = bool(cols[col][wi])
                mat[wi, 6] = bool(shuffle_mask[wi]) if wi < len(shuffle_mask) else False
            out[str(line.get('id'))] = mat
    return out


def _capture_state(per_song: list[dict], modes: dict, refute: dict, *, fill: bool = False,
                   nucleus: bool = False, translation_half: float | None = None,
                   nearest: bool = False, blocked: set | None = None) -> tuple[dict, dict, dict]:
    """Eight probe columns, plus the ±half columns of a translation cue."""
    cut = _refute_cut(
        float(refute.get('both_far', 0.20)), float(refute.get('only_far', 0.30)),
        refute.get('off') if isinstance(refute.get('off'), dict) else None)
    blocked = blocked or set()
    _stamp_neighbours(per_song)
    lines_out: dict = {}
    extra: dict = {}
    for song in per_song:
        peaks = song['sets'][(WITNESS_HEIGHT, False)]
        choir = song.get('envelope_peaks') if song.get('use_choir_envelope') else None
        fill_peaks = song.get('envelope_peaks') if fill else None
        rows = list(song.get('all_lines') or [])
        col_parts = []
        for shift, shuffle in _probe_columns():
            parts = line_probe_parts(
                rows, peaks, modes, cut, shift=shift, shuffle=shuffle,
                choir_peaks=choir, fill_peaks=fill_peaks,
                nucleus=nucleus, translation_half=translation_half, nearest=nearest)
            col_parts.append({item['id']: item for item in parts})
        wide_cols = []
        if translation_half is not None:
            for sign in (float(translation_half), -float(translation_half)):
                parts = line_probe_parts(
                    rows, peaks, modes, cut, shift=sign, choir_peaks=choir,
                    fill_peaks=fill_peaks, nucleus=nucleus, translation_half=translation_half,
                    nearest=nearest)
                wide_cols.append({item['id']: item for item in parts})
        by_id = {line.get('id'): line for line in rows}
        for lid in (col_parts[0] if col_parts else {}):
            source = by_id.get(lid)
            family = P.primary_family((source or {}).get('placed_by'))
            if family in blocked:
                continue
            bits = np.zeros((len(LINE_SHARES), 8), dtype=bool)
            song_name = song.get('slug')
            for col, part in enumerate(col_parts):
                item = part.get(lid)
                if item is None or item.get('window_fail'):
                    continue
                family = item.get('family') or family
                song_name = item.get('song') or song_name
                for share_i, share in enumerate(LINE_SHARES):
                    bits[share_i, col] = Q.line_word_ok(item['proved'], item['flags'], share)
            lines_out[str(lid)] = {'family': family, 'bits': bits, 'song': song_name}
            if not wide_cols or source is None:
                continue
            if not P.cue_is_translation(source.get('lang'), source.get('cue_lang')):
                continue
            grid = np.zeros((len(LINE_SHARES), 2), dtype=bool)
            for sign_i, part in enumerate(wide_cols):
                item = part.get(lid)
                if item is None or item.get('window_fail'):
                    continue
                for share_i, share in enumerate(LINE_SHARES):
                    grid[share_i, sign_i] = Q.line_word_ok(item['proved'], item['flags'], share)
            extra[str(lid)] = grid
    words = _capture_word_masks(
        per_song, modes, fill=fill, nucleus=nucleus,
        translation_half=translation_half, blocked=blocked)
    return lines_out, words, extra


def _member_from_state(name: str, per_song: list[dict], modes: dict, refute: dict, k,
                       *, baseline: bool = False, fill: bool = False, nucleus: bool = False,
                       translation_half: float | None = None, nearest: bool = False,
                       blocked: set | None = None,
                       partial: bool = False, min_words: int = 0) -> dict:
    lines, words, extra = _capture_state(
        per_song, modes, refute, fill=fill, nucleus=nucleus,
        translation_half=translation_half, nearest=nearest, blocked=blocked)
    ki = _share_index(k)
    chance, proved, _count = (None, [], 0) if ki is None else _family_line_chance(lines, ki)
    if translation_half is not None and ki is not None and extra:
        rate = _extra_rate([extra], list(lines), ki)
        if rate is not None:
            chance = rate if chance is None else max(float(chance), float(rate))
    word_chance = _word_chance_from(words)
    word_n = 0
    for mat in words.values():
        word_n += int(np.asarray(mat).shape[0])
    enough = word_n >= int(min_words)
    within = (
        enough and ki is not None and chance is not None
        and float(chance) <= LINE_LIMIT + 1e-12
        and (word_chance is None or float(word_chance) <= LIMIT + 1e-12)
    )
    return {
        'name': name,
        'baseline': baseline,
        'within_limit': bool(baseline or within),
        'partial': bool(partial and enough and not baseline),
        'k': None if ki is None else float(LINE_SHARES[ki]),
        'lines': lines,
        'words': words,
        'extra': extra,
        'chance': chance,
        'word_chance': word_chance,
        'proved_n': len(proved),
    }


def _quiet_flags(per_song: list[dict]) -> None:
    for song in per_song:
        song['use_attack_fill'] = False
        song['use_choir_envelope'] = False


def _phoneme_member(name: str, per_song: list[dict], decision: dict, modes: dict, refute: dict, k,
                    *, fill: bool = False, translation_half: float | None = None) -> dict | None:
    """The word-witness stamp, without the choir-wide vowel clock or envelope."""
    if not decision or not decision.get('admitted'):
        return None
    import phoneme_choice as Phone

    stamped = dict(decision)
    stamped['choir_attack'] = 'spectral'
    stamped['choir_clock'] = 'phone'
    Phone.apply(per_song, stamped)
    _quiet_flags(per_song)
    if fill:
        for song in per_song:
            song['use_attack_fill'] = True
    try:
        return _member_from_state(
            name, per_song, modes, refute, k, fill=fill, partial=True,
            translation_half=translation_half, blocked=set())
    finally:
        Phone.clear(per_song)
        _quiet_flags(per_song)


def _split_member(name: str) -> tuple[str, str, str, str] | None:
    """`kind:song:lang:model`. Model names contain hyphens, not colons."""
    kind, sep, rest = str(name).partition(':')
    if kind not in ('stable', 'phone', 'phone-fill') or not sep:
        return None
    parts = rest.split(':', 2)
    if len(parts) != 3 or not all(parts):
        return None
    return kind, parts[0], parts[1], parts[2]


def _stable_targets(per_song: list[dict]) -> list[tuple[str, str, str]]:
    """Measured stable-ts models other than the one already written into the witness slot."""
    found = []
    seen = set()
    for song in per_song:
        chosen = song.get('proof_models') or {}
        for line in song.get('all_lines') or []:
            lang = line.get('lang') or '?'
            skip = chosen.get(lang)
            for word in line.get('words') or []:
                if word.get('third_kind') != 'stable-ts':
                    continue
                for name, clock in (word.get('stable_models') or {}).items():
                    if clock is None or name == skip:
                        continue
                    key = (song.get('slug'), lang, str(name))
                    if key in seen or not key[0]:
                        continue
                    seen.add(key)
                    found.append(key)
    return found


def _swap_stable(per_song: list[dict], slug: str, lang: str, model: str) -> tuple[list, int]:
    """Point the stable witness slot at one measured model. The placer clock stays."""
    saved = []
    changed = 0
    for song in per_song:
        if song.get('slug') != slug:
            continue
        for line in song.get('all_lines') or []:
            if (line.get('lang') or '?') != lang:
                continue
            for word in line.get('words') or []:
                if word.get('third_kind') != 'stable-ts':
                    continue
                clock = (word.get('stable_models') or {}).get(model)
                if clock is None:
                    continue
                new = float(clock)
                old = word.get('third')
                if old is not None and abs(float(old) - new) <= 1e-9:
                    continue
                saved.append((word, word.get('third'), word.get('clock_stable')))
                word['third'] = new
                word['clock_stable'] = new
                changed += 1
    return saved, changed


def _unswap_stable(saved: list) -> None:
    for word, third, stable in saved:
        word['third'] = third
        word['clock_stable'] = stable


def _fill_placed_clocks(per_song: list[dict]) -> tuple[list, int]:
    """Put the placement-model clock into an empty stable witness slot.

    Words that already have the chosen model's clock, or any third witness, stay.
    The model search does not do this: inheriting the clock there made every
    candidate share one line pass and pushed the share above 0.25.
    """
    saved = []
    changed = 0
    for song in per_song:
        placement = song.get('placement_model')
        chosen = song.get('proof_models') or {}
        if not placement:
            continue
        for line in song.get('all_lines') or []:
            model = chosen.get(line.get('lang') or '?')
            placed_by = line.get('placed_by')
            for word in line.get('words') or []:
                clock = P.placed_clock_for_gap(
                    placed_by, word.get('stable_models'), model, placement, word.get('third'))
                if clock is None:
                    continue
                saved.append((word, word.get('third'), word.get('clock_stable'), word.get('third_kind')))
                word['third'] = clock
                word['clock_stable'] = clock
                word['third_kind'] = 'stable-ts'
                changed += 1
    return saved, changed


def _unfill_placed_clocks(saved: list) -> None:
    for word, third, stable, kind in saved:
        word['third'] = third
        word['clock_stable'] = stable
        word['third_kind'] = kind


def _phone_targets(per_song: list[dict], decision: dict | None) -> list[tuple[str, str, str, str]]:
    """A phoneme model the pair did not choose. Role stays `or` unless the pair's own role is `only`."""
    pairs = {
        (row.get('song'), row.get('lang')): row
        for row in (decision or {}).get('pairs') or []
        if isinstance(row, dict)
    }
    out = []
    seen = set()
    for song in per_song:
        present: dict[str, set[str]] = {}
        for line in song.get('all_lines') or []:
            lang = line.get('lang') or '?'
            for word in line.get('words') or []:
                for name, clock in (word.get('phones') or {}).items():
                    if clock is None:
                        continue
                    present.setdefault(lang, set()).add(str(name))
        for lang, models in present.items():
            row = pairs.get((song.get('slug'), lang))
            chosen = row.get('model') if isinstance(row, dict) and isinstance(row.get('model'), str) else None
            pair_role = row.get('role') if isinstance(row, dict) and row.get('role') in ('or', 'only') else 'off'
            role = 'only' if pair_role == 'only' else 'or'
            for model in sorted(models):
                if model == chosen:
                    continue
                key = (song.get('slug'), lang, model, role)
                if not key[0] or key in seen:
                    continue
                seen.add(key)
                out.append(key)
    return out


def _stamp_one_phone(per_song: list[dict], slug: str, lang: str, model: str, role: str) -> int:
    """One model on one language. Two models are not written onto the same word."""
    stamped = 0
    for song in per_song:
        if song.get('slug') != slug:
            continue
        for line in song.get('all_lines') or []:
            if (line.get('lang') or '?') != lang:
                continue
            for word in line.get('words') or []:
                clock = (word.get('phones') or {}).get(model)
                if clock is None:
                    word.pop('phoneme', None)
                    word.pop('phoneme_role', None)
                    continue
                word['phoneme'] = float(clock)
                word['phoneme_role'] = role
                stamped += 1
    return stamped


def _lang_members(per_song: list[dict], origin: list, modes: dict, refute: dict,
                 k, members: list[dict]) -> dict:
    """Language CTC, weak-pair agreement, and 1-vs-2 overrule. Each is its own member.

    A failure here is a missing witness, not a failed union. Stamps are cleared
    before the next member, and the origin lines are put back on the way out.
    """
    report: dict = {'error': None, 'pairs': [], 'pair_rows': [], 'lang_admitted': [], 'pair_admitted': []}
    try:
        import lang_ctc_choice as Lang

        _restore(per_song, origin)
        _quiet_flags(per_song)
        report = Lang.plan(per_song, modes)
        report['error'] = None

        def add(name: str, stamp) -> None:
            _restore(per_song, origin)
            _quiet_flags(per_song)
            try:
                if not stamp():
                    return
                member = _member_from_state(
                    name, per_song, modes, refute, k, partial=True, min_words=0)
                members.append(member)
                print(
                    f"объединение: {name} доказала {member['proved_n']}, "
                    f"проход строки {member['chance']}, слов {member['word_chance']}, "
                    f"внутри {member['within_limit']}",
                    flush=True,
                )
            finally:
                Lang.clear(per_song)
                _quiet_flags(per_song)

        add('lang', lambda: Lang.apply_lang(per_song, report.get('lang_admitted') or []))
        add('pair', lambda: Lang.apply_pair(per_song, report.get('pair_admitted') or []))

        def stamp_over() -> int:
            return Lang.apply_overrule(per_song, report, refute)

        add('overrule', stamp_over)
        if report.get('lang_admitted'):
            def stamp_both() -> int:
                lang_n = Lang.apply_lang(per_song, report.get('lang_admitted') or [])
                over_n = Lang.apply_overrule(per_song, report, refute)
                return lang_n if lang_n and over_n else 0

            add('lang-overrule', stamp_both)
    except Exception as e:
        report = dict(report) if isinstance(report, dict) else {}
        report['error'] = f'{e.__class__.__name__}: {e}'
        print(f'языковой CTC не допущен ({report["error"]})', flush=True)
        try:
            import lang_ctc_choice as Lang
            Lang.clear(per_song)
        except Exception:
            pass
    finally:
        _restore(per_song, origin)
        _quiet_flags(per_song)
    return report


def _moves_for(members_moves: list[tuple[str, list[dict]]], line_member: dict) -> dict[str, list[dict]]:
    """Retimes only for lines the join assigned to the placer that moved them."""
    by_song: dict[str, list[dict]] = {}
    seen = set()
    for name, moves in members_moves:
        for row in moves or []:
            lid = str(row.get('id') or '')
            if line_member.get(lid) != name or (name, lid) in seen:
                continue
            seen.add((name, lid))
            song = str(row.get('song') or '')
            item = {key: value for key, value in row.items() if key != 'song'}
            by_song.setdefault(song, []).append(item)
    return by_song


def _union_overlay(per_song: list[dict], origin: list, origin_modes: dict, refute: dict,
                   origin_picked: dict, decision: dict, placement_kept: bool,
                   scopes_ok: bool) -> dict | None:
    """Join the baseline with every other cap-holding configuration.

    The live lines are restored on the way out. A second phoneme search runs
    only when placement has already replaced the baseline, so the pre-placement
    stamp is still a member.
    """
    k = origin_picked.get('k')
    if _share_index(k) is None:
        print('объединение: у базового прохода нет доли K', flush=True)
        return None
    blocked = set(origin_picked.get('blocked_primaries') or [])
    live = _snapshot(per_song)
    moves: list[tuple[str, list[dict]]] = []
    try:
        _restore(per_song, origin)
        _quiet_flags(per_song)
        sections = {song['slug']: _section_bounds(song['slug']) for song in per_song}
        print('объединение: базовый проход', flush=True)
        members = [_member_from_state(
            'baseline', per_song, origin_modes, refute, k,
            baseline=True, blocked=blocked, partial=False)]
        print(
            f"объединение: база доказала {members[0]['proved_n']}, "
            f"проход строки {members[0]['chance']}",
            flush=True,
        )
        print('объединение: заливка на базовых строках', flush=True)
        for song in per_song:
            song['use_attack_fill'] = True
        try:
            members.append(_member_from_state(
                'fill', per_song, origin_modes, refute, k, fill=True, partial=True, min_words=MIN_WORDS))
        finally:
            _quiet_flags(per_song)
        print(
            f"объединение: заливка {members[-1]['proved_n']}, "
            f"проход строки {members[-1]['chance']}, слова {members[-1]['word_chance']}, "
            f"внутри {members[-1]['within_limit']}",
            flush=True,
        )
        print('объединение: ядро слога', flush=True)
        members.append(_member_from_state(
            'nucleus', per_song, origin_modes, refute, k, nucleus=True, partial=True))
        print(
            f"объединение: ядро {members[-1]['proved_n']}, "
            f"проход строки {members[-1]['chance']}, внутри {members[-1]['within_limit']}",
            flush=True,
        )
        print('объединение: окно переводной реплики', flush=True)
        members.append(_member_from_state(
            'wide', per_song, origin_modes, refute, k,
            translation_half=P.TRANSLATION_HALF, partial=True))
        print(
            f"объединение: окно {members[-1]['proved_n']}, "
            f"проход строки {members[-1]['chance']}, внутри {members[-1]['within_limit']}",
            flush=True,
        )
        # A translation line outside 0.30 s is invisible to fill and to the
        # nucleus. Measuring them on the wider gate is the same ±half price.
        for name, fill, nucleus, nearest in (
            ('wide-fill', True, False, False),
            ('wide-nucleus', False, True, False),
            ('wide-nearest', False, False, True),
        ):
            print(f'объединение: {name}', flush=True)
            members.append(_member_from_state(
                name, per_song, origin_modes, refute, k, fill=fill, nucleus=nucleus,
                nearest=nearest, translation_half=P.TRANSLATION_HALF, partial=True))
            print(
                f"объединение: {name} {members[-1]['proved_n']}, "
                f"проход строки {members[-1]['chance']}, внутри {members[-1]['within_limit']}",
                flush=True,
            )
        origin_decision = decision
        if placement_kept:
            print('объединение: фонемный поиск на базовых строках', flush=True)
            import phoneme_choice as Phone
            origin_decision = Phone.choose(per_song, origin_modes, refute)
        phone = _phoneme_member('phoneme', per_song, origin_decision, origin_modes, refute, k)
        if phone is not None:
            members.append(phone)
            print(
                f"объединение: фонема {phone['proved_n']}, проход строки {phone['chance']}, "
                f"внутри {phone['within_limit']}",
                flush=True,
            )
            both = _phoneme_member(
                'phoneme-fill', per_song, origin_decision, origin_modes, refute, k, fill=True)
            if both is not None:
                members.append(both)
                print(
                    f"объединение: фонема и заливка {both['proved_n']}, "
                    f"проход строки {both['chance']}, внутри {both['within_limit']}",
                    flush=True,
                )
            for name, fill in (('wide-phoneme', False), ('wide-phoneme-fill', True)):
                print(f'объединение: {name}', flush=True)
                wide_phone = _phoneme_member(
                    name, per_song, origin_decision, origin_modes, refute, k,
                    fill=fill, translation_half=P.TRANSLATION_HALF)
                if wide_phone is None:
                    continue
                members.append(wide_phone)
                print(
                    f"объединение: {name} {wide_phone['proved_n']}, "
                    f"проход строки {wide_phone['chance']}, внутри {wide_phone['within_limit']}",
                    flush=True,
                )
        import phoneme_choice as Phone
        _restore(per_song, origin)
        _quiet_flags(per_song)
        print('объединение: пустой слот вместе с заливкой атаки', flush=True)
        saved_gap, gap_n = _fill_placed_clocks(per_song)
        if gap_n:
            for song in per_song:
                song['use_attack_fill'] = True
            try:
                gap_member = _member_from_state(
                    'placed-fill', per_song, origin_modes, refute, k, fill=True, partial=True)
            finally:
                _unfill_placed_clocks(saved_gap)
                _quiet_flags(per_song)
            members.append(gap_member)
            print(
                f"объединение: пустой слот и заливка {gap_member['proved_n']}, "
                f"проход строки {gap_member['chance']}, слов {gap_member['word_chance']}, "
                f"внутри {gap_member['within_limit']}",
                flush=True,
            )
        for slug, lang, model in _stable_targets(per_song):
            saved, changed = _swap_stable(per_song, slug, lang, model)
            if not changed:
                _unswap_stable(saved)
                continue
            name = f'stable:{slug}:{lang}:{model}'
            print(f'объединение: часы {name}', flush=True)
            try:
                if origin_decision and origin_decision.get('admitted'):
                    stamped = dict(origin_decision)
                    stamped['choir_attack'] = 'spectral'
                    stamped['choir_clock'] = 'phone'
                    Phone.apply(per_song, stamped)
                _quiet_flags(per_song)
                member = _member_from_state(
                    name, per_song, origin_modes, refute, k, partial=True)
            finally:
                _unswap_stable(saved)
                Phone.clear(per_song)
                _quiet_flags(per_song)
            members.append(member)
            print(
                f"объединение: {name} доказала {member['proved_n']}, "
                f"проход строки {member['chance']}, внутри {member['within_limit']}",
                flush=True,
            )
        for slug, lang, model, role in _phone_targets(per_song, origin_decision):
            for fill, prefix in ((False, 'phone'), (True, 'phone-fill')):
                name = f'{prefix}:{slug}:{lang}:{model}'
                print(f'объединение: {name}', flush=True)
                stamped_n = _stamp_one_phone(per_song, slug, lang, model, role)
                if not stamped_n:
                    Phone.clear(per_song)
                    continue
                if fill:
                    for song in per_song:
                        song['use_attack_fill'] = True
                try:
                    member = _member_from_state(
                        name, per_song, origin_modes, refute, k, fill=fill, partial=True)
                finally:
                    Phone.clear(per_song)
                    _quiet_flags(per_song)
                members.append(member)
                print(
                    f"объединение: {name} доказала {member['proved_n']}, "
                    f"проход строки {member['chance']}, внутри {member['within_limit']}",
                    flush=True,
                )
        _restore(per_song, origin)
        _quiet_flags(per_song)
        hand_moves = _apply_handoffs(per_song, refute, sections, True)
        if hand_moves:
            hand = _member_from_state(
                'handoff', per_song, origin_modes, refute, k,
                translation_half=P.TRANSLATION_HALF, partial=True)
            members.append(hand)
            moves.append(('handoff', hand_moves))
            print(
                f"объединение: передача {hand['proved_n']}, проход строки {hand['chance']}, "
                f"внутри {hand['within_limit']}",
                flush=True,
            )
            if origin_decision and origin_decision.get('admitted'):
                mixed = _phoneme_member(
                    'handoff-phoneme', per_song, origin_decision, origin_modes, refute, k)
                if mixed is not None:
                    members.append(mixed)
                    print(
                        f"объединение: передача и фонема {mixed['proved_n']}, "
                        f"проход строки {mixed['chance']}, внутри {mixed['within_limit']}",
                        flush=True,
                    )
        import phoneme as PhonePlace

        for lang in PhonePlace.OPEN_LANG_ORDER:
            _restore(per_song, origin)
            _quiet_flags(per_song)
            lang_moves = _apply_latin(per_song, sections, only_lang=lang)
            if not lang_moves:
                continue
            name = f'phoneme-place:{lang}'
            placed_lang = _member_from_state(
                name, per_song, origin_modes, refute, k,
                translation_half=P.TRANSLATION_HALF, partial=True)
            members.append(placed_lang)
            moves.append((name, lang_moves))
            print(
                f"объединение: фонема {lang} {placed_lang['proved_n']}, "
                f"проход строки {placed_lang['chance']}, внутри {placed_lang['within_limit']}",
                flush=True,
            )
        print('объединение: ближнее слово единственного свидетеля', flush=True)
        members.append(_member_from_state(
            'nearest', per_song, origin_modes, refute, k, nearest=True, partial=True))
        print(
            f"объединение: ближнее слово {members[-1]['proved_n']}, "
            f"проход строки {members[-1]['chance']}, внутри {members[-1]['within_limit']}",
            flush=True,
        )
        lang_report = _lang_members(per_song, origin, origin_modes, refute, k, members)
        result = admit_union(members)
        print(
            f"объединение: доказано {len(result.get('proved') or [])}, "
            f"проход строки {result.get('chance')}, слов {result.get('word_chance')}, "
            f"полное {result.get('full_or')}, внутри {result.get('within_limit')}, "
            f"снято {result.get('lost')}",
            flush=True,
        )
        return {
            'result': result if result.get('within_limit') else None,
            'decision': origin_decision,
            'retime': _moves_for(moves, result.get('line_member') or {}) if result.get('within_limit') else {},
            'wide_measured': True,
            'lang_ctc': lang_report,
        }
    finally:
        _restore(per_song, live)
        _quiet_flags(per_song)


def _member_features(name: str) -> set[str]:
    """Which published flags a joined member turns on for the line it proved.

    A line keeps the combination that proved it. The plain wide gate does not
    imply the envelope, and the envelope does not imply the wide gate.
    """
    text = str(name)
    features: set[str] = set()
    if (text in ('fill', 'phoneme-fill', 'placed-fill', 'wide-fill', 'wide-phoneme-fill')
            or text.startswith('phone-fill:')):
        features.add('fill')
    if text == 'placed-fill':
        features.add('placed')
    if text in ('nucleus', 'wide-nucleus'):
        features.add('nucleus')
    if text == 'wide' or text.startswith('wide-'):
        features.add('wide')
    if text in ('nearest', 'wide-nearest'):
        features.add('nearest')
    if text in ('phoneme', 'phoneme-fill', 'handoff-phoneme', 'wide-phoneme', 'wide-phoneme-fill'):
        features.add('phone')
    if text == 'lang':
        features.add('lang')
    elif text == 'pair':
        features.add('pair')
    elif text == 'overrule':
        features.add('overrule')
    elif text == 'lang-overrule':
        features.update(('lang', 'overrule'))
    return features


def _ids_with(line_member: dict, proved: set, feature: str) -> list[str]:
    return sorted(
        str(lid) for lid, name in line_member.items()
        if lid in proved and feature in _member_features(name))


def _union_line_flags(line_member: dict, proved: set) -> tuple[list[str], list[str]]:
    """Which kept lines take the envelope fill, and which take the empty-slot clock.

    `placed-fill` needs both: the restored clock clears a one-witness refutation,
    and the envelope supplies the attack the spectral peaks missed. Either one
    alone left that line unproved.
    """
    return _ids_with(line_member, proved, 'fill'), _ids_with(line_member, proved, 'placed')


def _apply_union_choice(chosen: dict, decision: dict, overlay: dict, scopes_ok: bool) -> None:
    """Publish the join. Baseline lines keep the baseline clocks."""
    result = overlay['result']
    origin_decision = overlay.get('decision') or decision
    line_member = result.get('line_member') or {}
    baseline_ids = set(result.get('baseline_ids') or [])
    proved = set(result.get('proved') or [])
    line_fill, line_placed_clock = _union_line_flags(line_member, proved)
    line_nucleus = _ids_with(line_member, proved, 'nucleus')
    line_nearest = _ids_with(line_member, proved, 'nearest')
    phone_names = {
        'phoneme', 'phoneme-fill', 'handoff-phoneme', 'wide-phoneme', 'wide-phoneme-fill',
    }
    phone_ids = {lid for lid, name in line_member.items() if name in phone_names and lid in proved}
    line_stable: dict[str, str] = {}
    line_phone_model: dict[str, str] = {}
    extra_roles: dict[str, str] = {}
    phone_lookup = None
    if origin_decision and origin_decision.get('admitted'):
        import phoneme_choice as Phone
        phone_lookup = Phone
    pair_rows = {
        (row.get('song'), row.get('lang')): row
        for row in (origin_decision or {}).get('pairs') or []
        if isinstance(row, dict)
    }
    for lid, name in line_member.items():
        if lid not in proved:
            continue
        parsed = _split_member(str(name))
        if parsed is None:
            continue
        kind, slug, lang, model = parsed
        if kind == 'stable':
            line_stable[lid] = model
            if phone_lookup is None:
                continue
            role, _chosen_model = phone_lookup._lookup(origin_decision, slug, lang)
            if role == 'only' and lid in baseline_ids:
                role = 'off'
            if role in ('or', 'only'):
                extra_roles[lid] = role
                phone_ids.add(lid)
            continue
        row = pair_rows.get((slug, lang))
        pair_here = row.get('role') if isinstance(row, dict) and row.get('role') in ('or', 'only') else 'off'
        role = 'only' if pair_here == 'only' and lid not in baseline_ids else 'or'
        extra_roles[lid] = role
        line_phone_model[lid] = model
        phone_ids.add(lid)
    roles = {}
    pair_role = {}
    if phone_lookup is not None:
        for row in origin_decision.get('pairs') or []:
            role = row.get('role') if row.get('role') in ('or', 'only') else 'off'
            pair_role[(row.get('song'), row.get('lang'))] = (role, row.get('model'), row.get('word_chance'))
        for lid, role in (origin_decision.get('line_roles') or {}).items():
            if role in ('or', 'only'):
                roles[str(lid)] = role
    # A line the join did not assign to the phoneme stamp does not take `only`:
    # that role replaces the clocks that proved the baseline line.
    for scope in chosen.get('scopes') or []:
        key = (scope.get('song'), scope.get('lang'))
        role, model, chance = pair_role.get(key, ('off', None, None))
        if role == 'off' and scope.get('lang') != '*':
            role, model, chance = pair_role.get((scope.get('song'), '*'), ('off', None, None))
        use_pair = bool(result.get('full_or')) and role in ('or', 'only') and 'phoneme' in (result.get('members') or [])
        scope['phoneme'] = role if use_pair else 'off'
        scope['phoneme_model'] = model if isinstance(model, str) and (use_pair or phone_ids) else None
        scope['phoneme_chance'] = _round(chance) if use_pair else None
    if not (result.get('full_or') and 'phoneme' in (result.get('members') or [])):
        roles = {lid: role for lid, role in roles.items() if lid in phone_ids}
        for lid in phone_ids:
            roles.setdefault(lid, 'or')
    for lid in baseline_ids:
        if roles.get(lid) == 'only' or (not roles.get(lid) and any(
                pair_role.get(key, ('off',))[0] == 'only' for key in pair_role)):
            # Per-line `only` is the dangerous one. A pair-level `only` is already
            # replaced below when the full join did not publish it.
            if roles.get(lid) == 'only':
                roles[lid] = 'off'
    for lid, role in list(roles.items()):
        if role == 'only' and lid in baseline_ids:
            roles[lid] = 'off'
    for lid, role in extra_roles.items():
        if role in ('or', 'only') and not (role == 'only' and lid in baseline_ids):
            roles[lid] = role
    chosen['line_roles'] = {lid: role for lid, role in roles.items() if role in ('or', 'only', 'off') and role != 'off'}
    chosen['line_fill'] = line_fill
    chosen['line_nucleus'] = line_nucleus
    chosen['line_nearest'] = line_nearest
    chosen['line_stable'] = line_stable
    chosen['line_placed_clock'] = line_placed_clock
    chosen['line_phone_model'] = line_phone_model
    lang_report = overlay.get('lang_ctc') or {}
    chosen['line_lang'] = _ids_with(line_member, proved, 'lang')
    chosen['line_pair'] = _ids_with(line_member, proved, 'pair')
    chosen['line_overrule'] = _ids_with(line_member, proved, 'overrule')
    chosen['lang_of'] = dict(lang_report.get('lang_of') or {})
    chosen['pair_phone'] = dict(lang_report.get('pair_phone') or {})
    chosen['attack_fill'] = False
    chosen['choir_attack'] = 'spectral'
    chosen['choir_clock'] = 'phone'
    wide_ids = _ids_with(line_member, proved, 'wide')
    full_wide = bool(result.get('full_or') and 'wide' in (result.get('members') or []))
    wide_on = full_wide or bool(wide_ids)
    # Null means every translation line. A list means only those lines paid for
    # the wider probe. Publishing the half without that list would let the proof
    # accept a far line the join never measured.
    chosen['translation_half'] = float(P.TRANSLATION_HALF) if wide_on else None
    chosen['line_wide'] = None if full_wide else wide_ids
    chosen['retime'] = overlay.get('retime') or {}
    chosen['line_chance'] = _round(result.get('chance'))
    chosen['chance'] = chosen['line_chance']
    chosen['true_proved'] = len(result.get('proved') or [])
    chosen['true_total'] = int(result.get('candidates') or 0)
    chosen['true_rate'] = None if not chosen['true_total'] else _round(chosen['true_proved'] / chosen['true_total'])
    chosen['within_limit'] = bool(scopes_ok and result.get('within_limit'))
    chosen['union'] = {
        'full_or': bool(result.get('full_or')),
        'chance': _round(result.get('chance')),
        'word_chance': _round(result.get('word_chance')),
        'proved': len(result.get('proved') or []),
        'baseline': len(baseline_ids),
        'members': list(result.get('members') or []),
        'lost': list(result.get('lost') or []),
        'lost_chance': _round(result.get('lost_chance')),
        'word_lost': list(result.get('word_lost') or []),
        'line_fill': line_fill,
        'line_nucleus': line_nucleus,
        'line_nearest': line_nearest,
        'line_wide': chosen['line_wide'],
        'translation_half': chosen['translation_half'],
        'line_stable': line_stable,
        'line_placed_clock': line_placed_clock,
        'line_phone_model': line_phone_model,
    }
    if origin_decision is not None and phone_ids:
        origin_decision['kept'] = True
        decision['kept'] = True
        decision['line_roles'] = dict(chosen['line_roles'])
    decision['union'] = chosen['union']


def _try_refuter(per_song: list[dict], refute: dict, baseline_n: int) -> dict:
    """Drop a witness as a refuter only when placers and Gemini agree and the gates rise.

    The comparison is recorded either way. Nothing is dropped when the shifted
    line pass would go over 5 % or proved lines would not rise.
    """
    import refuter_choice as RC

    report = {'kept': False, 'reason': 'не мерялось', 'lines': [], 'candidates': [], 'off': {}}
    out = {'refute': refute, 'report': report, 'scopes': None, 'modes': None, 'tables': None, 'picked': None}
    try:
        gemini = {song.get('slug') or '': RC.gemini_starts(song.get('slug') or '') for song in per_song}
        rows = RC.cases(per_song, refute, gemini)
        cands = RC.candidates(rows)
        report = {'kept': False, 'reason': 'кандидатов нет', 'lines': rows, 'candidates': cands, 'off': {}}
        out['report'] = report
        if not cands:
            return out

        def priced(off: dict):
            nxt = dict(refute)
            nxt['off'] = off
            scopes, ok, modes, tables, picked = _remeasure(per_song, nxt)
            return nxt, scopes, ok, modes, tables, picked

        together = RC.off_map(cands)
        nxt, scopes, ok, modes, tables, picked = priced(together)
        why = 'все кандидаты вместе'
        if not _rises(ok, picked, baseline_n):
            kept_off: dict[str, list[str]] = {}
            current_n = int(baseline_n)
            nxt = refute
            why = ''
            for cand in cands:
                trial_off = {key: list(value) for key, value in kept_off.items()}
                kinds = trial_off.setdefault(str(cand.get('key') or ''), [])
                kind = str(cand.get('kind') or '')
                if kind and kind not in kinds:
                    kinds.append(kind)
                trial, scopes, ok, modes, tables, picked = priced(trial_off)
                if not _rises(ok, picked, current_n):
                    continue
                kept_off = trial_off
                current_n = int(picked.get('proved') or 0)
                nxt = trial
                why = 'по одному'
            if not why:
                report['reason'] = 'порог не удержан'
                return out
        report['kept'] = True
        report['reason'] = why
        report['off'] = dict(nxt.get('off') or {})
        report['proved'] = int(picked.get('proved') or 0)
        report['base_proved'] = int(baseline_n)
        out.update({
            'refute': nxt, 'report': report, 'scopes': scopes, 'modes': modes,
            'tables': tables, 'picked': picked,
        })
        print(
            f"свидетель снят как опровергатель ({why}): доказано {picked.get('proved')} против {baseline_n}",
            flush=True)
    except Exception as e:
        report['reason'] = f'замер не собран: {e.__class__.__name__}'
        print(f'сравнение свидетеля не допущено ({e.__class__.__name__}: {e})', flush=True)
    return out


# Published by run 39548436423 on top of baseline-155.json. Holding the file
# alone would allow those three lines to disappear. A missing line is still
# allowed only when keeping it would push the line pass over 5 %.
# `withdrawn` in that file is not a failed pass: the lyric text or its
# timing-draft flag changed, so the old proof does not apply. Thresholds stay.
PASS5_EXTRA = ('english-8', 'coda-fa-3', 'shushtari-s2')
# These three keep the published choice. A song outside the list is measured
# on its own so its witnesses do not move the three. A run that names none of
# them does the same: it does not check its join against this list.
FROZEN_SONGS = ('i-have-come-alive', 'karitas', 'one')
_LINE_LIST_KEYS = (
    'line_fill', 'line_nucleus', 'line_nearest', 'line_wide',
    'line_lang', 'line_pair', 'line_overrule', 'line_placed_clock',
)
_LINE_MAP_KEYS = ('line_roles', 'line_stable', 'line_phone_model')


def _baseline_payload() -> dict:
    """The frozen line list. An unreadable file fails the hold check."""
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'baseline-155.json'
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _read_frozen() -> list[str]:
    """Line ids proved before pass 5. Missing file means the check cannot pass."""
    return [str(item) for item in (_baseline_payload().get('ids') or []) if item]


def _withdrawn_ids() -> list[str]:
    """Lines removed from the held set after the frozen list was written."""
    return [str(item) for item in (_baseline_payload().get('withdrawn') or []) if item]


def _published_ids() -> list[str]:
    """Frozen 155 plus pass 5, without lines withdrawn after a lyric edit."""
    ids = _read_frozen()
    seen = set(ids)
    for lid in PASS5_EXTRA:
        if lid not in seen:
            ids.append(lid)
            seen.add(lid)
    drop = set(_withdrawn_ids())
    return [lid for lid in ids if lid not in drop]


def published_groups() -> dict[tuple[str, str], int]:
    """Held solo and choir counts. Chance passes must not fall under these."""
    groups: dict[tuple[str, str], int] = {}
    raw = _baseline_payload().get('held_groups') or {}
    if not isinstance(raw, dict):
        return groups
    for slug, kinds in raw.items():
        if not isinstance(kinds, dict):
            continue
        for kind, count in kinds.items():
            if kind not in ('solo', 'choir'):
                continue
            try:
                n = int(count)
            except (TypeError, ValueError):
                continue
            if n > 0:
                groups[(str(slug), str(kind))] = n
    return groups


def published_count() -> int:
    """How many lines the held baseline still requires."""
    return len(_published_ids())


def file_lines_lost(proved_ids) -> list[str]:
    """Retained file lines missing from `proved_ids`.

    The retained set is the frozen list plus the pass-5 trio, minus
    `withdrawn`. `pass_keeps_baseline` only looks at the ids of this run, and
    a line pass above 5 % excuses a missing run line. A missing file line is
    not excused.
    """
    proved = {str(item) for item in (proved_ids or []) if item}
    return [lid for lid in _published_ids() if lid not in proved]


def file_write_allowed(proved_ids) -> tuple[bool, str]:
    """Whether lyrics and timing flags may be written.

    The file must be the 152 distinct retained lines, and every one of them
    must be in `proved_ids`. One absence refuses the write.
    """
    ids = _published_ids()
    if len(ids) != 152 or len(set(ids)) != 152:
        return False, f'файл базы не 152 строки ({len(ids)})'
    lost = file_lines_lost(proved_ids)
    if lost:
        shown = ', '.join(lost[:12])
        more = '' if len(lost) <= 12 else f' и ещё {len(lost) - 12}'
        return False, f'потеряна строка файла: {shown}{more}'
    return True, 'файл удержан: 152'


def qa_proved_ids(slugs: list[str]) -> list[str]:
    """Line ids `qa_sync` marked pass in `work/<slug>/qa-sync.json`."""
    proved: list[str] = []
    for slug in slugs:
        path = work_dir(slug) / 'qa-sync.json'
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        proof = data.get('proof') if isinstance(data, dict) else None
        if not isinstance(proof, dict):
            continue
        for row in proof.get('lines') or []:
            if isinstance(row, dict) and row.get('pass') and row.get('id'):
                proved.append(str(row['id']))
    return proved


def outside_frozen(slugs: list[str]) -> bool:
    """True when the run names songs and none of them is one of the frozen three."""
    return bool(slugs) and all(slug not in FROZEN_SONGS for slug in slugs)


def qa_file_gate(slugs: list[str]) -> tuple[bool, str]:
    """The write gate on this run's qa proof.

    One lost line of a frozen song refuses. A run that names none of the
    frozen songs does not carry their lines, so this gate leaves the
    published file alone.
    """
    if outside_frozen(slugs):
        return True, 'файл не этой песни: база не тронута'
    return file_write_allowed(qa_proved_ids(slugs))


def _lyric_ids(slug: str) -> set[str]:
    """Vocal line ids of one song. An unreadable file contributes none."""
    import timing as T

    path = song_dir(slug) / 'lyrics.json'
    if not path.is_file():
        return set()
    try:
        lyrics = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return set()
    return {str(line.get('id')) for _sec, line in T.vocal_lines(lyrics) if line.get('id')}


def _published_bench() -> dict:
    """The bench file already in the tree. Measuring Alive must not replace it."""
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'attack-chance.json'
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def song_choice_from_chosen(chosen: dict, slug: str, line_ids: set[str] | None = None) -> dict:
    """One song's K, shift grid and limits, and only that song's line lists.

    Word chance stays 15 % and line chance stays 5 %. The shift grid stays
    `SHIFTS`. Lists are restricted to this song so another song's witness
    cannot add or remove a line.
    """
    ids = _lyric_ids(slug) if line_ids is None else {str(item) for item in line_ids if item}
    choice = {
        'k': chosen.get('line_share'),
        'shifts': list(SHIFTS),
        'shift_chance': dict(chosen.get('shifts') or {}) if isinstance(chosen.get('shifts'), dict) else {},
        'word_limit': LIMIT,
        'line_limit': LINE_LIMIT,
    }
    for key in (
        'name', 'tol', 'choir_tol', 'peak_height', 'require_rise', 'require_second',
        'witnesses', 'agree_tol', 'line_share', 'line_min_words', 'line_chance',
        'chance', 'refute', 'bias', 'adopt', 'choir_attack', 'choir_clock',
        'attack_fill', 'blocked_primaries', 'primaries', 'translation_half',
        'within_limit',
    ):
        if key in chosen:
            choice[key] = chosen[key]
    choice['line_limit'] = LINE_LIMIT
    scopes = []
    for scope in chosen.get('scopes') or []:
        if isinstance(scope, dict) and str(scope.get('song') or '') == slug:
            scopes.append(scope)
    choice['scopes'] = scopes
    for key in _LINE_LIST_KEYS:
        choice[key] = [str(lid) for lid in (chosen.get(key) or []) if str(lid) in ids]
    for key in _LINE_MAP_KEYS:
        raw = chosen.get(key) or {}
        if isinstance(raw, dict):
            choice[key] = {str(lid): value for lid, value in raw.items() if str(lid) in ids}
        else:
            choice[key] = {}
    lang_of = {}
    prefix = slug + '|'
    for key, value in (chosen.get('lang_of') or {}).items():
        if str(key).startswith(prefix):
            lang_of[str(key)] = value
    choice['lang_of'] = lang_of
    pair_phone = {}
    for key, value in (chosen.get('pair_phone') or {}).items():
        if str(key).startswith(prefix):
            pair_phone[str(key)] = value
    choice['pair_phone'] = pair_phone
    retime = chosen.get('retime') if isinstance(chosen.get('retime'), dict) else {}
    rows = retime.get(slug)
    choice['retime'] = {slug: rows} if isinstance(rows, list) else {}
    return choice


def _choice_from_piece(piece: dict, slug: str) -> dict:
    """One new song's own K and line lists, taken from its own measurement."""
    fresh_chosen = piece.get('chosen') if isinstance(piece.get('chosen'), dict) else {}
    choice = song_choice_from_chosen(fresh_chosen, slug)
    choice['k'] = fresh_chosen.get('line_share')
    choice['line_share'] = fresh_chosen.get('line_share')
    choice['shifts'] = list(SHIFTS)
    choice['word_limit'] = LIMIT
    choice['line_limit'] = LINE_LIMIT
    phone = piece.get('phoneme') if isinstance(piece.get('phoneme'), dict) else {}
    choice['phoneme_kept'] = bool(phone.get('kept'))
    choice['phoneme_search'] = phone.get('search')
    return choice


def _own_rule_ok(chosen: dict) -> bool:
    """Whether this song's own measurement chose a rule at or under 5 %.

    The frozen baseline is not this song's to lose. A line pass over 5 %,
    or no chosen rule, still refuses the run.
    """
    name = chosen.get('name')
    if not chosen.get('within_limit') or name in (None, '', 'unmeasured'):
        return False
    chance = chosen.get('chance')
    try:
        chance_f = None if chance is None else float(chance)
    except (TypeError, ValueError):
        return False
    if chance_f is not None and chance_f > LINE_LIMIT + 1e-12:
        return False
    return True


def _fresh_only_payload(published: dict, slugs: list[str], pieces: list[tuple[str, dict]]) -> dict:
    """The published choice and baseline, plus each new song measured alone.

    The returned bench is what qa reads during the run. The prove job puts
    the published bench files back before it commits, so this addition does
    not replace them. A new song over 5 % fails the rule check and does not
    report the frozen lines as lost.
    """
    held = published.get('chosen') if isinstance(published.get('chosen'), dict) else {}
    published_ok = bool(held.get('within_limit') and held.get('baseline_kept'))
    by_song: dict[str, dict] = {}
    worst_name = None
    worst_chance = None
    own_ok = True
    for slug, piece in pieces:
        fresh_chosen = piece.get('chosen') if isinstance(piece.get('chosen'), dict) else {}
        if not _own_rule_ok(fresh_chosen):
            own_ok = False
            worst_name = fresh_chosen.get('name')
            worst_chance = fresh_chosen.get('chance')
        by_song[slug] = _choice_from_piece(piece, slug)
    held_n = published_count()
    held_status = {
        'kept': True, 'lost': [], 'n': held_n, 'reason': 'удержано',
    }
    if not published_ok or not own_ok:
        return {
            'songs': list(slugs),
            'by_song': by_song,
            'measured_songs': list(slugs),
            'chosen': {
                'name': worst_name if worst_name not in (None, '') else 'unmeasured',
                'within_limit': False,
                'chance': worst_chance,
                'baseline_kept': True,
                'baseline_lost': [],
                'baseline_n': held_n,
                'baseline_reason': 'удержано',
            },
            'frozen': dict(held_status),
        }
    payload = copy.deepcopy(published)
    have = [str(item) for item in (payload.get('songs') or [])]
    for slug in slugs:
        if slug not in have:
            have.append(slug)
    payload['songs'] = have
    payload['by_song'] = by_song
    payload['measured_songs'] = list(slugs)
    out_chosen = dict(payload.get('chosen') or {})
    out_chosen['baseline_n'] = held_n
    out_chosen['baseline_kept'] = True
    out_chosen['baseline_lost'] = []
    out_chosen['baseline_reason'] = 'удержано'
    payload['chosen'] = out_chosen
    payload['frozen'] = dict(held_status)
    return payload


def build_payload(slugs: list[str]) -> dict:
    """Measure a new song on its own and keep the published choice of the three.

    A run of only the frozen songs still measures them together, as before.
    A run that names none of them measures each new song on its own and
    leaves the published choice, the baseline list and the published bench.
    The new song still has to come in at or under the 5 % line pass.
    A run that also names a frozen song does not put the new song into their
    union. Each song's K, shift grid and limits are stored under `by_song`.
    Thresholds are not changed.
    """
    fresh = [slug for slug in slugs if slug not in FROZEN_SONGS]
    frozen = [slug for slug in slugs if slug in FROZEN_SONGS]
    if not fresh:
        return _measure_slugs(slugs)
    published = _published_bench()
    chosen = published.get('chosen') if isinstance(published.get('chosen'), dict) else {}
    if frozen and (not chosen.get('within_limit') or not chosen.get('baseline_kept')):
        return _measure_slugs(slugs)
    if not frozen:
        pieces = [(slug, _measure_slugs([slug])) for slug in fresh]
        return _fresh_only_payload(published, fresh, pieces)
    by_song = {slug: song_choice_from_chosen(chosen, slug) for slug in frozen}
    for slug in fresh:
        piece = _measure_slugs([slug])
        by_song[slug] = _choice_from_piece(piece, slug)
    payload = copy.deepcopy(published)
    payload['songs'] = list(slugs)
    payload['by_song'] = by_song
    payload['measured_songs'] = list(fresh)
    out_chosen = dict(payload.get('chosen') or {})
    out_chosen['baseline_n'] = published_count()
    out_chosen['baseline_kept'] = True
    out_chosen['baseline_lost'] = []
    out_chosen['baseline_reason'] = 'удержано'
    payload['chosen'] = out_chosen
    frozen_status = dict(payload.get('frozen') or {})
    frozen_status['n'] = published_count()
    frozen_status['kept'] = True
    frozen_status['lost'] = []
    frozen_status['reason'] = 'удержано'
    payload['frozen'] = frozen_status
    return payload


def _frozen_status(result: dict | None, ids: list[str]) -> dict:
    """Whether the published join still holds the frozen proved lines.

    A missing line is allowed only when holding it would push the line pass
    over 5 %. No join means the check did not run, so it does not pass.
    """
    if not ids:
        return {'kept': False, 'lost': [], 'n': 0, 'reason': 'нет списка базовых строк'}
    if not result:
        return {'kept': False, 'lost': [], 'n': len(ids), 'reason': 'объединение не собрано'}
    proved = set(result.get('proved') or [])
    detail = result.get('lost_detail') or {}
    lost = []
    for lid in ids:
        if lid in proved:
            continue
        lost.append({'id': lid, 'chance': detail.get(lid)})
    return {
        'kept': pass_keeps_baseline(result, ids),
        'lost': lost,
        'n': len(ids),
        'reason': 'удержано' if pass_keeps_baseline(result, ids) else 'базовая строка потеряна без прохода выше 5 %',
    }


def _measure_slugs(slugs: list[str]) -> dict:
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
            'open_place': phone_summary.get('open_place') or {},
            'report_by_id': report_by,
            'next_by_id': next_by,
            'order_by_id': order_by,
            'proof_models': (report.get('summary') or {}).get('proof_models') or {},
            'placement_model': (report.get('summary') or {}).get('placement_model')
            or (report.get('summary') or {}).get('stable_model'),
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
    refuter_try = _try_refuter(per_song, refute, int(baseline_picked.get('proved') or 0))
    refute = refuter_try['refute']
    refuter_report = refuter_try['report']
    if refuter_try.get('picked') is not None:
        scopes = refuter_try['scopes']
        modes = refuter_try['modes']
        baseline_tables = refuter_try['tables']
        baseline_picked = refuter_try['picked']
        scopes_ok = True
    origin_modes = dict(modes)
    origin_picked = baseline_picked
    origin_lines = _snapshot(per_song)
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
    try:
        overlay = _union_overlay(
            per_song, origin_lines, origin_modes, refute, origin_picked, decision,
            placed_kept is not None, scopes_ok)
    except Exception as exc:
        overlay = None
        print(f'объединение не собрано ({exc.__class__.__name__}: {exc})', flush=True)
    published_union = bool(overlay and (overlay.get('result') or {}).get('within_limit'))
    if published_union:
        _apply_union_choice(chosen, decision, overlay, scopes_ok)
        if overlay.get('decision') is not None:
            decision = overlay['decision']
            decision['kept'] = bool(chosen.get('line_roles') or 'phoneme' in (chosen.get('union') or {}).get('members') or [])
            decision['line_roles'] = dict(chosen.get('line_roles') or {})
            decision['union'] = chosen.get('union')
    density = []
    for song in per_song:
        density.extend(density_table(song['slug'], song['lines'], song['base']))
    public_rows = []
    for row in rows:
        public_rows.append({k: v for k, v in row.items() if not k.startswith('_')})
    frozen = _frozen_status((overlay or {}).get('result') if overlay else None, _published_ids())
    chosen['baseline_kept'] = frozen['kept']
    chosen['baseline_lost'] = frozen['lost']
    chosen['baseline_n'] = frozen['n']
    chosen['baseline_reason'] = frozen['reason']
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
        'lang_ctc': (overlay or {}).get('lang_ctc') if overlay else None,
        'attack_fill': _public_fill(fill_report),
        '_refutations': collect_refutations(per_song, refute),
        'refuter': refuter_report,
        'frozen': frozen,
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


def commit_gate(payload: dict | None, slugs: list[str], exit_code: int = 0) -> tuple[bool, str]:
    """Whether prove may commit docs/analysis/bench.

    The measurement writes the bench even when it refuses the rule. Run
    40144966993 committed that one-song file after baseline_kept came back
    false. A refused rule or a lost baseline must leave the published bench.
    A non-zero exit whose file still looks publishable means the script died
    before it wrote: the checkout's old bench must not be committed again as
    if this run had measured it, and the run still fails.
    """
    chosen = (payload or {}).get('chosen') or {}
    name = chosen.get('name')
    if not chosen.get('within_limit') or name in (None, '', 'unmeasured'):
        ok, detail = False, f'замер не выбрал правило ({name}, проход {chosen.get("chance")})'
    elif not chosen.get('baseline_kept'):
        reason = chosen.get('baseline_reason') or 'baseline_kept ложь'
        ok, detail = False, f'база не удержана: {reason}'
    else:
        have = set((payload or {}).get('songs') or [])
        missing = [slug for slug in slugs if slug not in have]
        if missing:
            ok, detail = False, 'нет песен: ' + ', '.join(missing)
        elif 'file_kept' in chosen and not chosen.get('file_kept'):
            reason = chosen.get('file_reason') or 'строка файла потеряна'
            ok, detail = False, f'файл не удержан: {reason}'
        elif 'file_proved' in chosen:
            allowed, reason = file_write_allowed(chosen.get('file_proved') or [])
            if not allowed:
                ok, detail = False, f'файл не удержан: {reason}'
            else:
                ok, detail = True, f"правило {name}, база {chosen.get('baseline_n')}"
        else:
            ok, detail = True, f"правило {name}, база {chosen.get('baseline_n')}"
    if exit_code != 0 and ok:
        return False, 'замер атак не выбрал правило'
    return ok, detail


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
        import lang_ctc_choice as LangCtc
        (out_dir / 'lang-ctc.md').write_text(
            LangCtc.render_md(payload.get('lang_ctc') or {}), encoding='utf-8')
    except Exception as e:
        print(f'lang-ctc.md не записан ({e.__class__.__name__}: {e})')
    try:
        import phoneme_choice as Phone
        (out_dir / 'chorus.md').write_text(Phone.render_chorus(phone.get('chorus') or {}), encoding='utf-8')
    except Exception as e:
        print(f'chorus.md не записан ({e.__class__.__name__}: {e})')
    try:
        import stem_onset
        onset_songs = []
        for slug in args.slugs:
            path = work_dir(slug) / 'align-report.json'
            onset = {}
            if path.exists():
                report = json.loads(path.read_text(encoding='utf-8'))
                onset = ((report.get('summary') or {}).get('placement') or {}).get('ft') or {}
                onset = onset.get('onset') or {}
            onset_songs.append({'slug': slug, 'onset': onset})
        (out_dir / 'stem-onset.md').write_text(stem_onset.render_md(onset_songs), encoding='utf-8')
        (out_dir / 'stem-onset.json').write_text(
            json.dumps(onset_songs, ensure_ascii=False, indent=1), encoding='utf-8')
    except Exception as e:
        print(f'stem-onset.md не записан ({e.__class__.__name__}: {e})')
    try:
        import refuter_choice as RC
        (out_dir / 'refuter.md').write_text(RC.render_md(payload.get('refuter') or {}), encoding='utf-8')
    except Exception as e:
        print(f'refuter.md не записан ({e.__class__.__name__}: {e})')
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
    if chosen.get('baseline_reason') != 'объединение не собрано' and not chosen.get('baseline_kept'):
        lost = ', '.join(str(row.get('id')) for row in (chosen.get('baseline_lost') or [])[:12])
        print(f"монотонность не удержана: {chosen.get('baseline_reason')}"
              + (f" ({lost})" if lost else ''))
        return 2
    have = set(payload.get('songs') or [])
    missing = [slug for slug in args.slugs if slug not in have]
    if missing:
        print('нет песен: ' + ', '.join(missing))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
