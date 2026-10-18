"""What the agents of Living Lyrics are doing now, as JSON for the ll-shtab mod.

Grok: one task per folder in ../living-lyrics-wt; its session is
~/.grok/sessions/<percent-encoded folder>/<id>/ (chat_history.jsonl, events.jsonl).
States: working (turn running, grok alive), stalled (turn not ended, no grok process),
finished (turn ended), none (no session yet).
Gemini: a running agy.exe; the video it watches is read from its command line.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

WT = Path('C:/Users/User/Documents/GitHub/living-lyrics-wt')
SESSIONS = Path.home() / '.grok' / 'sessions'
TAIL = 200_000


def tail_lines(path: Path, size: int = TAIL):
    with open(path, 'rb') as fh:
        fh.seek(0, os.SEEK_END)
        fh.seek(max(0, fh.tell() - size))
        return fh.read().decode('utf-8', 'replace').splitlines()


def session_dir(worktree: Path):
    base = SESSIONS / urllib.parse.quote(str(worktree).replace('/', '\\'), safe='')
    if not base.is_dir():
        return None
    runs = [p for p in base.iterdir() if p.is_dir() and (p / 'chat_history.jsonl').exists()]
    return max(runs, key=lambda p: (p / 'chat_history.jsonl').stat().st_mtime) if runs else None


def turn_running(sdir: Path):
    events = sdir / 'events.jsonl'
    if not events.exists():
        return True
    for line in reversed(tail_lines(events, 8000)):
        try:
            kind = json.loads(line).get('type')
        except ValueError:
            continue
        if kind == 'turn_ended':
            return False
        if kind in ('phase_changed', 'turn_started', 'tool_started', 'tool_finished'):
            return True
    return True


def last_step(sdir: Path):
    step = ''
    for line in tail_lines(sdir / 'chat_history.jsonl'):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get('type') == 'reasoning':
            for s in o.get('summary') or []:
                if s.get('text'):
                    step = s['text']
        elif o.get('type') == 'assistant' and o.get('content'):
            step = o['content']
    step = ' '.join(step.replace('*', '').replace('`', '').split())
    return step if len(step) <= 160 else step[:159] + '…'


def grok_usage(session_id: str):
    """Tokens and model of one Grok session, as `grok usage` reports them."""
    try:
        out = subprocess.run(['grok', 'usage', session_id], capture_output=True, encoding='utf-8', errors='replace', timeout=15).stdout
        data = json.loads(out).get('session') or {}
    except Exception:
        return 0, ''
    return int(data.get('totalTokens') or 0), str(data.get('primaryModelId') or '')


def processes():
    """grok.exe and agy.exe: command line and start time, one PowerShell call."""
    cmd = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Get-CimInstance Win32_Process -Filter \"Name='grok.exe' OR Name='agy.exe'\" | "
        "ForEach-Object { [pscustomobject]@{ name = $_.Name; cmd = $_.CommandLine; "
        "start = $_.CreationDate.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Compress"
    )
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command', cmd], capture_output=True, encoding='utf-8', errors='replace', timeout=20).stdout.strip()
    except Exception:
        return []
    if not out:
        return []
    data = json.loads(out)
    return data if isinstance(data, list) else [data]


def minutes_since(iso: str):
    try:
        t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    except ValueError:
        return 0
    return max(0, int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() // 60))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    procs = processes()
    grok_cmds = ' '.join(p.get('cmd') or '' for p in procs if (p.get('name') or '').lower() == 'grok.exe')
    grok = []
    if WT.is_dir():
        for wt in sorted(p for p in WT.iterdir() if p.is_dir()):
            sdir = session_dir(wt)
            if sdir is None:
                grok.append({'name': wt.name, 'state': 'none', 'minutes': 0, 'step': ''})
                continue
            minutes = int((time.time() - (sdir / 'chat_history.jsonl').stat().st_mtime) // 60)
            if turn_running(sdir):
                state = 'working' if (sdir.name in grok_cmds or wt.name in grok_cmds) else 'stalled'
            else:
                state = 'finished'
            tokens, model = grok_usage(sdir.name)
            grok.append({'name': wt.name, 'state': state, 'minutes': minutes, 'step': last_step(sdir), 'tokens': tokens, 'model': model})
    gemini = []
    for p in procs:
        if (p.get('name') or '').lower() != 'agy.exe':
            continue
        cmd = p.get('cmd') or ''
        if ' -p' not in cmd and '--print' not in cmd:
            continue
        m = re.search(r'work[\\/]([a-z0-9-]+)[\\/]video\.', cmd)
        gemini.append({'slug': m.group(1) if m else '', 'minutes': minutes_since(p.get('start') or '')})
    print(json.dumps({'grok': grok, 'gemini': gemini}, ensure_ascii=False))


if __name__ == '__main__':
    main()
