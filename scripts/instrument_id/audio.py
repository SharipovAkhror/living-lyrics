"""Load audio through the ffmpeg binary shipped with imageio-ffmpeg.

The machine has no ffmpeg on PATH. Decoding goes to a float32 mono stream at the
encoder sample rate so m4a and wav take the same path.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import numpy as np

_DURATION = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe_duration(path: Path) -> float:
    proc = subprocess.run(
        [ffmpeg_exe(), "-hide_banner", "-i", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    match = _DURATION.search(proc.stderr or "")
    if not match:
        raise RuntimeError(f"ffmpeg не назвал длительность: {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def load_mono(path: Path, sample_rate: int) -> np.ndarray:
    """Decode the whole file to mono float32 at sample_rate."""
    proc = subprocess.run(
        [
            ffmpeg_exe(), "-v", "error", "-i", str(path),
            "-f", "f32le", "-ac", "1", "-ar", str(sample_rate), "pipe:1",
        ],
        capture_output=True, check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-500:]
        raise RuntimeError(f"ffmpeg не открыл {path}: {err}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if audio.size == 0:
        raise RuntimeError(f"пустой звук: {path}")
    return audio


def window(audio: np.ndarray, sample_rate: int, start_sec: float, length_sec: float) -> np.ndarray:
    """Slice [start, start+length). Missing edges are zeros, so a short note still has one window."""
    n = int(round(length_sec * sample_rate))
    start = int(round(start_sec * sample_rate))
    out = np.zeros(n, dtype=np.float32)
    if start >= audio.size or start + n <= 0:
        return out
    src_lo = max(0, start)
    src_hi = min(audio.size, start + n)
    dst_lo = src_lo - start
    out[dst_lo:dst_lo + (src_hi - src_lo)] = audio[src_lo:src_hi]
    return out


def center_window(audio: np.ndarray, sample_rate: int, length_sec: float) -> np.ndarray:
    n = int(round(length_sec * sample_rate))
    if audio.size <= n:
        return window(audio, sample_rate, 0.0, length_sec)
    start = (audio.size - n) // 2
    return np.asarray(audio[start:start + n], dtype=np.float32)
