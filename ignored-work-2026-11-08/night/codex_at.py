"""Run the T37 recheck on Codex once its 5-hour window resets; one-off, not in git."""
import os, subprocess, time
A='C:/Users/User/Documents/GitHub/agentic-os-live/ops/agents'
W='C:/Users/User/Documents/GitHub/living-lyrics-wt/t37-comments'; T=W+'/work/t37'
while time.time()<1793411169+120: time.sleep(60)
env=dict(os.environ,PYTHONIOENCODING='utf-8')
with open(T+'/codex-recheck3-result.json','w',encoding='utf-8') as o:
    p=subprocess.run(['python',A+'/codex_run.py',W,'gpt-6.1-sol','high','900','-',T+'/recheck.md','--task','T37 recheck round 3'],cwd=W,stdout=o,stderr=subprocess.STDOUT,env=env)
print('CODEX done, exit',p.returncode)
