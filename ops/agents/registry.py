"""The registry of Living Lyrics chats: one role card per chat in .claude/agents/ll-*.md.

A card is an ordinary Claude Code agent definition (a chat starts from it with
`claude --agent <name> --bg`), plus a few fields of ours in its frontmatter: `chat` (the chat's
name and address), `cwd`, `branch`, `reports_to`. Adding a chat = one card + rotate_chat.py.
keep_chats.py and rotate_chat.py read the cards from here; the live state of each
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


def sessions(include_done: bool = False) -> list[dict]:
    """`claude agents --json`; with include_done also the sessions the daemon settled (state `done`)."""
    argv = [claude_bin(), 'agents', '--json'] + (['--all'] if include_done else [])
    out = subprocess.run(argv, capture_output=True, encoding='utf-8', errors='replace')
    if out.returncode != 0:
        raise RuntimeError(f'claude agents: {out.stderr.strip()}')
    return json.loads(out.stdout or '[]')


def pending_tool(session_id: str) -> str:
    """What a waiting session waits on: its last tool call that has no result yet, in a few words."""
    hits = list((Path.home() / '.claude' / 'projects').glob(f'*/{session_id}.jsonl')) if session_id else []
    if not hits:
        return ''
    with open(hits[0], 'rb') as fh:
        fh.seek(0, 2)
        fh.seek(max(0, fh.tell() - 400_000))
        lines = fh.read().decode('utf-8', 'replace').splitlines()
    calls, done = {}, set()
    for line in lines:
        try:
            msg = json.loads(line).get('message') or {}
        except ValueError:
            continue
        for block in msg.get('content') or [] if isinstance(msg.get('content'), list) else []:
            if block.get('type') == 'tool_use':
                calls[block.get('id')] = block
            elif block.get('type') == 'tool_result':
                done.add(block.get('tool_use_id'))
    open_calls = [b for i, b in calls.items() if i not in done]
    if not open_calls:
        return ''
    b = open_calls[-1]
    inp = b.get('input') or {}
    hint = inp.get('description') or inp.get('action') or (inp.get('questions') or [{}])[0].get('question', '') if isinstance(inp, dict) else ''
    text = f"{b.get('name', '')}: {hint}".strip(': ') if hint else b.get('name', '')
    return text if len(text) <= 90 else text[:89] + '…'


def live_chats(repo: Path = REPO, running: list[dict] | None = None) -> list[dict]:
    """Each registered chat with the state of its newest session (none: not running here)."""
    running = sessions() if running is None else running
    rows = []
    for card in cards(repo):
        mine = sorted((s for s in running if s.get('name') == card['chat']), key=lambda s: s.get('startedAt', 0))
        s = mine[-1] if mine else {}
        state = 'none' if not s else 'retired' if not s.get('pid') else {'busy': 'working', 'waiting': 'waiting'}.get(s.get('status', ''), 'idle')
        row = {'name': card['chat'], 'role': card['name'], 'reports_to': card.get('reports_to', ''), 'state': state}
        if state == 'waiting':
            row['waiting_for'] = pending_tool(s.get('sessionId', ''))
        rows.append(row)
    return rows


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(live_chats(Path(sys.argv[1]) if len(sys.argv) > 1 else REPO), ensure_ascii=False, indent=2))
