"""Launch the next studio round on Grok without a chat (one-shot, run by Windows Task Scheduler).

python scripts/review/launch_round.py <round> [--wt <studio worktree>] [--dry-run]

It needs no Claude session, so it survives chat rotation.

- If round <N-1> is not in origin/site/studio-pass yet but its branch exists, Grok finishes that
  round first (work/review/round<N-1>-finish.md on its branch); LL · Site reviews and merges it.
- Otherwise it creates site/studio-pass-r<N> from origin/site/studio-pass in the studio worktree
  and starts Grok on work/review/round<N>-brief.md.
Briefs live in this checkout's work/review (not in git). The studio worktree defaults to
../living-lyrics-wt/studio-pass beside this repo. Every outcome is one line in
work/review/launch_round.log. Never touches main. --dry-run fetches and runs the checks, then
logs what it would do: no checkout, no brief written, nothing started.
"""
import datetime
import os
import subprocess
import sys
from pathlib import Path

USAGE = 'usage: launch_round.py <round> [--wt <studio worktree>] [--dry-run]'


def main_checkout() -> Path:
    """The repo's main checkout, also when this file runs from a linked worktree."""
    here = Path(__file__).resolve().parents[2]
    r = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                       cwd=here, capture_output=True, text=True, encoding='utf-8')
    common = Path(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else None
    return common.parent if common is not None and common.name == '.git' else here


MAIN = main_checkout()
WT = MAIN.parent / 'living-lyrics-wt' / 'studio-pass'
BRIDGE = Path.home() / '.claude/plugins/cache/xai-grok-build/grok-build/0.2.1/scripts/grok-bridge.mjs'
LOG = MAIN / 'work' / 'review' / 'launch_round.log'


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', *args], cwd=WT, capture_output=True, text=True, encoding='utf-8')


def log(msg: str) -> None:
    line = f'{datetime.datetime.now().isoformat(timespec="seconds")} {msg}'
    print(line)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(line + '\n')


def grok_env() -> dict[str, str]:
    """GROK_BINARY from the environment, else the compiled trimmer, else leave it unset."""
    env = dict(os.environ)
    if env.get('GROK_BINARY'):
        return env
    local = os.environ.get('LOCALAPPDATA')
    exe = Path(local) / 'aos' / 'bin' / 'grok_exec.exe' if local else None
    if exe is not None and exe.is_file():
        # The bridge spawns this with no shell and rejects backslashes.
        env['GROK_BINARY'] = exe.as_posix()
        return env
    log('starting Grok without the tool trimming')
    return env


def start(brief: Path, dry: bool = False) -> None:
    if not brief.exists():
        log(f'brief missing: {brief}')
        return
    if dry:
        log(f'would start Grok on {brief}')
        return
    env = grok_env()
    r = subprocess.run(['node', str(BRIDGE), 'run', '--background', '--write', '--model', 'grok-4.7',
                        '--effort', 'high', '--cwd', str(WT), '--prompt-file', str(brief)],
                       capture_output=True, text=True, encoding='utf-8', env=env)
    log(f'grok start {brief.name}: exit {r.returncode} {r.stdout.strip()[:200]} {r.stderr.strip()[-300:]}')


def parse_args(argv: list[str]) -> tuple[int, Path, bool]:
    dry = False
    wt: Path | None = None
    numbers: list[str] = []
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg in ('-h', '--help'):
            print(USAGE)
            raise SystemExit(0)
        if arg == '--dry-run':
            dry = True
        elif arg == '--wt':
            i += 1
            if i >= len(argv):
                raise SystemExit(USAGE)
            wt = Path(argv[i])
        else:
            numbers.append(arg)
        i += 1
    if len(numbers) != 1 or not numbers[0].isdigit():
        raise SystemExit(USAGE)
    return int(numbers[0]), wt or WT, dry


def main() -> int:
    global WT
    n, WT, dry = parse_args(sys.argv)
    prev = n - 1
    if not WT.is_dir():
        log(f'round {n}: worktree {WT} is missing, nothing launched')
        return 1
    git('fetch', '-q', 'origin')
    if git('status', '--porcelain').stdout.strip():
        log(f'round {n}: worktree {WT} has uncommitted changes, nothing launched')
        return 1
    merged = f'Studio round {prev}' in git('log', '--oneline', '-80', 'origin/site/studio-pass').stdout
    if not merged:
        branch = f'site/studio-pass-r{prev}'
        if git('rev-parse', '--verify', '-q', branch).returncode != 0:
            log(f'round {n}: round {prev} neither merged nor on a branch, nothing launched')
            return 1
        brief = MAIN / 'work' / 'review' / f'round{prev}-brief.md'
        finish = brief.with_name(f'round{prev}-finish.md')
        if dry:
            missing = '' if brief.exists() else f'; brief missing: {brief}'
            log(f'round {n}: round {prev} not merged yet, would finish it on {branch} '
                f'(checkout {branch}, write {finish.name}, start Grok){missing}')
            return 0 if brief.exists() else 1
        git('checkout', '-q', branch)
        log(f'round {n}: round {prev} not merged yet, Grok finishes it on {branch}')
        done = git('log', '--oneline', f'origin/site/studio-pass..{branch}').stdout.strip()
        finish.write_text(
            brief.read_text(encoding='utf-8') +
            f'\n\n## Where the previous executor stopped\n\nYou are on `{branch}` (pushed). A previous executor '
            'was stopped by a usage limit; its commits:\n\n```\n' + done + '\n```\n\n'
            'Read `git log` and the diffs first, do not redo committed work, verify it, then finish every '
            'Done-when item and push the branch.\n', encoding='utf-8')
        start(finish)
        return 0
    branch = f'site/studio-pass-r{n}'
    brief = MAIN / 'work' / 'review' / f'round{n}-brief.md'
    if dry:
        log(f'round {n}: would checkout -B {branch} origin/site/studio-pass')
        start(brief, dry=True)
        return 0
    r = git('checkout', '-q', '-B', branch, 'origin/site/studio-pass')
    if r.returncode != 0:
        log(f'round {n}: checkout failed: {r.stderr.strip()}')
        return 1
    start(brief)
    return 0


if __name__ == '__main__':
    sys.exit(main())
