"""Fetch credits pages and artwork for a song, extract readable text and a colour palette.

    python3 scripts/pipeline/sandbox/research.py <slug> <youtube-id> [page-url …]

Writes work/<slug>/research/{pages.txt, palette.json, cover.jpg}. Runs where the network is open
(Vercel Sandbox / GitHub Actions); the agent then reads pages.txt and fills credits by hand.
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en,ru;q=0.8'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def text_of(page: str) -> str:
    page = re.sub(r'(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', page)
    page = re.sub(r'(?i)<br\s*/?>|</(p|div|li|h\d|tr)>', '\n', page)
    page = re.sub(r'<[^>]+>', ' ', page)
    page = html.unescape(page)
    lines = [re.sub(r'\s+', ' ', l).strip() for l in page.split('\n')]
    return '\n'.join(l for l in lines if l)


def youtube_description(vid: str) -> str:
    page = get(f'https://www.youtube.com/watch?v={vid}&hl=en').decode('utf-8', 'replace')
    m = re.search(r'"shortDescription":"(.*?)","', page)
    title = re.search(r'"title":"(.*?)","lengthSeconds', page)
    desc = json.loads('"' + m.group(1) + '"') if m else '(description not found)'
    return f"TITLE: {json.loads(chr(34) + title.group(1) + chr(34)) if title else '?'}\n{desc}"


def palette(img_path: Path, k: int = 6) -> list[dict]:
    from PIL import Image
    import numpy as np

    im = Image.open(img_path).convert('RGB').resize((160, 90))
    px = np.asarray(im).reshape(-1, 3).astype(float)
    rng = np.random.default_rng(1)
    c = px[rng.choice(len(px), k, replace=False)]
    for _ in range(25):
        d = ((px[:, None, :] - c[None]) ** 2).sum(-1)
        lab = d.argmin(1)
        c = np.array([px[lab == i].mean(0) if (lab == i).any() else c[i] for i in range(k)])
    counts = np.bincount(lab, minlength=k)
    out = []
    for i in np.argsort(-counts):
        r, g, b = (int(v) for v in c[i])
        out.append({'hex': f'#{r:02X}{g:02X}{b:02X}', 'share': round(float(counts[i] / len(px)), 3)})
    return out


def main(slug: str, vid: str, pages: list[str]) -> None:
    out = ROOT / 'work' / slug / 'research'
    out.mkdir(parents=True, exist_ok=True)
    chunks = []
    try:
        chunks.append('=== YouTube ' + vid + '\n' + youtube_description(vid))
    except Exception as e:  # noqa: BLE001
        chunks.append(f'=== YouTube {vid}: {e}')
    for url in pages:
        try:
            chunks.append(f'=== {url}\n' + text_of(get(url).decode('utf-8', 'replace'))[:20000])
        except Exception as e:  # noqa: BLE001
            chunks.append(f'=== {url}: {e}')
    (out / 'pages.txt').write_text('\n\n'.join(chunks), encoding='utf-8')
    for size in ('maxresdefault', 'hqdefault'):
        try:
            (out / 'cover.jpg').write_bytes(get(f'https://i.ytimg.com/vi/{vid}/{size}.jpg'))
            break
        except Exception:  # noqa: BLE001
            continue
    if (out / 'cover.jpg').exists():
        (out / 'palette.json').write_text(json.dumps(palette(out / 'cover.jpg'), indent=2))
    print(f'research → {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
