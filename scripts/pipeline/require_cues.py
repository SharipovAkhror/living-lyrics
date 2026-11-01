"""Stop a prove song before align when its cue file is missing or empty.

    python3 scripts/pipeline/require_cues.py [--root DIR] <slug> [<slug>…]

A song that will be proved needs docs/analysis/<slug>/cues.json with at least
one cue row. A missing file, an empty file, or a file with no rows exits 1
and prints the Actions error. Other songs are not looked at. No audio, no
network, no models.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT  # noqa: E402

SLUG = re.compile(r'[a-z0-9-]+')
# The workflow prints this line and stops. An empty file uses the same line:
# there is still nothing to prove a line against.
MESSAGE = (
    '::error::{slug}: нет docs/analysis/{slug}/cues.json, '
    'строки не доказать, сначала реплики (docs/methodology/05-alignment.md)'
)


def cue_path(root: Path, slug: str) -> Path:
    return root / 'docs' / 'analysis' / slug / 'cues.json'


def has_cues(path: Path) -> bool:
    """True when the file is a non-empty JSON list of cue rows."""
    if not path.is_file():
        return False
    try:
        text = path.read_text(encoding='utf-8-sig')
    except OSError:
        return False
    if not text.strip():
        return False
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return False
    return isinstance(data, list) and len(data) > 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', type=Path, default=None)
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    root = args.root if args.root is not None else ROOT
    failed = False
    for slug in args.slugs:
        if not SLUG.fullmatch(slug):
            print(f'::error::{slug}: недопустимое имя песни', flush=True)
            failed = True
            continue
        if has_cues(cue_path(root, slug)):
            continue
        print(MESSAGE.format(slug=slug), flush=True)
        failed = True
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
