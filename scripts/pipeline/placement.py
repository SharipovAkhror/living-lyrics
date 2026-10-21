"""Fallback placement when MMS misses a cued line.

The first pass is unchanged: MMS inside the cue window, placed when the structural
checks pass and the pre-snap start is within 0.30 s of the cue. A line that fails
that is tried, in order, on a wider MMS window (this cue to the next cue, several
margins), then MMS on an htdemucs_ft clip of that line, then stable-ts, then the
second aligner. The first one that passes structure and |Δ| ≤ 0.30 s is the placer.

Proof stays the line rule. The placer is not its own witness: the other two clocks
are the witnesses. htdemucs_ft runs only on the lines still open, and only while the
time budget holds.
"""
from __future__ import annotations

import time

import numpy as np

import calibrate_score as Cal

CUE_TOL = 0.30
# 90th percentile of |Gemini hearing − cue| on the 13 I Have Come Alive
# translation lines whose own recheck block hears that line's text (2.006 s,
# docs/analysis/i-have-come-alive/recheck.json). Karitas and ONE p90s of the
# same match are 0.56 s and 0.63 s. The half is the widest of those p90s,
# rounded up to the cent so the measured p90 sits inside. It is not the 7 s
# outlier on rumi-18-2: that hearing is stored on a later line, not on its block.
TRANSLATION_HALF = 2.01
# Margins around the span [this cue, next cue]. Lead is before this cue, tail is
# after the next cue's start. The ordinary cue window is not in this list.
WINDOW_MARGINS = (
    (0.00, 0.00),
    (0.15, 0.00),
    (0.30, 0.00),
    (0.80, 0.00),
    (1.20, 0.00),
    (0.00, 0.30),
    (0.30, 0.30),
    (0.80, 0.50),
)
CHAIN = ('mms-window', 'mms-ft', 'stable-ts', 'second')
# htdemucs_ft is about four times realtime. Twelve minutes per song leaves the
# rest of the three-song run inside the workflow limit.
FT_BUDGET_S = 12 * 60
FT_RTF = 4.0
FT_RATE = 44100
DISPUTE_LO = 0.30
DISPUTE_HI = 0.70
AGREE = 0.10


def primary_family(name: str | None) -> str:
    """`mms`, `stable-ts`, `phoneme` or `second`. Every MMS window is the MMS clock."""
    if not name or str(name).startswith('mms'):
        return 'mms'
    if name in ('stable-ts', 'phoneme'):
        return name
    return 'second'


def span_to_next(cue_start: float, cue_end: float, next_start: float | None, duration: float,
                 lead: float, tail: float) -> tuple[float, float]:
    """Search from this cue to the next cue, plus a margin on each side.

    The ordinary neighbour fence is not applied: that fence is what the first pass
    already used. The span still stays inside the file.
    """
    t0 = max(0.0, float(cue_start) - float(lead))
    end = float(next_start) if next_start is not None else float(cue_end)
    t1 = min(float(duration), end + float(tail))
    if t1 < t0 + 0.40:
        t1 = min(float(duration), t0 + 0.40)
    return t0, t1


def same_window(a: tuple[float, float], b: tuple[float, float], tol: float = 0.05) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def ends_from_starts(starts: list[float | None], next_cue: float | None) -> list[float | None]:
    """A start-only aligner still has to sit in order. The end is the next start.

    The last end stops at the next cue when there is one, so a start that is itself
    before that cue is not called past it.
    """
    ends: list[float | None] = []
    for i, start in enumerate(starts):
        if start is None:
            ends.append(None)
            continue
        nxt = next((float(s) for s in starts[i + 1:] if s is not None), None)
        if nxt is not None:
            ends.append(max(float(start) + 0.02, nxt))
        else:
            end = float(start) + 0.40
            # Cap only when the start itself is still before the next cue. A start
            # past that cue keeps the long end, so the structural check can see it.
            if next_cue is not None and float(start) <= float(next_cue) and end > float(next_cue):
                end = float(next_cue)
            ends.append(end)
    return ends


def spans_inside(spans: list | None, section: tuple[float, float] | None, slack: float = 0.05) -> bool:
    """Every timed word start lies inside the section, slack included.

    Punctuation is not in the lettered structural check, and the validator warns
    on every word. None spans are ignored. No section means there is nothing to
    test. A start exactly on the slack boundary passes.
    """
    if section is None:
        return True
    lo = float(section[0]) - float(slack)
    hi = float(section[1]) + float(slack)
    for span in spans or []:
        if span is None:
            continue
        start = float(span[0])
        if start < lo - 1e-9 or start > hi + 1e-9:
            return False
    return True


def lang_primary(code: str | None) -> str:
    """ISO 639 primary subtag. `en` and `en-GB` are the same language."""
    if not code:
        return ''
    return str(code).strip().lower().replace('_', '-').split('-')[0]


def cue_is_translation(line_lang: str | None, cue_lang: str | None) -> bool:
    """True when the subtitle cue is not in the line's language.

    A missing language is not called a translation: the 0.30 s gate stays.
    """
    line = lang_primary(line_lang)
    cue = lang_primary(cue_lang)
    if not line or not cue:
        return False
    return line != cue


def cue_accept_limit(line_lang: str | None, cue_lang: str | None, half: float | None = None) -> float:
    """Same-language cues stay at 0.30 s. A translation cue may use `half`."""
    span = TRANSLATION_HALF if half is None else half
    if span is None or not cue_is_translation(line_lang, cue_lang):
        return CUE_TOL
    return float(span)


def translation_span(cue: float, prev_end: float | None, next_start: float | None,
                     half: float) -> tuple[float, float]:
    """Acceptance window for one translation cue.

    ±`half` around the cue, tightened by the previous line's end and the next
    line's start when those neighbours exist. The intersection is the bound:
    a neighbour gap of many seconds does not become the search.
    """
    half = max(0.0, float(half))
    lo = float(cue) - half
    hi = float(cue) + half
    if prev_end is not None:
        lo = max(lo, float(prev_end))
    if next_start is not None:
        hi = min(hi, float(next_start))
    if hi < lo:
        lo = hi = float(cue)
    return lo, hi


def in_translation_window(start: float, cue: float, prev_end: float | None,
                          next_start: float | None, half: float) -> bool:
    lo, hi = translation_span(cue, prev_end, next_start, half)
    return lo - 1e-9 <= float(start) <= hi + 1e-9


def translation_leftover(start: float | None, cue: float | None, prev_end: float | None,
                         next_start: float | None, *, structure_ok: bool, translated: bool) -> bool:
    """A translation start the 0.30 s gate refused, still inside the neighbour fence.

    The chain does not adopt it while a later step can still land inside 0.30 s.
    A start before the previous cue end is not a leftover: the wider proof uses
    the same fence, so keeping it would publish a time the join cannot price.
    """
    if not structure_ok or not translated or start is None or cue is None:
        return False
    if round(abs(float(start) - float(cue)), 3) <= CUE_TOL:
        return False
    return in_translation_window(float(start), float(cue), prev_end, next_start, TRANSLATION_HALF)


def judge(starts: list[float | None], ends: list[float | None], cue_start: float | None,
          next_cue: float | None, section: tuple[float, float] | None = None,
          limit: float | None = None) -> dict:
    """Structure and |first start − cue|. `placed` needs both, and a cue.

    `limit` defaults to 0.30 s. A translation cue passes its own measured half.
    """
    if not starts or any(s is None or e is None for s, e in zip(starts, ends)):
        why = 'missing' if not starts or any(s is None for s in starts) else 'eaten'
        return {'structure_ok': False, 'structure': why, 'delta': None, 'near': False, 'placed': False}
    ok, why = Cal.structural(starts, ends, next_cue, section)
    tol = CUE_TOL if limit is None else float(limit)
    delta = None if cue_start is None or starts[0] is None else abs(float(starts[0]) - float(cue_start))
    near = delta is not None and round(delta, 3) <= tol
    return {
        'structure_ok': ok, 'structure': why, 'delta': None if delta is None else round(delta, 3),
        'near': near, 'placed': bool(ok and near and cue_start is not None),
    }


def lettered_pairs(seconds: list[list[float] | None], roman: list[str]) -> tuple[list[float | None], list[float | None]]:
    starts, ends = [], []
    for span, rm in zip(seconds, roman):
        if not rm:
            continue
        if span is None:
            starts.append(None)
            ends.append(None)
        else:
            starts.append(float(span[0]))
            ends.append(float(span[1]))
    return starts, ends


def first_placed(attempts: list[dict]) -> dict | None:
    """The earliest chain step that already passed. Later successes stay recorded."""
    order = {name: i for i, name in enumerate(CHAIN)}
    ok = [row for row in attempts if row.get('placed')]
    if not ok:
        return None
    ok.sort(key=lambda row: order.get(row.get('by'), 99))
    return ok[0]


def placed_clock_for_gap(placed_by: str | None, stored: dict | None,
                         chosen_model: str | None, placement_model: str | None,
                         third: float | None) -> float | None:
    """The placement-model clock for an empty stable witness, or None.

    The model search does not inherit this clock. The join prices it on its own,
    and only where the stable slot is already the third witness and is empty.
    An existing third witness is left as it is. A measured chosen model is not
    replaced by the placement model.
    """
    if third is not None or not placement_model:
        return None
    stored = stored or {}
    if chosen_model and stored.get(chosen_model) is not None:
        return None
    clock = stored.get(placement_model)
    if clock is None:
        return None
    _second, _second_kind, _slot, kind_when_empty = witness_slots(placed_by, None, None, None)
    if kind_when_empty != 'stable-ts':
        return None
    return round(float(clock), 3)


def stamp_placed_clock(words: list[dict] | None, placed_by: str | None,
                       chosen_model: str | None, placement_model: str | None) -> int:
    """Fill empty stable witness slots on report words. Returns how many changed."""
    changed = 0
    for word in words or []:
        clock = placed_clock_for_gap(
            placed_by, word.get('stable_models'), chosen_model, placement_model, word.get('third_s'))
        if clock is None:
            continue
        word['third_s'] = clock
        word['clock_stable'] = clock
        word['third_kind'] = 'stable-ts'
        changed += 1
    return changed


def witness_slots(placed_by: str | None, mms: float | None, second: float | None,
                  stable: float | None) -> tuple[float | None, str | None, float | None, str | None]:
    """Two witness clocks, and which aligner each one is. The placer is left out.

    Returns (second_s, second_kind, third_s, third_kind) for the report columns the
    proof already reads. Kinds other than whisperx are not a bias target.
    """
    family = primary_family(placed_by)
    if family == 'stable-ts':
        return mms, 'mms', second, 'whisperx'
    if family == 'second':
        return mms, 'mms', stable, 'stable-ts'
    if family == 'phoneme':
        # The phoneme placer is not a witness of itself. MMS and stable-ts, or the second clock.
        if stable is not None:
            return mms, 'mms', stable, 'stable-ts'
        return mms, 'mms', second, 'whisperx'
    return second, 'whisperx', stable, 'stable-ts'


# A refuted line may move to a later placer. Phoneme is last and only when its clock exists.
HANDOFF_AFTER = {
    'mms': ('stable-ts', 'second', 'phoneme'),
    'stable-ts': ('second', 'phoneme'),
    'second': ('phoneme',),
    'phoneme': (),
}


def _placer_clock(word: dict, name: str) -> float | None:
    key = {
        'stable-ts': 'clock_stable',
        'second': 'clock_second',
        'phoneme': 'clock_phoneme',
    }.get(name, 'clock_mms')
    value = word.get(key)
    return None if value is None else float(value)


def handoff_proposal(line: dict, next_cue: float | None, peaks, refute: dict | None,
                     section: tuple[float, float] | None = None,
                     allow_phoneme: bool = True) -> dict | None:
    """Give a refuted line to the next placer that places it and does not refute.

    The current placer stays when no later one both lands inside 0.30 s and
    leaves every lettered word unrefuted. The line is not unplaced.
    """
    import qa_sync as Q

    words = list(line.get('words') or [])
    if len(words) < 2 or not refute:
        return None
    if not any(Q.word_refuted(
            {'ctc_s': word.get('t'), 'second_s': word.get('second'), 'third_s': word.get('third')},
            peaks, refute) for word in words):
        return None
    family = primary_family(line.get('placed_by'))
    cue = line.get('cue_start')
    limit = cue_accept_limit(line.get('lang'), line.get('cue_lang'))
    for name in HANDOFF_AFTER.get(family, ()):
        if name == 'phoneme' and not allow_phoneme:
            continue
        starts = [_placer_clock(word, name) for word in words]
        if any(start is None for start in starts):
            continue
        ends = ends_from_starts(starts, next_cue)
        if not judge(starts, ends, cue, next_cue, section, limit=limit).get('placed'):
            continue
        witnesses = []
        refuted = False
        for word, start in zip(words, starts):
            slot = witness_slots(
                name, _placer_clock(word, 'mms'), _placer_clock(word, 'second'),
                _placer_clock(word, 'stable-ts'))
            witnesses.append(slot)
            if Q.word_refuted({'ctc_s': start, 'second_s': slot[0], 'third_s': slot[2]}, peaks, refute):
                refuted = True
                break
        if refuted:
            continue
        return {
            'by': name,
            'starts': [float(start) for start in starts],
            'ends': [float(end) for end in ends],
            'witnesses': witnesses,
        }
    return None


def consider_phoneme_place(starts: list, cue, next_cue, section: tuple[float, float] | None = None,
                           limit: float | None = None) -> dict | None:
    """A phoneme start places a still-open line inside the cue gate.

    Same-language cues stay at 0.30 s. A translation cue may pass `limit`.
    """
    if cue is None or not starts or any(start is None for start in starts):
        return None
    floats = [float(start) for start in starts]
    ends = ends_from_starts(floats, next_cue)
    if not judge(floats, ends, float(cue), next_cue, section, limit=limit).get('placed'):
        return None
    return {'by': 'phoneme', 'starts': floats, 'ends': [float(end) for end in ends]}


def in_dispute_band(delta: float | None) -> bool:
    """MMS |Δ| strictly above 0.30 s and at most 0.70 s. The rule is not changed."""
    if delta is None:
        return False
    rounded = round(float(delta), 3)
    return DISPUTE_LO < rounded <= DISPUTE_HI + 1e-9


def dispute_row(line_id: str, lang: str, group: str, cue: float | None, mms: float | None,
                second: float | None, stable: float | None, peaks: np.ndarray | None) -> dict | None:
    """One line whose MMS start sits 0.30–0.70 s from the cue.

    Agreement is the three starts within 0.10 s of each other. The attack is a
    peak of the caller's height within 0.10 s of their median. A missing clock
    is not an agreement.
    """
    if cue is None or mms is None or not in_dispute_band(abs(float(mms) - float(cue))):
        return None
    clocks = [mms, second, stable]
    present = [c for c in clocks if c is not None]
    span = None if len(present) < 3 else max(present) - min(present)
    agree = span is not None and span <= AGREE + 1e-12
    median = None if len(present) < 3 else float(np.median(present))
    attack = False
    attack_dt = None
    if agree and median is not None and peaks is not None and len(peaks):
        attack_dt = float(np.min(np.abs(np.asarray(peaks, dtype=float) - median)))
        attack = attack_dt <= AGREE + 1e-12
    return {
        'id': line_id, 'lang': lang, 'group': group,
        'cue': round(float(cue), 3), 'mms': round(float(mms), 3),
        'second': None if second is None else round(float(second), 3),
        'stable': None if stable is None else round(float(stable), 3),
        'delta': round(abs(float(mms) - float(cue)), 3),
        'span': None if span is None else round(span, 3),
        'agree': agree, 'attack': bool(agree and attack),
        'attack_dt': None if attack_dt is None else round(attack_dt, 3),
    }


def summarize_unplaced(rows: list[dict]) -> list[dict]:
    """Per language: why MMS did not place the line, and whether the other two would have.

    `missing` — no MMS path. `structure` — a path that failed the structural checks.
    `delta` — structure passed and |Δ| > 0.30 s. A line can be in structure and also
    far from the cue; it is counted under structure, and `structure_far` says how
    many of those are also past 0.30 s.
    """
    langs: dict[str, dict] = {}
    for row in rows:
        if row.get('mms_placed'):
            continue
        lang = row.get('lang') or '?'
        bucket = langs.setdefault(lang, {
            'lang': lang, 'lines': 0, 'unplaced': 0, 'missing': 0, 'structure': 0,
            'structure_far': 0, 'delta': 0, 'uncued': 0,
            'second_placed': 0, 'second_near': 0, 'second_structure': 0,
            'stable_placed': 0, 'stable_near': 0, 'stable_structure': 0,
            'window_placed': 0, 'ft_placed': 0,
        })
        bucket['lines'] += 1
        bucket['unplaced'] += 1
        if row.get('mms_missing'):
            bucket['missing'] += 1
        elif not row.get('mms_structure_ok'):
            bucket['structure'] += 1
            if row.get('mms_delta') is None or float(row['mms_delta']) > CUE_TOL:
                bucket['structure_far'] += 1
        elif row.get('mms_delta') is None:
            bucket['uncued'] += 1
        else:
            bucket['delta'] += 1
        for prefix in ('second', 'stable'):
            if row.get(f'{prefix}_placed'):
                bucket[f'{prefix}_placed'] += 1
            if row.get(f'{prefix}_near'):
                bucket[f'{prefix}_near'] += 1
            if row.get(f'{prefix}_structure'):
                bucket[f'{prefix}_structure'] += 1
        if row.get('window_placed'):
            bucket['window_placed'] += 1
        if row.get('ft_placed'):
            bucket['ft_placed'] += 1
    return [langs[key] for key in sorted(langs)]


def merge_spans(spans: list[tuple[float, float, str]], gap: float = 0.4) -> list[tuple[float, float, list[str]]]:
    """Overlapping clip requests become one demucs span. Ids stay with the span."""
    if not spans:
        return []
    ordered = sorted(spans, key=lambda item: (item[0], item[1]))
    out: list[tuple[float, float, list[str]]] = []
    t0, t1, ids = ordered[0][0], ordered[0][1], [ordered[0][2]]
    for a, b, line_id in ordered[1:]:
        if a <= t1 + gap:
            t1 = max(t1, b)
            ids.append(line_id)
        else:
            out.append((t0, t1, ids))
            t0, t1, ids = a, b, [line_id]
    out.append((t0, t1, ids))
    return out


def fit_budget(spans: list[tuple[float, float, list[str]]], budget_s: float, rtf: float = FT_RTF
               ) -> tuple[list[tuple[float, float, list[str]]], list[str]]:
    """Keep every span whose estimated runtime still fits. A span that does not fit is named and skipped.

    A later shorter span can still be kept. The first span is skipped too when it
    alone is larger than the budget.
    """
    kept = []
    skipped: list[str] = []
    used = 0.0
    for t0, t1, ids in spans:
        cost = max(0.0, t1 - t0) * rtf
        if kept and used + cost > budget_s:
            skipped.extend(ids)
            continue
        if not kept and cost > budget_s:
            skipped.extend(ids)
            continue
        kept.append((t0, t1, ids))
        used += cost
    return kept, skipped


def separate_ft_clips(mix_44k: np.ndarray, spans: list[tuple[float, float]], rate: int = FT_RATE,
                      budget_s: float = FT_BUDGET_S) -> tuple[list[np.ndarray | None], dict]:
    """Vocals of each span from one htdemucs_ft load. A span past the budget is None.

    `mix_44k` is mono float32 at `rate`. The model wants that rate and two channels.
    The returned vocal is mono at the same rate. The caller resamples to 16 kHz.
    """
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model('htdemucs_ft')
    model.cpu().eval()
    # The download is not part of the separation budget. The clock starts once the model is loaded.
    started = time.monotonic()
    sources = list(getattr(model, 'sources', []) or [])
    if 'vocals' not in sources:
        raise RuntimeError('htdemucs_ft не отдал дорожку vocals')
    vocal_i = sources.index('vocals')
    out: list[np.ndarray | None] = []
    done = 0
    for t0, t1 in spans:
        if time.monotonic() - started > budget_s:
            out.append(None)
            continue
        a = max(0, int(float(t0) * rate))
        b = min(len(mix_44k), int(float(t1) * rate))
        if b - a < int(0.4 * rate):
            out.append(None)
            continue
        clip = np.stack([mix_44k[a:b], mix_44k[a:b]])
        tensor = torch.from_numpy(np.ascontiguousarray(clip)).float().unsqueeze(0)
        with torch.inference_mode():
            separated = apply_model(model, tensor, device='cpu', split=True, overlap=0.1, progress=False)
        vocal = separated[0, vocal_i].mean(dim=0).detach().cpu().numpy().astype(np.float32)
        out.append(vocal)
        done += 1
    info = {
        'ran': True, 'clips': done, 'skipped': len(spans) - done,
        'elapsed_s': round(time.monotonic() - started, 1), 'budget_s': budget_s,
    }
    del model
    return out, info
