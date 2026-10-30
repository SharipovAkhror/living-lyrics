"""Check that PR #6 withdrew exactly the proved lines it changed.

Compares vocal lines in content/songs between origin/main and this worktree.
A line id counts as changed when it was added or removed, or its sung text,
word tokens, word times, own place, or a new timing-draft flag changed.
Own place ignores an index shift that comes only from inserting or deleting
other lines. The old baseline is baseline-155.json ids plus PASS5_EXTRA,
before `withdrawn` is applied.

Exit 0 when `withdrawn` equals the intersection of that change set and the
old baseline. After the PR is merged, origin/main has the same lines and
the intersection cannot be recomputed: the command exits 2.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'pipeline'))

import attack_chance as A  # noqa: E402


def git_show(rev: str, rel: str) -> dict | None:
    proc = subprocess.run(
        ['git', 'show', f'{rev}:{rel}'],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
    )
    if proc.returncode != 0:
        return None
    return json.loads(proc.stdout)


def changed_json() -> list[str]:
    proc = subprocess.run(
        ['git', 'diff', '--name-only', 'origin/main...HEAD', '--', 'content/songs'],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True,
    )
    return [line.strip().replace('\\', '/') for line in proc.stdout.splitlines() if line.strip()]


def vocal(lyrics: dict) -> list[dict]:
    rows = []
    order = 0
    for sec in lyrics.get('sections') or []:
        if sec.get('kind') != 'vocal':
            continue
        for line in sec.get('lines') or []:
            words = line.get('words') or []
            tokens = [w.get('w') for w in words]
            rows.append({
                'id': line.get('id'),
                'order': order,
                'text': ' '.join(str(tok) for tok in tokens),
                'tokens': tokens,
                'times': [(w.get('w'), w.get('s'), w.get('e')) for w in words],
                'flags': list(line.get('flags') or []),
            })
            order += 1
    return rows


def line_objects(obj, found: list[dict]) -> None:
    """Dicts that store a sung line: an id plus a words array of {w}."""
    if isinstance(obj, dict):
        words = obj.get('words')
        if obj.get('id') and isinstance(words, list) and words and isinstance(words[0], dict) and 'w' in words[0]:
            found.append(obj)
        for value in obj.values():
            line_objects(value, found)
    elif isinstance(obj, list):
        for value in obj:
            line_objects(value, found)


def classify(slug: str) -> list[dict]:
    rel = f'content/songs/{slug}/lyrics.json'
    old_doc = git_show('origin/main', rel)
    new_doc = json.loads((ROOT / rel).read_text(encoding='utf-8'))
    if old_doc is None:
        raise SystemExit(f'нет {rel} на origin/main')
    old_rows = vocal(old_doc)
    new_rows = vocal(new_doc)
    old_ids = [row['id'] for row in old_rows]
    new_ids = [row['id'] for row in new_rows]
    if len(old_ids) != len(set(old_ids)) or len(new_ids) != len(set(new_ids)):
        raise SystemExit(f'повтор id в {slug}')
    loose_old: list[dict] = []
    loose_new: list[dict] = []
    line_objects(old_doc, loose_old)
    line_objects(new_doc, loose_new)
    if {row['id'] for row in loose_old} != set(old_ids) or {row['id'] for row in loose_new} != set(new_ids):
        raise SystemExit(f'{slug}: строки вне vocal sections')
    old_i = {row['id']: row for row in old_rows}
    new_i = {row['id']: row for row in new_rows}
    added = [row['id'] for row in new_rows if row['id'] not in old_i]
    removed = [row['id'] for row in old_rows if row['id'] not in new_i]
    out = []
    for lid in list(dict.fromkeys(old_ids + new_ids)):
        old, new = old_i.get(lid), new_i.get(lid)
        reasons = []
        if old is None:
            reasons.append('added')
            if 'timing-draft' in new['flags']:
                reasons.append('timing-draft-added')
        elif new is None:
            reasons.append('removed')
        else:
            added_before = sum(1 for item in added if new_i[item]['order'] < new['order'])
            removed_before = sum(1 for item in removed if old_i[item]['order'] < old['order'])
            if old['text'] != new['text']:
                reasons.append('text')
            if old['tokens'] != new['tokens']:
                reasons.append('words')
            if old['times'] != new['times'] and 'words' not in reasons:
                reasons.append('times')
            if new['order'] != old['order'] + added_before - removed_before:
                reasons.append('order')
            if 'timing-draft' in new['flags'] and 'timing-draft' not in old['flags']:
                reasons.append('timing-draft-added')
        if reasons:
            out.append({'song': slug, 'id': lid, 'reasons': reasons})
    return out


def main() -> int:
    names = changed_json()
    lyrics = [name for name in names if name.endswith('/lyrics.json')]
    others = [name for name in names if not name.endswith('/lyrics.json')]
    for name in others:
        if not name.endswith('.json'):
            continue
        old = git_show('origin/main', name)
        new = json.loads((ROOT / name).read_text(encoding='utf-8'))
        found: list[dict] = []
        if old is not None:
            line_objects(old, found)
        line_objects(new, found)
        if found:
            print(f'FAIL  {name} хранит строки со словами, разбор их не сравнивает')
            return 1
    if not lyrics:
        print('FAIL  нет различий lyrics.json против origin/main: пересечение не пересчитать')
        return 2
    changed = []
    for rel in lyrics:
        slug = rel.split('/')[2]
        changed.extend(classify(slug))
    pr = {row['id'] for row in changed}
    frozen = set(A._read_frozen())
    old = frozen | set(A.PASS5_EXTRA)
    withdrawn = set(A._withdrawn_ids())
    intersection = pr & old
    ok = withdrawn == intersection
    print(f'файлы content/songs: {len(names)}')
    for row in changed:
        mark = 'база' if row['id'] in old else '    '
        left = 'вышла' if row['id'] in withdrawn else '    '
        print(f"{mark}\t{left}\t{row['song']}\t{row['id']}\t{','.join(row['reasons'])}")
    for lid in A.PASS5_EXTRA:
        if lid not in pr:
            print(f"{'база' if lid in old else '    '}\t{'вышла' if lid in withdrawn else 'осталась'}\t—\t{lid}\tне меняется")
    print(f'меняет PR: {len(pr)}')
    print(f'старая база: {len(old)}')
    print(f'пересечение: {len(intersection)} {sorted(intersection)}')
    print(f'withdrawn: {len(withdrawn)} {sorted(withdrawn)}')
    print(f'удерживается: {A.published_count()}')
    print('OK  вышедшие = пересечение' if ok else 'FAIL  вышедшие не равны пересечению')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
