"""Run the owner-role agy check at 01:50 UTC; one-off, not in git. Waits for the studio Grok run first."""
import datetime as dt, os, subprocess, sys, time
from pathlib import Path
A='C:/Users/User/Documents/GitHub/agentic-os-live/ops/agents'
sys.path.insert(0,A)
import grok_status as gs
W=Path('C:/Users/User/Documents/GitHub/living-lyrics-wt/studio-pass'); O=W/'work/owner-check'
n=sys.argv[1]
target=dt.datetime(2026,10,31,1,50,tzinfo=dt.timezone.utc)
time.sleep(300)
while dt.datetime.now(dt.timezone.utc)<target: time.sleep(60)
while True:
    s=gs.session_dir(W)
    if s and not gs.working(s) and time.time()-(s/'chat_history.jsonl').stat().st_mtime>120: break
    time.sleep(60)
env=dict(os.environ,PYTHONIOENCODING='utf-8')
with open(O/f'result-{n}.json','w',encoding='utf-8') as out, open(O/f'result-{n}.err','w',encoding='utf-8') as err:
    p=subprocess.run(['python',A+'/agy_run.py',str(W),'claude-opus-5-5-high','-','1800s',str(O/'schema.json'),str(O/'prompt.md'),'--task','T28 owner-role check'],cwd=W,stdout=out,stderr=err,env=env)
print('AGY done, exit',p.returncode,f'result-{n}.json')
