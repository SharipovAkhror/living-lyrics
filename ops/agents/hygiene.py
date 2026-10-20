"""Hygiene of the Living Lyrics repo and its chats: delete what is safe, report the rest.

Safe, deleted with --apply (each one fully merged into origin/main and clean):
- a remote branch (not main, live or a protected one);
- an executor worktree in ../living-lyrics-wt whose Grok session has finished, and its branch;
- a local branch no worktree has checked out.
Reported, never deleted: unmerged branches older than STALE_DAYS, worktrees with uncommitted work,
archived chats still running, two running chats under one name, tasks in progress with nobody on
them, and paths in the docs that point to nothing.

    python ops/agents/hygiene.py [<repo>] [--apply] [--repo-only] [--json]

--repo-only skips what lives on the Station (worktrees, local branches, chats): the nightly cloud
routine runs it that way. Every chat runs it at the end of a step (AGENTS.md); the Dashboard mod
runs it hourly on the Station (station_tick.py) and shows the result.
"""
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

PROTECTED = {'main', 'live', 'll-business', 'HEAD'}
STALE_DAYS = 7
ON_OTHER_BRANCHES = {'ops/live.json'}  # lives on the `live` branch
DOC_PATH = re.compile(r'`((?:docs|ops|src|scripts|content|\.claude|\.github)/[A-Za-z0-9_./-]+)`')


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, encoding='utf-8', errors='replace')


def merged(repo: Path, ref: str) -> bool:
    return git(repo, 'merge-base', '--is-ancestor', ref, 'origin/main').returncode == 0


def board_worktrees(repo: Path) -> set[str]:
    try:
        board = json.loads((repo / 'ops' / 'board.json').read_text(encoding='utf-8'))
        return {t['worktree'] for t in board.get('tasks', []) if t.get('worktree') and t.get('section') in ('now', 'you', 'later')}
    except (OSError, ValueError, KeyError):
        return set()


def safe_to_delete(repo: Path, ref: str, on_board: set[str]) -> bool:
    """Merged and really finished. A branch freshly cut from main (tip == origin/main, no commits yet)
    also passes is-ancestor, so skip it, anything younger than a day, and branches of tasks on the board."""
    if not merged(repo, ref):
        return False
    tip = git(repo, 'rev-parse', ref).stdout.strip()
    if tip == git(repo, 'rev-parse', 'origin/main').stdout.strip():
        return False
    if age_days(repo, ref) < 1:
        return False
    return ref.removeprefix('origin/').rsplit('/', 1)[-1] not in on_board


def age_days(repo: Path, ref: str) -> float:
    out = git(repo, 'log', '-1', '--format=%ct', ref).stdout.strip()
    return (datetime.datetime.now().timestamp() - int(out)) / 86400 if out else 0


def worktrees(repo: Path) -> list[dict]:
    rows, cur = [], {}
    for line in git(repo, 'worktree', 'list', '--porcelain').stdout.splitlines() + ['']:
        if not line:
            if cur:
                rows.append(cur)
            cur = {}
        elif line.startswith('worktree '):
            cur['path'] = Path(line[9:])
        elif line.startswith('branch '):
            cur['branch'] = line[7:].removeprefix('refs/heads/')
        elif line.startswith('HEAD '):
            cur['head'] = line[5:]
    return rows


def grok_states(main: Path) -> dict[str, str]:
    """Each executor folder's Grok state (agents_live.py): working, stalled, finished or none."""
    script = main / 'ops' / 'dashboard-mod' / 'hooks' / 'agents_live.py'
    out = subprocess.run([sys.executable, str(script), str(main)], capture_output=True, encoding='utf-8', errors='replace')
    try:
        return {r['name']: r.get('state', '') for r in json.loads(out.stdout).get('grok', [])}
    except (ValueError, KeyError):
        return {}


def check_branches(repo: Path, apply: bool, fixed: list, issues: list) -> None:
    on_board = board_worktrees(repo)
    for line in git(repo, 'branch', '-r', '--format=%(refname:short)').stdout.split():
        name = line.removeprefix('origin/')
        if name in PROTECTED or not line.startswith('origin/'):
            continue
        if safe_to_delete(repo, line, on_board):
            if apply and git(repo, 'push', '-q', 'origin', '--delete', name).returncode == 0:
                fixed.append(f'удалена влитая ветка на GitHub: {name}')
            else:
                issues.append(f'влитая ветка на GitHub ещё не удалена: {name}')
        elif not merged(repo, line) and age_days(repo, line) > STALE_DAYS:
            issues.append(f'ветка {name} не влита и не менялась {int(age_days(repo, line))} дн.')


def check_local(repo: Path, apply: bool, fixed: list, issues: list) -> None:
    trees = worktrees(repo)
    main = trees[0]['path']
    states = grok_states(main)
    on_board = board_worktrees(repo)
    wt_root = (main.parent / 'living-lyrics-wt').resolve()
    for t in trees[1:]:
        path, branch = t['path'], t.get('branch', '')
        if branch in PROTECTED or not path.is_dir():
            continue
        dirty = bool(git(path, 'status', '--porcelain').stdout.strip())
        done = bool(branch) and merged(repo, branch)
        if path.parent.resolve() == wt_root:
            # An executor's folder: its Grok session must have finished, not merely never started,
            # and its task must be off the board (a task waiting on the owner comes back to it).
            if path.name in on_board:
                continue
            if done and not dirty and states.get(path.name) == 'finished':
                if apply and git(repo, 'worktree', 'remove', str(path)).returncode == 0:
                    git(repo, 'branch', '-d', branch)
                    fixed.append(f'убрана папка исполнителя {path.name} и ветка {branch} (влиты)')
                else:
                    issues.append(f'папка исполнителя {path.name} влита, но не убрана')
            elif dirty and age_days(repo, branch or 'HEAD') > STALE_DAYS:
                issues.append(f'в папке {path.name} несохранённая работа, последняя запись {int(age_days(repo, branch))} дн. назад')
        elif done and not dirty and age_days(repo, branch) > 1:
            issues.append(f'рабочая копия чата {path.name} влита и стоит больше суток — её уберёт сам чат или `claude rm`')
    checked_out = {t.get('branch') for t in trees}
    for name in git(repo, 'branch', '--format=%(refname:short)').stdout.split():
        if name in PROTECTED or name in checked_out:
            continue
        if safe_to_delete(repo, name, on_board):
            if apply and git(repo, 'branch', '-d', name).returncode == 0:
                fixed.append(f'удалена влитая локальная ветка {name}')
            else:
                issues.append(f'влитая локальная ветка {name} не удалена')


def check_chats(repo: Path, issues: list) -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from registry import cards, sessions
        running = sessions()
    except Exception:
        return
    for s in running:
        if 'архив' in (s.get('name') or '') and s.get('pid'):
            issues.append(f'архивный чат «{s["name"]}» ещё работает (pid {s["pid"]})')
    for card in cards(repo):
        live = [s for s in running if s.get('name') == card['chat'] and s.get('pid')]
        if len(live) > 1:
            issues.append(f'«{card["chat"]}» запущен дважды: ' + ', '.join((s.get('id') or s.get('sessionId', ''))[:8] for s in live))


def check_board(repo: Path, issues: list) -> None:
    try:
        board = json.loads((repo / 'ops' / 'board.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        issues.append('ops/board.json не читается')
        return
    for t in board.get('tasks', []):
        if t.get('section') == 'now' and not (t.get('agent') or t.get('who')):
            issues.append(f'на доске задача без исполнителя: {t.get("title")}')


def check_docs(repo: Path, issues: list) -> None:
    # The standing docs only: task briefs and research name files that are still to be made.
    files = [repo / 'AGENTS.md', repo / 'docs' / 'STATUS.md', *repo.glob('docs/process/*.md'), *repo.glob('docs/methodology/*.md'),
             *repo.glob('ops/*.md'), *repo.glob('.claude/agents/*.md')]
    missing = []
    for f in files:
        if not f.is_file():
            continue
        for ref in DOC_PATH.findall(f.read_text(encoding='utf-8', errors='replace')):
            target = ref.rstrip('.,/')
            if any(c in target for c in '*<>{}') or 'YYYY' in target or target in ON_OTHER_BRANCHES or (repo / target).exists():
                continue
            missing.append(f'{f.relative_to(repo).as_posix()} → {target}')
    for m in sorted(set(missing))[:20]:
        issues.append(f'ссылка на несуществующее: {m}')
    if len(set(missing)) > 20:
        issues.append(f'… и ещё {len(set(missing)) - 20} таких ссылок')


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    repo = Path(args[0]).resolve() if args else Path(__file__).resolve().parents[2]
    apply = '--apply' in flags
    fixed, issues = [], []
    git(repo, 'fetch', '-q', '--prune', 'origin')
    check_branches(repo, apply, fixed, issues)
    if '--repo-only' not in flags:
        check_local(repo, apply, fixed, issues)
        check_chats(repo, issues)
    check_board(repo, issues)
    check_docs(repo, issues)
    at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if '--json' in flags:
        print(json.dumps({'at': at, 'fixed': fixed, 'issues': issues}, ensure_ascii=False))
        return
    for line in fixed:
        print(f'✓ {line}')
    for line in issues:
        print(f'• {line}')
    if not fixed and not issues:
        print('порядок')


if __name__ == '__main__':
    main()
