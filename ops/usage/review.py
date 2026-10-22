"""Weekly Grok spend review: recompute the numbers in docs/research/spend-<year>-w<NN>.md.

Read-only. Sources: ops/usage/ledger/*.jsonl (which Grok sessions belong to the project),
`grok usage <id>` (tokens, cache, list-price cost, per turn), ~/.grok/sessions/<cwd>/<id>/
(events.jsonl and updates.jsonl: wall time, tool calls, file reads, failed hooks, compaction segments).

    python ops/usage/review.py [--since 2026-10-16] [--ledger ops/usage/ledger] [--json out.json]

Run it on the Station from the main checkout: the collector appends the live ledger there.
"""
import argparse, collections, glob, json, ntpath, os, statistics, sys, subprocess, urllib.parse
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GROK = os.path.expanduser('~/.grok/bin/grok.exe' if os.name == 'nt' else '~/.grok/bin/grok')
SESS = os.path.expanduser('~/.grok/sessions')
CAP = 30e6  # per-session token cap from docs/process/executor-budget.md


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')[:32])


def ledger_sessions(ledger, since):
    tasks = {}
    for f in sorted(glob.glob(os.path.join(ledger, '*.jsonl'))):
        for line in open(f, encoding='utf-8'):
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get('agent') == 'grok' and r.get('kind') == 'session' and r.get('sessionUpdated', '') >= since:
                tasks[r['session']] = r['task']
    return tasks


def usage(sid):
    p = subprocess.run([GROK, 'usage', sid], capture_output=True, text=True, encoding='utf-8',
                       timeout=60, cwd=os.path.expanduser('~'))
    return json.loads(p.stdout)


def scan(sid):
    found = glob.glob(os.path.join(SESS, '*', sid))
    if not found:
        return {}
    d = found[0]
    wt = ntpath.basename(urllib.parse.unquote(os.path.basename(os.path.dirname(d))))
    r = dict(turns=[], tool_s=0.0, reads=collections.Counter(), api_ms=0, hooks_failed=0,
             segments=len(glob.glob(os.path.join(d, 'compaction', 'segment_*.md'))))
    start = None
    for line in open(os.path.join(d, 'events.jsonl'), encoding='utf-8', errors='replace'):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get('type')
        if t == 'turn_started':
            start = e['ts']
        elif t == 'turn_ended' and start:
            r['turns'].append((start, (ts(e['ts']) - ts(start)).total_seconds()))
            start = None
        elif t == 'tool_completed':
            r['tool_s'] += e.get('duration_ms', 0) / 1000
    up = os.path.join(d, 'updates.jsonl')
    if os.path.exists(up):
        for line in open(up, encoding='utf-8', errors='replace'):
            if '"tool_call"' not in line and '"turn_completed"' not in line and '"hook_execution"' not in line:
                continue
            try:
                u = json.loads(line)['params']['update']
            except (ValueError, KeyError):
                continue
            k = u.get('sessionUpdate')
            if k == 'tool_call' and u.get('title') == 'read_file':
                f = (u.get('rawInput') or {}).get('target_file', '')
                r['reads'][f.split(wt, 1)[-1].lstrip('\\/').replace('\\', '/')] += 1
            elif k == 'turn_completed':
                r['api_ms'] += (u.get('usage') or {}).get('apiDurationMs', 0)
            elif k == 'hook_execution':
                r['hooks_failed'] += sum(1 for x in u.get('runs', []) if x.get('status', {}).get('status') == 'failed')
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default='2026-10-16')
    ap.add_argument('--ledger', default=os.path.join(ROOT, 'ops', 'usage', 'ledger'))
    ap.add_argument('--json')
    a = ap.parse_args()
    rows, day, files = [], collections.Counter(), collections.Counter()
    for sid, task in ledger_sessions(a.ledger, a.since).items():
        u = usage(sid)
        s, g = u['session'], scan(sid)
        for t in u.get('turns', []):
            day[t['endedAt'][:10]] += t['totalTokens']
        files.update(g.get('reads', {}))
        rows.append(dict(sid=sid, task=task, tok=s['totalTokens'], inp=s['inputTokens'], cached=s['cachedReadTokens'],
                         out=s['outputTokens'], calls=s['modelCalls'], usd=s.get('costUsdTicks', 0) / 1e10,
                         wall_h=sum(x[1] for x in g.get('turns', [])) / 3600, tool_h=g.get('tool_s', 0) / 3600,
                         api_h=g.get('api_ms', 0) / 3.6e6, segments=g.get('segments', 0),
                         reads=sum(g.get('reads', {}).values()), rereads=sum(v - 1 for v in g.get('reads', {}).values()),
                         start=(g.get('turns') or [('',)])[0][0], hooks_failed=g.get('hooks_failed', 0)))
    T = sum(r['tok'] for r in rows)
    I = sum(r['inp'] for r in rows)
    C = sum(r['calls'] for r in rows)
    print(f"sessions {len(rows)}  tokens {T/1e6:.1f}M  cached share of input {sum(r['cached'] for r in rows)/I:.1%}  "
          f"output share {sum(r['out'] for r in rows)/T:.2%}  model calls {C}  tokens per call {T/C:.0f}  "
          f"list price ${sum(r['usd'] for r in rows):.0f}")
    print(f"wall {sum(r['wall_h'] for r in rows):.1f}h  model {sum(r['api_h'] for r in rows):.1f}h  "
          f"tools {sum(r['tool_h'] for r in rows):.1f}h  file reads {sum(r['reads'] for r in rows)}  "
          f"re-reads {sum(r['rereads'] for r in rows)}  failed hook runs {sum(r['hooks_failed'] for r in rows)}")
    big = [r for r in rows if r['tok'] > CAP]
    print(f"median session {statistics.median(r['tok'] for r in rows)/1e6:.1f}M; over {CAP/1e6:.0f}M: {len(big)} sessions, "
          f"{sum(r['tok'] - CAP for r in big)/1e6:.0f}M above the cap")
    print('most read files:', ', '.join(f'{f} x{n}' for f, n in files.most_common(5)))
    by = collections.defaultdict(collections.Counter)
    for r in rows:
        for k in ('tok', 'usd', 'calls', 'wall_h', 'segments'):
            by[r['task']][k] += r[k]
        by[r['task']]['sessions'] += 1
    print(f"\n{'task':18s} {'tokM':>7s} {'share':>6s} {'$list':>6s} {'wall h':>6s} {'sess':>4s} {'calls':>5s}")
    for k, c in sorted(by.items(), key=lambda x: -x[1]['tok']):
        print(f"{k:18s} {c['tok']/1e6:7.1f} {c['tok']/T:6.1%} {c['usd']:6.1f} {c['wall_h']:6.1f} {c['sessions']:4d} {c['calls']:5d}")
    cum = 0
    print()
    for d in sorted(day):
        cum += day[d]
        print(f"{d} {day[d]/1e6:7.0f}M  cumulative {cum/T:5.0%}")
    if a.json:
        json.dump(rows, open(a.json, 'w', encoding='utf-8'), ensure_ascii=False)


if __name__ == '__main__':
    sys.exit(main())
