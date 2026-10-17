"""Keep the Demucs vocal stem between CI runs without exposing the audio.

    AUDIO_KEY=… python3 scripts/pipeline/stem_cache.py pack <slug> <dir>
        work/<slug>/stems/vocals.wav → <dir>/<slug>-<recording id>.vocals.flac.enc
    AUDIO_KEY=… python3 scripts/pipeline/stem_cache.py unpack <slug> <dir>
        the reverse, when a cached stem of the same recording exists

The stem is compressed to FLAC and encrypted with AUDIO_KEY (AES-256-GCM, the content/audio-enc
format), so a cache of a public repository holds nothing listenable. The recording id is a hash of
content/audio-enc/<slug>/high.m4a.enc: a new recording never meets an old stem.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from common import ROOT, sha256, work_dir


def model_name() -> str:
    return re.sub(r'[^A-Za-z0-9_.-]', '_', os.environ.get('SEPARATOR_MODEL') or 'htdemucs')


def cache_file(slug: str, folder: Path) -> Path:
    rid = sha256(ROOT / 'content' / 'audio-enc' / slug / 'high.m4a.enc')[:12]
    return folder / f'{slug}-{rid}-{model_name()}.vocals.flac.enc'


def key() -> AESGCM:
    return AESGCM(bytes.fromhex(os.environ['AUDIO_KEY']))


def pack(slug: str, folder: Path) -> None:
    wav = work_dir(slug) / 'stems' / 'vocals.wav'
    if not wav.exists():
        print(f'{slug}: стема нет — нечего сохранять')
        return
    made_by = work_dir(slug) / 'stems' / 'model.txt'
    if made_by.exists() and made_by.read_text().strip() != (os.environ.get('SEPARATOR_MODEL') or 'htdemucs'):
        print(f'{slug}: стем сделан другой моделью — в кэш не кладу')
        return
    flac = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(wav), '-c:a', 'flac', '-f', 'flac', '-'],
                          check=True, capture_output=True).stdout
    iv = os.urandom(12)
    sealed = key().encrypt(iv, flac, None)  # ciphertext + 16-byte tag
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f'{slug}-*.vocals.flac.enc'):
        old.unlink()
    out = cache_file(slug, folder)
    out.write_bytes(iv + sealed[-16:] + sealed[:-16])
    print(f'{slug}: стем сохранён в кэш ({len(flac) // 1024} KB)')


def unpack(slug: str, folder: Path) -> None:
    src = cache_file(slug, folder)
    wav = work_dir(slug) / 'stems' / 'vocals.wav'
    if wav.exists():
        print(f'{slug}: стем уже на месте')
        return
    if not src.exists():
        print(f'{slug}: в кэше стема нет — Demucs посчитает заново')
        return
    blob = src.read_bytes()
    flac = key().decrypt(blob[:12], blob[28:] + blob[12:28], None)
    wav.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'flac', '-i', '-', str(wav)], input=flac, check=True)
    (wav.parent / 'model.txt').write_text((os.environ.get('SEPARATOR_MODEL') or 'htdemucs') + '\n', encoding='utf-8')
    print(f'{slug}: стем восстановлен из кэша')


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('pack', 'unpack'):
        raise SystemExit(__doc__)
    (pack if sys.argv[1] == 'pack' else unpack)(sys.argv[2], Path(sys.argv[3]))
