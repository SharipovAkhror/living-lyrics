"""Stage 2: delivery files, loudness, peaks, song.json audio block.

    python3 scripts/pipeline/process_audio.py <slug>

- high.m4a: AAC source → remux (no re-encode); anything else → AAC 256 kbit/s.
- saver.m4a: AAC 96 kbit/s.
- gainDb: −14 LUFS minus measured integrated loudness (EBU R128). The file itself is never normalised.
- peaks.json: RMS every 50 ms, normalised 0..1.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys

import numpy as np

from common import audio_dir, ffprobe, find_source, load_json, run, save_json, sha256, song_dir, work_dir

TARGET_LUFS = -14.0
PEAK_RATE = 20  # values per second


def loudness(path) -> tuple[float, float]:
    """Integrated loudness (LUFS) and true peak (dBTP) via ffmpeg loudnorm, first pass."""
    proc = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'],
        text=True, capture_output=True,
    )
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', proc.stderr, re.S)
    if not m:
        raise SystemExit('loudnorm measurement failed:\n' + proc.stderr[-2000:])
    data = json.loads(m.group(0))
    return float(data['input_i']), float(data['input_tp'])


def peaks(path, duration: float) -> dict:
    """Mono 8 kHz decode → RMS per window → normalised list."""
    sr = 8000
    raw = subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
        check=True, capture_output=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    hop = sr // PEAK_RATE
    n = len(x) // hop
    frames = x[: n * hop].reshape(n, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    # Perceptual-ish curve: compress with a power, normalise to the 99th percentile so one peak doesn't flatten the rest.
    rms = np.power(rms, 0.6)
    ref = np.percentile(rms, 99) or 1.0
    rms = np.clip(rms / ref, 0, 1)
    return {'rate': PEAK_RATE, 'duration': round(duration, 3), 'rms': [round(float(v), 3) for v in rms]}


def main(slug: str) -> None:
    src = find_source(slug)
    info = ffprobe(src)
    a = next(s for s in info['streams'] if s['codec_type'] == 'audio')
    codec = a['codec_name']
    duration = float(info['format']['duration'])
    print(f'source {src.name}: {codec}, {a.get("sample_rate")} Hz, {a.get("channels")} ch, {duration:.2f} s')

    out = audio_dir(slug)
    high = out / 'high.m4a'
    saver = out / 'saver.m4a'
    if codec == 'aac':
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src), '-map', '0:a:0', '-c:a', 'copy', '-movflags', '+faststart', str(high)])
    else:
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src), '-map', '0:a:0', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000' if a.get('sample_rate') == '48000' else '44100', '-movflags', '+faststart', str(high)])
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src), '-map', '0:a:0', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', str(saver)])

    lufs, tp = loudness(high)
    gain = round(TARGET_LUFS - lufs, 1)
    print(f'loudness {lufs:.1f} LUFS, true peak {tp:.1f} dBTP → gainDb {gain:+.1f}')

    duration = float(ffprobe(high)['format']['duration'])
    save_json(out / 'peaks.json', peaks(high, duration))

    prov_path = work_dir(slug) / 'provenance.json'
    prov = load_json(prov_path) if prov_path.exists() else {'kind': 'file', 'ref': src.name}
    prov.setdefault('sha256', sha256(src))

    song_path = song_dir(slug) / 'song.json'
    song = load_json(song_path)
    song['duration'] = round(duration, 2)
    song['audio'] = {
        'status': 'ready',
        'high': f'/audio/{slug}/high.m4a',
        'saver': f'/audio/{slug}/saver.m4a',
        'peaks': f'/audio/{slug}/peaks.json',
        'gainDb': gain,
        'provenance': {k: prov[k] for k in ('kind', 'ref', 'retrieved', 'codec', 'sha256') if k in prov},
    }
    save_json(song_path, song)
    for f in (high, saver, out / 'peaks.json'):
        print(f'{f.relative_to(out.parents[2])}  {f.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
