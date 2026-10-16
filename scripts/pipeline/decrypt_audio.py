"""Decrypt a recording into work/<slug>/ (AES-256-GCM: 12-byte IV, 16-byte tag, data; key in AUDIO_KEY).

    AUDIO_KEY=… python3 scripts/pipeline/decrypt_audio.py <slug>
        content/audio-enc/<slug>/high.m4a.enc → work/<slug>/source.m4a
    AUDIO_KEY=… python3 scripts/pipeline/decrypt_audio.py <slug> --inbox content/inbox/<folder>
        a recording from the Telegram inbox → work/<slug>/source.<ext> (plus info.json beside it)
"""
from __future__ import annotations

import json
import os
import shutil
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from common import ROOT, work_dir


def decrypt(blob: bytes) -> bytes:
    key = bytes.fromhex(os.environ['AUDIO_KEY'])
    iv, tag, ct = blob[:12], blob[12:28], blob[28:]
    return AESGCM(key).decrypt(iv, ct + tag, None)


def main(slug: str, inbox: str | None = None) -> None:
    if inbox:
        folder = ROOT / inbox
        info = json.loads((folder / 'info.json').read_text(encoding='utf-8'))
        if not info.get('file'):
            raise SystemExit(f'{inbox}: only a link, no recording — ask the user for the file')
        src = folder / info['file']
        ext = info['file'].removeprefix('source.').removesuffix('.enc')
        out = work_dir(slug) / f'source.{ext}'
        shutil.copy(folder / 'info.json', work_dir(slug) / 'inbox-info.json')
    else:
        src = ROOT / 'content' / 'audio-enc' / slug / 'high.m4a.enc'
        out = work_dir(slug) / 'source.m4a'
    data = decrypt(src.read_bytes())
    out.write_bytes(data)
    print(f'{out} {len(data) // 1024} KB')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not a:
        raise SystemExit(__doc__)
    main(a[0], sys.argv[sys.argv.index('--inbox') + 1] if '--inbox' in sys.argv else None)
