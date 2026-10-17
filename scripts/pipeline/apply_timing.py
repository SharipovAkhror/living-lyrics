"""Apply word timing measured on another machine (sandbox, CI) to content/songs/<slug>/lyrics.json.

    python3 scripts/pipeline/apply_timing.py <slug> <timing.json> [--dry-run]

<timing.json> is the compact file align.py writes to work/<slug>/timing.json:
    {"slug", "created", "timing": {song.json timing},
     "lines": {"<line id>": {"sig": "<text fingerprint>", "draft": true|false, "w": [[s, e], …]}},
     "sections": {"<section id>": [start, end, timing-draft?]}}
Copy it out of a sandbox with `python3 scripts/pipeline/sandbox/dump.py work/<slug>/timing.json`
(paste the pieces together into one file).

A line is updated only when its words are still the ones that were aligned (same fingerprint and
word count); otherwise it is skipped and listed, because another edit changed the text since.
Only word s/e, line flags (timing-draft) and song.json timing change. Section bounds are left
alone unless --sections is passed (another task owns the structure). The rest of the files stays
byte for byte. align.py keeps every line timing-draft; clearing that flag is qa_sync.py --apply.
"""
from __future__ import annotations

import json
import sys

import timing as T
from common import dump_json, load_json, song_dir


def main(slug: str, path: str, dry: bool, sections: bool) -> int:
    data = json.loads(open(path, encoding='utf-8').read())
    if data.get('slug') != slug:
        raise SystemExit(f'{path}: slug {data.get("slug")} ≠ {slug}')
    lyr_path, song_path = song_dir(slug) / 'lyrics.json', song_dir(slug) / 'song.json'
    lyrics, song = load_json(lyr_path), load_json(song_path)
    lines = {line['id']: line for _, line in T.vocal_lines(lyrics)}
    applied, skipped = [], []
    for lid, rec in data['lines'].items():
        line = lines.get(lid)
        if line is None:
            skipped.append(f'{lid}: строки больше нет')
            continue
        if T.text_sig(line) != rec['sig'] or len(line['words']) != len(rec['w']):
            skipped.append(f'{lid}: текст изменился после выравнивания — выровняйте заново')
            continue
        for w, (s, e) in zip(line['words'], rec['w']):
            w['s'], w['e'] = s, e
        T.set_flag(line, 'timing-draft', bool(rec['draft']))
        applied.append(lid)
    if sections:
        secs = {s['id']: s for s in lyrics['sections']}
        for sid, rec in data.get('sections', {}).items():
            start, end, draft = rec[0], rec[1], rec[2] if len(rec) > 2 else False
            if sid in secs:
                secs[sid]['start'], secs[sid]['end'] = start, end
                if 'timing-draft' in secs[sid].get('flags', []) or draft:
                    T.set_flag(secs[sid], 'timing-draft', bool(draft))
    fixes = T.enforce_order(lyrics)
    if song['timing'].get('status') != 'verified' and data.get('timing'):
        song['timing'] = data['timing']
    print(f'применено строк: {len(applied)}, пропущено: {len(skipped)}, исправлений порядка: {fixes}')
    for s in skipped:
        print('  ·', s)
    if dry:
        print('dry run: файлы не изменены')
        return 0
    lyr_path.write_text(dump_json(lyrics), encoding='utf-8')
    song_path.write_text(dump_json(song), encoding='utf-8')
    return 1 if skipped else 0


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if len(a) != 2:
        raise SystemExit(__doc__)
    sys.exit(main(a[0], a[1], '--dry-run' in sys.argv, '--sections' in sys.argv))
