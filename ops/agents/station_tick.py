"""One tick of the orchestrator machine, for the Dashboard mod (every 2 minutes).

1. Keeps the main checkout on origin/main: the chats push from worktrees, so the board and the mod's
   own code on disk would lag. Fast-forward only, and only when no file dirty here (the usage
   collector rewrites ops/usage/*) changed upstream; anything else is left as it is.
2. Runs hygiene.py --apply once an hour (safe deletions; the rest is reported).
3. Prints the chats of the registry with their state (registry.py), the GitHub Actions runs in
   progress and the last hygiene result, as JSON:
   {"chats": [...], "pipeline": [{"name", "title", "minutes"}], "failed": [{"id", "name", "branch", "title", "url", "at"}],
   "hygiene": {"at", "fixed", "issues"}}.

    python ops/agents/station_tick.py [<repo>]
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

from registry import live_chats

HYGIENE_S = 3600


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


def failed(repo: Path) -> list[dict]:
    """Workflow runs that failed in the last 24 h: the mod hands each new one to LL · Main once.

    GitHub mails a failure to the account that pushed, and every chat and executor pushes as the
    owner; the owner turns those mails off and the orchestrator gets them here instead."""
    out = subprocess.run(
        ['gh', 'run', 'list', '--status', 'failure', '--limit', '10', '--json', 'databaseId,workflowName,headBranch,displayTitle,createdAt,url'],
        cwd=repo, capture_output=True, encoding='utf-8', errors='replace',
    )
    if out.returncode != 0:
        return []
    now = datetime.datetime.now(datetime.timezone.utc)
    rows = []
    for r in json.loads(out.stdout or '[]'):
        at = datetime.datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00'))
        if now - at < datetime.timedelta(hours=24):
            rows.append({'id': r['databaseId'], 'name': r['workflowName'], 'branch': r['headBranch'], 'title': r['displayTitle'], 'url': r['url'], 'at': r['createdAt']})
    return rows


def hygiene(repo: Path) -> dict | None:
    """hygiene.py --apply once an hour; the last result is kept in .git and returned every tick."""
    cache = Path(git(repo, 'rev-parse', '--absolute-git-dir').stdout.strip()) / 'll-hygiene.json'
    try:
        last = json.loads(cache.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        last = None
    at = datetime.datetime.fromisoformat(last['at'].replace('Z', '+00:00')) if last else None
    if at and (datetime.datetime.now(datetime.timezone.utc) - at).total_seconds() < HYGIENE_S:
        return last
    out = subprocess.run([sys.executable, str(Path(__file__).with_name('hygiene.py')), str(repo), '--apply', '--json'],
                         capture_output=True, encoding='utf-8', errors='replace', timeout=240)
    try:
        last = json.loads(out.stdout)
    except ValueError:
        return last
    cache.write_text(json.dumps(last, ensure_ascii=False), encoding='utf-8')
    return last


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    repo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
    state = sync(repo)
    try:
        chats = live_chats(repo)
    except Exception:  # no claude CLI on PATH
        chats = []
    print(json.dumps({'sync': state, 'chats': chats, 'pipeline': pipeline(repo), 'failed': failed(repo), 'hygiene': hygiene(repo)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
