"""Decrypt content/audio-enc/<slug>/high.m4a.enc into work/<slug>/source.m4a (AES-256-GCM, key in AUDIO_KEY).

    AUDIO_KEY=… python3 scripts/pipeline/decrypt_audio.py <slug>
"""
from __future__ import annotations

import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from common import ROOT, work_dir


def main(slug: str) -> None:
    key = bytes.fromhex(os.environ['AUDIO_KEY'])
    blob = (ROOT / 'content' / 'audio-enc' / slug / 'high.m4a.enc').read_bytes()
    iv, tag, ct = blob[:12], blob[12:28], blob[28:]
    data = AESGCM(key).decrypt(iv, ct + tag, None)
    out = work_dir(slug) / 'source.m4a'
    out.write_bytes(data)
    print(f'{out} {len(data) // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1])
