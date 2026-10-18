"""Print Grok's last plain assistant message for a worktree (its report), read from ~/.grok/sessions."""
import json
import sys
import urllib.parse
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
wt = Path(__file__).resolve().parents[3] / 'living-lyrics-wt' / sys.argv[1]
base = Path.home() / '.grok' / 'sessions' / urllib.parse.quote(str(wt).replace('/', chr(92)), safe='')
sdir = max((p for p in base.iterdir() if p.is_dir()), key=lambda p: (p / 'chat_history.jsonl').stat().st_mtime)
last = ''
for line in open(sdir / 'chat_history.jsonl', encoding='utf-8', errors='replace'):
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get('type') == 'assistant' and o.get('content') and not o.get('tool_calls'):
        last = o['content']
print(last)
