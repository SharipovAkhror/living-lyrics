"""Keep the Living Lyrics work chats alive: respawn a background chat the Claude daemon retired.

The daemon stops a background session that has sat idle at its prompt for about 8 hours
(daemon.log: `bg retire <id>: idle-prompt, idle 8h`). A stopped session has no inbox, so
messages from the other chats no longer reach it. This script finds each chat of the registry
(.claude/agents/ll-*.md, see registry.py; background kind) that has lost its process and runs `claude respawn <id>` for it: the same
session and conversation, never a new copy. Archived chats (« · архив » in the name) and
sessions stopped on purpose (`claude stop`, state `stopped`) are skipped.

The Dashboard mod runs it every 10 minutes on the orchestrator machine. Several sessions there
run the mod, so a stamp in <repo>/.git/ll-keep-chats.json makes runs closer than 5 minutes no-ops.

    python ops/agents/keep_chats.py [<repo>] [--dry-run]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from registry import cards, claude_bin, sessions

MIN_GAP_S = 300


def retired(running: list[dict], chats: set[str]) -> list[dict]:
    """Registered chats in the background whose process is gone."""
    return [
        s for s in running
        if s.get('kind') == 'background' and s.get('name') in chats and not s.get('pid') and s.get('state') != 'stopped'
    ]


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:] if a != '--dry-run']
    dry = '--dry-run' in sys.argv
    repo = Path(args[0]) if args else Path(__file__).resolve().parents[2]
    stamp = repo / '.git' / 'll-keep-chats.json'
    if not dry and stamp.is_file() and time.time() - json.loads(stamp.read_text(encoding='utf-8')).get('at', 0) < MIN_GAP_S:
        return
    claude = claude_bin()
    done = []
    for s in retired(sessions(), {c['chat'] for c in cards(repo)}):
        sid = s.get('id') or s['sessionId'][:8]
        if dry:
            print(f'would respawn {s["name"]} · {sid}')
            continue
        r = subprocess.run([claude, 'respawn', sid], capture_output=True, encoding='utf-8', errors='replace')
        done.append({'name': s['name'], 'id': sid, 'ok': r.returncode == 0})
        print(f'respawn {s["name"]} · {sid}: {"ok" if r.returncode == 0 else r.stderr.strip()}')
    if not dry:
        stamp.write_text(json.dumps({'at': time.time(), 'respawned': done}, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
