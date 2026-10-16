"""Read a web page as plain text from a machine with open internet (Vercel Sandbox, CI).

    python3 scripts/pipeline/sandbox/fetch_text.py <url> [--from N] [--grep WORD]

For agents whose own environment cannot reach the site: run this in a sandbox and read the output.
The text is cached in /tmp/fetch/, printed in 1 800-character pieces (see dump.py), about 11 KB per
call; continue with --from <offset>. --grep prints only lines containing WORD (case-insensitive)
with one line of context, which is handy for long pages.
"""
from __future__ import annotations

import hashlib
import re
import ssl
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from research import UA, text_of  # noqa: E402

PIECE = 1800
PER_CALL = 6


def fetch(url: str) -> str:
    cache = Path('/tmp/fetch') / (hashlib.sha1(url.encode()).hexdigest() + '.txt')
    if cache.exists():
        return cache.read_text(encoding='utf-8')
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en,ru;q=0.8'})
    ctx = ssl.create_default_context()
    try:
        raw = urllib.request.urlopen(req, timeout=40, context=ctx).read()
    except ssl.SSLError:
        # A few old sites ship an incomplete certificate chain; the text is public anyway.
        raw = urllib.request.urlopen(req, timeout=40, context=ssl._create_unverified_context()).read()
    text = text_of(raw.decode('utf-8', 'replace'))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(text, encoding='utf-8')
    return text


def main() -> None:
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not a:
        raise SystemExit(__doc__)
    text = fetch(a[0])
    if '--grep' in sys.argv:
        word = sys.argv[sys.argv.index('--grep') + 1].lower()
        lines = text.split('\n')
        keep = sorted({j for i, l in enumerate(lines) if word in l.lower() for j in (i - 1, i, i + 1) if 0 <= j < len(lines)})
        text = '\n'.join(lines[i] for i in keep)
    start = int(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else 0
    end = min(len(text), start + PIECE * PER_CALL)
    for i in range(start, end, PIECE):
        sys.stdout.write(text[i:min(i + PIECE, end)])
        sys.stdout.flush()
        time.sleep(0.3)
    sys.stdout.write(f'\n#fetch {end}/{len(text)}' + (f' — next: --from {end}' if end < len(text) else ' — end') + '\n')


if __name__ == '__main__':
    main()
