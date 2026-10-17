"""Keep the four Demucs stems between CI runs without exposing the audio.

    AUDIO_KEY=… python3 scripts/pipeline/stem_cache.py pack <slug> <dir>
        work/<slug>/stems/{vocals,drums,bass,other}.wav → encrypted FLAC in <dir>
    AUDIO_KEY=… python3 scripts/pipeline/stem_cache.py unpack <slug> <dir>
        the reverse, only when all four cached stems of the same recording exist

Each stem is compressed to FLAC and encrypted with AUDIO_KEY (AES-256-GCM, the content/audio-enc
format), so a cache of a public repository holds nothing listenable. The recording id is a hash of
content/audio-enc/<slug>/high.m4a.enc: a new recording never meets an old stem. The file name
carries a 4-stem marker, so a vocals-only cache from an earlier run is a miss and Demucs runs again.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from common import ROOT, sha256, work_dir

STEMS = ('vocals', 'drums', 'bass', 'other')


def model_name() -> str:
    return re.sub(r'[^A-Za-z0-9_.-]', '_', os.environ.get('SEPARATOR_MODEL') or 'htdemucs')


def cache_file(slug: str, folder: Path, stem: str) -> Path:
    rid = sha256(ROOT / 'content' / 'audio-enc' / slug / 'high.m4a.enc')[:12]
    return folder / f'{slug}-{rid}-{model_name()}-4.{stem}.flac.enc'


def key() -> AESGCM:
    return AESGCM(bytes.fromhex(os.environ['AUDIO_KEY']))


def _flac(wav: Path) -> bytes:
    return subprocess.run(['ffmpeg', '-v', 'error', '-i', str(wav), '-c:a', 'flac', '-f', 'flac', '-'],
                          check=True, capture_output=True).stdout


def _wav(flac: bytes, wav: Path) -> None:
    wav.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'flac', '-i', '-', str(wav)], input=flac, check=True)


def pack(slug: str, folder: Path) -> None:
    stems = work_dir(slug) / 'stems'
    missing = [name for name in STEMS if not (stems / f'{name}.wav').exists()]
    if missing:
        print(f'{slug}: неполный набор стемов ({", ".join(missing)}) — в кэш не кладу')
        return
    made_by = stems / 'model.txt'
    if made_by.exists() and made_by.read_text().strip() != (os.environ.get('SEPARATOR_MODEL') or 'htdemucs'):
        print(f'{slug}: стемы сделаны другой моделью — в кэш не кладу')
        return
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f'{slug}-*.flac.enc'):
        old.unlink()
    total = 0
    for name in STEMS:
        flac = _flac(stems / f'{name}.wav')
        total += len(flac)
        iv = os.urandom(12)
        sealed = key().encrypt(iv, flac, None)  # ciphertext + 16-byte tag
        cache_file(slug, folder, name).write_bytes(iv + sealed[-16:] + sealed[:-16])
    print(f'{slug}: четыре стема сохранены в кэш ({total // 1024} KB)')


def unpack(slug: str, folder: Path) -> None:
    stems = work_dir(slug) / 'stems'
    if all((stems / f'{name}.wav').exists() for name in STEMS):
        print(f'{slug}: четыре стема уже на месте')
        return
    srcs = [cache_file(slug, folder, name) for name in STEMS]
    if not all(src.exists() for src in srcs):
        print(f'{slug}: в кэше нет всех четырёх стемов — Demucs посчитает заново')
        return
    for name, src in zip(STEMS, srcs):
        blob = src.read_bytes()
        flac = key().decrypt(blob[:12], blob[28:] + blob[12:28], None)
        _wav(flac, stems / f'{name}.wav')
    (stems / 'model.txt').write_text((os.environ.get('SEPARATOR_MODEL') or 'htdemucs') + '\n', encoding='utf-8')
    print(f'{slug}: четыре стема восстановлены из кэша')


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('pack', 'unpack'):
        raise SystemExit(__doc__)
    (pack if sys.argv[1] == 'pack' else unpack)(sys.argv[2], Path(sys.argv[3]))
