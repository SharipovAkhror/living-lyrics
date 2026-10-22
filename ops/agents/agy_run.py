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
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COLLECT = ROOT / 'ops' / 'usage' / 'collect.py'
FALLBACK = Path.home() / 'AppData' / 'Local' / 'agy' / 'bin' / 'agy.exe'


def agy_bin() -> str:
    found = shutil.which('agy')
    if found:
        return found
    if FALLBACK.is_file():
        return str(FALLBACK)
    raise SystemExit('agy_run: agy not found on PATH')


def log(out: str, model: str, task: str) -> None:
    """Ledger row for this run; agy's JSON has no model field, so it is added here. Never fails the run."""
    try:
        data = json.loads(out)
        data.setdefault('model', model)
        subprocess.run([sys.executable, str(COLLECT), '--run', '-', '--task', task], input=json.dumps(data),
                       capture_output=True, text=True, encoding='utf-8', timeout=120)
    except Exception as e:  # noqa: BLE001 - logging must not break the caller
        print(f'agy_run: not logged: {e}', file=sys.stderr)


def run(worktree, model, effort, timeout, schema, prompt, task) -> tuple[int, str, dict | None]:
    """(exit code, raw stdout, parsed JSON or None). `prompt` is the prompt text."""
    wt = str(Path(worktree).resolve())
    cmd = [agy_bin(), '-p', prompt, '--model', model, '--add-dir', wt, '--dangerously-skip-permissions',
           '--output-format', 'json', '--print-timeout', timeout]
    if schema and schema != '-':  # '-': free-text answer (reviews)
        cmd += ['--json-schema', str(Path(schema).resolve())]
    if effort and effort != '-':
        cmd += ['--effort', effort]
    proc = subprocess.run(cmd, cwd=wt, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = proc.stdout or ''
    if out.strip():
        log(out, model, task)
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
