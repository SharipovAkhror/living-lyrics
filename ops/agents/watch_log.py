"""Exit as soon as any named Grok task finishes a turn after this watcher started.

Reads Grok's own session logs through grok_status.py next to this file (the bridge's status is unreliable:
grok processes can stay alive after the work is done). A task counts as finished when its latest
turn has ended, its log changed after the watcher started, and it has been quiet for QUIET seconds.
"""
import sys
import time

import grok_status as gs

QUIET = 90
start = time.time()
names = sys.argv[1:]
# A task that already ended its turn before the watcher started would never be reported.
for n in names:
    sdir = gs.session_dir(gs.WT / n)
    if sdir is not None and not gs.working(sdir):
        print(f'FINISHED {n} (before the watcher started)')
        sys.exit(0)
while True:
    for n in names:
        sdir = gs.session_dir(gs.WT / n)
        if sdir is None:
            continue
        mtime = (sdir / 'chat_history.jsonl').stat().st_mtime
        if mtime > start and not gs.working(sdir) and time.time() - mtime > QUIET:
            print(f'FINISHED {n}')
            sys.exit(0)
    time.sleep(45)
