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
    """`mms`, `stable-ts` or `second`. Every MMS window is the MMS clock."""
    if not name or str(name).startswith('mms'):
        return 'mms'
    if name == 'stable-ts':
        return 'stable-ts'
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


def judge(starts: list[float | None], ends: list[float | None], cue_start: float | None,
          next_cue: float | None, section: tuple[float, float] | None = None) -> dict:
    """Structure and |first start − cue|. `placed` needs both, and a cue."""
    if not starts or any(s is None or e is None for s, e in zip(starts, ends)):
        why = 'missing' if not starts or any(s is None for s in starts) else 'eaten'
        return {'structure_ok': False, 'structure': why, 'delta': None, 'near': False, 'placed': False}
    ok, why = Cal.structural(starts, ends, next_cue, section)
    delta = None if cue_start is None or starts[0] is None else abs(float(starts[0]) - float(cue_start))
    near = delta is not None and round(delta, 3) <= CUE_TOL
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
    return second, 'whisperx', stable, 'stable-ts'


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
