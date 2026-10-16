"""Stage 3: split vocals from accompaniment with Demucs (htdemucs, two stems).

    python3 scripts/pipeline/separate.py <slug> [--model htdemucs_ft]

Writes work/<slug>/stems/vocals.wav and no_vocals.wav. CPU works (≈ 1–2× real time on 4 cores).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from common import find_source, run, work_dir


def main(slug: str, model: str = 'htdemucs') -> None:
    src = find_source(slug)
    out = work_dir(slug) / 'demucs'
    run([sys.executable, '-m', 'demucs', '--two-stems', 'vocals', '-n', model, '-o', str(out), str(src)])
    produced = next(out.glob(f'{model}/*/vocals.wav'))
    stems = work_dir(slug) / 'stems'
    stems.mkdir(exist_ok=True)
    shutil.copy(produced, stems / 'vocals.wav')
    shutil.copy(produced.with_name('no_vocals.wav'), stems / 'no_vocals.wav')
    print(f'stems → {stems}')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    model = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else 'htdemucs'
    main(args[0], model)
