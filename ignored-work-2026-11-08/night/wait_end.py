"""Exit when any given Grok worktree folder has ended its turn; one-off, not in git."""
import sys
import time
from pathlib import Path

sys.path.insert(0, 'C:/Users/User/Documents/GitHub/agentic-os-live/ops/agents')
import grok_status as gs

QUIET = 120
paths = [Path(a) for a in sys.argv[1:]]
while True:
    for p in paths:
        sdir = gs.session_dir(p)
        if sdir is None:
            continue
        mtime = (sdir / 'chat_history.jsonl').stat().st_mtime
        if not gs.working(sdir) and time.time() - mtime > QUIET:
            print('FINISHED', p.name)
            sys.exit(0)
    time.sleep(45)
