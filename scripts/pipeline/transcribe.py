"""Stage 4: draft transcription of the vocal stem with Whisper (word timestamps, language per segment).

    python3 scripts/pipeline/transcribe.py <slug> [--model large-v3]

Writes work/<slug>/transcript.json. Use it as a map: which verses are sung, in which order,
which language, roughly when. Never copy it into lyrics.json without checking against the
canonical text and by ear — Whisper misspells Arabic and Persian and invents words in melismas.
"""
from __future__ import annotations

import json
import subprocess
import sys

from common import work_dir


def load_16k(path) -> 'object':
    """Mono 16 kHz float32 via ffmpeg. Passing an array avoids faster-whisper's PyAV decoder,
    whose keyword arguments break with newer PyAV releases."""
    import numpy as np

    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def main(slug: str, model_name: str = 'large-v3') -> None:
    from faster_whisper import WhisperModel

    stem = work_dir(slug) / 'stems' / 'vocals.wav'
    model = WhisperModel(model_name, device='auto', compute_type='int8')
    segments, info = model.transcribe(
        load_16k(stem),
        word_timestamps=True,
        vad_filter=True,
        multilingual=True,
        condition_on_previous_text=False,
        beam_size=5,
    )
    out = []
    for seg in segments:
        out.append({
            'start': round(seg.start, 2),
            'end': round(seg.end, 2),
            'lang': getattr(seg, 'language', None) or info.language,
            'text': seg.text.strip(),
            'words': [{'w': w.word.strip(), 's': round(w.start, 2), 'e': round(w.end, 2), 'p': round(w.probability, 2)} for w in (seg.words or [])],
        })
        print(f"{seg.start:7.2f} – {seg.end:7.2f}  [{out[-1]['lang']}]  {seg.text.strip()}")
    path = work_dir(slug) / 'transcript.json'
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'→ {path}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    m = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else 'large-v3'
    main(args[0], m)
