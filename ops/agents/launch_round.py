"""Launch the next studio round on Grok without a chat (one-shot, run by Windows Task Scheduler).

python ops/agents/launch_round.py 22

Scheduled on the Station as task «LL launch studio round 22» (Fri 2026-10-23 21:10, after the Grok
weekly reset). It needs no Claude session, so it survives chat rotation.

- If round <N-1> is not in origin/site/studio-pass yet but its branch exists, Grok finishes that
  round first (work/review/round<N-1>-brief.md on its branch); LL · Site reviews and merges it.
- Otherwise it creates site/studio-pass-r<N> from origin/site/studio-pass in the studio worktree
  and starts Grok on work/review/round<N>-brief.md.
Briefs live in the main folder's work/review (not in git). Every outcome is one line in
ops/agents/launch_round.log. Never touches main.
"""
import datetime
import os
import subprocess
import sys
from pathlib import Path

MAIN = Path('C:/Users/User/Documents/GitHub/living-lyrics')
WT = MAIN.parent / 'living-lyrics-wt' / 'studio-pass'
BRIDGE = Path.home() / '.claude/plugins/cache/xai-grok-build/grok-build/0.2.1/scripts/grok-bridge.mjs'
LOG = MAIN / 'ops' / 'agents' / 'launch_round.log'


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', *args], cwd=WT, capture_output=True, text=True, encoding='utf-8')


def log(msg: str) -> None:
    line = f'{datetime.datetime.now().isoformat(timespec="seconds")} {msg}'
    print(line)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(line + '\n')


def start(brief: Path) -> None:
    if not brief.exists():
        log(f'brief missing: {brief}')
        return
    env = dict(os.environ, GROK_BINARY=str(MAIN / 'ops' / 'agents' / 'grok_exec.mjs'))
    r = subprocess.run(['node', str(BRIDGE), 'run', '--background', '--write', '--model', 'grok-4.7',
                        '--effort', 'high', '--cwd', str(WT), '--prompt-file', str(brief)],
                       capture_output=True, text=True, encoding='utf-8', env=env)
    log(f'grok start {brief.name}: exit {r.returncode} {r.stdout.strip()[:200]} {r.stderr.strip()[-300:]}')


def main() -> int:
    n = int(sys.argv[1])
    prev = n - 1
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
        git('checkout', '-q', branch)
        log(f'round {n}: round {prev} not merged yet, Grok finishes it on {branch}')
        brief = MAIN / 'work' / 'review' / f'round{prev}-brief.md'
        done = git('log', '--oneline', f'origin/site/studio-pass..{branch}').stdout.strip()
        finish = brief.with_name(f'round{prev}-finish.md')
        finish.write_text(
            brief.read_text(encoding='utf-8') +
            f'\n\n## Where the previous executor stopped\n\nYou are on `{branch}` (pushed). A previous executor '
            'was stopped by a usage limit; its commits:\n\n```\n' + done + '\n```\n\n'
            'Read `git log` and the diffs first, do not redo committed work, verify it, then finish every '
            'Done-when item and push the branch.\n', encoding='utf-8')
        start(finish)
        return 0
    r = git('checkout', '-q', '-B', f'site/studio-pass-r{n}', 'origin/site/studio-pass')
    if r.returncode != 0:
        log(f'round {n}: checkout failed: {r.stderr.strip()}')
        return 1
    start(MAIN / 'work' / 'review' / f'round{n}-brief.md')
    return 0


if __name__ == '__main__':
    sys.exit(main())
