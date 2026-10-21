"""Score one studio round with two independent critics on a frozen rubric.

Usage: python scripts/review/critique.py <round> <studio-worktree> [--only design|motion]

Takes the frozen frame set from <studio-worktree>/work/studio/{sheets<N>,video<N>,board<N>-player-3x.png},
copies it into work/review/r<N>/ of the main checkout (the only place agy can read), asks Gemini (agy)
and Grok (grok-bridge) the frozen prompts in docs/design/critique/, and computes the score from the
per-criterion numbers. A round gets a score only when both critics agree within AGREE points.
Rules and the frame set: docs/design/critique/README.md.
"""
import json
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = Path('C:/Users/User/Documents/GitHub/living-lyrics')  # agy reads only inside its workspace
GROK_BRIDGE = Path.home() / '.claude/plugins/cache/xai-grok-build/grok-build/0.2.1/scripts/grok-bridge.mjs'
AGREE = 5.0
TRIES = 3

DESIGN_SHEETS = [
    'iphone-dark-song', 'iphone-light-song', 'iphone-dark-library', 'iphone-light-library',
    'se-light-song', 'se375-dark-song', 'land-15-dark-song', 'ipad-light-song',
    'desk-dark-song', 'desk-light-library', 'wide-dark-library', 'wide-light-song',
]
MOTION_SHEETS = [f'{e}-{f}-contact' for e in ('chromium', 'webkit') for f in ('library-song', 'scrub', 'settings', 'play')]
CRITERIA = {
    'design': ['hierarchy', 'layout', 'material', 'controls', 'legibility', 'consistency'],
    'motion': ['continuity', 'timing', 'cleanliness', 'content', 'feedback', 'parity'],
}


def stage(n: int, wt: Path, kind: str) -> tuple[str, list[str]]:
    studio = wt / 'work/studio'
    dest = MAIN / f'work/review/r{n}/{kind}'
    dest.mkdir(parents=True, exist_ok=True)
    if kind == 'design':
        pairs = [(studio / f'sheets{n}/round{n}-{s}.png', f'{s}.png') for s in DESIGN_SHEETS]
        pairs.append((studio / f'board{n}-player-3x.png', 'board-player-3x.png'))
    else:
        pairs = [(studio / f'video{n}/{s}.png', f'{s}.png') for s in MOTION_SHEETS]
    missing = [str(src) for src, _ in pairs if not src.exists()]
    if missing:
        sys.exit('frame set incomplete:\n  ' + '\n  '.join(missing))
    for src, name in pairs:
        shutil.copyfile(src, dest / name)
    return f'work/review/r{n}/{kind}', [name for _, name in pairs]


def prompt(kind: str, rel: str, files: list[str]) -> str:
    text = (ROOT / f'docs/design/critique/{kind}-prompt.txt').read_text(encoding='utf-8')
    return text.replace('{{DIR}}', rel).replace('{{FILES}}', ', '.join(files))


def parse(text: str, kind: str) -> dict | None:
    for m in sorted(re.finditer(r'\{', text), key=lambda m: m.start()):
        depth = 0
        for i in range(m.start(), len(text)):
            depth += text[i] == '{'
            depth -= text[i] == '}'
            if depth == 0:
                try:
                    obj = json.loads(text[m.start():i + 1])
                except json.JSONDecodeError:
                    break
                crit = obj.get('criteria', {})
                if all(isinstance(crit.get(c, {}).get('score'), (int, float)) for c in CRITERIA[kind]):
                    return obj
                break
    return None


def gemini(p: str, n: int, kind: str) -> str:
    pf = MAIN / f'work/review/r{n}/{kind}-gemini-prompt.txt'
    pf.write_text(p, encoding='utf-8')
    agy = shutil.which('agy') or 'agy'
    r = subprocess.run([agy, '-p', p, '--model', 'gemini-3.8-flash-high', '--output-format', 'json',
                        '--print-timeout', '1200s'], cwd=MAIN, capture_output=True, text=True, encoding='utf-8')
    if not r.stdout.strip():
        return r.stderr[-2000:]
    try:
        return json.loads(r.stdout).get('response', '')
    except json.JSONDecodeError:
        return r.stdout


def grok(p: str, n: int, kind: str) -> str:
    pf = MAIN / f'work/review/r{n}/{kind}-grok-prompt.txt'
    pf.write_text(p, encoding='utf-8')
    r = subprocess.run(['node', str(GROK_BRIDGE), 'run', '--model', 'grok-4.7', '--effort', 'high',
                        '--cwd', str(MAIN), '--prompt-file', str(pf)], cwd=MAIN, capture_output=True, text=True,
                       encoding='utf-8')
    out = r.stdout
    return out.split('[grok-cc] Grok finished.')[-1]


def ask(name: str, fn, kind: str, n: int) -> dict:
    for t in range(1, TRIES + 1):
        raw = fn()
        (MAIN / f'work/review/r{n}/{kind}-{name}-{t}.txt').write_text(raw or '', encoding='utf-8')
        obj = parse(raw or '', kind)
        if obj:
            obj['total'] = round(10 * sum(obj['criteria'][c]['score'] for c in CRITERIA[kind]) / len(CRITERIA[kind]), 1)
            return obj
        print(f'  {name}: no valid answer on try {t}', file=sys.stderr)
    return {}


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    n, wt = int(args[0]), Path(args[1])
    kinds = [args[args.index('--only') + 1]] if '--only' in args else ['design', 'motion']
    out_path = MAIN / f'work/review/r{n}/scores.json'
    result = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {}
    for kind in kinds:
        rel, files = stage(n, wt, kind)
        p = prompt(kind, rel, files)
        print(f'{kind}: asking both critics…', file=sys.stderr)
        with ThreadPoolExecutor(2) as pool:
            fg = pool.submit(ask, 'gemini', lambda: gemini(p, n, kind), kind, n)
            fk = pool.submit(ask, 'grok', lambda: grok(p, n, kind), kind, n)
            g, k = fg.result(), fk.result()
        res = {'gemini': g.get('total'), 'grok': k.get('total'), 'per_criterion': {}}
        for c in CRITERIA[kind]:
            res['per_criterion'][c] = [g.get('criteria', {}).get(c, {}).get('score'), k.get('criteria', {}).get(c, {}).get('score')]
        if g and k and abs(g['total'] - k['total']) <= AGREE:
            res['score'] = round((g['total'] + k['total']) / 2, 1)
        else:
            res['score'] = None
        res['issues'] = {'gemini': g.get('issues', []), 'grok': k.get('issues', [])}
        result[kind] = res
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')

    def cell(kind: str) -> str:
        r = result.get(kind)
        if not r:
            return '—'
        s = f"{r['score']}" if r['score'] is not None else 'нет (расхождение)'
        return f"{s} (Gemini {r['gemini']}, Grok {r['grok']})"
    print(f'| {n} | {cell("design")} | {cell("motion")} |')


if __name__ == '__main__':
    main()
