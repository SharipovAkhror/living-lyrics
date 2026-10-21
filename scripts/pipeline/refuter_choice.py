"""Ask whether a refuting witness is the one out of step, per song and language.

A refuted line is a candidate only when the placer clocks agree with each
other and with the T29 Gemini hearing, and the refuting witness sits away
from both. One line is not a language. Two lines of the same witness kind
are the smallest set that can propose dropping that kind as a refuter there.
The prove job then prices the drop on the usual shifted labels. This module
does not change a threshold and does not drop anything by itself.

Gemini times are the hearing already stored for T29. A line with no hearing
cannot support a drop. The hearing is a line start, so it is compared at the
cue tolerance 0.30 s. Placer clocks agree at 0.10 s, the same gap the witnesses
use among themselves.
"""
from __future__ import annotations

import json

import qa_sync as Q

AGREE_S = 0.10
GEMINI_S = 0.30
FAR_S = 0.20
MIN_LINES = 2


def _closest(items: list[dict], anchor: float | None) -> float | None:
    """Gemini entry whose start is within 1.5 s of this line's own start."""
    best = None
    best_gap = None
    for item in items:
        if not isinstance(item, dict) or item.get('start') is None:
            continue
        start = float(item['start'])
        if anchor is None:
            return start
        gap = abs(start - float(anchor))
        if gap > 1.5:
            continue
        if best_gap is None or gap < best_gap:
            best = start
            best_gap = gap
    return best


def gemini_starts(slug: str) -> dict[str, float]:
    """Line id to the T29 Gemini start, in seconds. Missing hearings are absent.

    A targeted place (`recheck-gemini-places.json`, matches_id) wins over the
    pass that filled every line. The pass stores neighbouring lines in the
    same list, so only the entry near that line's own start is kept.
    """
    from common import ROOT

    out: dict[str, float] = {}
    path = ROOT / 'docs' / 'analysis' / slug / 'recheck.json'
    if path.is_file():
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            payload = {}
        for line in payload.get('lines') or []:
            if not isinstance(line, dict) or not line.get('id'):
                continue
            start = _closest(list(line.get('gemini') or []), line.get('start'))
            if start is not None:
                out[str(line['id'])] = float(start)
    places = ROOT / 'docs' / 'analysis' / slug / 'recheck-gemini-places.json'
    if places.is_file():
        try:
            payload = json.loads(places.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            payload = {}
        for place in payload.get('places') or []:
            if not isinstance(place, dict):
                continue
            for segment in place.get('segments') or []:
                if not isinstance(segment, dict):
                    continue
                line_id = segment.get('matches_id')
                if not line_id or line_id == 'NONE' or segment.get('start_s') is None:
                    continue
                out[str(line_id)] = float(segment['start_s'])
    return out


def _cluster(times: list[float]) -> float | None:
    """Median when at least two clocks sit within 0.10 s of each other."""
    if len(times) < 2:
        return None
    ordered = sorted(float(t) for t in times)
    # Every pair within the agree gap, not only the neighbours: one outlier
    # must not hide inside a wide median.
    if ordered[-1] - ordered[0] > AGREE_S + 1e-9:
        return None
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _placer_times(word: dict) -> list[float]:
    times = []
    for key in ('clock_mms', 'clock_phoneme', 'clock_stem'):
        if word.get(key) is not None:
            times.append(float(word[key]))
    own = word.get('t')
    if own is not None and not any(abs(float(own) - t) <= 1e-3 for t in times):
        times.append(float(own))
    return times


def _witnesses(word: dict, why: str) -> list[tuple[str, float]]:
    second = None if word.get('second') is None else float(word['second'])
    third = None if word.get('third') is None else float(word['third'])
    second_kind = str(word.get('second_kind') or 'whisperx')
    third_kind = str(word.get('third_kind') or 'stable-ts')
    if why == 'witnesses-agree-elsewhere':
        found = []
        if second is not None:
            found.append((second_kind, second))
        if third is not None:
            found.append((third_kind, third))
        return found
    if why == 'witness-attack':
        if second is not None and third is None:
            return [(second_kind, second)]
        if third is not None and second is None:
            return [(third_kind, third)]
        # The single-clock rule refutes from whichever clock was passed.
        # Both present means this was not the single-clock case.
    return []


def cases(per_song: list[dict], refute: dict | None, gemini_by_song: dict[str, dict] | None = None,
          peak_key: tuple = (0.7, False)) -> list[dict]:
    """One row per refuted line. Agreement is recorded; nothing is dropped here."""
    gemini_by_song = gemini_by_song or {}
    rows = []
    for song in per_song:
        peaks = (song.get('sets') or {}).get(peak_key)
        gemini = gemini_by_song.get(song.get('slug') or '') or {}
        for line in song.get('lines') or []:
            if not line.get('placed'):
                continue
            hit = None
            why = None
            for word in line.get('words') or []:
                probe = {
                    'ctc_s': word.get('t'),
                    'second_s': word.get('second'),
                    'third_s': word.get('third'),
                    'second_kind': word.get('second_kind') or 'whisperx',
                    'third_kind': word.get('third_kind') or 'stable-ts',
                    'song': song.get('slug'),
                    'lang': line.get('lang'),
                }
                why = Q.word_refuted(probe, peaks, refute)
                if why:
                    hit = word
                    break
            if hit is None or why is None:
                continue
            placers = _placer_times(hit)
            centre = _cluster(placers)
            heard = gemini.get(line.get('id'))
            witnesses = _witnesses(hit, why)
            against = []
            if centre is not None and heard is not None and abs(centre - float(heard)) <= GEMINI_S + 1e-9:
                for kind, clock in witnesses:
                    far_from_placers = abs(clock - centre) > FAR_S + 1e-9
                    far_from_hearing = abs(clock - float(heard)) > abs(centre - float(heard)) + 1e-9
                    if far_from_placers and far_from_hearing:
                        against.append(kind)
            rows.append({
                'song': song.get('slug'),
                'id': line.get('id'),
                'lang': line.get('lang'),
                'why': why,
                'placed_by': line.get('placed_by'),
                'placers': len(placers),
                'centre': None if centre is None else round(centre, 3),
                'gemini': None if heard is None else round(float(heard), 3),
                'against': against,
                'agree': bool(against),
            })
    return rows


def candidates(rows: list[dict]) -> list[dict]:
    """Witness kinds that lose to the placers and to Gemini on at least two lines."""
    counts: dict[tuple, int] = {}
    for row in rows:
        if not row.get('agree'):
            continue
        for kind in row.get('against') or []:
            key = (str(row.get('song') or ''), str(row.get('lang') or ''), str(kind))
            counts[key] = counts.get(key, 0) + 1
    found = []
    for (song, lang, kind), n in counts.items():
        if n < MIN_LINES:
            continue
        found.append({'song': song, 'lang': lang, 'kind': kind, 'key': f'{song}|{lang}', 'lines': n})
    found.sort(key=lambda row: (-int(row['lines']), row['key'], row['kind']))
    return found


def off_map(cands: list[dict]) -> dict[str, list[str]]:
    """`song|lang` to the witness kinds that do not refute there."""
    out: dict[str, list[str]] = {}
    for cand in cands:
        key = str(cand.get('key') or '')
        kind = str(cand.get('kind') or '')
        if not key or not kind:
            continue
        kinds = out.setdefault(key, [])
        if kind not in kinds:
            kinds.append(kind)
    return out


def render_md(report: dict) -> str:
    kept = report.get('off') or {}
    lines = [
        '# Свидетель против постановщиков и Gemini',
        '',
        'Строка попадает в кандидаты, когда часы постановщиков лежат не дальше 0,10 с друг от друга, '
        'слышание T29 не дальше 0,30 с от них, а опровергающий свидетель дальше и от них, и от слышания. '
        'Один такой случай язык не меняет. Два и больше одного вида свидетеля предлагают не опровергать им '
        'этот язык. Предложение остаётся, только если проход строки на смещённых метках не выше 5 % '
        'и доказанных строк становится больше. Пороги 0,20 с и 0,30 с не сдвигаются.',
        '',
        f"Оставлено: {'да' if report.get('kept') else 'нет'}. {report.get('reason') or ''}",
        '',
        '| песня | строка | язык | почему | постановщиков | их середина | Gemini | против |',
        '|---|---|---|---|---:|---:|---:|---|',
    ]
    for row in report.get('lines') or []:
        against = ', '.join(row.get('against') or []) or '—'
        lines.append(
            f"| {row.get('song')} | {row.get('id')} | {row.get('lang')} | {row.get('why')} | "
            f"{row.get('placers')} | {row.get('centre') if row.get('centre') is not None else '—'} | "
            f"{row.get('gemini') if row.get('gemini') is not None else '—'} | {against} |"
        )
    lines.append('')
    if kept:
        lines.append('| пара | свидетель не опровергает |')
        lines.append('|---|---|')
        for key, kinds in sorted(kept.items()):
            lines.append(f"| {key} | {', '.join(kinds)} |")
        lines.append('')
    return '\n'.join(lines)
