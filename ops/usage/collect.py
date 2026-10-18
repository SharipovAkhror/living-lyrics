"""Usage ledger of the project's agents: Grok token totals per session, Gemini quota windows.

Appends snapshots to ops/usage/ledger/<YYYY-MM>.jsonl and writes ops/usage/latest.json, which
the in-app dashboard reads. Run on the owner's machine (that is where Grok and Antigravity are
signed in):

    python ops/usage/collect.py            # Grok + Gemini quota (Gemini opens agy for ~20 s)
    python ops/usage/collect.py --no-gemini
    python ops/usage/collect.py --run <agy-output.json> --task "watch-video karitas"

`--run` records one finished Gemini job from the JSON that `agy -p --output-format json` printed.
Nothing here reads credentials; the account e-mail agy prints is never written.
"""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'ops' / 'usage'
LEDGER = OUT / 'ledger'
SESSIONS = Path.home() / '.grok' / 'sessions'
GROK_SETTINGS = Path.home() / '.grok' / 'settings_cache.json'
WT_MARK = urllib.parse.quote('living-lyrics-wt\\', safe='')


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def append(rows):
    if not rows:
        return
    LEDGER.mkdir(parents=True, exist_ok=True)
    path = LEDGER / f'{now():%Y-%m}.jsonl'
    with open(path, 'a', encoding='utf-8', newline='\n') as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')


def read_ledger(days=8):
    rows = []
    since = now() - dt.timedelta(days=days)
    for path in sorted(LEDGER.glob('*.jsonl')):
        for line in path.read_text(encoding='utf-8').splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            try:
                if dt.datetime.fromisoformat(row['ts'].replace('Z', '+00:00')) >= since:
                    rows.append(row)
            except (KeyError, ValueError):
                continue
    return rows


# ---- Grok ----

def grok_plan():
    try:
        payload = json.loads(GROK_SETTINGS.read_text(encoding='utf-8'))['payload']
        payload = json.loads(payload) if isinstance(payload, str) else payload
        return payload['settings'].get('subscription_tier_display') or ''
    except Exception:
        return ''


def grok_sessions():
    """(task, session id) for every Grok session started in a living-lyrics-wt folder."""
    out = []
    if not SESSIONS.is_dir():
        return out
    for base in SESSIONS.iterdir():
        if WT_MARK.lower() not in base.name.lower():
            continue
        task = urllib.parse.unquote(base.name).replace('/', '\\').rstrip('\\').split('\\')[-1]
        for sdir in base.iterdir():
            if sdir.is_dir():
                out.append((task, sdir.name))
    return out


def grok_usage(session_id):
    try:
        text = subprocess.run(['grok', 'usage', session_id], capture_output=True, encoding='utf-8', errors='replace', timeout=20).stdout
        data = json.loads(text)
    except Exception:
        return None
    s = data.get('session') or {}
    return {
        'totalTokens': int(s.get('totalTokens') or 0),
        'outputTokens': int(s.get('outputTokens') or 0),
        'modelCalls': int(s.get('modelCalls') or 0),
        'turns': int(s.get('turnCount') or 0),
        'model': s.get('primaryModelId') or '',
        'sessionUpdated': data.get('updatedAt') or '',
    }


def collect_grok(ts):
    rows = []
    for task, sid in grok_sessions():
        usage = grok_usage(sid)
        if usage and usage['totalTokens']:
            rows.append({'ts': ts, 'agent': 'grok', 'kind': 'session', 'task': task, 'session': sid, **usage})
    return rows


def grok_window(rows, start):
    """Tokens spent since `start`: per session, last snapshot minus the last one before `start`."""
    per = {}
    for row in rows:
        if row.get('agent') != 'grok' or row.get('kind') != 'session':
            continue
        t = dt.datetime.fromisoformat(row['ts'].replace('Z', '+00:00'))
        rec = per.setdefault(row['session'], {'before': 0, 'last': 0, 'task': row['task'], 'active': ''})
        if t < start:
            rec['before'] = max(rec['before'], row['totalTokens'])
        else:
            rec['last'] = max(rec['last'], row['totalTokens'])
            rec['active'] = max(rec['active'], row.get('sessionUpdated') or '')
    total, by_task = 0, {}
    for rec in per.values():
        # A session with no turn in the window spent nothing there, even on its first snapshot.
        try:
            active = dt.datetime.fromisoformat(rec['active'][:26].rstrip('Z') + '+00:00') >= start if rec['active'] else False
        except ValueError:
            active = True
        spent = max(0, rec['last'] - rec['before']) if rec['last'] and active else 0
        total += spent
        if spent:
            by_task[rec['task']] = by_task.get(rec['task'], 0) + spent
    return total, by_task


# ---- Gemini (Antigravity) ----

ANSI = re.compile(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?')


def agy_usage_screen():
    """Open agy in a pseudo-console, run /usage, return the screen text."""
    from winpty import PtyProcess  # pip install pywinpty

    proc = PtyProcess.spawn('agy', cwd=str(ROOT), dimensions=(60, 160))
    chunks = []

    def reader():
        while True:
            try:
                data = proc.read(4096)
            except Exception:
                return
            if data:
                chunks.append(data)

    threading.Thread(target=reader, daemon=True).start()
    try:
        time.sleep(6)
        if 'trust the contents' in ''.join(chunks):
            proc.write(chr(13))
            time.sleep(6)
        header = ANSI.sub('', ''.join(chunks))
        proc.write(chr(27))
        time.sleep(1)
        mark = len(chunks)
        proc.write('/usage')
        time.sleep(1)
        proc.write(chr(13))
        time.sleep(10)
        screen = ANSI.sub('', ''.join(chunks[mark:]))
        proc.write(chr(27))
        time.sleep(0.5)
        proc.write('/exit' + chr(13))
        time.sleep(1)
    finally:
        proc.terminate(force=True)
    return header, screen


def parse_quota(header, screen):
    plan = ''
    m = re.search(r'\(([^()@]*(?:Pro|Ultra|Free|Plus|Standard)[^()@]*)\)', header)
    if m:
        plan = m.group(1).strip()
    groups = {}
    current = None
    window = None
    for line in screen.replace('\r', '\n').split('\n'):
        s = line.strip()
        if s.endswith('MODELS') and s.isupper():
            current = 'gemini' if 'GEMINI' in s else 'claude-gpt' if 'CLAUDE' in s else s.lower()
            groups[current] = {}
        elif current and 'Weekly Limit Remaining' in s:
            window = 'weekly'
        elif current and 'Five Hour Limit Remaining' in s:
            window = 'fiveHour'
        elif current and window:
            p = re.search(r'(\d+(?:\.\d+)?)%', s)
            if p and window + 'Remaining' not in groups[current]:
                groups[current][window + 'Remaining'] = float(p.group(1))
                continue
            r = re.search(r'Refreshes in\s+(.+)$', s)
            if r:
                groups[current][window + 'ResetIn'] = r.group(1).strip()
                window = None
            elif 'Quota available' in s:
                groups[current][window + 'ResetIn'] = ''
                window = None
    return plan, groups


def collect_gemini(ts):
    try:
        header, screen = agy_usage_screen()
    except Exception as exc:
        print(f'gemini quota: {exc}', file=sys.stderr)
        return []
    plan, groups = parse_quota(header, screen)
    return [{'ts': ts, 'agent': 'gemini', 'kind': 'quota', 'plan': plan, 'group': g, **v} for g, v in groups.items() if v]


def record_run(path, task):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    usage = data.get('usage') or {}
    tokens = 0
    for key in ('total_tokens', 'totalTokens'):
        if key in usage:
            tokens = int(usage[key] or 0)
    if not tokens:
        tokens = sum(int(v or 0) for k, v in usage.items() if isinstance(v, (int, float)) and 'token' in k.lower() and 'cache' not in k.lower())
    return {
        'ts': iso(now()), 'agent': 'gemini', 'kind': 'run', 'task': task,
        'model': data.get('model') or 'gemini-3.8-flash-high',
        'seconds': round(float(data.get('duration_seconds') or 0), 1),
        'tokens': tokens, 'status': data.get('status') or '',
    }


# ---- Summary ----

def write_latest(rows):
    t = now()
    day_start = t.astimezone().replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
    week_start = t - dt.timedelta(days=7)
    grok_today, grok_today_by = grok_window(rows, day_start)
    grok_week, _ = grok_window(rows, week_start)
    quota = {}
    for row in rows:
        if row.get('agent') == 'gemini' and row.get('kind') == 'quota':
            quota[row['group']] = {**row}
    gem_runs = [r for r in rows if r.get('agent') == 'gemini' and r.get('kind') == 'run' and r['ts'] >= iso(day_start)]
    latest = {
        'updated': iso(t),
        'grok': {'plan': grok_plan(), 'today': grok_today, 'week': grok_week, 'todayByTask': grok_today_by,
                 'limit': 'xAI не сообщает лимит подписки: виден только расход'},
        'gemini': {
            'plan': (quota.get('gemini') or {}).get('plan', ''),
            'quota': {g: {k: v for k, v in q.items() if k.endswith('Remaining') or k.endswith('ResetIn')} | {'at': q['ts']} for g, q in quota.items()},
            'runsToday': len(gem_runs),
            'secondsToday': round(sum(r.get('seconds', 0) for r in gem_runs)),
        },
    }
    (OUT / 'latest.json').write_text(json.dumps(latest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return latest


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-gemini', action='store_true')
    ap.add_argument('--run', help='agy JSON output of a finished Gemini job')
    ap.add_argument('--task', default='', help='what the Gemini job was, for --run')
    a = ap.parse_args()
    ts = iso(now())
    rows = []
    if a.run:
        rows.append(record_run(a.run, a.task))
    else:
        rows += collect_grok(ts)
        if not a.no_gemini:
            rows += collect_gemini(ts)
    append(rows)
    print(json.dumps(write_latest(read_ledger()), ensure_ascii=False))


if __name__ == '__main__':
    main()
