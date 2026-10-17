"""Stage 3: split the mix into stems.

    python3 scripts/pipeline/separate.py <slug> [--model htdemucs]

Models (all run on CPU):
  htdemucs            Demucs v4, default. Four stems (vocals, drums, bass, other), no --two-stems:
                      the flag does not make the run shorter and throws away the stems the next
                      task needs. Runtime is about the length of the track; the pipeline report
                      records the measured wall clock, not a fixed factor.
  htdemucs_ft         Demucs v4 fine-tuned bag of 4 models: cleaner vocals, about 4× slower.
                      Not the default. Use it only after a timing run shows htdemucs vocals leaking.
  *.ckpt / *.onnx     any model of the `audio-separator` package (pip install "audio-separator[cpu]").
                      Not the default: a checkpoint's licence and CPU time have to be read first.
The model can also come from the SEPARATOR_MODEL environment variable.

Demucs writes work/<slug>/stems/{vocals,drums,bass,other}.wav. An audio-separator model writes
vocals.wav only. stems/model.txt names the model, which align.py and qa_sync.py put into their reports.
"""
from __future__ import annotations

import os
import shutil
import sys

from common import find_source, run, work_dir


def main(slug: str, model: str = 'htdemucs') -> None:
    src = find_source(slug)
    stems = work_dir(slug) / 'stems'
    stems.mkdir(exist_ok=True)
    if model.endswith(('.ckpt', '.onnx', '.pth', '.yaml')):
        out = work_dir(slug) / 'separator'
        out.mkdir(exist_ok=True)
        run(['audio-separator', str(src), '--model_filename', model, '--output_dir', str(out),
             '--single_stem', 'Vocals', '--output_format', 'WAV'])
        produced = next(out.glob('*(Vocals)*.wav'))
        shutil.copy(produced, stems / 'vocals.wav')
        shutil.rmtree(out)
    else:
        out = work_dir(slug) / 'demucs'
        # Four stems. --two-stems mixes drums, bass and other into one file after the same work.
        run([sys.executable, '-m', 'demucs', '-n', model, '-o', str(out), str(src)])
        track = next(out.glob(f'{model}/*'))
        for name in ('vocals', 'drums', 'bass', 'other'):
            produced = track / f'{name}.wav'
            if not produced.is_file():
                raise SystemExit(f'demucs не отдал стем {name}: {track}')
            shutil.copy(produced, stems / f'{name}.wav')
        shutil.rmtree(out)
    (stems / 'model.txt').write_text(model + '\n', encoding='utf-8')
    print(f'stems ({model}) → {stems}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    default = os.environ.get('SEPARATOR_MODEL') or 'htdemucs'
    model = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else default
    main(args[0], model)
