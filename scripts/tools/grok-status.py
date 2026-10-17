"""Live view of the Grok tasks: one git worktree per task in ../living-lyrics-wt/<name>.

For each task: branch, commits ahead of main, uncommitted files, whether Grok is still working,
and its latest steps (reasoning summaries, commands, messages) read from Grok's own session log
(~/.grok/sessions/<encoded worktree path>/<session>/chat_history.jsonl).

    python scripts/tools/grok-status.py              # all tasks, once
    python scripts/tools/grok-status.py --watch      # refresh every 20 s (Ctrl+C to stop)
    python scripts/tools/grok-status.py t1-sync -n 30  # one task, last 30 steps
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WT = ROOT.parent / 'living-lyrics-wt'
SESSIONS = Path.home() / '.grok' / 'sessions'


def git(cwd, *args):
    r = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True, encoding='utf-8')
    return r.stdout.strip()


def session_dir(worktree: Path):
    """Grok keys sessions by the working directory, percent-encoded with Windows separators."""
    key = urllib.parse.quote(str(worktree).replace('/', '\\'), safe='')
    base = SESSIONS / key
    if not base.is_dir():
        return None
    runs = [p for p in base.iterdir() if p.is_dir() and (p / 'chat_history.jsonl').exists()]
    return max(runs, key=lambda p: (p / 'chat_history.jsonl').stat().st_mtime) if runs else None


def working(sdir: Path):
    """True while the last Grok turn has not ended."""
    events = sdir / 'events.jsonl'
    if not events.exists():
        return True
    with open(events, 'rb') as fh:
        fh.seek(0, os.SEEK_END)
        fh.seek(max(0, fh.tell() - 4000))
        tail = fh.read().decode('utf-8', 'replace').splitlines()
    for line in reversed(tail):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get('type') == 'turn_ended':
            return False
        if ev.get('type') in ('phase_changed', 'turn_started', 'tool_started', 'tool_finished'):
            return True
    return True


def short(text, n):
    text = ' '.join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + '…'


def steps(sdir: Path, limit: int, width: int):
    out = []
    with open(sdir / 'chat_history.jsonl', encoding='utf-8', errors='replace') as fh:
        lines = fh.readlines()
    for line in lines[-400:]:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        t = o.get('type')
        if t == 'reasoning':
            for s in o.get('summary') or []:
                if s.get('text'):
                    out.append('  · думает: ' + short(s['text'], width))
        elif t == 'assistant':
            if o.get('content'):
                out.append('  » пишет: ' + short(o['content'], width))
            for call in o.get('tool_calls') or []:
                try:
                    args = json.loads(call.get('arguments') or '{}')
                except ValueError:
                    args = {}
                what = args.get('description') or args.get('command') or args.get('file_path') or args.get('path') or args.get('query') or ''
                out.append(f"  › {call.get('name')}: " + short(what, width))
    return out[-limit:]


def show(names, limit, width):
    if not WT.is_dir():
        print(f'Нет папки {WT}')
        return
    tasks = sorted(p for p in WT.iterdir() if p.is_dir() and (not names or p.name in names))
    for wt in tasks:
        branch = git(wt, 'branch', '--show-current')
        ahead = git(wt, 'rev-list', '--count', 'main..HEAD') or '?'
        dirty = len([x for x in git(wt, 'status', '--short').splitlines() if x.strip()])
        sdir = session_dir(wt)
        if sdir is None:
            state, ago = 'нет журнала Grok', ''
        else:
            mtime = (sdir / 'chat_history.jsonl').stat().st_mtime
            mins = int((time.time() - mtime) // 60)
            state = 'работает' if working(sdir) else 'закончил'
            ago = f', последнее действие {mins} мин назад'
        print(f'■ {wt.name}  [{branch}]  {state}{ago}; коммитов: {ahead}, несохранённых файлов: {dirty}')
        if sdir is not None:
            for s in steps(sdir, limit, width):
                print(s)
        print()


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('tasks', nargs='*', help='имена задач (папок в living-lyrics-wt); по умолчанию все')
    ap.add_argument('-n', type=int, default=4, help='сколько последних шагов показывать')
    ap.add_argument('--watch', action='store_true', help='обновлять каждые 20 с')
    a = ap.parse_args()
    width = max(60, min(160, (os.get_terminal_size().columns if sys.stdout.isatty() else 140) - 14))
    while True:
        if a.watch:
            print('\033[2J\033[H', end='')
            print(time.strftime('%H:%M:%S'), '— задачи Grok (Ctrl+C — выход)\n')
        show(a.tasks, a.n, width)
        if not a.watch:
            break
        time.sleep(20)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
