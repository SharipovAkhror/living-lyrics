"""One tick of the orchestrator machine, for the Dashboard mod (every 2 minutes).

1. Keeps the main checkout on origin/main: the chats push from worktrees, so the board and the mod's
   own code on disk would lag. Fast-forward only, and only when no file dirty here (the usage
   collector rewrites ops/usage/*) changed upstream; anything else is left as it is.
2. Prints the chats of the registry with their state (registry.py) and the GitHub Actions runs in
   progress, as JSON: {"chats": [...], "pipeline": [{"name", "title", "minutes"}]}.

    python ops/agents/station_tick.py [<repo>]
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

from registry import live_chats


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, encoding='utf-8', errors='replace')


def sync(repo: Path) -> str:
    if git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.strip() != 'main':
        return 'not on main'
    if git(repo, 'fetch', '-q', 'origin', 'main').returncode != 0:
        return 'offline'
    if git(repo, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main').returncode != 0:
        return 'local commits'
    behind = git(repo, 'rev-list', '--count', 'HEAD..origin/main').stdout.strip()
    if behind in ('', '0'):
        return 'up to date'
    dirty = {line[3:] for line in git(repo, 'status', '--porcelain').stdout.splitlines() if line}
    upstream = set(git(repo, 'diff', '--name-only', 'HEAD', 'origin/main').stdout.split())
    if dirty & upstream:
        return f'dirty here and changed upstream: {", ".join(sorted(dirty & upstream))}'
    out = git(repo, 'merge', '--ff-only', '--autostash', '-q', 'origin/main')
    return f'pulled {behind}' if out.returncode == 0 else f'merge failed: {out.stderr.strip()}'


def pipeline(repo: Path) -> list[dict]:
    out = subprocess.run(
        ['gh', 'run', 'list', '--status', 'in_progress', '--limit', '5', '--json', 'workflowName,displayTitle,createdAt'],
        cwd=repo, capture_output=True, encoding='utf-8', errors='replace',
    )
    if out.returncode != 0:
        return []
    now = datetime.datetime.now(datetime.timezone.utc)
    runs = []
    for r in json.loads(out.stdout or '[]'):
        started = datetime.datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00'))
        runs.append({'name': r['workflowName'], 'title': r['displayTitle'], 'minutes': int((now - started).total_seconds() // 60)})
    return runs


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    repo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
    state = sync(repo)
    try:
        chats = live_chats(repo)
    except Exception:  # no claude CLI on PATH
        chats = []
    print(json.dumps({'sync': state, 'chats': chats, 'pipeline': pipeline(repo)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
