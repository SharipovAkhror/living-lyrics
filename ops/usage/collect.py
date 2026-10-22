"""Usage ledger of the project's agents.

Appends a row to ops/usage/ledger/<YYYY-MM>.jsonl only when the measured tuple changed,
and writes ops/usage/latest.json. The in-app dashboard reads that summary. Run on the
owner's machine (Grok, Claude Code and Antigravity are signed in there):

    python ops/usage/collect.py            # tokens, Grok weekly window, Gemini quota, Claude plan
    python ops/usage/collect.py --no-gemini
    python ops/usage/collect.py --run <agy-output.json> --task "watch-video karitas"

`--run` records one finished Gemini job from the JSON `agy -p --output-format json` printed.
Nothing here reads credentials. Account e-mail, organisation ids and tokens are never written.
Claude's 5-hour and weekly windows stay in the Claude Code runtime; this file records only the plan.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
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
PROBE_NAME = 'll-t32-usage-probe'

SOURCE_GROK_USAGE = 'grok usage'
SOURCE_GROK_SCREEN = 'grok /usage'
SOURCE_GROK_SETTINGS = '~/.grok/settings_cache.json'
SOURCE_AGY_SCREEN = 'agy /usage'
SOURCE_AGY_RUN = 'agy -p'
SOURCE_CLAUDE = 'claude auth status --json'

# Confirmed on the Station screen: subscriptionType "pro" is labelled "Claude Pro".
# Other subscriptionType values are not given a display name here.
CLAUDE_PLAN = {'pro': 'Claude Pro'}

ANSI = re.compile(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?')
TZ_MARK = re.compile(r'(?i)\b(?:UTC|GMT)\b|Etc/GMT|[+-]\d{2}:?\d{2}|\bZ\b')


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


def read_ledger(days=None):
    """Every journal row, or only the last `days` when that is set.

    The week total is a difference of peaks, so the peak from before the window has to be
    visible. Change-only rows can be older than eight days; the whole file stays the source.
    """
    rows = []
    since = now() - dt.timedelta(days=days) if days is not None else None
    if not LEDGER.is_dir():
        return rows
    for path in sorted(LEDGER.glob('*.jsonl')):
        for line in path.read_text(encoding='utf-8').splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if since is None:
                rows.append(row)
                continue
            try:
                if dt.datetime.fromisoformat(row['ts'].replace('Z', '+00:00')) >= since:
                    rows.append(row)
            except (KeyError, ValueError):
                continue
    return rows


def snapshot_key(row):
    """Identity of a repeating snapshot. None means the row is an event and is always kept."""
    if row.get('agent') == 'grok' and row.get('kind') == 'session':
        return ('grok-session', row.get('session'))
    if row.get('agent') == 'gemini' and row.get('kind') == 'quota':
        return ('gemini-quota', row.get('group'))
    if row.get('agent') == 'grok' and row.get('kind') == 'quota':
        return ('grok-quota',)
    return None


def measured(row):
    """The tuple a later identical snapshot must not repeat. Reset countdowns are not part of it."""
    if row.get('agent') == 'grok' and row.get('kind') == 'session':
        return (row.get('totalTokens'), row.get('outputTokens'), row.get('modelCalls'), row.get('turns'))
    if row.get('agent') == 'gemini' and row.get('kind') == 'quota':
        return (row.get('plan'), row.get('weeklyRemaining'), row.get('fiveHourRemaining'))
    if row.get('agent') == 'grok' and row.get('kind') == 'quota':
        return (row.get('plan'), row.get('percentUsed'), row.get('resetsAt'))
    return None


def keep_changed(rows, last):
    """Copy of `last` is updated. Events (no snapshot key) are always kept."""
    kept = []
    for row in rows:
        key = snapshot_key(row)
        sig = measured(row)
        if key is None or last.get(key) != sig:
            kept.append(row)
            if key is not None:
                last[key] = sig
    return kept


def load_signatures():
    last = {}
    if not LEDGER.is_dir():
        return last
    for path in sorted(LEDGER.glob('*.jsonl')):
        for line in path.read_text(encoding='utf-8').splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            key = snapshot_key(row)
            if key is not None:
                last[key] = measured(row)
    return last


def day_shrink(rows, day):
    """(lines that day, lines the change-only rule would have kept). `day` is a YYYY-MM-DD prefix."""
    prior = {}
    day_rows = []
    for row in rows:
        ts = str(row.get('ts') or '')
        if ts[:10] < day:
            key = snapshot_key(row)
            if key is not None:
                prior[key] = measured(row)
        elif ts.startswith(day):
            day_rows.append(row)
    return len(day_rows), len(keep_changed(day_rows, prior))


# ---- Grok tokens ----

def grok_plan_meta():
    """(display name, fetched_at) from the local settings cache. No identity fields."""
    try:
        raw = json.loads(GROK_SETTINGS.read_text(encoding='utf-8'))
        payload = raw['payload']
        payload = json.loads(payload) if isinstance(payload, str) else payload
        settings = payload.get('settings') or {}
        return settings.get('subscription_tier_display') or '', payload.get('fetched_at') or ''
    except Exception:
        return '', ''


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
        text = subprocess.run(
            ['grok', 'usage', session_id], capture_output=True, encoding='utf-8', errors='replace', timeout=20,
        ).stdout
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


def _reset_label(raw):
    """The reset phrase only. Modal borders and a loading row are not part of it."""
    label = raw.strip()
    label = re.split(r'[│┃┌┐└┘├┤┬┴┼─]', label)[0]
    label = re.split(r'\s{3,}', label)[0]
    return label.strip()


def parse_grok_usage(screen):
    """Weekly allowance from the Grok /usage modal. The reset string is kept as printed."""
    text = ANSI.sub('', screen or '').replace('\r', '\n')
    header = re.search(r'Weekly limit \(([^)\r\n]+)\)', text, re.I)
    if not header:
        return None
    window = text[header.end():header.end() + 800]
    reset = re.search(r'Resets:\s*([^\r\n]+)', window)
    out = {'plan': header.group(1).strip()}
    before = window[:reset.start()] if reset else window
    percents = list(re.finditer(r'(\d+(?:\.\d+)?)\s*%', before))
    if percents:
        value = float(percents[-1].group(1))
        out['percentUsed'] = int(value) if value.is_integer() else value
    if reset:
        label = _reset_label(reset.group(1))
        if label:
            out['resetsAt'] = label
            out['timezoneLabeled'] = bool(TZ_MARK.search(label))
    return out


class Screen:
    """Minimal VT100 grid so a cursor-addressed modal can be read as lines."""

    def __init__(self, rows=50, cols=140):
        self.rows = rows
        self.cols = cols
        self.grid = [[' '] * cols for _ in range(rows)]
        self.cy = 0
        self.cx = 0

    def _clamp(self):
        self.cy = max(0, min(self.rows - 1, self.cy))
        self.cx = max(0, min(self.cols - 1, self.cx))

    def put(self, ch):
        if ch == '\n':
            self.cy = min(self.rows - 1, self.cy + 1)
            self.cx = 0
            return
        if ch == '\r':
            self.cx = 0
            return
        if ch == '\b':
            self.cx = max(0, self.cx - 1)
            return
        if ch == '\t':
            self.cx = min(self.cols - 1, ((self.cx // 8) + 1) * 8)
            return
        if ord(ch) < 32:
            return
        self._clamp()
        self.grid[self.cy][self.cx] = ch
        if self.cx + 1 < self.cols:
            self.cx += 1
        else:
            self.cx = 0
            self.cy = min(self.rows - 1, self.cy + 1)

    def erase_display(self, mode):
        if mode in (2, 3):
            self.grid = [[' '] * self.cols for _ in range(self.rows)]
            return
        if mode == 0:
            self.erase_line(0)
            for r in range(self.cy + 1, self.rows):
                self.grid[r] = [' '] * self.cols
        elif mode == 1:
            self.erase_line(1)
            for r in range(self.cy):
                self.grid[r] = [' '] * self.cols

    def erase_line(self, mode):
        if mode == 2:
            self.grid[self.cy] = [' '] * self.cols
        elif mode == 0:
            for c in range(self.cx, self.cols):
                self.grid[self.cy][c] = ' '
        elif mode == 1:
            for c in range(0, self.cx + 1):
                self.grid[self.cy][c] = ' '

    def csi(self, params, final):
        nums = []
        for part in params.split(';'):
            part = part.strip()
            if part == '':
                nums.append(None)
            else:
                try:
                    nums.append(int(part))
                except ValueError:
                    nums.append(None)

        def n(i, default):
            if i < len(nums) and nums[i] is not None:
                return nums[i]
            return default

        if final in ('H', 'f'):
            self.cy = n(0, 1) - 1
            self.cx = n(1, 1) - 1
            self._clamp()
        elif final == 'A':
            self.cy -= n(0, 1)
            self._clamp()
        elif final == 'B':
            self.cy += n(0, 1)
            self._clamp()
        elif final == 'C':
            self.cx += n(0, 1)
            self._clamp()
        elif final == 'D':
            self.cx -= n(0, 1)
            self._clamp()
        elif final == 'G':
            self.cx = n(0, 1) - 1
            self._clamp()
        elif final == 'J':
            self.erase_display(n(0, 0))
        elif final == 'K':
            self.erase_line(n(0, 0))

    def feed(self, data):
        i = 0
        n = len(data)
        while i < n:
            c = data[i]
            if c != '\x1b':
                self.put(c)
                i += 1
                continue
            if i + 1 >= n:
                break
            nxt = data[i + 1]
            if nxt == '[':
                j = i + 2
                while j < n and not (0x40 <= ord(data[j]) <= 0x7E):
                    j += 1
                if j >= n:
                    break
                params = data[i + 2:j].lstrip('?>=<')
                self.csi(params, data[j])
                i = j + 1
            elif nxt == ']':
                j = i + 2
                while j < n and data[j] != '\x07':
                    if data[j] == '\x1b' and j + 1 < n and data[j + 1] == '\\':
                        j += 2
                        break
                    j += 1
                else:
                    j += 1
                i = j
            else:
                i += 2

    def text(self):
        lines = [''.join(row).rstrip() for row in self.grid]
        while lines and not lines[-1].strip():
            lines.pop()
        return '\n'.join(lines)


def forget_probe_sessions():
    """Drop sessions the quota probe created. Never touches a project session."""
    if not SESSIONS.is_dir():
        return
    for base in list(SESSIONS.iterdir()):
        try:
            name = urllib.parse.unquote(base.name)
        except Exception:
            name = base.name
        if PROBE_NAME in name.lower() and base.is_dir():
            shutil.rmtree(base, ignore_errors=True)


def _terminate(proc):
    pid = getattr(proc, 'pid', None)
    try:
        proc.terminate(force=True)
    except Exception:
        pass
    if pid:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], capture_output=True)


def grok_usage_screen():
    """Open an isolated grok, run /usage, return the screen. Does not attach to the live leader."""
    from winpty import PtyProcess

    rows, cols = 50, 140
    probe = Path(os.environ.get('TEMP') or '.') / PROBE_NAME
    probe.mkdir(exist_ok=True)
    sock = Path(os.environ.get('TEMP') or '.') / 'll-t32-usage-leader.sock'
    try:
        sock.unlink()
    except OSError:
        pass
    forget_probe_sessions()
    exe = shutil.which('grok') or shutil.which('grok.exe') or str(Path.home() / '.grok' / 'bin' / 'grok.exe')
    proc = PtyProcess.spawn([exe, '--leader-socket', str(sock)], cwd=str(probe), dimensions=(rows, cols))
    screen = Screen(rows, cols)
    lock = threading.Lock()

    def reader():
        while True:
            try:
                data = proc.read(4096)
            except Exception:
                return
            if data:
                with lock:
                    screen.feed(data)

    threading.Thread(target=reader, daemon=True).start()
    text = ''
    try:
        time.sleep(12)
        with lock:
            seen = screen.text().lower()
        proc.write('\r')
        time.sleep(4 if 'trust' in seen else 2)
        proc.write('/usage\r')
        deadline = time.time() + 12
        text = ''
        while time.time() < deadline:
            time.sleep(0.4)
            with lock:
                text = screen.text()
            if 'Weekly limit' in text and 'Resets:' in text and 'Loading session usage' not in text:
                break
        proc.write('\x1b')
        time.sleep(0.4)
        proc.write('/exit\r')
        time.sleep(1.5)
    finally:
        _terminate(proc)
        forget_probe_sessions()
        try:
            sock.unlink()
        except OSError:
            pass
    return text


def collect_grok_weekly(ts):
    try:
        screen = grok_usage_screen()
    except Exception as exc:
        print(f'grok weekly: {exc}', file=sys.stderr)
        return None
    parsed = parse_grok_usage(screen)
    if not parsed or parsed.get('percentUsed') is None:
        print('grok weekly: screen had no weekly limit', file=sys.stderr)
        return None
    parsed['at'] = ts
    return parsed


def grok_quota_row(ts, weekly):
    row = {
        'ts': ts, 'agent': 'grok', 'kind': 'quota',
        'plan': weekly.get('plan') or '',
        'percentUsed': weekly.get('percentUsed'),
        'resetsAt': weekly.get('resetsAt') or '',
        'timezoneLabeled': bool(weekly.get('timezoneLabeled')),
    }
    return row


# ---- Gemini (Antigravity) ----

def agy_usage_screen():
    """Open agy in a pseudo-console, run /usage, return the screen text."""
    from winpty import PtyProcess

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
        _terminate(proc)
    return header, screen


def _as_number(text):
    value = float(text)
    return int(value) if value.is_integer() else value


def parse_quota(header, screen):
    """Plan and remaining percents from an agy /usage screen.

    "Quota available" is a full window: remaining 100 and no reset time.
    A reset is stored only when the screen prints "Refreshes in ...".
    """
    plan = ''
    found = re.search(r'\(([^()@]*(?:Pro|Ultra|Free|Plus|Standard)[^()@]*)\)', header or '')
    if found:
        plan = found.group(1).strip()
    groups = {}
    current = None
    window = None
    for line in (screen or '').replace('\r', '\n').split('\n'):
        s = line.strip()
        if s.endswith('MODELS') and s.isupper():
            current = 'gemini' if 'GEMINI' in s else 'claude-gpt' if 'CLAUDE' in s else s.lower()
            groups[current] = {}
            window = None
        elif current and 'Weekly Limit Remaining' in s:
            window = 'weekly'
        elif current and 'Five Hour Limit Remaining' in s:
            window = 'fiveHour'
        elif current and window:
            percent = re.search(r'(\d+(?:\.\d+)?)%', s)
            if percent and window + 'Remaining' not in groups[current]:
                groups[current][window + 'Remaining'] = _as_number(percent.group(1))
                continue
            refreshes = re.search(r'Refreshes in\s+(.+)$', s)
            if refreshes:
                groups[current][window + 'ResetIn'] = refreshes.group(1).strip()
                window = None
            elif 'Quota available' in s:
                if window + 'Remaining' not in groups[current]:
                    groups[current][window + 'Remaining'] = 100
                window = None
    return plan, {name: values for name, values in groups.items() if values}


def quota_fields(src, at):
    """One group's numbers for latest.json. Empty reset strings are omitted."""
    out = {'source': SOURCE_AGY_SCREEN, 'at': at}
    for key in ('weeklyRemaining', 'fiveHourRemaining'):
        if src.get(key) is not None and src.get(key) != '':
            out[key] = src[key]
    for key in ('weeklyResetIn', 'fiveHourResetIn'):
        if src.get(key):
            out[key] = src[key]
    return out


def collect_gemini_live(ts):
    try:
        header, screen = agy_usage_screen()
    except Exception as exc:
        print(f'gemini quota: {exc}', file=sys.stderr)
        return None
    plan, groups = parse_quota(header, screen)
    if not groups:
        print('gemini quota: screen had no windows', file=sys.stderr)
        return None
    return {'plan': plan, 'groups': groups, 'at': ts}


def gemini_rows(ts, live):
    rows = []
    for name, values in live['groups'].items():
        row = {'ts': ts, 'agent': 'gemini', 'kind': 'quota', 'plan': live.get('plan') or '', 'group': name}
        row.update(values)
        rows.append(row)
    return rows


def record_run(path, task):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    usage = data.get('usage') or {}
    tokens = 0
    for key in ('total_tokens', 'totalTokens'):
        if key in usage:
            tokens = int(usage[key] or 0)
    if not tokens:
        tokens = sum(
            int(v or 0) for k, v in usage.items()
            if isinstance(v, (int, float)) and 'token' in k.lower() and 'cache' not in k.lower()
        )
    return {
        'ts': iso(now()), 'agent': 'gemini', 'kind': 'run', 'task': task,
        'model': data.get('model') or 'gemini-3.8-flash-high',
        'seconds': round(float(data.get('duration_seconds') or 0), 1),
        'tokens': tokens, 'status': data.get('status') or '',
    }


# ---- Claude plan ----

def claude_executable():
    appdata = os.environ.get('APPDATA', '')
    exe = Path(appdata) / 'npm' / 'node_modules' / '@anthropic-ai' / 'claude-code' / 'bin' / 'claude.exe'
    if exe.is_file():
        return str(exe)
    for name in ('claude.exe', 'claude.cmd', 'claude'):
        found = shutil.which(name)
        if found:
            return found
    return 'claude'


def parse_claude_auth(text):
    """Display plan from `claude auth status --json`. Identity fields are ignored."""
    start = (text or '').find('{')
    if start < 0:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not data.get('loggedIn', True):
        return None
    return CLAUDE_PLAN.get(data.get('subscriptionType'))


def collect_claude(ts):
    try:
        proc = subprocess.run(
            [claude_executable(), 'auth', 'status', '--json'],
            capture_output=True, encoding='utf-8', errors='replace', timeout=40,
        )
    except Exception as exc:
        print(f'claude plan: {exc}', file=sys.stderr)
        return None
    plan = parse_claude_auth(proc.stdout or '')
    if not plan:
        print('claude plan: no confirmed plan name', file=sys.stderr)
        return None
    return {'plan': plan, 'planSource': SOURCE_CLAUDE, 'at': ts}


# ---- Summary ----

def _gemini_from_rows(rows):
    quota_rows = {}
    plan = ''
    at = ''
    for row in rows:
        if row.get('agent') == 'gemini' and row.get('kind') == 'quota':
            quota_rows[row['group']] = row
            if row.get('plan'):
                plan = row['plan']
            at = row.get('ts') or at
    return plan, quota_rows, at


# Waste caps (docs/process/executor-budget.md, rules R2 and R4; LL · Ops). Flag only, never kill.
CAP_TOKENS = 30_000_000
CAP_TOKENS_NO_COMMIT = 50_000_000
CAP_WALL_S = 2 * 3600
ACTIVE_S = 30 * 60          # a session not updated for this long is over: no alert
WEEKLY_ALERT_PCT = 70
WEEKLY_ALERT_EARLY_S = 24 * 3600
WORKTREES = ROOT.parent / 'living-lyrics-wt'


def _parse_ts(value):
    try:
        t = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _reset_time(label, at):
    """'October 23, 21:08' (local time, no year, as the Grok modal prints it) → aware datetime, or None."""
    try:
        t = dt.datetime.strptime(f'{label} {at.year}', '%B %d, %H:%M %Y')
    except (ValueError, TypeError):
        return None
    t = t.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
    return t.replace(year=t.year + 1) if t < at - dt.timedelta(days=1) else t


def worktree_commits_since(task, since):
    """Commits made in the executor's worktree since `since`; None when it can't be read."""
    folder = WORKTREES / task
    if not folder.is_dir():
        return None
    try:
        out = subprocess.run(['git', '-C', str(folder), 'log', f'--since={iso(since)}', '--format=%H'],
                             capture_output=True, encoding='utf-8', errors='replace', timeout=20)
    except Exception:
        return None
    return len(out.stdout.split()) if out.returncode == 0 else None


def grok_alerts(rows, stamp, weekly=None, commits=worktree_commits_since):
    """Cap alerts {kind, task, session, value, at}. Wall time runs from the session's first ledger snapshot
    (so it can be up to one collection interval short) to its own last update."""
    t = _parse_ts(stamp)
    first, last = {}, {}
    for r in rows:
        if r.get('agent') != 'grok' or r.get('kind') != 'session':
            continue
        key = (r.get('task', ''), r.get('session', ''))
        first[key] = min(first.get(key, r['ts']), r['ts'])
        if key not in last or r['ts'] >= last[key]['ts']:
            last[key] = r
    alerts = []
    for key, r in sorted(last.items()):
        start = _parse_ts(first[key])
        updated = _parse_ts(r.get('sessionUpdated') or r['ts']) or _parse_ts(r['ts'])
        if not (t and start and updated) or (t - updated).total_seconds() > ACTIVE_S:
            continue
        wall = max(0, round((updated - start).total_seconds()))
        tokens = int(r.get('totalTokens') or 0)
        base = {'task': key[0], 'session': key[1], 'at': stamp}
        if tokens > CAP_TOKENS:
            alerts.append({'kind': 'tokens', 'value': tokens, **base})
        if wall > CAP_WALL_S:
            alerts.append({'kind': 'wall', 'value': wall, **base})
        if tokens > CAP_TOKENS_NO_COMMIT or wall > CAP_WALL_S:
            made = commits(key[0], start)
            if made == 0:
                alerts.append({'kind': 'no-commit', 'value': tokens, **base})
    if weekly and weekly.get('percentUsed') is not None and weekly['percentUsed'] >= WEEKLY_ALERT_PCT:
        at = _parse_ts(weekly.get('at') or stamp)
        reset = _reset_time(weekly.get('resetsAt'), at) if at else None
        if reset and (reset - at).total_seconds() > WEEKLY_ALERT_EARLY_S:
            alerts.append({'kind': 'weekly', 'task': '', 'session': '', 'value': weekly['percentUsed'], 'at': stamp})
    return alerts


def build_latest(rows, stamp, *, claude=None, gemini_live=None, grok_live=None, prev=None, settings_plan=('', '')):
    """The summary dict. Missing measurements are omitted. Nothing is guessed."""
    prev = prev or {}
    t = dt.datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    day_start = t.astimezone().replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
    week_start = t - dt.timedelta(days=7)
    grok_today, grok_today_by = grok_window(rows, day_start)
    grok_week, _ = grok_window(rows, week_start)

    grok = {
        'today': grok_today,
        'todaySource': SOURCE_GROK_USAGE,
        'todayAt': stamp,
        'week': grok_week,
        'weekSource': SOURCE_GROK_USAGE,
        'weekAt': stamp,
        'todayByTask': grok_today_by,
        'todayByTaskSource': SOURCE_GROK_USAGE,
        'todayByTaskAt': stamp,
    }
    if grok_live and grok_live.get('plan'):
        grok['plan'] = grok_live['plan']
        grok['planSource'] = SOURCE_GROK_SCREEN
        grok['planAt'] = grok_live.get('at') or stamp
    elif settings_plan[0]:
        grok['plan'] = settings_plan[0]
        grok['planSource'] = SOURCE_GROK_SETTINGS
        grok['planAt'] = _short_stamp(settings_plan[1]) or stamp
    elif prev.get('grok', {}).get('plan'):
        grok['plan'] = prev['grok']['plan']
        if prev['grok'].get('planSource'):
            grok['planSource'] = prev['grok']['planSource']
        if prev['grok'].get('planAt'):
            grok['planAt'] = prev['grok']['planAt']

    if grok_live and grok_live.get('percentUsed') is not None:
        weekly = {
            'percentUsed': grok_live['percentUsed'],
            'source': SOURCE_GROK_SCREEN,
            'at': grok_live.get('at') or stamp,
            'timezoneLabeled': bool(grok_live.get('timezoneLabeled')),
        }
        if grok_live.get('resetsAt'):
            weekly['resetsAt'] = grok_live['resetsAt']
        grok['weekly'] = weekly
    elif prev.get('grok', {}).get('weekly'):
        grok['weekly'] = prev['grok']['weekly']

    if gemini_live:
        plan = gemini_live.get('plan') or ''
        groups = gemini_live.get('groups') or {}
        gem_at = gemini_live.get('at') or stamp
        quota = {name: quota_fields(values, gem_at) for name, values in groups.items()}
        gem_source = SOURCE_AGY_SCREEN
    else:
        plan, group_rows, gem_at = _gemini_from_rows(rows)
        quota = {name: quota_fields(values, values.get('ts') or gem_at) for name, values in group_rows.items()}
        gem_source = SOURCE_AGY_SCREEN
        if not quota and prev.get('gemini', {}).get('quota'):
            quota = prev['gemini']['quota']
            plan = plan or prev['gemini'].get('plan') or ''
            gem_at = prev['gemini'].get('at') or ''
            gem_source = prev['gemini'].get('planSource') or SOURCE_AGY_SCREEN

    gem_runs = [
        r for r in rows
        if r.get('agent') == 'gemini' and r.get('kind') == 'run' and r['ts'] >= iso(day_start)
    ]
    gemini = {
        'quota': quota,
        'runsToday': len(gem_runs),
        'runsTodaySource': SOURCE_AGY_RUN,
        'runsTodayAt': stamp,
        'secondsToday': round(sum(r.get('seconds', 0) for r in gem_runs)),
        'secondsTodaySource': SOURCE_AGY_RUN,
        'secondsTodayAt': stamp,
    }
    if plan:
        gemini['plan'] = plan
        gemini['planSource'] = gem_source
        if gem_at:
            gemini['at'] = gem_at
    if 'claude-gpt' in quota:
        gemini['claudeGpt'] = quota['claude-gpt']

    latest = {'updated': stamp, 'grok': grok, 'gemini': gemini, 'alerts': grok_alerts(rows, stamp, grok.get('weekly'))}
    # Filled by LL · Ops (ops/usage/review.py), weekly or on demand; carried over untouched.
    if prev.get('value'):
        latest['value'] = prev['value']
    if claude and claude.get('plan'):
        latest['claude'] = {
            'plan': claude['plan'],
            'planSource': claude.get('planSource') or SOURCE_CLAUDE,
            'at': claude.get('at') or stamp,
        }
    elif prev.get('claude', {}).get('plan'):
        latest['claude'] = prev['claude']
    return latest


def _short_stamp(value):
    """Trim a client timestamp to the second, UTC, or return ''."""
    if not value:
        return ''
    text = str(value).replace('Z', '+00:00')
    try:
        parsed = dt.datetime.fromisoformat(text[:32])
    except ValueError:
        return ''
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return iso(parsed.astimezone(dt.timezone.utc))


def previous_latest():
    try:
        return json.loads((OUT / 'latest.json').read_text(encoding='utf-8'))
    except Exception:
        return {}


def write_latest(rows, stamp=None, **live):
    stamp = stamp or iso(now())
    latest = build_latest(
        rows, stamp,
        claude=live.get('claude'),
        gemini_live=live.get('gemini_live'),
        grok_live=live.get('grok_live'),
        prev=previous_latest(),
        settings_plan=grok_plan_meta(),
    )
    (OUT / 'latest.json').write_text(json.dumps(latest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return latest


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-gemini', action='store_true')
    ap.add_argument('--run', help='agy JSON output of a finished Gemini job')
    ap.add_argument('--task', default='', help='what the Gemini job was, for --run')
    args = ap.parse_args()
    ts = iso(now())
    rows = []
    claude = collect_claude(ts)
    gemini_live = None
    grok_live = None
    if args.run:
        rows.append(record_run(args.run, args.task))
    else:
        rows += collect_grok(ts)
        if not args.no_gemini:
            gemini_live = collect_gemini_live(ts)
            if gemini_live:
                rows += gemini_rows(ts, gemini_live)
        grok_live = collect_grok_weekly(ts)
        if grok_live:
            rows.append(grok_quota_row(ts, grok_live))
    append(keep_changed(rows, load_signatures()))
    print(json.dumps(
        write_latest(read_ledger(), ts, claude=claude, gemini_live=gemini_live, grok_live=grok_live),
        ensure_ascii=False,
    ))


if __name__ == '__main__':
    main()
