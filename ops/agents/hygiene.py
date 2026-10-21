"""Hygiene of the Living Lyrics repo and its chats: delete what is safe, report the rest.

Safe, deleted with --apply (each one fully merged into origin/main and clean):
- a remote branch (not main, live or a protected one);
- an executor worktree in ../living-lyrics-wt whose Grok session has finished, and its branch;
- a local branch no worktree has checked out.
Reported, never deleted: unmerged branches older than STALE_DAYS, worktrees with uncommitted work,
archived chats still running, two running chats under one name, tasks in progress with nobody on
them, paths in the docs that point to nothing, a done card still marked running, sync
counts that drift from the table in docs/tasks/T1-sync.md (section «Счёт синхронизации»),
and a done or rejected card tN whose brief exists but does not say «сделано» or «отклонено» on line 1.

    python ops/agents/hygiene.py [<repo>] [--apply] [--repo-only] [--json]

--repo-only skips what lives on the Station (worktrees, local branches, chats): the GitHub workflow
.github/workflows/cleanup.yml runs it that way after every update of main. Every chat runs it at the end of a step (AGENTS.md); the Dashboard mod
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
        if t.get('section') == 'done' and t.get('status') == 'running':
            issues.append(f'сделанная карточка всё ещё «идёт»: {t.get("id")}')


SYNC_GROUPS = {
    'i have come alive, соло': ('ihca', 'Соло'),
    'karitas, соло': ('karitas', 'Соло'),
    'one, соло': ('one', 'Соло'),
    'one, хор': ('one', 'Хор'),
}
# Denominators that have been used for a sync group. A fraction with one of these
# outside the canonical table is a second count of the same sync.
SYNC_TOTALS = {120, 122, 125, 60, 61, 37, 26, 63}
SYNC_FRACTION = re.compile(r'(\d+)\s*/\s*(\d+)|(\d+)\s+из\s+(\d+)')


def parse_sync_table(repo: Path) -> tuple[list[dict], str | None]:
    path = repo / 'docs' / 'tasks' / 'T1-sync.md'
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError:
        return [], 'нет docs/tasks/T1-sync.md'
    start = next((i for i, line in enumerate(lines) if line.strip() == '## Счёт синхронизации'), None)
    if start is None:
        return [], 'в docs/tasks/T1-sync.md нет раздела «Счёт синхронизации»'
    rows = []
    for line in lines[start + 1:]:
        if line.startswith('## '):
            break
        if not line.startswith('|'):
            continue
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if not cells or cells[0] in ('Группа', '') or all(set(cell) <= set('-: ') for cell in cells):
            continue
        nums = [int(cell) for cell in cells[1:] if re.fullmatch(r'\d+', cell)]
        if len(nums) < 3:
            continue
        rows.append({'name': cells[0].lower(), 'proven': nums[0], 'placed': nums[1], 'total': nums[2]})
    if len(rows) != 4:
        return rows, f'в таблице синхронизации {len(rows)} строк, ожидается 4'
    return rows, None


def check_sync(repo: Path, issues: list) -> None:
    rows, error = parse_sync_table(repo)
    if error:
        issues.append(error)
        return
    allowed = {(row['proven'], row['total']) for row in rows} | {(row['placed'], row['total']) for row in rows}
    try:
        board = json.loads((repo / 'ops' / 'board.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        issues.append('ops/board.json не читается, счёт синхронизации не сверить')
        return
    found = {}
    for song in board.get('songs') or []:
        for group in song.get('groups') or []:
            found[(song.get('id'), group.get('name'))] = (
                group.get('proven'), group.get('placed'), group.get('total'),
            )
    for row in rows:
        key = SYNC_GROUPS.get(row['name'])
        if key is None:
            issues.append(f'неизвестная группа в таблице синхронизации: {row["name"]}')
            continue
        got = found.get(key)
        expect = (row['proven'], row['placed'], row['total'])
        if got != expect:
            issues.append(
                f'доска songs {key[0]}/{key[1]} = {got}, таблица T1 = {expect}'
            )
    for key in found:
        if key not in SYNC_GROUPS.values():
            issues.append(f'на доске группа вне таблицы синхронизации: {key[0]}/{key[1]}')
    prose = []
    for label, path in (('docs/STATUS.md', repo / 'docs' / 'STATUS.md'), ('docs/BACKLOG.md', repo / 'docs' / 'BACKLOG.md')):
        try:
            prose.append((label, path.read_text(encoding='utf-8')))
        except OSError:
            issues.append(f'не читается {label}')
    for task in board.get('tasks') or []:
        if task.get('id') != 't1':
            continue
        for field in ('title', 'what', 'now', 'next'):
            prose.append((f'board.t1.{field}', str(task.get(field) or '')))
    for song in board.get('songs') or []:
        if song.get('note'):
            prose.append((f'board.songs.{song.get("id")}.note', str(song['note'])))
    for label, text in prose:
        for match in SYNC_FRACTION.finditer(text):
            proven = int(match.group(1) or match.group(3))
            total = int(match.group(2) or match.group(4))
            if total in SYNC_TOTALS and (proven, total) not in allowed:
                issues.append(f'другой счёт синхронизации в {label}: {proven}/{total}')


BRIEF_ID = re.compile(r'^t(\d+)$')


def check_brief_marks(repo: Path, issues: list) -> None:
    """A finished card tN with a brief must say so on the brief's first line.

    Cards with no brief, and ids that are not t plus digits (t7d, d-mark), are skipped.
    The mark belongs in the same commit that sets the card to done or rejected.
    """
    try:
        board = json.loads((repo / 'ops' / 'board.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return
    tasks_dir = repo / 'docs' / 'tasks'
    for task in board.get('tasks') or []:
        match = BRIEF_ID.fullmatch(str(task.get('id') or ''))
        if match is None or task.get('section') != 'done':
            continue
        status = task.get('status')
        if status == 'done':
            need = 'сделано'
        elif status == 'rejected':
            need = 'отклонено'
        else:
            continue
        for brief in sorted(tasks_dir.glob(f'T{match.group(1)}-*.md')):
            try:
                first = brief.read_text(encoding='utf-8').splitlines()[0]
            except (OSError, IndexError):
                issues.append(f'бриф {brief.name} не читается')
                continue
            if need not in first:
                issues.append(
                    f'карточка {task.get("id")} — {status}, а первая строка {brief.name} без «{need}»'
                )


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
    check_sync(repo, issues)
    check_brief_marks(repo, issues)
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
