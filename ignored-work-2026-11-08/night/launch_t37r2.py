"""Start one Grok run per night task. One-off, not in git."""
import os
import subprocess
from pathlib import Path

N = Path(__file__).resolve().parent
W = N.parents[2]
R = W.parent / 'living-lyrics'
BRIDGE = Path.home() / '.claude/plugins/cache/xai-grok-build/grok-build/0.2.1/scripts/grok-bridge.mjs'
template = (R / 'docs/tasks/_executor.md').read_text(encoding='utf-8')
env = dict(os.environ)
env['GROK_BINARY'] = subprocess.check_output(['python', str(W.parent / 'agentic-os-live/ops/agents/grok_binary.py')], text=True).strip()
for folder, branch, key in [('t37-comments', 'site/t37-comments', 't37r2')]:
    wt = W / folder
    brief = template.replace('{{WT}}', wt.as_posix()).replace('{{BRANCH}}', branch) + (N / f'{key}-body.md').read_text(encoding='utf-8')
    p = subprocess.run(['node', str(BRIDGE), 'run', '--background', '--write', '--fresh', '--model', 'grok-4.7', '--effort', 'high', brief],
                       cwd=wt, env=env, capture_output=True, text=True, encoding='utf-8')
    print(folder, p.returncode, (p.stdout + p.stderr)[-200:].replace('\n', ' '))
