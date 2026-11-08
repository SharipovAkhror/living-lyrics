"""Start one Grok run per night task. One-off, not in git."""
import os
import subprocess
from pathlib import Path

N = Path(__file__).resolve().parent
R = N.parents[1]
W = R.parent / 'living-lyrics-wt'
BRIDGE = Path.home() / '.claude/plugins/cache/xai-grok-build/grok-build/0.2.1/scripts/grok-bridge.mjs'
template = (R / 'docs/tasks/_executor.md').read_text(encoding='utf-8')
env = dict(os.environ)
env.pop('GROK_BINARY', None)  # grok_binary.py: no Bun, start without it
for folder, branch, key in [('r22e', 'site/studio-pass-r22', 'r22e')]:
    wt = W / 'studio-pass'
    brief = template.replace('{{WT}}', wt.as_posix()).replace('{{BRANCH}}', branch) + (N / f'{key}-body.md').read_text(encoding='utf-8')
    p = subprocess.run(['node', str(BRIDGE), 'run', '--background', '--write', '--fresh', '--model', 'grok-4.7', '--effort', 'high', brief],
                       cwd=wt, env=env, capture_output=True, text=True, encoding='utf-8')
    print(folder, p.returncode, (p.stdout + p.stderr)[-200:].replace('\n', ' '))
