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
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


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


def find_source(slug: str) -> Path:
    cands = sorted(p for p in work_dir(slug).glob('source.*') if p.suffix not in ('.json', '.part'))
    if not cands:
        raise SystemExit(f'No work/{slug}/source.* — run fetch_audio.sh first')
    return cands[0]
