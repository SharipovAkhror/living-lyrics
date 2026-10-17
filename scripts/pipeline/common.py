"""Shared paths and helpers for the onboarding pipeline."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def song_dir(slug: str) -> Path:
    return ROOT / 'content' / 'songs' / slug


def work_dir(slug: str) -> Path:
    d = ROOT / 'work' / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def audio_dir(slug: str) -> Path:
    d = ROOT / 'public' / 'audio' / slug
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path: Path, data) -> None:
    path.write_text(dump_json(data), encoding='utf-8')


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print('$', ' '.join(str(c) for c in cmd))
    return subprocess.run(cmd, check=True, text=True, capture_output=kw.pop('capture', False), **kw)


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', str(path)],
        check=True, text=True, capture_output=True,
    ).stdout
    return json.loads(out)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_audio(path: Path, sr: int = 16000):
    """Mono float32 samples at `sr` Hz, decoded by ffmpeg (any container or codec)."""
    import numpy as np

    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def vocal_stem(slug: str, explicit: str | None = None) -> tuple[Path, bool]:
    """The vocal stem (preferred) or, failing that, the full mix. Returns (path, is_stem)."""
    if explicit:
        return Path(explicit), 'vocals' in Path(explicit).name
    stem = work_dir(slug) / 'stems' / 'vocals.wav'
    if stem.exists():
        return stem, True
    return find_source(slug), False


def dump_json(data) -> str:
    """The repository's JSON style: 2-space indent, UTF-8 as is, trailing newline.
    Content files round-trip byte for byte through json.loads → dump_json."""
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def find_source(slug: str) -> Path:
    cands = sorted(p for p in work_dir(slug).glob('source.*') if p.suffix not in ('.json', '.part'))
    if not cands:
        raise SystemExit(f'No work/{slug}/source.* — run fetch_audio.sh first')
    return cands[0]
