"""Language-independent features of a vocal recording, shared by align.py and qa_sync.py.

All curves are sampled every HOP seconds (10 ms) from mono 16 kHz audio:
  rms_db       loudness of the voice, dB
  activity     True where someone is singing (adaptive threshold, short holes closed)
  onset_curves where something begins: spectral flux in the vowel band (notes, syllables), flux in
               the consonant band 3–8 kHz (s, t, k, sh…), and the rise of the level after a dip
"""
from __future__ import annotations

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
