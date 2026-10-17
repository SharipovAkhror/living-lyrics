"""Two jobs share this module.

Vocal curves for align.py and qa_sync.py (do not remove: those files import them, and the
alignment work must keep working). Sampled every HOP seconds (10 ms) from mono 16 kHz audio:
  rms_db       loudness of the voice, dB
  activity     True where someone is singing (adaptive threshold, short holes closed)
  onset_curves where something begins: spectral flux in the vowel band (notes, syllables), flux in
               the consonant band 3–8 kHz (s, t, k, sh…), and the rise of the level after a dip

Animation features for the scene (AudioFeatures in src/instruments/animation.ts):

    python3 features.py <slug>

writes public/audio/<slug>/features.json from the full mix and the four htdemucs stems.
librosa (ISC) supplies loudness, onset strength and spectral centroid. beat_this (MIT, no DBN)
supplies beat times; librosa's beat tracker is the fallback. Nothing here is tuned to one recording.
"""
from __future__ import annotations

import json
import sys

import numpy as np

SR = 16000
HOP = 0.01
HOP_N = int(SR * HOP)


def frames(x: np.ndarray, win: int, hop: int = HOP_N) -> np.ndarray:
    """Overlapping frames (n, win) centred on k*hop; the signal is zero-padded at both ends."""
    pad = np.pad(x, (win // 2, win // 2))
    n = 1 + (len(pad) - win) // hop
    return np.lib.stride_tricks.as_strided(pad, shape=(n, win), strides=(pad.strides[0] * hop, pad.strides[0]))


def rms_db(x: np.ndarray, win_s: float = 0.04) -> np.ndarray:
    f = frames(x, int(SR * win_s))
    return 20 * np.log10(np.sqrt((f.astype(np.float64) ** 2).mean(axis=1)) + 1e-9)


def fill_runs(mask: np.ndarray, value: bool, max_len: int) -> np.ndarray:
    """Flip runs of `value` shorter than max_len frames that are surrounded by the other value."""
    m = mask.copy()
    n = len(m)
    i = 0
    while i < n:
        if m[i] == value:
            j = i
            while j < n and m[j] == value:
                j += 1
            if j - i < max_len and i > 0 and j < n:
                m[i:j] = not value
            i = j
        else:
            i += 1
    return m


def activity(db: np.ndarray, hole: float = 0.3, blip: float = 0.12) -> tuple[np.ndarray, float]:
    """Voice present / absent per frame and the threshold used (dB).

    The threshold sits between the stem's noise floor and its typical singing level, but never more
    than 35 dB under the loud level (Demucs leaves faint instrument bleed in quiet parts)."""
    floor, loud = np.percentile(db, 10), np.percentile(db, 97)
    thr = max(floor + 0.4 * (loud - floor), loud - 35.0)
    act = db > thr
    act = fill_runs(act, False, int(hole / HOP))  # breaths and consonants inside a phrase
    act = fill_runs(act, True, int(blip / HOP))   # clicks and bleed
    return act, float(thr)


def _norm(o: np.ndarray, detrend: float = 0.5) -> np.ndarray:
    """Remove the slowly varying part, keep positive jumps, scale so the 95th percentile is 1."""
    k = int(detrend / HOP) | 1
    base = np.convolve(o, np.ones(k) / k, mode='same')
    o = np.maximum(o - base, 0)
    pos = o[o > 0]
    scale = np.percentile(pos, 95) if len(pos) else 1.0
    return np.clip(o / (scale + 1e-9), 0, 2)


def onset_curves(x: np.ndarray, db: np.ndarray | None = None) -> dict[str, np.ndarray]:
    """Three onset curves, each ~0..2 (1 = a strong onset for this recording)."""
    n_fft = 1024
    win = np.hanning(n_fft).astype(np.float32)
    bands = {'mid': (100.0, 3000.0), 'hf': (3000.0, 8000.0)}
    idx = {k: (int(a * n_fft / SR), int(b * n_fft / SR) + 1) for k, (a, b) in bands.items()}
    f = frames(x.astype(np.float32), n_fft)
    flux = {k: np.zeros(len(f)) for k in bands}
    prev = None
    for a in range(0, len(f), 4096):
        logm = np.log1p(100.0 * np.abs(np.fft.rfft(f[a:a + 4096] * win, axis=1)))
        both = np.vstack([logm[:1] if prev is None else prev[None, :], logm])
        d = np.maximum(np.diff(both, axis=0), 0)
        for k, (lo, hi) in idx.items():
            flux[k][a:a + len(logm)] = d[:, lo:hi].sum(axis=1)
        prev = logm[-1]
    if db is None:
        db = rms_db(x)
    n = min(len(db), len(f))
    sm = np.convolve(db[:n], np.ones(3) / 3, mode='same')
    rise = np.maximum(np.diff(sm, prepend=sm[0]), 0)
    return {'mid': _norm(flux['mid'][:n]), 'hf': _norm(flux['hf'][:n]), 'rise': _norm(rise)}


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) frame ranges where mask is True."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


# --- Animation features (public/audio/<slug>/features.json) -------------------------
#
# driveAt() reads 0…1 tracks and, optionally, beat times. sustain and breath are not stored:
# the contract derives them from these tracks (FAMILY_DRIVE). A quiet stem must stay quiet,
# so every loudness track is scaled to the mix, not to itself.

FEATURE_RATE = 20  # Hz. Contract allows 20–50; 20 matches peaks.json and keeps the file small.
FEATURE_SR = 16000
DB_RANGE = 40.0  # 0 is this many dB under the mix's loud level; the loud level itself is 1.
TRACK_ORDER = ('loud', 'onset', 'bright', 'drums', 'bass', 'other', 'vocals')
# Compact JSON, two decimal places. One decimal if the file would pass 900 KB.
SIZE_BUDGET = 900_000
BEAT_CHECKPOINT = 'final0'


def perceptual_01(rms: np.ndarray, ref_rms: float) -> np.ndarray:
    """Map linear RMS onto 0…1 against one reference level (a high percentile of the mix).

    The scale is logarithmic: `ref_rms` is 1, and a frame `DB_RANGE` dB quieter is 0.
    Scaling a stem to its own peak would turn bleed in a silent stem into a full envelope.
    """
    rms = np.asarray(rms, dtype=np.float64)
    ref = float(ref_rms)
    if not np.isfinite(ref) or ref < 1e-8:
        return np.zeros_like(rms)
    ref_db = 20.0 * np.log10(ref)
    db = 20.0 * np.log10(np.maximum(rms, 1e-8))
    return np.clip((db - (ref_db - DB_RANGE)) / DB_RANGE, 0.0, 1.0)


def _resample(values: np.ndarray, n: int) -> np.ndarray:
    values = np.nan_to_num(np.asarray(values, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    if n <= 0:
        return np.zeros(0)
    if len(values) == 0:
        return np.zeros(n)
    if len(values) == n:
        return values
    src = np.linspace(0.0, 1.0, len(values))
    dst = np.linspace(0.0, 1.0, n)
    return np.interp(dst, src, values)


def _quantize(values: np.ndarray, places: int) -> np.ndarray:
    scale = 10 ** places
    return np.clip(np.rint(np.asarray(values, dtype=np.float64) * scale) / scale, 0.0, 1.0)


def _fmt(value: float, places: int) -> str:
    if places <= 0:
        return str(int(round(value)))
    text = f'{value:.{places}f}'.rstrip('0').rstrip('.')
    return text or '0'


def _dumps(rate: int, duration: float, tracks: dict[str, np.ndarray], beats: list[float] | None, places: int) -> str:
    body = ','.join(
        f'"{name}":[{",".join(_fmt(float(v), places) for v in tracks[name])}]' for name in TRACK_ORDER
    )
    beats_part = ''
    if beats:
        beats_part = ',"beats":[' + ','.join(_fmt(t, 3) for t in beats) + ']'
    return f'{{"rate":{rate},"duration":{_fmt(duration, 3)},"tracks":{{{body}}}{beats_part}}}'


def stable_beats(times, duration: float) -> list[float] | None:
    """Beat times worth swaying to. Free rhythm and a tracker that found no pulse return None.

    A beat is kept when the gaps around it sit near their local median and inside 40–240 bpm.
    The list is dropped when fewer than half the tracker's beats survive, or fewer than eight:
    a handful of accidental peaks should not drive the drawing.
    """
    raw = []
    for t in np.asarray(times, dtype=np.float64).reshape(-1):
        if np.isfinite(t) and 0.0 <= float(t) <= duration + 0.05:
            raw.append(float(t))
    raw.sort()
    deduped: list[float] = []
    for t in raw:
        if not deduped or t - deduped[-1] > 1e-3:
            deduped.append(t)
    if len(deduped) < 8:
        return None
    ibi = np.diff(deduped)
    keep = [True] * len(deduped)
    for i, gap in enumerate(ibi):
        window = ibi[max(0, i - 4):min(len(ibi), i + 5)]
        med = float(np.median(window))
        if med < 0.25 or med > 1.5 or abs(float(gap) - med) > 0.35 * med:
            keep[i] = False
            keep[i + 1] = False
    kept = [round(t, 3) for t, ok in zip(deduped, keep) if ok]
    collapsed: list[float] = []
    for t in kept:
        if not collapsed or t > collapsed[-1]:
            collapsed.append(t)
    if len(collapsed) < 8 or len(collapsed) * 2 < len(deduped):
        return None
    return collapsed


def _track_beats(path, samples: np.ndarray, sr: int, duration: float) -> tuple[list[float] | None, str]:
    """beat_this without the madmom DBN. librosa's tracker is only the fallback.

    Audio2Beats takes samples. File2Beats opens the path with torchaudio, which does not
    read the decrypted m4a on the runner.
    """
    del path  # the decoded samples are the source of truth; the path is only for callers
    try:
        from beat_this.inference import Audio2Beats

        signal = np.asarray(samples, dtype=np.float32)
        beats, _downbeats = Audio2Beats(checkpoint_path=BEAT_CHECKPOINT, device='cpu', dbn=False)(signal, sr)
        kept = stable_beats(beats, duration)
        return kept, f'beat_this:{BEAT_CHECKPOINT}' + (f':{len(kept)}' if kept else ':no-pulse')
    except Exception as exc:  # noqa: BLE001 — a missing weight file must not drop the envelopes
        print(f'beat_this не сработал ({exc}); запасной трекер librosa')
    try:
        import librosa

        _tempo, beat_times = librosa.beat.beat_track(y=samples, sr=sr, units='time')
        kept = stable_beats(beat_times, duration)
        return kept, 'librosa' + (f':{len(kept)}' if kept else ':no-pulse')
    except Exception as exc:  # noqa: BLE001
        print(f'librosa beat tracker не сработал ({exc}); доли не записаны')
        return None, 'none'


def _curves(mix: np.ndarray, stems: dict[str, np.ndarray], sr: int, n: int) -> dict[str, np.ndarray]:
    """librosa envelopes, then one per-song scale. See perceptual_01."""
    import librosa

    hop = sr // FEATURE_RATE
    mix_rms = librosa.feature.rms(y=mix, frame_length=2048, hop_length=hop, center=True)[0]
    ref = float(np.percentile(mix_rms, 95))
    onset = librosa.onset.onset_strength(y=mix, sr=sr, hop_length=hop, center=True)
    onset_scale = float(np.percentile(onset, 95)) if len(onset) else 1.0
    if onset_scale < 1e-8:
        onset_scale = 1.0
    centroid = librosa.feature.spectral_centroid(y=mix, sr=sr, n_fft=2048, hop_length=hop, center=True)[0]
    bright = _resample(centroid, n)
    lo, hi = np.percentile(bright, [5, 95])
    if float(hi - lo) < 50.0:  # almost no brightness change: an absolute scale, still 0…1
        bright_01 = np.clip(bright / (sr / 4.0), 0.0, 1.0)
    else:
        bright_01 = np.clip((bright - lo) / (hi - lo), 0.0, 1.0)
    tracks = {
        'loud': _resample(perceptual_01(mix_rms, ref), n),
        'onset': _resample(np.clip(onset / onset_scale, 0.0, 1.0), n),
        'bright': bright_01,
    }
    for name in ('drums', 'bass', 'other', 'vocals'):
        rms = librosa.feature.rms(y=stems[name], frame_length=2048, hop_length=hop, center=True)[0]
        tracks[name] = _resample(perceptual_01(rms, ref), n)
    return tracks


def _fit_length(samples: np.ndarray, n: int) -> np.ndarray:
    if len(samples) == n:
        return samples
    if len(samples) > n:
        return samples[:n]
    return np.pad(samples, (0, n - len(samples)))


def write_features(slug: str):
    """Read work/<slug>/source.* and stems, write public/audio/<slug>/features.json."""
    from common import audio_dir, find_source, load_audio, work_dir

    mix_path = find_source(slug)
    mix = load_audio(mix_path, FEATURE_SR)
    stems = {}
    stem_dir = work_dir(slug) / 'stems'
    for name in ('drums', 'bass', 'other', 'vocals'):
        path = stem_dir / f'{name}.wav'
        if not path.is_file():
            raise SystemExit(f'нет стема {path} — сначала separate (htdemucs, четыре стема)')
        stems[name] = _fit_length(load_audio(path, FEATURE_SR), len(mix))
    duration = len(mix) / FEATURE_SR
    n = max(1, int(round(duration * FEATURE_RATE)))
    tracks = _curves(mix, stems, FEATURE_SR, n)
    beats, beat_note = _track_beats(mix_path, mix, FEATURE_SR, duration)
    places = 2
    text = _dumps(FEATURE_RATE, duration, {k: _quantize(tracks[k], places) for k in TRACK_ORDER}, beats, places)
    if len(text.encode('utf-8')) > SIZE_BUDGET:
        places = 1
        text = _dumps(FEATURE_RATE, duration, {k: _quantize(tracks[k], places) for k in TRACK_ORDER}, beats, places)
    out = audio_dir(slug) / 'features.json'
    out.write_text(text, encoding='utf-8')
    size = out.stat().st_size
    print(f'FEATURES {slug} duration={duration:.3f} rate={FEATURE_RATE} places={places} '
          f'bytes={size} beats={beat_note} → {out}')
    if size > 1_500_000:
        raise SystemExit(f'features.json весит {size} байт — это больше бюджета')
    return out


def _self_test() -> None:
    ref = 0.1
    loud = perceptual_01(np.array([ref]), ref)
    mid = perceptual_01(np.array([ref * 10 ** (-20 / 20)]), ref)
    quiet = perceptual_01(np.array([ref * 10 ** (-DB_RANGE / 20)]), ref)
    assert loud[0] > 0.99, loud
    assert 0.45 < mid[0] < 0.55, mid
    assert quiet[0] < 0.02, quiet
    assert perceptual_01(np.array([1.0]), 0.0)[0] == 0.0
    pulse = stable_beats([i * 0.5 for i in range(40)], 20)
    assert pulse and abs(pulse[1] - pulse[0] - 0.5) < 1e-6, pulse
    assert stable_beats([0, 0.3, 1.7, 1.9, 4.4, 4.5, 8.0, 8.2], 9) is None
    assert stable_beats([0.5, 1.0], 10) is None
    duration = 977.05
    n = max(1, int(round(duration * FEATURE_RATE)))
    rng = np.random.default_rng(0)
    tracks = {name: _quantize(rng.random(n), 2) for name in TRACK_ORDER}
    text = _dumps(FEATURE_RATE, duration, tracks, [0.5, 1.0, 1.5], 2)
    data = json.loads(text)
    assert data['rate'] == FEATURE_RATE
    assert set(data['tracks']) == set(TRACK_ORDER)
    assert all(len(data['tracks'][name]) == n for name in TRACK_ORDER)
    assert all(0.0 <= v <= 1.0 for name in TRACK_ORDER for v in data['tracks'][name])
    assert len(text.encode('utf-8')) < SIZE_BUDGET, len(text)
    no_beats = json.loads(_dumps(FEATURE_RATE, 1.0, {name: np.zeros(20) for name in TRACK_ORDER}, None, 2))
    assert 'beats' not in no_beats
    print('features self-test ok')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        _self_test()
    elif len(sys.argv) == 2 and not sys.argv[1].startswith('-'):
        write_features(sys.argv[1])
    else:
        raise SystemExit(__doc__)
