"""Publish the executors' live state to the `live` branch so every device can read it.

The state is what ops/dashboard-mod/hooks/agents_live.py prints (Grok tasks and Gemini runs), plus
the chats and Actions runs the mod adds from ops/agents/station_tick.py;
a cloud orchestrator can pipe the same JSON in with --stdin instead. It is written as
ops/live.json on an orphan branch `live` (one commit, force-pushed: the branch holds only the
latest state, so main and the history stay clean). The dashboard mod on other devices reads
https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/live/ops/live.json
(raw.githubusercontent caches for up to ~5 minutes).

Publishes when the set of states changed, plus a heartbeat every HEARTBEAT_MIN even when idle, so a
reader can tell a quiet machine from a dead one (`at` older than 45 min = no news; the
station-watch workflow opens an issue when it is older than 30 min). The last published
signature is cached in <repo>/.git/ll-live.json; nothing in the working tree or any branch of
the main checkout is touched (git plumbing only).

    python ops/agents/publish_live.py [<repo>] [--stdin] [--force] [--dry-run]
"""
import datetime
import hashlib
import json
import subprocess
import sys
from pathlib import Path

BRANCH = 'live'
# The mod calls this every 10 min; 9 keeps a 10-min beat despite timer jitter.
HEARTBEAT_MIN = 9
HERE = Path(__file__).resolve().parent
AGENTS_LIVE = HERE.parent / 'dashboard-mod' / 'hooks' / 'agents_live.py'
# Vercel builds every pushed branch; this file in the branch's own tree turns that off for it.
VERCEL = '{\n  "$schema": "https://openapi.vercel.sh/vercel.json",\n  "git": { "deploymentEnabled": false }\n}\n'
README = (
    'Живое состояние исполнителей для мода Dashboard: `ops/live.json`. '
    'Ветка перезаписывается одним коммитом (`ops/agents/publish_live.py`), в неё ничего не вливается.\n'
)


def git(repo: Path, *args: str, data: str | None = None) -> str:
    # Bytes in and out: text mode on Windows would add a CR to every line of blobs and tree entries.
    out = subprocess.run(['git', '-C', str(repo), *args], input=data.encode('utf-8') if data is not None else None, capture_output=True)
    if out.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)}: {out.stderr.decode("utf-8", "replace").strip()}')
    return out.stdout.decode('utf-8', 'replace').strip()


def signature(live: dict) -> str:
    """The states only: no minutes, steps or token counts, which change every poll."""
    grok = sorted((r.get('name', ''), r.get('state', ''), r.get('model', '')) for r in live.get('grok') or [])
    gemini = sorted(r.get('slug', '') for r in live.get('gemini') or [])
    chats = sorted((c.get('name', ''), c.get('state', '')) for c in live.get('chats') or [])
    runs = sorted(r.get('title', '') for r in live.get('pipeline') or [])
    return hashlib.sha256(json.dumps([grok, gemini, chats, runs]).encode()).hexdigest()[:16]


def minutes_since(iso: str) -> float:
    try:
        t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    except ValueError:
        return 1e9
    return (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 60


def collect(repo: Path, use_stdin: bool) -> dict:
    if use_stdin:
        return json.loads(sys.stdin.read())
    out = subprocess.run([sys.executable, str(AGENTS_LIVE), str(repo)], capture_output=True, encoding='utf-8', errors='replace', timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f'agents_live.py: {out.stderr.strip()}')
    return json.loads(out.stdout)


def commit_tree(repo: Path, files: dict[str, str]) -> str:
    """One parentless commit holding `files` (path → text), built without a checkout."""
    def tree(entries: dict) -> str:
        lines = []
        for name, value in sorted(entries.items()):
            if isinstance(value, dict):
                lines.append(f'040000 tree {tree(value)}\t{name}')
            else:
                lines.append(f'100644 blob {git(repo, "hash-object", "-w", "--stdin", data=value)}\t{name}')
        return git(repo, 'mktree', data='\n'.join(lines) + '\n')

    root: dict = {}
    for path, text in files.items():
        node = root
        *folders, leaf = path.split('/')
        for f in folders:
            node = node.setdefault(f, {})
        node[leaf] = text
    return git(repo, 'commit-tree', tree(root), '-m', 'Live state of the executors (overwritten by publish_live.py)')


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    repo = Path(args[0]).resolve() if args else Path.cwd()
    cache = Path(git(repo, 'rev-parse', '--absolute-git-dir')) / 'll-live.json'

    live = collect(repo, '--stdin' in flags)
    sig = signature(live)
    try:
        last = json.loads(cache.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        last = {}
    stale = minutes_since(last.get('at', '')) >= HEARTBEAT_MIN
    if '--force' not in flags and last.get('signature') == sig and not stale:
        print('unchanged')
        return 0

    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    body = json.dumps({'at': now, **live}, ensure_ascii=False, indent=2) + '\n'
    if '--dry-run' in flags:
        print(body, end='')
        return 0
    sha = commit_tree(repo, {'ops/live.json': body, 'vercel.json': VERCEL, 'README.md': README})
    git(repo, 'push', '--force', 'origin', f'{sha}:refs/heads/{BRANCH}')
    cache.write_text(json.dumps({'signature': sig, 'at': now}), encoding='utf-8')
    print(f'published {sha[:7]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:  # the mod runs this unattended: report, never raise a trace at the owner
        print(f'publish_live: {e}', file=sys.stderr)
        sys.exit(1)
