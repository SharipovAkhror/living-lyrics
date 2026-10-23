"""Tests for registry.last_said() and registry.live_chats(); no network, no claude calls.

    python ops/agents/tests/test_registry.py
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import registry  # noqa: E402


def _row(text: str, at: str) -> str:
    return json.dumps({'timestamp': at, 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}})


def _said(rows: list[str]) -> dict:
    """last_said over a stub transcript written to a temporary directory."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 's.jsonl'
        path.write_text('\n'.join(rows), encoding='utf-8')
        original = registry.transcript_tail
        registry.transcript_tail = lambda sid, size=0: path.read_text(encoding='utf-8').splitlines()
        try:
            return registry.last_said('s')
        finally:
            registry.transcript_tail = original


def _chats(session: dict) -> dict:
    """live_chats for one card and one session, with cards, pending_tool and last_said stubbed."""
    saved = registry.cards, registry.pending_tool, registry.last_said
    registry.cards = lambda repo=registry.REPO: [{'chat': 'LL · Test', 'name': 'll-test'}]
    registry.pending_tool = lambda sid: ''
    registry.last_said = lambda sid: {}
    try:
        return registry.live_chats(running=[{'name': 'LL · Test', 'pid': 1, 'sessionId': 'x', **session}])[0]
    finally:
        registry.cards, registry.pending_tool, registry.last_said = saved


def test_skips_filler():
    got = _said([_row('Real report on the work.', 't1'), _row('No response requested.', 't2')])
    assert got['text'] == 'Real report on the work.' and got['at'] == 't1', got


def test_skips_several_fillers_and_case():
    got = _said([_row('Report.', 't1'), _row('Принято', 't2'), _row('ok.', 't3')])
    assert got['text'] == 'Report.', got


def test_long_text_starting_with_noted_kept():
    text = 'Noted, and here is what I changed in the registry and why it matters.'
    got = _said([_row('Older.', 't1'), _row(text, 't2')])
    assert got['text'] == text, got


def test_only_filler_gives_empty():
    assert _said([_row('Noted', 't1')]) == {}


def test_dialog_open():
    row = _chats({'status': 'waiting', 'waitingFor': 'dialog open'})
    assert row['waiting_for'] == registry.WAITING_TEXT['dialog open'], row


def test_permission_prompt():
    row = _chats({'status': 'waiting', 'waitingFor': 'permission prompt'})
    assert row['waiting_for'] == 'ждёт разрешения — откройте чат', row


def test_other_waiting_for_as_is():
    assert _chats({'status': 'waiting', 'waitingFor': 'something'})['waiting_for'] == 'something'


if __name__ == '__main__':
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print('ok  ', name)
            except AssertionError as e:
                failed += 1
                print('FAIL', name, e)
    sys.exit(1 if failed else 0)
