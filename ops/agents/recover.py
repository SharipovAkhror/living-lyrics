"""After the Station powered off or restarted: bring the work chats back, one process each.

The work chats (.claude/agents/ll-*.md, see registry.py) are background sessions under the Claude
daemon. A restart kills their processes and nothing starts them again (no autostart, the owner's
choice). They also use the terminal's Claude sign-in, not the desktop app's: when that sign-in is
gone they stop with "Login expired", even though the app still works.

    python ops/agents/recover.py [<repo>] [--dry-run]

1. `claude auth status`: not signed in -> print the one command for the owner, exit 2.
2. Every registered chat whose newest background session has no process: `claude respawn <id>`,
   the same conversation, never a copy (the same pick as keep_chats.py).
3. After a short wait, one line per chat: running, or what it waits for. A chat on the
   "Resume this conversation?" dialog waits for the owner. A desktop-app session with a work
   chat's name is a copy of that chat (the owner opened it in the app): it is named for
   archiving, which the app's own tools do (the /recover skill).

Exit 0 when every chat runs and none waits, 1 otherwise. Owner's rule: docs/process/after-restart.md.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from keep_chats import retired
from registry import cards, claude_bin, sessions

WAIT_S = 25


def signed_in(claude: str) -> bool:
    out = subprocess.run([claude, 'auth', 'status'], capture_output=True, encoding='utf-8', errors='replace')
    try:
        return bool(json.loads(out.stdout).get('loggedIn'))
    except ValueError:
        return False


def report(names: list[str], running: list[dict]) -> bool:
    """One line per chat from `claude agents --json --all`; True when all run and none waits."""
    ok = True
    for name in names:
        mine = sorted((s for s in running if s.get('name') == name), key=lambda s: s.get('startedAt', 0))
        bg = [s for s in mine if s.get('kind') == 'background']
        app = [s for s in mine if s.get('kind') != 'background']
        s = bg[-1] if bg else {}
        sid = s.get('id') or s.get('sessionId', '')[:8]
        if not s:
            line, ok = 'no background session (start it: rotate_chat.py)', False
        elif s.get('waitingFor'):
            line, ok = f'waits: {s["waitingFor"]} (owner opens the chat, picks Resume)', False
        elif s.get('pid'):
            line = 'running'
        else:
            line, ok = f'not running ({s.get("state", "?")})', False
        print(f'{name} · {sid}: {line}')
        for a in app:
            same = 'same conversation' if a.get('sessionId') == s.get('sessionId') else 'another conversation, check before archiving'
            print(f'  app copy {a.get("sessionId", "")[:8]} ({same})')
    return ok


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if a != '--dry-run']
    dry = '--dry-run' in sys.argv
    repo = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    claude = claude_bin()
    if not signed_in(claude):
        print('Claude in the terminal is signed out: the work chats cannot run.')
        print('Owner: run `claude auth login`, press Authorize in the browser, then run this again.')
        sys.exit(2)
    names = [c['chat'] for c in cards(repo)]
    todo = retired(sessions(include_done=True), set(names))
    for s in todo:
        sid = s.get('id') or s['sessionId'][:8]
        if dry:
            print(f'would respawn {s["name"]} · {sid}')
            continue
        r = subprocess.run([claude, 'respawn', sid], capture_output=True, encoding='utf-8', errors='replace')
        print(f'respawn {s["name"]} · {sid}: {"ok" if r.returncode == 0 else r.stderr.strip()}')
    if todo and not dry:
        time.sleep(WAIT_S)
    sys.exit(0 if report(names, sessions(include_done=True)) else 1)


if __name__ == '__main__':
    main()
