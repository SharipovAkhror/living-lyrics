"""Cheap check of on-screen captions: save one frame per change, with its time.

    python3 scripts/pipeline/lyric_frames.py <slug> [--video path] [--band 0.62] [--threshold 0.06]
    python3 scripts/pipeline/lyric_frames.py <slug> --mode ink --crop 180:60:230:155

Many official videos show the original text and a translation on screen. The moment each caption
appears is a first guess for when the line starts. The default watches the lower part of the
picture (from --band of the height down) and keeps a frame whenever ffmpeg's scene score there
rises above --threshold. It writes work/<slug>/lyric-frames/<seconds>.jpg plus index.json.

Some lyric videos put the words in the middle, over a moving pattern. A bottom band then misses
the letters, and the scene score of a wide band follows the pattern instead of the text. --crop
W:H:X:Y limits the watch to a rectangle. --mode ink counts pixels in that rectangle brighter
than the dark field and marks the frame where that count rises and holds: one appearance, at
the video's frame rate.

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


def parse_crop(text: str) -> tuple[int, int, int, int]:
    """W:H:X:Y of the text rectangle. Width and height are at least 1."""
    parts = text.split(':')
    if len(parts) != 4:
        raise SystemExit('--crop is W:H:X:Y')
    try:
        w, h, x, y = (int(p) for p in parts)
    except ValueError as e:
        raise SystemExit(f'--crop is W:H:X:Y ({e})') from e
    if w < 1 or h < 1 or x < 0 or y < 0:
        raise SystemExit('--crop needs a positive size and a non-negative origin')
    return w, h, x, y


def video_fps(video: Path) -> float:
    """Frames per second from ffmpeg's probe line. The scene clock is this rate."""
    probe = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', str(video)],
        capture_output=True, text=True,
    )
    match = re.search(r'(\d+(?:\.\d+)?) fps', probe.stderr)
    if match is None:
        raise SystemExit('ffmpeg did not report fps\n' + probe.stderr[-400:])
    fps = float(match.group(1))
    if fps <= 0:
        raise SystemExit(f'fps is {fps}')
    return fps


def rise_onsets(counts: list[int], fps: float, rise: int = 60, hold: int = 8,
                step: int = 8, debounce_s: float = 0.40) -> list[dict]:
    """First frame of a sustained rise in a light-pixel count.

    `counts[i]` is how many pixels in the text crop are brighter than the ink
    threshold at frame i. A rise starts at i when the next `hold` frames climb
    by at least `rise` above the recent floor and this frame itself steps up by
    `step`. Events closer than `debounce_s` collapse to the first one: a fade
    that crosses the threshold twice is one appearance. The time is frame / fps,
    rounded to a millisecond, which is finer than one frame at 25 fps.
    """
    if fps <= 0:
        raise ValueError('fps')
    if hold < 1:
        raise ValueError('hold')
    onsets: list[dict] = []
    last = -1e9
    n = len(counts)
    for i in range(2, n - hold):
        base = min(counts[i - 2:i + 1])
        ahead = max(counts[i:i + hold])
        if ahead - base < rise or counts[i] - counts[i - 1] < step:
            continue
        t = i / fps
        if t - last <= debounce_s:
            continue
        onsets.append({'t': round(t, 3), 'frame': i, 'ink': counts[i]})
        last = t
    return onsets


def assign_nearest(starts: list[float], onsets: list[float], window: float) -> list[int | None]:
    """One onset per start, closest first, each onset used once.

    A start with nothing inside `window` seconds stays unmatched (None).
    Considering pairs by distance keeps an earlier line from taking the onset
    that sits on the next line.
    """
    if window < 0:
        raise ValueError('window')
    pairs: list[tuple[float, int, int]] = []
    for i, start in enumerate(starts):
        for j, onset in enumerate(onsets):
            gap = abs(float(onset) - float(start))
            if gap <= window:
                pairs.append((gap, i, j))
    pairs.sort()
    taken_start: set[int] = set()
    taken_onset: set[int] = set()
    chosen: dict[int, int] = {}
    for _gap, i, j in pairs:
        if i in taken_start or j in taken_onset:
            continue
        taken_start.add(i)
        taken_onset.add(j)
        chosen[i] = j
    return [chosen.get(i) for i in range(len(starts))]


def retimed_span(cues: list[dict], new_starts: list[float | None]) -> list[tuple[float, float]]:
    """New (start, end) for each cue.

    A matched start moves to its onset. An end that already sat on the next
    cue's start follows that neighbour. Anything else keeps its duration.
    The end stays strictly after the start.
    """
    if len(cues) != len(new_starts):
        raise ValueError('cues and starts differ')
    starts = [float(cues[i]['start'] if new_starts[i] is None else new_starts[i]) for i in range(len(cues))]
    out: list[tuple[float, float]] = []
    for i, cue in enumerate(cues):
        old_start = float(cue['start'])
        old_end = float(cue['end'])
        start = starts[i]
        nxt = starts[i + 1] if i + 1 < len(cues) else None
        old_nxt = float(cues[i + 1]['start']) if i + 1 < len(cues) else None
        contiguous = old_nxt is not None and abs(old_end - old_nxt) <= 0.25
        if contiguous and nxt is not None and nxt > start:
            end = nxt
        else:
            end = old_end + (start - old_start)
            if nxt is not None and end > nxt:
                end = nxt
        if end <= start:
            end = start + 0.35
        out.append((round(start, 3), round(end, 3)))
    return out


def _scene_times(video: Path, vf: str) -> list[float]:
    probe = subprocess.run(
        ['ffmpeg', '-hide_banner', '-i', str(video), '-vf', vf, '-f', 'null', '-'],
        capture_output=True, text=True,
    )
    return [float(m) for m in re.findall(r'pts_time:([0-9.]+)', probe.stderr)]


def _ink_counts(video: Path, crop: tuple[int, int, int, int], lum: int) -> list[int]:
    w, h, x, y = crop
    flt = f'crop={w}:{h}:{x}:{y},format=gray'
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(video),
           '-vf', flt, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    assert proc.stdout is not None
    n = w * h
    counts: list[int] = []
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        counts.append(sum(px > lum for px in buf))
    proc.wait()
    if proc.returncode not in (0, None) and not counts:
        raise SystemExit(f'ffmpeg ink read failed ({proc.returncode})')
    return counts


def _save_frames(video: Path, out: Path, rows: list[dict]) -> None:
    """One full frame per change, named by its time. Accurate to the frame index."""
    if not rows:
        return
    # A long select list still finishes in one decode. Batches keep the filter short.
    batch = 80
    written = 0
    for start in range(0, len(rows), batch):
        chunk = rows[start:start + batch]
        expr = '+'.join(f'eq(n\\,{row["frame"]})' for row in chunk)
        pattern = str(out / f'_batch_{start:04d}_%04d.jpg')
        subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(video),
             '-vf', f"select='{expr}'", '-fps_mode', 'vfr', '-q:v', '3', '-y', pattern],
            check=True,
        )
        for i, row in enumerate(chunk, start=1):
            src = out / f'_batch_{start:04d}_{i:04d}.jpg'
            dest = out / row['frame_name']
            if not src.is_file():
                raise SystemExit(f'missing frame {src.name} for {row["t"]}')
            src.replace(dest)
            written += 1
    if written != len(rows):
        raise SystemExit(f'saved {written} frames, expected {len(rows)}')


def _index_rows(times: list[dict]) -> list[dict]:
    rows = []
    for row in times:
        name = f'{row["t"]:07.2f}.jpg'
        item = {'t': row['t'], 'frame': name}
        if 'ink' in row:
            item['ink'] = row['ink']
            item['n'] = row['frame']
        rows.append(item)
    return rows


def main(slug: str, video: Path | None, band: float, threshold: float, mode: str,
         crop: tuple[int, int, int, int] | None, lum: int, rise: int, hold: int,
         step: int, debounce_s: float, save: bool) -> None:
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
    if mode == 'scene':
        if crop is None:
            flt = f"crop=iw:ih*{1 - band:.3f}:0:ih*{band:.3f},scale=480:-2,select='eq(n,0)+gt(scene,{threshold})',showinfo"
        else:
            w, h, x, y = crop
            flt = f"crop={w}:{h}:{x}:{y},scale=480:-2,select='eq(n,0)+gt(scene,{threshold})',showinfo"
        times = [{'t': round(t, 2), 'frame': 0} for t in _scene_times(video, flt)]
        if not times:
            raise SystemExit('ffmpeg found no frames; check the file.')
        # Scene mode keeps the historical names. The saved picture is 0.4 s after the cut,
        # so the new caption is on screen. Frame index 0 is not used for those names.
        index = []
        for row in times:
            name = f'{row["t"]:07.2f}.jpg'
            subprocess.run(
                ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', f'{row["t"] + 0.4:.2f}',
                 '-i', str(video), '-frames:v', '1', '-q:v', '3', '-y', str(out / name)],
                check=True,
            )
            index.append({'t': row['t'], 'frame': name})
    elif mode == 'ink':
        if crop is None:
            raise SystemExit('--mode ink needs --crop W:H:X:Y, the rectangle where the letters sit')
        fps = video_fps(video)
        counts = _ink_counts(video, crop, lum)
        found = rise_onsets(counts, fps, rise=rise, hold=hold, step=step, debounce_s=debounce_s)
        if not found:
            raise SystemExit('no text rise in that crop; look at a frame and move --crop')
        index = _index_rows(found)
        for row, src in zip(index, found):
            src['frame_name'] = row['frame']
        if save:
            _save_frames(video, out, found)
        meta = {
            'mode': 'ink', 'fps': fps, 'crop': {'w': crop[0], 'h': crop[1], 'x': crop[2], 'y': crop[3]},
            'lum': lum, 'rise': rise, 'hold': hold, 'step': step, 'debounce_s': debounce_s,
            'frames': len(counts), 'onsets': len(index),
        }
        (out / 'measure.json').write_text(json.dumps(meta, indent=1), encoding='utf-8')
    else:
        raise SystemExit(f'unknown mode {mode}')
    (out / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
    print(f'{len(index)} caption frames → {out}')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not a:
        raise SystemExit(__doc__)

    def opt(k, d):
        return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d

    v = opt('--video', None)
    crop_text = opt('--crop', None)
    main(
        a[0], Path(v) if v else None, float(opt('--band', 0.62)), float(opt('--threshold', 0.06)),
        opt('--mode', 'scene'), parse_crop(crop_text) if crop_text else None,
        int(opt('--lum', 120)), int(opt('--rise', 60)), int(opt('--hold', 8)),
        int(opt('--step', 8)), float(opt('--debounce', 0.40)), '--no-frames' not in sys.argv,
    )
