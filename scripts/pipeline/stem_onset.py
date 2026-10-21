"""Choose a vocal stem by onset clarity, then hand that choice to placement.

The song stem stays htdemucs: a full-song htdemucs_ft pass does not fit the
150 minute job. This module separates short clips around words the previous
proof already kept and scores the attack at those times. A candidate replaces
the clip placer only when the attack at the word is stronger and the same
curve is not stronger at the shifted controls. Weights are not committed.

Candidates, all from the Demucs repository (MIT, https://github.com/adefossez/demucs):
  htdemucs_ft as the clip placer already runs it (shifts 1, overlap 0.1);
  the same model at the library overlap 0.25;
  the same model with shifts 2 and overlap 0.5;
  the sample mean of htdemucs and htdemucs_ft;
  mdx_extra when the measure budget still has room.
mdx_extra's training included the MUSDB test set (Demucs README). That is a
score caveat, not a different licence. A model that fails to load is recorded
and is not chosen.
"""
from __future__ import annotations

import time

import numpy as np

import features as F

MEASURE_BUDGET_S = 10 * 60
MIN_WORDS = 8
# A candidate must be at least this much stronger at the word. A stem that is
# only louder at the shifted controls does not win: its ratio would fall.
GAIN = 1.05
SHIFT_S = (-0.40, -0.25, 0.25, 0.40)
WINDOW_S = 0.08
ONSET_W = {'mid': 0.5, 'hf': 0.5, 'rise': 1.0}

# role=baseline is the clip placer the pipeline already runs.
# role=ingredient is scored and can feed the ensemble; it is not itself a choice.
CANDIDATES = (
    {
        'name': 'htdemucs_ft',
        'model': 'htdemucs_ft',
        'shifts': 1,
        'overlap': 0.1,
        'ensemble': False,
        'role': 'baseline',
        'license': 'MIT',
        'note': 'Demucs v4, набор из четырёх дообученных моделей. Веса не коммитятся. Сдвиги 1, перекрытие 0,1 — как у текущего отрезка.',
    },
    {
        'name': 'htdemucs',
        'model': 'htdemucs',
        'shifts': 1,
        'overlap': 0.25,
        'ensemble': False,
        'role': 'ingredient',
        'license': 'MIT',
        'note': 'Demucs v4, четыре стема. Нужен как вторая дорожка среднего. Сам отрезок им не заменяется: первый проход уже на нём.',
    },
    {
        'name': 'htdemucs_ft-overlap',
        'model': 'htdemucs_ft',
        'shifts': 1,
        'overlap': 0.25,
        'ensemble': False,
        'role': 'raised',
        'license': 'MIT',
        'note': 'Те же веса htdemucs_ft. Перекрытие 0,25 — значение библиотеки, не новый файл весов.',
    },
    {
        'name': 'htdemucs_ft-shifts2',
        'model': 'htdemucs_ft',
        'shifts': 2,
        'overlap': 0.5,
        'ensemble': False,
        'role': 'raised',
        'license': 'MIT',
        'note': 'Те же веса htdemucs_ft. Два сдвига и перекрытие 0,5. Новых весов нет.',
    },
    {
        'name': 'mdx_extra',
        'model': 'mdx_extra',
        'shifts': 1,
        'overlap': 0.25,
        'ensemble': False,
        'role': 'second',
        'license': 'MIT',
        'note': 'Demucs mdx_extra, тот же репозиторий и MIT. README: обучение включало тест MUSDB. Веса не коммитятся.',
    },
)


def current_spec() -> dict:
    """The clip placer the rescue already runs, when the measure does not switch."""
    row = dict(CANDIDATES[0])
    row['reason'] = 'не измерено'
    return row


def rtf_of(spec: dict | None) -> float:
    """Rough realtime factor for the rescue budget. Unknown settings stay at 4."""
    spec = spec or {}
    if spec.get('ensemble'):
        return 6.0
    try:
        shifts = int(spec.get('shifts') or 1)
    except (TypeError, ValueError):
        shifts = 1
    if shifts >= 2:
        return 8.0
    return 4.0


def sample_times(lyrics: dict | None, limit: int = 12) -> list[float]:
    """Starts of proved lines, spread across the song. A draft line is not a target.

    The published start is the snapped word, which sits on the attack the proof
    already accepted. Clarity is how strong that attack is on each stem.
    """
    import timing as T

    if not lyrics:
        return []
    times = []
    for sec, line in T.vocal_lines(lyrics):
        if T.group(sec, line) not in ('solo', 'choir'):
            continue
        if 'timing-draft' in (line.get('flags') or []):
            continue
        words = line.get('words') or []
        if not words or words[0].get('s') is None:
            continue
        times.append(float(words[0]['s']))
    if len(times) <= limit:
        return times
    if limit < 1:
        return []
    picked = []
    for i in range(limit):
        picked.append(times[int(round(i * (len(times) - 1) / (limit - 1)))])
    out = []
    for t in picked:
        if not out or abs(t - out[-1]) > 0.05:
            out.append(t)
    return out


def group_clips(times: list[float], duration: float, pad: float = 1.2,
                join_gap: float = 2.0) -> list[tuple[float, float, list[float]]]:
    """Clips that cover the target times. Nearby times share one clip."""
    if not times:
        return []
    ordered = sorted(float(t) for t in times)
    groups: list[list[float]] = [[ordered[0]]]
    for t in ordered[1:]:
        if t - groups[-1][-1] <= join_gap:
            groups[-1].append(t)
        else:
            groups.append([t])
    clips = []
    for group in groups:
        t0 = max(0.0, group[0] - pad)
        t1 = min(float(duration), group[-1] + pad)
        if t1 - t0 < 0.4:
            continue
        clips.append((t0, t1, group))
    return clips


def _combo(curves: dict) -> np.ndarray:
    weight = sum(ONSET_W.values())
    n = min(len(curves[name]) for name in ONSET_W)
    acc = np.zeros(n, dtype=float)
    for name, w in ONSET_W.items():
        acc += w * np.asarray(curves[name][:n], dtype=float)
    return acc / weight


def _window_max(curve: np.ndarray, t: float) -> float | None:
    if t < WINDOW_S or t > (len(curve) * F.HOP) - WINDOW_S:
        return None
    i = int(round(t / F.HOP))
    radius = max(1, int(round(WINDOW_S / F.HOP)))
    a = max(0, i - radius)
    b = min(len(curve), i + radius + 1)
    if b <= a:
        return None
    return float(np.max(curve[a:b]))


def score_vocal(vocal: np.ndarray, rate: int, t0: float, times: list[float]) -> tuple[list[float], list[float]]:
    """Attack strength at each target and at the shifted controls, in clip time.

    A target whose window or whose shifts leave the clip is left out of both lists.
    """
    import torch
    import torchaudio

    if vocal is None or len(vocal) < int(0.4 * rate):
        return [], []
    wave = torch.from_numpy(np.ascontiguousarray(vocal)).float()
    if wave.ndim == 1:
        wave = wave.unsqueeze(0)
    if int(rate) != F.SR:
        wave = torchaudio.functional.resample(wave, int(rate), F.SR)
    y = wave.squeeze(0).numpy().astype(np.float32)
    curve = _combo(F.onset_curves(y))
    at: list[float] = []
    off: list[float] = []
    for t in times:
        rel = float(t) - float(t0)
        here = _window_max(curve, rel)
        if here is None:
            continue
        shifted = []
        outside = False
        for delta in SHIFT_S:
            value = _window_max(curve, rel + delta)
            if value is None:
                outside = True
                break
            shifted.append(value)
        if outside or not shifted:
            continue
        at.append(here)
        off.extend(shifted)
    return at, off


def _summary(at: list[float], off: list[float]) -> dict | None:
    if len(at) < MIN_WORDS or not off:
        return None
    med_at = float(np.median(np.asarray(at, dtype=float)))
    med_off = float(np.median(np.asarray(off, dtype=float)))
    ratio = None if med_off <= 1e-6 else med_at / med_off
    return {
        'n': len(at),
        'med_at': round(med_at, 4),
        'med_off': round(med_off, 4),
        'ratio': None if ratio is None else round(ratio, 4),
    }


def choose(rows: list[dict]) -> dict:
    """Pick the clearest stem. The baseline stays when nobody beats it.

    A win needs a stronger attack at the proved word and a word/shift ratio
    that is not worse. The ingredient stem cannot win: the first pass already
    uses it. Among winners, the stronger attack at the word comes first.
    """
    base = next((row for row in rows if row.get('role') == 'baseline' and row.get('summary')), None)
    if base is None:
        spec = current_spec()
        spec['reason'] = 'база без оценки'
        return spec
    best = base
    reason = 'база'
    bsum = base['summary']
    for row in rows:
        if row is base or row.get('role') in ('ingredient', None) or not row.get('summary'):
            continue
        summary = row['summary']
        if summary.get('ratio') is None or bsum.get('ratio') is None:
            continue
        stronger = float(summary['med_at']) > float(bsum['med_at']) * GAIN
        ratio_ok = float(summary['ratio']) + 1e-9 >= float(bsum['ratio'])
        if not (stronger and ratio_ok):
            continue
        if float(summary['med_at']) > float(best['summary']['med_at']) + 1e-9:
            best = row
            reason = 'атака у слова сильнее, контроль не сильнее'
    spec = {key: best.get(key) for key in (
        'name', 'model', 'shifts', 'overlap', 'ensemble', 'license', 'note', 'role')}
    spec['reason'] = reason
    spec['summary'] = best.get('summary')
    return spec


def _load(name: str):
    import torch
    from demucs.pretrained import get_model

    model = get_model(name)
    model.cpu().eval()
    sources = list(getattr(model, 'sources', []) or [])
    if 'vocals' not in sources:
        raise RuntimeError(f'{name} не отдал дорожку vocals')
    return model, sources.index('vocals'), torch


def separate_spans(mix_44k: np.ndarray, spans: list[tuple[float, float]], rate: int = 44100,
                   budget_s: float = 12 * 60, spec: dict | None = None
                   ) -> tuple[list[np.ndarray | None], dict]:
    """Vocals for each span. A span past the budget is None.

    `spec` selects the model, shifts and overlap. An ensemble averages htdemucs
    and htdemucs_ft. The default matches the clip placer this file replaces
    only after a measurement: htdemucs_ft, one shift, overlap 0.1.
    """
    from demucs.apply import apply_model

    spec = spec or current_spec()
    started = time.monotonic()
    info = {
        'ran': False, 'clips': 0, 'skipped': 0, 'elapsed_s': 0.0, 'budget_s': budget_s,
        'model': spec.get('model'), 'shifts': spec.get('shifts'), 'overlap': spec.get('overlap'),
        'ensemble': bool(spec.get('ensemble')), 'error': None,
    }
    if not spans:
        info['ran'] = True
        return [], info
    try:
        if spec.get('ensemble'):
            vocals, skipped = _ensemble(mix_44k, spans, rate, budget_s, started)
        else:
            model, vocal_i, torch = _load(str(spec.get('model') or 'htdemucs_ft'))
            try:
                vocals, skipped = _apply_spans(
                    model, vocal_i, torch, mix_44k, spans, rate, budget_s, started,
                    int(spec.get('shifts') or 1), float(spec.get('overlap') if spec.get('overlap') is not None else 0.1))
            finally:
                del model
    except Exception as e:
        info['error'] = f'{e.__class__.__name__}: {e}'
        info['elapsed_s'] = round(time.monotonic() - started, 1)
        return [None] * len(spans), info
    done = sum(1 for vocal in vocals if vocal is not None)
    info.update({
        'ran': True, 'clips': done, 'skipped': skipped,
        'elapsed_s': round(time.monotonic() - started, 1),
    })
    return vocals, info


def _apply_spans(model, vocal_i: int, torch, mix: np.ndarray, spans, rate: int,
                 budget_s: float, started: float, shifts: int, overlap: float):
    from demucs.apply import apply_model

    out: list[np.ndarray | None] = []
    skipped = 0
    for t0, t1 in spans:
        if time.monotonic() - started > budget_s:
            out.append(None)
            skipped += 1
            continue
        a = max(0, int(float(t0) * rate))
        b = min(len(mix), int(float(t1) * rate))
        if b - a < int(0.4 * rate):
            out.append(None)
            skipped += 1
            continue
        clip = np.stack([mix[a:b], mix[a:b]])
        tensor = torch.from_numpy(np.ascontiguousarray(clip)).float().unsqueeze(0)
        with torch.inference_mode():
            separated = apply_model(
                model, tensor, device='cpu', split=True, overlap=float(overlap),
                shifts=int(shifts), progress=False)
        vocal = separated[0, vocal_i].mean(dim=0).detach().cpu().numpy().astype(np.float32)
        out.append(vocal)
    return out, skipped


def _ensemble(mix, spans, rate, budget_s, started):
    """Mean of htdemucs and htdemucs_ft on the same clip. Either miss leaves None."""
    half = max(1.0, (budget_s - (time.monotonic() - started)) / 2.0)
    first, info_a = separate_spans(
        mix, spans, rate=rate, budget_s=half,
        spec={'model': 'htdemucs', 'shifts': 1, 'overlap': 0.25, 'ensemble': False})
    if info_a.get('error'):
        raise RuntimeError(info_a['error'])
    second, info_b = separate_spans(
        mix, spans, rate=rate, budget_s=half,
        spec={'model': 'htdemucs_ft', 'shifts': 1, 'overlap': 0.1, 'ensemble': False})
    if info_b.get('error'):
        raise RuntimeError(info_b['error'])
    out = []
    skipped = 0
    for left, right in zip(first, second):
        if left is None or right is None or len(left) != len(right):
            out.append(None)
            skipped += 1
            continue
        out.append(((left.astype(np.float32) + right.astype(np.float32)) * 0.5))
    return out, skipped


def _score_cached(vocals: list[np.ndarray | None], clips, rate: int) -> tuple[list[float], list[float]]:
    at: list[float] = []
    off: list[float] = []
    for vocal, (t0, _t1, times) in zip(vocals, clips):
        if vocal is None:
            continue
        part_at, part_off = score_vocal(vocal, rate, t0, times)
        at.extend(part_at)
        off.extend(part_off)
    return at, off


def measure(mix_44k: np.ndarray, times: list[float], duration: float, rate: int = 44100,
            budget_s: float = MEASURE_BUDGET_S) -> dict:
    """Score the candidates and return the spec placement should use.

    A failure of one candidate is a row with an error. The alignment still gets
    a spec: the baseline, unless a measured row beat it.
    """
    clips = group_clips(times, duration)
    spans = [(t0, t1) for t0, t1, _times in clips]
    started = time.monotonic()
    rows = []
    cached: dict[str, list] = {}
    for cand in CANDIDATES:
        remaining = budget_s - (time.monotonic() - started)
        row = {
            'name': cand['name'], 'role': cand['role'], 'license': cand['license'],
            'note': cand['note'], 'model': cand['model'], 'shifts': cand['shifts'],
            'overlap': cand['overlap'], 'ensemble': False, 'error': None, 'summary': None,
            'elapsed_s': 0.0, 'ran': False,
        }
        if remaining < 30 or not spans:
            row['error'] = 'бюджет' if spans else 'нет слов'
            rows.append(row)
            continue
        vocals, info = separate_spans(mix_44k, spans, rate=rate, budget_s=remaining, spec=cand)
        row['elapsed_s'] = info.get('elapsed_s') or 0.0
        row['ran'] = bool(info.get('ran'))
        row['error'] = info.get('error')
        if info.get('ran') and not info.get('error'):
            cached[cand['name']] = vocals
            at, off = _score_cached(vocals, clips, rate)
            row['summary'] = _summary(at, off)
            if row['summary'] is None:
                row['error'] = row['error'] or f'слов с окном {len(at)}, нужно {MIN_WORDS}'
        rows.append(row)
        print(f"стем {cand['name']}: {row['summary'] or row['error']}", flush=True)
    ensemble = _ensemble_row(cached, clips, rate)
    if ensemble is not None:
        rows.append(ensemble)
        print(f"стем ensemble: {ensemble['summary'] or ensemble['error']}", flush=True)
    spec = choose(rows)
    return {
        'chosen': spec.get('name'),
        'reason': spec.get('reason'),
        'license': spec.get('license'),
        'note': spec.get('note'),
        'spec': spec,
        'words': len(times),
        'clips': len(clips),
        'elapsed_s': round(time.monotonic() - started, 1),
        'budget_s': budget_s,
        'rows': rows,
        'gain': GAIN,
        'shifts_s': list(SHIFT_S),
    }


def _ensemble_row(cached: dict, clips, rate: int) -> dict | None:
    left = cached.get('htdemucs')
    right = cached.get('htdemucs_ft')
    if not left or not right:
        return None
    vocals = []
    for a, b in zip(left, right):
        if a is None or b is None or len(a) != len(b):
            vocals.append(None)
            continue
        vocals.append((a.astype(np.float32) + b.astype(np.float32)) * 0.5)
    at, off = _score_cached(vocals, clips, rate)
    summary = _summary(at, off)
    return {
        'name': 'ensemble-htdemucs-ft',
        'role': 'ensemble',
        'license': 'MIT',
        'note': 'Среднее по сэмплам вокала htdemucs и htdemucs_ft. Обе модели MIT, веса не коммитятся.',
        'model': 'htdemucs+htdemucs_ft',
        'shifts': 1,
        'overlap': 0.1,
        'ensemble': True,
        'error': None if summary else f'слов с окном {len(at)}, нужно {MIN_WORDS}',
        'summary': summary,
        'elapsed_s': 0.0,
        'ran': True,
    }


def render_md(songs: list[dict]) -> str:
    """Russian note of one measurement per song. `songs` are align-report summaries."""
    lines = [
        '# Стем для постановки',
        '',
        'Сравнивается сила атаки в окне ±0,08 с у начала уже доказанного слова. '
        'Контроль — те же окна на ±0,25 с и ±0,40 с. Кандидат заменяет отрезок, '
        'только если атака у слова сильнее хотя бы на 5 % и отношение к контролю не хуже. '
        'Стем песни остаётся htdemucs: полный проход более тяжёлой модели в 150 минут не входит. '
        'Веса не коммитятся.',
        '',
        '| песня | выбрано | почему | слов | клипов | секунды |',
        '|---|---|---|---:|---:|---:|',
    ]
    for song in songs:
        onset = song.get('onset') or {}
        lines.append(
            f"| {song.get('slug')} | {onset.get('chosen') or '—'} | {onset.get('reason') or '—'} | "
            f"{onset.get('words') if onset.get('words') is not None else '—'} | "
            f"{onset.get('clips') if onset.get('clips') is not None else '—'} | "
            f"{onset.get('elapsed_s') if onset.get('elapsed_s') is not None else '—'} |"
        )
    lines.append('')
    lines.append('| песня | кандидат | лицензия | слов | медиана у слова | медиана контроля | отношение | ошибка |')
    lines.append('|---|---|---|---:|---:|---:|---:|---|')
    for song in songs:
        for row in (song.get('onset') or {}).get('rows') or []:
            summary = row.get('summary') or {}
            lines.append(
                f"| {song.get('slug')} | {row.get('name')} | {row.get('license') or '—'} | "
                f"{summary.get('n') if summary else '—'} | "
                f"{summary.get('med_at') if summary else '—'} | "
                f"{summary.get('med_off') if summary else '—'} | "
                f"{summary.get('ratio') if summary else '—'} | {row.get('error') or '—'} |"
            )
    lines.append('')
    return '\n'.join(lines)
