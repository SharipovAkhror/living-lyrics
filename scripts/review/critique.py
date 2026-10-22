"""Score one studio round, or a reference brand, with two independent critics on a frozen rubric.

Usage:
  python scripts/review/critique.py <round> <studio-worktree> [--only design|motion]
  python scripts/review/critique.py --ref <brand> <dir> [--only design|motion]
  python scripts/review/critique.py --relative <round>

The round path takes the frozen frame set from <studio-worktree>/work/studio/{sheets<N>,video<N>,board<N>-player-3x.png}.
--ref scores work/ref/<brand>/ laid out as sheets/round0-<name>.png, board0-player-3x.png and
video0/<engine>-<flow>-contact.png. Both copy the frames into work/review/ of the main checkout
(the only place agy can read), ask Gemini (agy) and Grok (grok-bridge) the frozen prompts in
docs/design/critique/, and compute the score from the per-criterion numbers. The product paragraph
is not changed. A round gets a score only when both critics agree within AGREE points.
--relative <round> prints ours ÷ the average of the reference brands that already have scores.
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


def round_pairs(n: int, wt: Path, kind: str) -> list[tuple[Path, str]]:
    studio = wt / 'work/studio'
    if kind == 'design':
        pairs = [(studio / f'sheets{n}/round{n}-{s}.png', f'{s}.png') for s in DESIGN_SHEETS]
        pairs.append((studio / f'board{n}-player-3x.png', 'board-player-3x.png'))
    else:
        pairs = [(studio / f'video{n}/{s}.png', f'{s}.png') for s in MOTION_SHEETS]
    return pairs


def ref_pairs(directory: Path, kind: str) -> list[tuple[Path, str]]:
    if kind == 'design':
        pairs = [(directory / f'sheets/round0-{s}.png', f'{s}.png') for s in DESIGN_SHEETS]
        pairs.append((directory / 'board0-player-3x.png', 'board-player-3x.png'))
    else:
        pairs = [(directory / f'video0/{s}.png', f'{s}.png') for s in MOTION_SHEETS]
    return pairs


def stage_pairs(pairs: list[tuple[Path, str]], dest: Path) -> tuple[str, list[str]]:
    dest.mkdir(parents=True, exist_ok=True)
    missing = [str(src) for src, _ in pairs if not src.exists()]
    if missing:
        sys.exit('frame set incomplete:\n  ' + '\n  '.join(missing))
    for src, name in pairs:
        shutil.copyfile(src, dest / name)
    return dest.relative_to(MAIN).as_posix(), [name for _, name in pairs]


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


def _log_agy(stdout: str, task: str) -> None:
    """Log a finished agy run in the usage ledger (ops/usage/collect.py --run -); never fails the caller."""
    collect = Path(__file__).resolve().parents[2] / 'ops' / 'usage' / 'collect.py'
    try:
        subprocess.run([sys.executable, str(collect), '--run', '-', '--task', task], input=stdout,
                       capture_output=True, text=True, encoding='utf-8', timeout=60)
    except Exception:
        pass


def gemini(p: str, dest: Path, kind: str) -> str:
    pf = dest / f'{kind}-gemini-prompt.txt'
    pf.write_text(p, encoding='utf-8')
    agy = shutil.which('agy') or 'agy'
    r = subprocess.run([agy, '-p', p, '--model', 'gemini-3.8-flash-high', '--output-format', 'json',
                        '--print-timeout', '1200s'], cwd=MAIN, capture_output=True, text=True, encoding='utf-8')
    if not r.stdout.strip():
        return r.stderr[-2000:]
    _log_agy(r.stdout, f'critique {kind}')
    try:
        return json.loads(r.stdout).get('response', '')
    except json.JSONDecodeError:
        return r.stdout


def grok(p: str, dest: Path, kind: str) -> str:
    pf = dest / f'{kind}-grok-prompt.txt'
    pf.write_text(p, encoding='utf-8')
    r = subprocess.run(['node', str(GROK_BRIDGE), 'run', '--model', 'grok-4.7', '--effort', 'high',
                        '--cwd', str(MAIN), '--prompt-file', str(pf)], cwd=MAIN, capture_output=True, text=True,
                       encoding='utf-8')
    out = r.stdout
    return out.split('[grok-cc] Grok finished.')[-1]


def ask(name: str, fn, kind: str, dest: Path) -> dict:
    for t in range(1, TRIES + 1):
        raw = fn()
        (dest / f'{kind}-{name}-{t}.txt').write_text(raw or '', encoding='utf-8')
        obj = parse(raw or '', kind)
        if obj:
            obj['total'] = round(10 * sum(obj['criteria'][c]['score'] for c in CRITERIA[kind]) / len(CRITERIA[kind]), 1)
            return obj
        print(f'  {name}: no valid answer on try {t}', file=sys.stderr)
    return {}


def score_kind(kind: str, rel: str, files: list[str], dest: Path) -> dict:
    p = prompt(kind, rel, files)
    print(f'{kind}: asking both critics…', file=sys.stderr)
    with ThreadPoolExecutor(2) as pool:
        fg = pool.submit(ask, 'gemini', lambda: gemini(p, dest, kind), kind, dest)
        fk = pool.submit(ask, 'grok', lambda: grok(p, dest, kind), kind, dest)
        g, k = fg.result(), fk.result()
    res = {'gemini': g.get('total'), 'grok': k.get('total'), 'per_criterion': {}}
    for c in CRITERIA[kind]:
        res['per_criterion'][c] = [g.get('criteria', {}).get(c, {}).get('score'), k.get('criteria', {}).get(c, {}).get('score')]
    if g and k and abs(g['total'] - k['total']) <= AGREE:
        res['score'] = round((g['total'] + k['total']) / 2, 1)
    else:
        res['score'] = None
    res['issues'] = {'gemini': g.get('issues', []), 'grok': k.get('issues', [])}
    return res


def kinds_of(args: list[str]) -> list[str]:
    if '--only' not in args:
        return ['design', 'motion']
    kind = args[args.index('--only') + 1]
    if kind not in CRITERIA:
        sys.exit('--only design|motion')
    return [kind]


def cell(result: dict, kind: str) -> str:
    r = result.get(kind)
    if not r:
        return '—'
    s = f"{r['score']}" if r['score'] is not None else 'нет (расхождение)'
    return f"{s} (Gemini {r['gemini']}, Grok {r['grok']})"


def number(value) -> float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def relative(n: int) -> None:
    ours_path = MAIN / f'work/review/r{n}/scores.json'
    if not ours_path.exists():
        sys.exit(f'missing {ours_path}')
    ours = json.loads(ours_path.read_text(encoding='utf-8'))
    brands = {}
    for path in sorted((MAIN / 'work/review').glob('ref-*/scores.json')):
        brands[path.parent.name.removeprefix('ref-')] = json.loads(path.read_text(encoding='utf-8'))
    if not brands:
        sys.exit('no reference scores in work/review/ref-*/scores.json')
    names = ', '.join(brands)
    print(f'round {n} / reference ({names})')
    print('| kind | judge | ours | reference | ours/reference |')
    print('|---|---|---:|---:|---:|')
    ratios = {}
    for kind in ('design', 'motion'):
        ratios[kind] = {}
        for judge in ('gemini', 'grok'):
            own = number((ours.get(kind) or {}).get(judge))
            vals = [number((data.get(kind) or {}).get(judge)) for data in brands.values()]
            vals = [v for v in vals if v is not None]
            if own is None or not vals:
                print(f'| {kind} | {judge} | {own if own is not None else "—"} | — | — |')
                continue
            ref = sum(vals) / len(vals)
            ratio = own / ref if ref else None
            ratios[kind][judge] = ratio
            shown = f'{ratio:.3f}' if ratio is not None else '—'
            print(f'| {kind} | {judge} | {own} | {ref:.1f} | {shown} |')
    print()
    print('| kind | criterion | gemini ours/ref | grok ours/ref |')
    print('|---|---|---:|---:|')
    for kind in ('design', 'motion'):
        for criterion in CRITERIA[kind]:
            cells = []
            for index, judge in enumerate(('gemini', 'grok')):
                own = None
                per = (ours.get(kind) or {}).get('per_criterion') or {}
                pair = per.get(criterion) or [None, None]
                if index < len(pair):
                    own = number(pair[index])
                vals = []
                for data in brands.values():
                    ref_pair = ((data.get(kind) or {}).get('per_criterion') or {}).get(criterion) or [None, None]
                    if index < len(ref_pair) and number(ref_pair[index]) is not None:
                        vals.append(number(ref_pair[index]))
                if own is None or not vals or not sum(vals):
                    cells.append('—')
                else:
                    cells.append(f'{own / (sum(vals) / len(vals)):.3f}')
            print(f'| {kind} | {criterion} | {cells[0]} | {cells[1]} |')
    print()
    for kind in ('design', 'motion'):
        both = ratios[kind].get('gemini') is not None and ratios[kind].get('grok') is not None
        if not both:
            print(f'gate {kind}: no ratio')
            continue
        ok = ratios[kind]['gemini'] >= 0.9 and ratios[kind]['grok'] >= 0.9
        print(f"gate {kind}: {'≥ 90%' if ok else 'below 90%'} "
              f"(gemini {ratios[kind]['gemini']:.3f}, grok {ratios[kind]['grok']:.3f})")


def main() -> None:
    args = sys.argv[1:]
    if '--relative' in args:
        relative(int(args[args.index('--relative') + 1]))
        return
    kinds = kinds_of(args)
    if '--ref' in args:
        i = args.index('--ref')
        if i + 2 >= len(args):
            sys.exit(__doc__)
        brand, directory = args[i + 1], Path(args[i + 2])
        if not re.fullmatch(r'[a-z0-9-]+', brand):
            sys.exit('brand must be a short lowercase name')
        dest = MAIN / f'work/review/ref-{brand}'
        out_path = dest / 'scores.json'
        result = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {}
        for kind in kinds:
            rel, files = stage_pairs(ref_pairs(directory, kind), dest / kind)
            result[kind] = score_kind(kind, rel, files, dest)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'| ref-{brand} | {cell(result, "design")} | {cell(result, "motion")} |')
        return
    if len(args) < 2 or args[0].startswith('--'):
        sys.exit(__doc__)
    n, wt = int(args[0]), Path(args[1])
    dest = MAIN / f'work/review/r{n}'
    out_path = dest / 'scores.json'
    result = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {}
    for kind in kinds:
        rel, files = stage_pairs(round_pairs(n, wt, kind), dest / kind)
        result[kind] = score_kind(kind, rel, files, dest)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'| {n} | {cell(result, "design")} | {cell(result, "motion")} |')


if __name__ == '__main__':
    main()
