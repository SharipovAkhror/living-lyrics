"""Cheap check of on-screen captions: save one frame per change, with its time.

    python3 scripts/pipeline/lyric_frames.py <slug> [--video path] [--band 0.62] [--threshold 0.06]

Many official videos show the original text and a translation on screen. The moment each caption
appears is a first guess for when the line starts. The script watches the lower part of the picture
(from --band of the height down), keeps a frame whenever that part changes (ffmpeg scene score
above --threshold), and writes work/<slug>/lyric-frames/<seconds>.jpg plus index.json.

Any video file is enough. The default is work/<slug>/video.* (the file the route downloaded).
Pass --video for a file under another name. The frames are not committed. This script does not
read letters: the agent looks at the images, and Gemini copies the text with read-captions.md.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from common import work_dir


VIDEO_EXTS = {'.mp4', '.mkv', '.webm', '.mov', '.m4v'}


def find_video(slug: str, explicit: Path | None) -> Path | None:
    """A video.* download, or any video file in the song's work folder, or --video."""
    if explicit is not None:
        return explicit if explicit.is_file() else None
    folder = work_dir(slug)
    named = [path for path in sorted(folder.glob('video.*')) if path.is_file() and path.suffix.lower() != '.json']
    if named:
        return named[0]
    others = [path for path in sorted(folder.iterdir()) if path.is_file() and path.suffix.lower() in VIDEO_EXTS]
    return others[0] if others else None


def main(slug: str, video: Path | None, band: float, threshold: float) -> None:
    video = find_video(slug, video)
    if video is None:
        raise SystemExit(
            'No video file. Use work/<slug>/video.* from the route download, '
            'or pass --video <file>. Any video file is enough.'
        )
    out = work_dir(slug) / 'lyric-frames'
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('*.jpg'):
        old.unlink()
    # Scene score is computed on the caption band only; the full frame is saved for reading.
    flt = f"crop=iw:ih*{1 - band:.3f}:0:ih*{band:.3f},scale=480:-2,select='eq(n,0)+gt(scene,{threshold})',showinfo"
    # Two passes keep it simple: first find the change times, then grab full frames at those times.
    probe = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', str(video), '-vf', flt, '-f', 'null', '-'],
        capture_output=True, text=True,
    )
    times = [float(m) for m in re.findall(r'pts_time:([0-9.]+)', probe.stderr)]
    if not times:
        raise SystemExit('ffmpeg found no frames; check the file.\n' + probe.stderr[-800:])
    index = []
    for t in times:
        name = f'{t:07.2f}.jpg'
        subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', f'{t + 0.4:.2f}', '-i', str(video), '-frames:v', '1', '-q:v', '3', '-y', str(out / name)],
            check=True,
        )
        index.append({'t': round(t, 2), 'frame': name})
    (out / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
    print(f'{len(index)} caption frames → {out}')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not a:
        raise SystemExit(__doc__)
    opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d  # noqa: E731
    v = opt('--video', None)
    main(a[0], Path(v) if v else None, float(opt('--band', 0.62)), float(opt('--threshold', 0.06)))
