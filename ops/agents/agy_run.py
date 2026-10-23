"""One Antigravity (agy) run for Living Lyrics, the single way chats and scripts start agy.

    python ops/agents/agy_run.py <worktree> <model> <effort> <timeout> <schema.json> <prompt-file> --task "<what>"

The run sees only <worktree> (cwd and --add-dir), auto-approves its tools, answers with JSON that
follows <schema> ('-' for free text) and stops after <timeout> (agy's --print-timeout, e.g. 900s). Every run is logged in
the usage ledger (ops/usage/collect.py --run -) with its model. Prints agy's JSON to stdout.
Exit code: agy's own when it failed; 3 when agy reported SUCCESS with an empty answer, which in
practice means a denied tool or a failed turn ("empty = denied/failed"). Policy:
docs/process/executors-guide.md §4. Models: `agy models`.
"""
import json
import os
import shutil
import tempfile
import time
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COLLECT = ROOT / 'ops' / 'usage' / 'collect.py'
FALLBACK = Path.home() / 'AppData' / 'Local' / 'agy' / 'bin' / 'agy.exe'
EFFORT_REJECTED = '--effort is not supported for model'
LOCK = Path(tempfile.gettempdir()) / 'll-agy-claude-gpt.lock'
LOCK_STALE_S = 3 * 3600  # longer than any allowed run (rule 2: 2 h)


def quota_group(model: str) -> str:
    """agy /usage group of a model id: 'claude-gpt' for Claude and GPT models, '' otherwise."""
    m = model.lower()
    return 'claude-gpt' if m.startswith(('claude', 'gpt')) else ''


def take_lock() -> bool:
    """True when this process now holds the Claude/GPT run lock. A lock older than LOCK_STALE_S is dropped."""
    try:
        if LOCK.exists() and time.time() - LOCK.stat().st_mtime > LOCK_STALE_S:
            LOCK.unlink()
    except OSError:
        pass
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(fd, 'w') as fh:
        fh.write(str(os.getpid()))
    return True


def drop_lock() -> None:
    try:
        LOCK.unlink()
    except OSError:
        pass


def quota_now(group: str) -> dict:
    """{'weekly': %, 'fiveHour': %} remaining for `group` from agy /usage; {} when it can't be read."""
    try:
        sys.path.insert(0, str(COLLECT.parent))
        import collect  # noqa: PLC0415 - heavy (pty), only for Claude/GPT runs
        live = collect.collect_gemini_live(collect.iso(collect.now()))
        values = (live or {}).get('groups', {}).get(group) or {}
        return {k: values[k + 'Remaining'] for k in ('weekly', 'fiveHour') if values.get(k + 'Remaining') is not None}
    except Exception as e:  # noqa: BLE001 - a missing reading must not block the run
        print(f'agy_run: quota not read: {e}', file=sys.stderr)
        return {}


def quota_fields(group: str, before: dict, after: dict) -> dict:
    """Ledger fields for the run row; only what was measured."""
    if not group or not (before or after):
        return {}
    out = {'quotaGroup': group}
    for k in ('weekly', 'fiveHour'):
        if k in before:
            out[k + 'Before'] = before[k]
        if k in after:
            out[k + 'After'] = after[k]
    return out


def agy_bin() -> str:
    found = shutil.which('agy')
    if found:
        return found
    if FALLBACK.is_file():
        return str(FALLBACK)
    raise SystemExit('agy_run: agy not found on PATH')


def log(out: str, model: str, task: str, extra: dict | None = None) -> None:
    """Ledger row for this run; agy's JSON has no model field, so it is added here. Never fails the run."""
    try:
        data = json.loads(out)
        data.setdefault('model', model)
        data.update(extra or {})
        subprocess.run([sys.executable, str(COLLECT), '--run', '-', '--task', task], input=json.dumps(data),
                       capture_output=True, text=True, encoding='utf-8', timeout=120)
    except Exception as e:  # noqa: BLE001 - logging must not break the caller
        print(f'agy_run: not logged: {e}', file=sys.stderr)


def run(worktree, model, effort, timeout, schema, prompt, task) -> tuple[int, str, dict | None]:
    """(exit code, raw stdout, parsed JSON or None). `prompt` is the prompt text."""
    group = quota_group(model)
    if not group:
        return _run(worktree, model, effort, timeout, schema, prompt, task, group)
    if not take_lock():
        print(f'agy_run: another Claude/GPT run holds {LOCK} (rule 6a: one at a time)', file=sys.stderr)
        return 5, '', None
    try:
        return _run(worktree, model, effort, timeout, schema, prompt, task, group)
    finally:
        drop_lock()


def _run(worktree, model, effort, timeout, schema, prompt, task, group) -> tuple[int, str, dict | None]:
    before = quota_now(group) if group else {}
    wt = str(Path(worktree).resolve())
    cmd = [agy_bin(), '-p', prompt, '--model', model, '--add-dir', wt, '--dangerously-skip-permissions',
           '--output-format', 'json', '--print-timeout', timeout]
    if schema and schema != '-':  # '-': free-text answer (reviews)
        cmd += ['--json-schema', str(Path(schema).resolve())]
    if effort and effort != '-':
        cmd += ['--effort', effort]
    proc = subprocess.run(cmd, cwd=wt, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if effort and effort != '-' and proc.returncode != 0 and EFFORT_REJECTED in (proc.stdout or '') + (proc.stderr or ''):
        # agy refuses --effort for some models (claude-sonnet-4-6, claude-opus-4-6-thinking): run again
        # without it rather than losing the start. The refusal happens before any turn, so it costs nothing.
        print(f'agy_run: {model} takes no --effort, running without it', file=sys.stderr)
        cmd = cmd[:-2]
        proc = subprocess.run(cmd, cwd=wt, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = proc.stdout or ''
    if out.strip():
        after = quota_now(group) if group else {}
        log(out, model, task, quota_fields(group, before, after))
    try:
        data = json.loads(out)
    except ValueError:
        data = None
    if proc.returncode != 0:
        sys.stderr.write((proc.stderr or '')[-2000:])
        return proc.returncode, out, data
    if data is None:
        return 4, out, None
    answer = data.get('structured_output') or (data.get('response') or '').strip()
    if str(data.get('status', '')).upper() == 'SUCCESS' and not answer:
        print('agy_run: empty = denied/failed', file=sys.stderr)
        return 3, out, data
    return 0, out, data


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    args = sys.argv[1:]
    task = ''
    if '--task' in args:
        i = args.index('--task')
        task = args[i + 1] if i + 1 < len(args) else ''
        del args[i:i + 2]
    if len(args) != 6:
        print(__doc__, file=sys.stderr)
        return 2
    worktree, model, effort, timeout, schema, prompt_file = args
    code, out, _ = run(worktree, model, effort, timeout, schema, Path(prompt_file).read_text(encoding='utf-8'), task or Path(worktree).name)
    sys.stdout.write(out)
    return code


if __name__ == '__main__':
    sys.exit(main())
