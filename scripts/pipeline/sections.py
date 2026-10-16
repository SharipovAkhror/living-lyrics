"""Stage 3: suggest vocal / instrumental sections from the vocal stem's energy.

    python3 scripts/pipeline/sections.py <slug> [--gap 4.0]

Writes work/<slug>/sections.suggested.json. A stretch without voice longer than --gap seconds
becomes an instrumental section. This is a draft: listen and adjust.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import soundfile as sf

from common import work_dir

HOP = 0.05  # seconds


def main(slug: str, gap: float = 4.0) -> None:
    path = work_dir(slug) / 'stems' / 'vocals.wav'
    x, sr = sf.read(path, always_2d=True)
    x = x.mean(axis=1)
    hop = int(sr * HOP)
    n = len(x) // hop
    rms = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    db = 20 * np.log10(rms + 1e-9)
    # Adaptive threshold: halfway between the noise floor and typical singing level.
    floor, loud = np.percentile(db, 15), np.percentile(db, 90)
    voiced = db > floor + (loud - floor) * 0.45
    # Close short holes (breaths, consonants) of < 0.6 s.
    k = int(0.6 / HOP)
    v = voiced.copy()
    i = 0
    while i < n:
        if not v[i]:
            j = i
            while j < n and not v[j]:
                j += 1
            if j - i < k and i > 0 and j < n:
                v[i:j] = True
            i = j
        else:
            i += 1
    sections = []
    i = 0
    while i < n:
        j = i
        while j < n and v[j] == v[i]:
            j += 1
        start, end = round(i * HOP, 2), round(j * HOP, 2)
        kind = 'vocal' if v[i] else 'instrumental'
        if kind == 'instrumental' and end - start < gap and sections:
            sections[-1]['end'] = end  # short pause stays inside the vocal section
        elif sections and sections[-1]['kind'] == kind:
            sections[-1]['end'] = end
        else:
            sections.append({'kind': kind, 'start': start, 'end': end})
        i = j
    out = work_dir(slug) / 'sections.suggested.json'
    out.write_text(json.dumps(sections, indent=2), encoding='utf-8')
    for s in sections:
        print(f"{s['kind']:<13} {s['start']:7.2f} – {s['end']:7.2f}  ({s['end'] - s['start']:5.1f} s)")
    print(f'→ {out}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    g = float(sys.argv[sys.argv.index('--gap') + 1]) if '--gap' in sys.argv else 4.0
    main(args[0], g)
