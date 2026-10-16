"""Print a sandbox result in pieces the Vercel MCP log stream passes whole.

    python3 scripts/pipeline/sandbox/dump.py <file> [--from N]

The MCP tools cut every string at about 2 000 characters (read_session_file included), but a
command's output arrives as separate items, one per write. So the file is written in 1 800-character
pieces with a short pause between them: about 11 KB per call. For a larger file, call again with
--from <offset printed at the end>.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

PIECE = 1800
PER_CALL = 6


def main(path: str, start: int = 0) -> None:
    text = Path(path).read_text(encoding='utf-8')
    end = min(len(text), start + PIECE * PER_CALL)
    for i in range(start, end, PIECE):
        sys.stdout.write(text[i:min(i + PIECE, end)])
        sys.stdout.flush()
        time.sleep(0.3)
    sys.stdout.write(f'\n#dump {end}/{len(text)}' + (f' — next: --from {end}' if end < len(text) else ' — end') + '\n')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not a:
        raise SystemExit(__doc__)
    main(a[0], int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 0)
