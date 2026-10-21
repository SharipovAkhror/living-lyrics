"""Start the replacement of a Living Lyrics chat as a background Claude session (chat rotation).

The old chat has already written, committed and pushed its hand-off (ops/handoff/<date>-<chat>.md)
in its own checkout and branch (main, or a worktree such as ../living-lyrics-wt/ll-business). This
script starts the new chat under the same name, supervised by the Claude daemon (not by any chat,
so archiving a chat never kills it), with Remote Control on so it shows in claude.ai and the
desktop sidebar, and gives it its first task: read the rules, the status and the hand-off, go on.

    python ops/agents/rotate_chat.py "LL · Tech" ops/handoff/2026-10-20-ll-tech.md [--cwd <dir>] [--model <m>] [--effort <e>] [--keep-old] [--dry-run]

Prints the new session's short id, then archives the old chat(s) of that name: `claude stop` for a
background session (archived on claude.ai at once), a reminder for a desktop-app session.
`--keep-old` leaves them running (docs/process/chat-rotation.md, steps 4–6).
"""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from registry import cards

REPO = Path(__file__).resolve().parents[2]


def claude_bin() -> str:
    """The claude executable. On Windows npm puts a claude.cmd shim on PATH; going through cmd.exe
    would mangle the Cyrillic prompt and the quotes, so use the claude.exe the shim points to."""
    found = shutil.which('claude') or 'claude'
    if found.lower().endswith('.cmd'):
        exe = Path(found).parent / 'node_modules' / '@anthropic-ai' / 'claude-code' / 'bin' / 'claude.exe'
        if exe.is_file():
            return str(exe)
    return found


CLAUDE = claude_bin()


def run(cmd: list[str], cwd: Path) -> str:
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, encoding='utf-8', errors='replace')
    if out.returncode != 0:
        raise SystemExit(f'{" ".join(cmd[:3])}…: {out.stderr.strip() or out.stdout.strip()}')
    return out.stdout.strip()


def checkout(path: Path) -> tuple[Path, str]:
    """The git checkout that holds `path` (the main one or a worktree) and its branch."""
    top = Path(run(['git', 'rev-parse', '--show-toplevel'], path.parent))
    return top, run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], top)


def pushed(handoff: Path) -> bool:
    """The hand-off must be committed and pushed in its own branch: the old chat is about to go."""
    top, branch = checkout(handoff)
    rel = handoff.resolve().relative_to(top.resolve()).as_posix()
    subprocess.run(['git', 'fetch', '-q', 'origin', branch], cwd=top)
    return subprocess.run(['git', 'cat-file', '-e', f'origin/{branch}:{rel}'], cwd=top).returncode == 0


def sessions() -> list[dict]:
    return json.loads(run([CLAUDE, 'agents', '--json'], REPO) or '[]')


def retire(old: list[dict]) -> None:
    """Archive the chats the new one replaces. `claude stop` on a background session archives it on
    claude.ai at once (the transcript stays). The old chat usually runs this script itself, so this is
    the last thing it does. A desktop-app session can't be stopped from here: it archives itself."""
    for s in old:
        sid = s.get('id') or s.get('sessionId', '')[:8]
        if s.get('kind') != 'background':
            print(f'archive by hand (archive_session in the app): {s.get("name")} · {sid}', flush=True)
            continue
        print(f'archiving the old chat: {s.get("name")} · {sid}', flush=True)
        subprocess.run([CLAUDE, 'stop', sid], capture_output=True)


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    args = [a for a in sys.argv[1:]]
    opts = {}
    for flag in ('--cwd', '--model', '--effort'):
        if flag in args:
            i = args.index(flag)
            opts[flag] = args[i + 1]
            del args[i:i + 2]
    dry = '--dry-run' in args
    keep_old = '--keep-old' in args
    args = [a for a in args if a not in ('--dry-run', '--keep-old')]
    if len(args) != 2:
        raise SystemExit(__doc__)
    name, handoff = args[0], Path(args[1])
    if not handoff.is_absolute():
        handoff = Path.cwd() / handoff
    cwd = Path(opts.get('--cwd', REPO))
    if not handoff.is_file():
        raise SystemExit(f'no hand-off file: {handoff}')
    if not dry and not pushed(handoff):
        raise SystemExit(f'commit and push the hand-off first: {handoff}')

    top, branch = checkout(handoff)
    rel = handoff.resolve().relative_to(top.resolve()).as_posix()
    prompt = (
        f'Ты — новый чат «{name}» проекта Living Lyrics, замена прежнего чата с тем же именем (ротация). '
        f'Прочитай AGENTS.md, docs/STATUS.md, docs/process/chat-rotation.md и сдачу дел {rel} '
        f'(папка {top.as_posix()}, ветка {branch}), перейми фоновые процессы по списку в сдаче дел и продолжай работу с пункта «Первым делом». '
        'Отчитайся оркестратору «LL · Main» одной короткой строкой по-английски, что принял дела '
        '(если ты сам LL · Main — напиши владельцу одну строку: «чат обновлён, работа продолжается»).'
    )
    cmd = [CLAUDE, '--bg', '--remote-control', name, '-n', name, '--permission-mode', 'auto']
    # The chat's role card (.claude/agents/ll-*.md) becomes its agent: role text, model, tools.
    card = next((c for c in cards(REPO) if c['chat'] == name), None)
    if card:
        cmd += ['--agent', card['name']]
    if '--model' in opts:
        cmd += ['--model', opts['--model']]
    if '--effort' in opts:
        cmd += ['--effort', opts['--effort']]
    cmd.append(prompt)
    if dry:
        print(json.dumps({'cwd': str(cwd), 'cmd': cmd}, ensure_ascii=False, indent=2))
        return

    old = [s for s in sessions() if s.get('name') == name]
    before = {s.get('sessionId') for s in old}
    out = run(cmd, cwd)
    print(out.splitlines()[0] if out else '')
    for _ in range(20):
        new = [s for s in sessions() if s.get('name') == name and s.get('sessionId') not in before]
        if new:
            print(f'new chat: {name} · {new[0].get("sessionId")} · {new[0].get("status")}', flush=True)
            if not keep_old:
                retire(old)
            return
        time.sleep(1)
    raise SystemExit(f'the new chat «{name}» did not show up in `claude agents`; check `claude agents` by hand')


if __name__ == '__main__':
    main()
