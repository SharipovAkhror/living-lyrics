"""Start the replacement of a Living Lyrics chat as a background Claude session (chat rotation).

The old chat has already written and pushed its hand-off (ops/handoff/<date>-<chat>.md). This
script starts the new chat under the same name, supervised by the Claude daemon (not by any chat,
so archiving a chat never kills it), with Remote Control on so it shows in claude.ai and the
desktop sidebar, and gives it its first task: read the rules, the status and the hand-off, go on.

    python ops/agents/rotate_chat.py "LL · Tech" ops/handoff/2026-10-20-tech.md [--cwd <dir>] [--model <m>] [--effort <e>] [--dry-run]

Prints the new session's short id. The old chat then renames and archives itself
(docs/process/chat-rotation.md, steps 5–6).
"""
import json
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def run(cmd: list[str], cwd: Path) -> str:
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, encoding='utf-8', errors='replace')
    if out.returncode != 0:
        raise SystemExit(f'{" ".join(cmd[:3])}…: {out.stderr.strip() or out.stdout.strip()}')
    return out.stdout.strip()


def pushed(handoff: Path) -> bool:
    """The hand-off must be in origin/main: the new chat may start on another machine."""
    rel = handoff.resolve().relative_to(REPO).as_posix()
    subprocess.run(['git', 'fetch', '-q', 'origin', 'main'], cwd=REPO)
    return subprocess.run(['git', 'cat-file', '-e', f'origin/main:{rel}'], cwd=REPO).returncode == 0


def sessions() -> list[dict]:
    return json.loads(run(['claude', 'agents', '--json'], REPO) or '[]')


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
    args = [a for a in args if a != '--dry-run']
    if len(args) != 2:
        raise SystemExit(__doc__)
    name, handoff = args[0], Path(args[1])
    if not handoff.is_absolute():
        handoff = REPO / handoff
    cwd = Path(opts.get('--cwd', REPO))
    if not handoff.is_file():
        raise SystemExit(f'no hand-off file: {handoff}')
    if not dry and not pushed(handoff):
        raise SystemExit(f'commit and push the hand-off first: {handoff}')

    rel = handoff.resolve().relative_to(REPO).as_posix()
    prompt = (
        f'Ты — новый чат «{name}» проекта Living Lyrics, замена прежнего чата с тем же именем (ротация). '
        f'Прочитай AGENTS.md, docs/STATUS.md, docs/process/chat-rotation.md и сдачу дел {rel} '
        f'(из репозитория {REPO.as_posix()}), перейми фоновые процессы по списку в сдаче дел и продолжай работу с пункта «Первым делом». '
        'Отчитайся главному чату «LL · Site (Main)» одной строкой, что принял дела '
        '(если ты сам главный чат — напиши владельцу одну строку: «чат обновлён, работа продолжается»).'
    )
    cmd = ['claude', '--bg', '--remote-control', name, '-n', name, '--permission-mode', 'auto']
    if '--model' in opts:
        cmd += ['--model', opts['--model']]
    if '--effort' in opts:
        cmd += ['--effort', opts['--effort']]
    cmd.append(prompt)
    if dry:
        print(json.dumps({'cwd': str(cwd), 'cmd': cmd}, ensure_ascii=False, indent=2))
        return

    before = {s.get('sessionId') for s in sessions()}
    out = run(cmd, cwd)
    print(out.splitlines()[0] if out else '')
    for _ in range(20):
        new = [s for s in sessions() if s.get('name') == name and s.get('sessionId') not in before]
        if new:
            print(f'new chat: {name} · {new[0].get("sessionId")} · {new[0].get("status")}')
            return
        time.sleep(1)
    raise SystemExit(f'the new chat «{name}» did not show up in `claude agents`; check `claude agents` by hand')


if __name__ == '__main__':
    main()
