"""The end of a chat's conversation, for the chat that replaces it (rotation, T40).

The hand-off says what is in progress; this shows what was said last, so a question the owner was
answering when the old chat went is not lost. Prints the last messages as «ts who: text», oldest first:
the user's own text (owner or a peer's cross-session message) and the chat's text replies; tool calls,
tool results and system reminders are skipped.

    python ops/agents/old_tail.py <session-id> [N]      # N messages, default 12
"""
import json
import sys

from registry import transcript_tail

SKIP = ('<system-reminder', '<task-notification', '[SYSTEM NOTIFICATION', '<command-', '<local-command')


def messages(session_id: str, n: int = 12, width: int = 700) -> list[str]:
    out = []
    for line in transcript_tail(session_id, 1_500_000):
        try:
            row = json.loads(line)
        except ValueError:
            continue
        msg = row.get('message') or {}
        role = msg.get('role')
        content = msg.get('content')
        if role == 'user':
            text = content if isinstance(content, str) else ' '.join(
                b.get('text', '') for b in content or [] if isinstance(b, dict) and b.get('type') == 'text')
            who = 'peer' if '<cross-session-message' in text else 'user'
        elif role == 'assistant' and isinstance(content, list):
            text = ' '.join(b.get('text', '') for b in content if b.get('type') == 'text')
            who = 'chat'
        else:
            continue
        text = ' '.join(text.split())
        if not text or (who != 'chat' and text.startswith(SKIP)):
            continue
        out.append(f'{row.get("timestamp", "")[:16]} {who}: {text[:width]}')
    return out[-n:]


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    lines = messages(sys.argv[1], n)
    print('\n'.join(lines) if lines else f'no transcript for {sys.argv[1]}')


if __name__ == '__main__':
    main()
