"""Weekly Claude chat spend from session transcripts (~/.claude/projects/*living-lyrics*/**/*.jsonl).

Read-only. One API call = one assistant message id (a message split over several lines counts once).
Context per call = input + cache write + cache read tokens.

    python ops/usage/claude_review.py [--since 2026-10-16T16:08] [--by-chat]

--by-chat adds tokens per chat name (customTitle; archive suffixes folded, subagents under their parent chat).
"""
import argparse, collections, glob, json, os, re

BASE = os.path.expanduser('~/.claude/projects')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default='2026-10-16T16:08')
    ap.add_argument('--by-chat', action='store_true')
    a = ap.parse_args()
    title = {}
    seen = set()
    S = collections.defaultdict(collections.Counter)
    meta, day, over, model = {}, collections.Counter(), collections.Counter(), collections.Counter()
    caps = (200e3, 300e3, 400e3, 600e3)
    for f in glob.glob(BASE + '/*living-lyrics*/**/*.jsonl', recursive=True):
        for line in open(f, encoding='utf-8', errors='replace'):
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get('customTitle'):
                title[f] = j['customTitle']
            ts = j.get('timestamp', '')
            if j.get('type') != 'assistant' or ts < a.since:
                continue
            m = j.get('message', {})
            u = m.get('usage') or {}
            if not u or (f, m.get('id')) in seen:
                continue
            seen.add((f, m.get('id')))
            ctx = u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0)
            tok = ctx + u.get('output_tokens', 0)
            c = S[f]
            c['tok'] += tok; c['cr'] += u.get('cache_read_input_tokens', 0); c['out'] += u.get('output_tokens', 0)
            c['calls'] += 1; c['maxctx'] = max(c['maxctx'], ctx)
            meta.setdefault(f, [ts, ts, m.get('model')])[1] = ts
            day[ts[:10]] += tok
            model[m.get('model')] += tok
            for cap in caps:
                over[cap] += max(0, ctx - cap)
    T = sum(c['tok'] for c in S.values())
    calls = sum(c['calls'] for c in S.values())
    print(f"transcripts {len(S)}  tokens {T/1e6:.0f}M  cache-read share {sum(c['cr'] for c in S.values())/T:.1%}  "
          f"output {sum(c['out'] for c in S.values())/1e6:.1f}M  calls {calls}  context per call {T/calls/1e3:.0f}k")
    print('by model:', {k: round(v / 1e6) for k, v in model.most_common()})
    print('tokens above a context cap, M:', {f'{int(k/1e3)}k': round(v / 1e6) for k, v in over.items()})
    print('by day, M:', {k: round(v / 1e6) for k, v in sorted(day.items())})
    for f, c in sorted(S.items(), key=lambda x: -x[1]['tok'])[:12]:
        first, last, mdl = meta[f]
        print(f"{c['tok']/1e6:6.0f}M calls {c['calls']:5d} avg ctx {c['tok']/c['calls']/1e3:4.0f}k max {c['maxctx']/1e3:4.0f}k "
              f"{mdl} {first[5:16]}..{last[5:16]} {os.path.basename(f)[:8]}{' (subagent)' if 'subagents' in f else ''}")
    if a.by_chat:
        chat = collections.Counter()
        for f, c in S.items():
            sub = os.sep + 'subagents' + os.sep in os.path.normpath(f)
            owner = os.path.dirname(os.path.dirname(f)) + '.jsonl' if sub else f
            name = re.sub(r' \(Main\)| · архив.*', '', title.get(owner, '(untitled)'))
            chat[name + (' / subagents' if sub else '')] += c['tok']
        print('by chat, M:')
        for k, v in chat.most_common():
            print(f'{v/1e6:7.0f}  {v/T:5.1%}  {k}')


if __name__ == '__main__':
    main()
