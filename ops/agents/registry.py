"""The registry of Living Lyrics chats: one role card per chat in .claude/agents/ll-*.md.

A card is an ordinary Claude Code agent definition (a chat starts from it with
`claude --agent <name> --bg`), plus a few fields of ours in its frontmatter: `chat` (the chat's
name and address), `cwd`, `branch`, `reports_to`. Adding a chat = one card + rotate_chat.py.
keep_chats.py, rotate_chat.py and publish_live.py read the cards from here; the live state of each
chat comes from `claude agents --json`.

    python ops/agents/registry.py [<repo>]      # the chats with their live state, as JSON
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def claude_bin() -> str:
    """claude.exe behind npm's claude.cmd shim (cmd.exe would mangle the Cyrillic names)."""
    found = shutil.which('claude') or 'claude'
    if found.lower().endswith('.cmd'):
        exe = Path(found).parent / 'node_modules' / '@anthropic-ai' / 'claude-code' / 'bin' / 'claude.exe'
        if exe.is_file():
            return str(exe)
    return found


def cards(repo: Path = REPO) -> list[dict]:
    """The frontmatter of every role card: flat `key: value` lines between the `---` fences."""
    out = []
    for path in sorted((repo / '.claude' / 'agents').glob('ll-*.md')):
        head = path.read_text(encoding='utf-8').split('---')[1]
        card = {k.strip(): v.strip() for k, _, v in (line.partition(':') for line in head.splitlines()) if k.strip()}
        if card.get('chat'):
            out.append(card)
    return out


def sessions() -> list[dict]:
    out = subprocess.run([claude_bin(), 'agents', '--json'], capture_output=True, encoding='utf-8', errors='replace')
    if out.returncode != 0:
        raise RuntimeError(f'claude agents: {out.stderr.strip()}')
    return json.loads(out.stdout or '[]')


def live_chats(repo: Path = REPO, running: list[dict] | None = None) -> list[dict]:
    """Each registered chat with the state of its newest session (none: not running here)."""
    running = sessions() if running is None else running
    rows = []
    for card in cards(repo):
        mine = sorted((s for s in running if s.get('name') == card['chat']), key=lambda s: s.get('startedAt', 0))
        s = mine[-1] if mine else {}
        state = 'none' if not s else 'retired' if not s.get('pid') else {'busy': 'working', 'waiting': 'waiting'}.get(s.get('status', ''), 'idle')
        rows.append({'name': card['chat'], 'role': card['name'], 'reports_to': card.get('reports_to', ''), 'state': state})
    return rows


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(live_chats(Path(sys.argv[1]) if len(sys.argv) > 1 else REPO), ensure_ascii=False, indent=2))
