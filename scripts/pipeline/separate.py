"""Stage 3: split vocals from accompaniment.

    python3 scripts/pipeline/separate.py <slug> [--model htdemucs]

Models (all run on CPU):
  htdemucs            Demucs v4, default. ≈ 0.6× real time on 4 cores (580 s → 6 min).
  htdemucs_ft         Demucs v4 fine-tuned bag of 4 models: cleaner vocals, ≈ 4× slower.
  *.ckpt / *.onnx     any model of the `audio-separator` package (pip install "audio-separator[cpu]"),
                      e.g. model_bs_roformer_ep_317_sdr_12.9755.ckpt (BS-RoFormer, the best vocal
                      separation published so far; slow on CPU) or UVR-MDX-NET-Voc_FT.onnx.
The model can also come from the SEPARATOR_MODEL environment variable.

Writes work/<slug>/stems/vocals.wav (and no_vocals.wav for Demucs) and stems/model.txt — the name of
the model, which align.py and qa_sync.py put into their reports.
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
        run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-n', model, '-o', str(out), str(src)])
        produced = next(out.glob(f'{model}/*/vocals.wav'))
        shutil.copy(produced, stems / 'vocals.wav')
        shutil.copy(produced.with_name('no_vocals.wav'), stems / 'no_vocals.wav')
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
