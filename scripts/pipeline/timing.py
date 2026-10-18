"""Helpers for reading and writing word timing in lyrics.json (align.py, qa_sync.py, apply_timing.py).

Only `s`/`e` of words, line `flags` and section `start`/`end` are ever changed; everything else in
the file stays byte for byte (same key order, 2-space indent, UTF-8 as is).
"""
from __future__ import annotations

import hashlib

FLAG_ORDER = ['text-unverified', 'timing-draft', 'translation-draft', 'sharh-draft', 'attribution-unverified']
LEAD = 0.6   # an instrumental card ends this long before the first sung word
TAIL = 0.8   # and starts this long after the last one


def vocal_lines(lyrics: dict) -> list[tuple[dict, dict]]:
    """(section, line) for every sung line, in file order."""
    return [(sec, line) for sec in lyrics['sections'] if sec['kind'] == 'vocal' for line in sec['lines']]


# Solo: one leading voice. The name may be missing. Choir is its own group (a looser tolerance,
# still provable). A duet, tutti or orchestra is neither: the stem mixes them.
_CHOIR = ('хор', 'choir', 'chorus', 'cappella')
_OTHER = ('ансамбль', 'ensemble', 'оркестр', 'orchestra', 'tutti')


def group(sec: dict, line: dict) -> str:
    """'solo', 'choir' or 'other'. An empty voice is one unnamed lead, so it is solo."""
    voice = (line.get('voice') or sec.get('voice') or '').strip()
    low = voice.casefold().replace('ё', 'е')
    if any(mark in low for mark in _CHOIR):
        return 'choir'
    if not voice:
        return 'solo'
    if low in ('все', 'all', 'все исполнители') or low.startswith('все ') or low.startswith('all '):
        return 'other'
    if ' и ' in f' {low} ':
        return 'other'
    if any(mark in low for mark in _OTHER):
        return 'other'
    return 'solo'


def is_solo(sec: dict, line: dict) -> bool:
    return group(sec, line) == 'solo'


def is_choir(sec: dict, line: dict) -> bool:
    return group(sec, line) == 'choir'


def line_text(line: dict) -> str:
    return ' '.join(w['w'] for w in line['words'])


def text_sig(line: dict) -> str:
    """Short fingerprint of a line's words: timing made for other words must not be applied."""
    return hashlib.sha1(line_text(line).encode('utf-8')).hexdigest()[:8]


def set_flag(obj: dict, flag: str, on: bool) -> None:
    """Add or remove a flag, keeping the canonical order; drop the key when no flags remain.
    A new `flags` key goes where the schema puts it: last, after everything else."""
    flags = [f for f in obj.get('flags', []) if f != flag]
    if on:
        flags.append(flag)
        flags.sort(key=lambda f: FLAG_ORDER.index(f) if f in FLAG_ORDER else len(FLAG_ORDER))
    if flags:
        obj['flags'] = flags
    else:
        obj.pop('flags', None)


def r2(x: float) -> float:
    return round(float(x) + 0.0, 2)


def enforce_order(lyrics: dict) -> int:
    """Make word times strictly ordered across the song (validator rule): e > s, s ≥ previous e.
    Trims the previous word's end rather than moving a start. Returns the number of fixes."""
    fixes = 0
    prev = None
    for _, line in vocal_lines(lyrics):
        for w in line['words']:
            if prev is not None and w['s'] < prev['e']:
                if w['s'] - prev['s'] >= 0.02:
                    prev['e'] = w['s']
                else:
                    w['s'] = r2(prev['e'])
                fixes += 1
            if w['e'] <= w['s']:
                w['e'] = r2(w['s'] + 0.02)
                fixes += 1
            prev = w
    return fixes


def fit_sections(lyrics: dict, duration: float, good: set[str]) -> list[str]:
    """Move section boundaries to the measured words.

    Vocal sections start LEAD before their first word and end TAIL after their last; the neighbouring
    instrumental section gives way. Between two vocal sections the boundary goes halfway through the
    pause. An instrumental section loses `timing-draft` when both of its edges now come from lines in
    `good` (or from the start or end of the song). Returns human-readable notes about each change."""
    secs = lyrics['sections']
    notes: list[str] = []

    def span(sec):
        ws = [w for line in sec['lines'] for w in line['words']]
        return min(w['s'] for w in ws), max(w['e'] for w in ws)

    spans = {i: span(s) for i, s in enumerate(secs) if s['kind'] == 'vocal'}
    for i in range(len(secs) - 1):
        a, b = secs[i], secs[i + 1]
        if abs(a['end'] - b['start']) > 0.01:
            continue  # not contiguous: leave as is
        if a['kind'] == 'vocal' and b['kind'] == 'vocal':
            last, first = spans[i][1], spans[i + 1][0]
            cut = (last + first) / 2 if first > last else first
        elif a['kind'] == 'instrumental' and b['kind'] == 'vocal':
            first = spans[i + 1][0]
            cut = min(first, max(a['start'] + 1.0, first - LEAD))
        elif a['kind'] == 'vocal' and b['kind'] == 'instrumental':
            last = spans[i][1]
            cut = max(last, min(b['end'] - 1.0, last + TAIL))
        else:
            continue
        cut = r2(cut)
        if cut <= a['start'] + 0.1 or cut >= b['end'] - 0.1:
            notes.append(f"{a['id']} | {b['id']}: слова вышли за соседнюю секцию ({cut}) — границы не тронуты, проверьте структуру")
            continue
        if abs(cut - a['end']) >= 0.01:
            notes.append(f"{a['id']} | {b['id']}: {a['end']} → {cut}")
            a['end'] = cut
            b['start'] = cut
    if secs and secs[0]['kind'] == 'vocal':
        secs[0]['start'] = r2(max(0.0, min(secs[0]['start'], spans[0][0] - LEAD)))
    if secs and secs[-1]['kind'] == 'vocal':
        secs[-1]['end'] = r2(min(duration, max(secs[-1]['end'], spans[len(secs) - 1][1] + TAIL)))

    for i, s in enumerate(secs):
        if s['kind'] != 'instrumental' or 'timing-draft' not in s.get('flags', []):
            continue
        left = i == 0 or (secs[i - 1]['kind'] == 'vocal' and secs[i - 1]['lines'][-1]['id'] in good)
        right = i == len(secs) - 1 or (secs[i + 1]['kind'] == 'vocal' and secs[i + 1]['lines'][0]['id'] in good)
        if left and right:
            set_flag(s, 'timing-draft', False)
    return notes


def _end_not_past(value: float, limit: float) -> float:
    """A section end on the file's 0.01 s grid that does not pass `limit`."""
    rounded = r2(min(value, limit))
    if rounded <= limit + 1e-9:
        return rounded
    hundredths = int(round(limit * 100))
    cand = hundredths / 100.0
    if cand > limit + 1e-9:
        cand = (hundredths - 1) / 100.0
    return cand


def fit_section_edges(lyrics: dict) -> int:
    """Cover a word that runs past its vocal section, without moving a start or a text.

    The validator warns when a word ends more than 0.05 s after the section. The end
    moves forward to that word, and may touch the next section's start. A word that
    would pass the next section is cut back to the boundary instead. Returns how many
    ends changed.
    """
    secs = lyrics.get('sections') or []
    fixes = 0
    for i, sec in enumerate(secs):
        if sec.get('kind') != 'vocal':
            continue
        limit = float(secs[i + 1]['start']) if i + 1 < len(secs) else float('inf')
        words = [w for line in sec.get('lines') or [] for w in line.get('words') or []]
        if not words:
            continue
        end = float(sec['end'])
        over = [w for w in words if float(w['e']) > end + 0.05 + 1e-9]
        if not over:
            continue
        if limit > end + 1e-9:
            extend_to = end
            for w in over:
                extend_to = max(extend_to, min(float(w['e']), limit))
            if extend_to > end + 0.005:
                new_end = _end_not_past(extend_to, limit)
                if new_end > end + 0.005:
                    sec['end'] = new_end
                    end = float(sec['end'])
                    fixes += 1
        for w in words:
            if float(w['e']) <= end + 0.05 + 1e-9:
                continue
            start = float(w['s'])
            if end <= start:
                continue
            trimmed = r2(end)
            if trimmed <= start or trimmed > end + 0.05 + 1e-9:
                trimmed = end
            if trimmed <= start:
                continue
            if abs(trimmed - float(w['e'])) >= 0.001:
                w['e'] = trimmed
                fixes += 1
    return fixes


def pull_outside_starts(lyrics: dict, slack: float = 0.05) -> int:
    """Pull a word that already starts past its section back inside the slack.

    fit_section_edges trims an end only when the start is still before the
    section end, and it never moves a section. A start that is already past
    that end would stay there and the validator would warn. This pulls such a
    start back to the edge and keeps the end inside the same slack. The first
    word of a line is left: its start is the cue lock. Section bounds and the
    word text stay. A start already inside is not moved.
    """
    fixes = 0
    for sec in lyrics.get('sections') or []:
        if sec.get('kind') != 'vocal':
            continue
        lo = float(sec['start']) - slack
        hi = float(sec['end']) + slack
        for line in sec.get('lines') or []:
            words = line.get('words') or []
            for i, w in enumerate(words):
                s, e = float(w['s']), float(w['e'])
                ns, ne = s, e
                if i > 0 and ns < lo:
                    ns = lo
                if i > 0 and ns > hi:
                    ns = max(lo, hi - 0.02)
                if ne > hi:
                    ne = hi
                if ne < ns + 0.02:
                    ne = min(hi, ns + 0.02)
                    if ne < ns + 0.02:
                        ns = max(lo, ne - 0.02)
                ns, ne = r2(ns), r2(ne)
                if ne > hi + 1e-9:
                    ne = r2(ne - 0.01)
                if ns > hi + 1e-9:
                    ns = r2(max(lo, ne - 0.02))
                if ne <= ns:
                    ne = r2(ns + 0.02)
                    if ne > hi + 1e-9:
                        ne = r2(hi)
                        ns = r2(max(lo, ne - 0.02))
                if abs(ns - s) < 0.001 and abs(ne - e) < 0.001:
                    continue
                w['s'], w['e'] = ns, ne
                fixes += 1
    return fixes
