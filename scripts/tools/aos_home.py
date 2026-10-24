"""Where the owner's setup (agentic-os-live) lives, for scripts that start executors through it.

Every agy run goes through agentic-os-live/ops/agents/agy_run.py: one folder, logged in the usage
ledger. Lookup: $AOS_HOME, then `agentic-os-live` next to this repo's main folder (found through
git's common dir, so it works from any worktree).
"""
import os
import subprocess
import sys
from pathlib import Path


def aos_home() -> Path:
    here = Path(__file__).resolve().parents[2]
    found = []
    if os.environ.get('AOS_HOME'):
        found.append(Path(os.environ['AOS_HOME']))
    common = subprocess.run(['git', '-C', str(here), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            capture_output=True, encoding='utf-8').stdout.strip()
    if common:
        found.append(Path(common).parent.parent / 'agentic-os-live')
    found.append(here.parent / 'agentic-os-live')
    for path in found:
        if (path / 'ops' / 'agents' / 'agy_run.py').is_file():
            return path
    raise SystemExit('agy_run.py не найден: нужна настройка владельца agentic-os-live рядом с этим репозиторием '
                     'или переменная AOS_HOME с путём к ней. Без неё запускайте agy вручную и пишите расход в отчёт.')


def import_agy_run():
    """The agy_run module of the owner's setup."""
    sys.path.insert(0, str(aos_home() / 'ops' / 'agents'))
    import agy_run  # noqa: E402
    return agy_run
