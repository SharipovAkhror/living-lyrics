"""After the owner-role agy run ends, run the T37 recheck on agy (runs on Claude go one at a time); one-off, not in git."""
import os, subprocess, time
from pathlib import Path
A='C:/Users/User/Documents/GitHub/agentic-os-live/ops/agents'
O=Path('C:/Users/User/Documents/GitHub/living-lyrics-wt/studio-pass/work/owner-check/result-1.json')
W=Path('C:/Users/User/Documents/GitHub/living-lyrics-wt/t37-comments'); T=W/'work/t37'
start=O.stat().st_mtime
# agy_at opens the file empty at launch and it stays empty until agy ends
while not (O.stat().st_mtime>start and O.stat().st_size>0): time.sleep(60)
time.sleep(30)
env=dict(os.environ,PYTHONIOENCODING='utf-8')
with open(T/'recheck3.json','w',encoding='utf-8') as out, open(T/'recheck3.err','w',encoding='utf-8') as err:
    p=subprocess.run(['python',A+'/agy_run.py',str(W),'claude-sonnet-5-5-medium','-','1500s','-',str(T/'recheck.md'),'--task','T37 recheck round 3'],cwd=W,stdout=out,stderr=err,env=env)
print('RECHECK done, exit',p.returncode)
