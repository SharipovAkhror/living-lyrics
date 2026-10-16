"""Stage 3: grab video frames from the middle of each instrumental section, to identify instruments.

    python3 scripts/pipeline/frames.py <slug> [--every 6]

Reads sections from content/songs/<slug>/lyrics.json (or work/<slug>/sections.suggested.json)
and writes work/<slug>/frames/<section>-<second>.jpg.
"""
from __future__ import annotations

import sys

from common import load_json, run, song_dir, work_dir


def main(slug: str, every: float = 6.0) -> None:
    video = next(iter(sorted(work_dir(slug).glob('video.*'))), None)
    if not video:
        raise SystemExit('No work/<slug>/video.* — the source had no video. Identify instruments by ear and from the release notes.')
    lyr = song_dir(slug) / 'lyrics.json'
    if lyr.exists():
        secs = [(s['id'], s['start'], s['end']) for s in load_json(lyr)['sections'] if s['kind'] == 'instrumental']
    else:
        secs = [(f'i{k}', s['start'], s['end']) for k, s in enumerate(load_json(work_dir(slug) / 'sections.suggested.json')) if s['kind'] == 'instrumental']
    out = work_dir(slug) / 'frames'
    out.mkdir(exist_ok=True)
    for sid, a, b in secs:
        t = a + 1.5
        while t < b - 1:
            run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', str(video), '-frames:v', '1', '-q:v', '3', str(out / f'{sid}-{int(t):04d}.jpg')])
            t += every
    print(f'frames → {out}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    ev = float(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 6.0
    main(args[0], ev)
