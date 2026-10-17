"""Anti-lag check: do the word times in lyrics.json match the voice in the recording?

    python3 scripts/pipeline/qa_sync.py <slug> [--lyrics PATH] [--audio PATH] [--tag NAME]
                                        [--baseline PATH.json] [--fix] [--strict] [--selftest]

Works for any song in any language: it never reads the words, only their times, and compares them
with two curves of the vocal stem (work/<slug>/stems/vocals.wav; the full mix if there is no stem):
  - voice activity: RMS in dB above an adaptive threshold;
  - onset strength: spectral flux in the voice band — it peaks where a syllable or a note begins.

Per line:
  (a) offset — the shift within ±2 s that best lines up the line's word starts with vocal onsets
      (cross-correlation of an impulse train with the onset curve), helped by how much of the line's
      sung time falls on voice and whether the voice comes in where the line starts. A shift is
      reported only when it beats "no shift" clearly; otherwise the line is ok or low confidence;
  (b) silence — the share of the line's word time where nobody sings;
  (c) implausible words — longer than 6 s, longer than 2.5 s and mostly silent, shorter than 50 ms.
Whole song:
  (d) voice without text (sung stretches ≥ 1.5 s that no line covers) and lines without voice.
Verdicts: ok · early by X s (text ahead of the voice) · late by X s (text behind) · no voice ·
low confidence. Plus a global offset suggestion.

Writes work/<slug>/qa-sync[-<tag>].md (Russian, ready to copy to docs/analysis/<slug>-qa.md) and .json.
Exit code 1 when a line is off by more than 0.25 s or sits on no voice (--strict: low confidence
too), so the check can gate publishing. --fix shifts such lines by their offset, only where the
evidence is strong, and rewrites lyrics.json (only word s/e change; run the check again after).
--selftest moves every line by known offsets and reports how many the detector recovers: a measure
of how far this check can be trusted on this particular recording.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np

import features as F
import timing as T
from common import ROOT, dump_json, load_audio, load_json, song_dir, vocal_stem, work_dir

MAX_LAG = 2.0          # search ±2 s
TOL = 0.25             # a line is "off" beyond this
NO_VOICE = 0.8         # share of silent word time that makes a line "no voice"
W_ACT, W_EDGE = 1.0, 0.5
ONSET_W = {'mid': 0.5, 'hf': 0.5, 'rise': 1.0}   # vowel-band flux, consonant-band flux, level rise
MIN_GAIN = 0.12        # the best shift must beat "no shift" by this much …
MIN_PROM = 3.0         # … and stand out of the lag curve by this many robust deviations
STRONG_GAIN, STRONG_PROM = 0.4, 5.0   # evidence that needs no neighbour to agree
FIX_GAIN = 0.2         # --fix moves a line only with at least this gain
LONG_WORD, LONG_SILENT, SHORT_WORD = 6.0, 2.5, 0.05


class Signals:
    def __init__(self, x: np.ndarray) -> None:
        self.db = F.rms_db(x)
        self.act, self.thr = F.activity(self.db)
        self.curves = F.onset_curves(x, self.db)
        n = min(len(self.db), *(len(c) for c in self.curves.values()))
        self.db, self.act = self.db[:n], self.act[:n]
        self.curves = {k: c[:n] for k, c in self.curves.items()}
        self.cum = np.concatenate([[0], np.cumsum(self.act)])
        self.n = n
        self.duration = n * F.HOP
        self.set_weights(ONSET_W)

    def set_weights(self, w: dict[str, float]) -> None:
        on = sum(w[k] * self.curves[k] for k in w) / sum(w.values())
        # Tolerate ±30 ms between a word start and its onset peak.
        pad = np.pad(on, 3)
        self.on = np.max(np.stack([pad[k:k + self.n] for k in range(7)]), axis=0)

    def coverage(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Number of active frames in [a, b) per element (frame indexes, clipped)."""
        a, b = np.clip(a, 0, self.n), np.clip(b, 0, self.n)
        return self.cum[b] - self.cum[np.maximum(a, 0)]


def lag_curve(sig: Signals, starts: np.ndarray, ends: np.ndarray) -> tuple[np.ndarray, dict]:
    """Agreement J(lag) for lags −MAX_LAG…+MAX_LAG (frames), and its parts."""
    k = int(MAX_LAG / F.HOP)
    lags = np.arange(-k, k + 1)
    si = np.round(starts / F.HOP).astype(int)
    ei = np.maximum(np.round(ends / F.HOP).astype(int), si + 1)
    idx = si[:, None] + lags[None, :]
    ok = (idx >= 0) & (idx < sig.n)
    vals = np.where(ok, sig.on[np.clip(idx, 0, sig.n - 1)], 0.0)
    wts = np.ones(len(si))
    wts[0] = 2.0
    onset = (wts[:, None] * vals).sum(axis=0) / wts.sum()
    cov = sig.coverage(si[:, None] + lags[None, :], ei[:, None] + lags[None, :]).sum(axis=0)
    act = cov / max(1, int((ei - si).sum()))
    w = int(0.3 / F.HOP)
    after = sig.coverage(si[0] + lags, si[0] + lags + w) / w
    before = sig.coverage(si[0] + lags - w, si[0] + lags) / w
    edge = after - before
    return onset + W_ACT * act + W_EDGE * edge, {'onset': onset, 'act': act, 'edge': edge}


def judge(j: np.ndarray) -> dict:
    """Best lag, its gain over zero shift, its prominence."""
    k = (len(j) - 1) // 2
    best = int(np.argmax(j))
    gain = float(j[best] - j[k])
    med = float(np.median(j))
    mad = float(np.median(np.abs(j - med))) * 1.4826 + 1e-6
    prom = float((j[best] - med) / mad)
    return {'lag': (best - k) * F.HOP, 'gain': gain, 'prom': prom, 'z0': float((j[k] - med) / mad)}


def measure_line(sig: Signals, words: list[dict]) -> dict:
    """Raw evidence for one line: best lag, gain over zero, prominence, silent share now and at the lag."""
    s = np.array([w['s'] for w in words])
    e = np.array([w['e'] for w in words])
    j, parts = lag_curve(sig, s, e)
    r = judge(j)
    k = (len(j) - 1) // 2
    at = k + int(round(r['lag'] / F.HOP))
    return {'offset': round(r['lag'], 2), 'gain': round(r['gain'], 3), 'prom': round(r['prom'], 1), 'z0': round(r['z0'], 1),
            'silence': round(1.0 - float(parts['act'][k]), 2), 'silence_at_offset': round(1.0 - float(parts['act'][at]), 2),
            'curve': j}


def strength(r: dict) -> int:
    """2 — a shift this clear stands on its own; 1 — plausible, needs a neighbour to agree; 0 — noise."""
    if r['prom'] >= STRONG_PROM and r['gain'] >= STRONG_GAIN:
        return 2
    if r['prom'] >= MIN_PROM and r['gain'] >= MIN_GAIN:
        return 1
    return 0


def decide(rs: list[dict], groups: list[str]) -> None:
    """Verdict per line (in song order; `groups` — the section of each line).

    Sung phrases repeat with the metre, so a single line can match its own rhythm a bar later almost
    as well as where it is. A shift is therefore claimed when the evidence is strong, or when it is
    moderate and a neighbouring line of the same section is shifted the same way (± 0.2 s): drafts
    and broken alignments drift in blocks, while metre echoes do not line up across lines."""
    for i, r in enumerate(rs):
        lag, lv = r['offset'], strength(r)
        support = any(0 <= j < len(rs) and groups[j] == groups[i] and strength(rs[j]) >= 1
                      and abs(rs[j]['offset'] - lag) <= 0.2 for j in (i - 1, i + 1))
        if r['silence'] >= NO_VOICE and not (lv >= 1 and r['silence_at_offset'] < NO_VOICE):
            v = 'no-voice'
        elif r['prom'] < MIN_PROM:
            v = 'low'                 # nothing confirms the line, nothing locates it elsewhere
        elif abs(lag) <= TOL:
            v = 'ok'
        elif lv == 2 or (lv == 1 and support):
            v = 'early' if lag > 0 else 'late'
        else:
            v = 'low'
        r['verdict'] = v
        r['support'] = bool(support)
        r['strong'] = bool(v in ('early', 'late') and r['gain'] >= FIX_GAIN
                           and r['silence_at_offset'] <= r['silence'] + 0.05)


def check_lines(sig: Signals, lines: list[list[dict]], groups: list[str]) -> list[dict]:
    rs = [measure_line(sig, ws) for ws in lines]
    decide(rs, groups)
    return rs


def word_issues(sig: Signals, line_id: str, words: list[dict]) -> list[dict]:
    out = []
    for w in words:
        d = w['e'] - w['s']
        a, b = int(w['s'] / F.HOP), max(int(w['s'] / F.HOP) + 1, int(w['e'] / F.HOP))
        voiced = float(sig.coverage(np.array([a]), np.array([b]))[0]) / (b - a)
        if d > LONG_WORD:
            out.append({'line': line_id, 'w': w['w'], 's': w['s'], 'dur': round(d, 2), 'voiced': round(voiced, 2), 'why': f'длиннее {LONG_WORD:.0f} с'})
        elif d > LONG_SILENT and voiced < 0.3:
            out.append({'line': line_id, 'w': w['w'], 's': w['s'], 'dur': round(d, 2), 'voiced': round(voiced, 2), 'why': 'длинное и почти без голоса'})
        elif d < SHORT_WORD:
            out.append({'line': line_id, 'w': w['w'], 's': w['s'], 'dur': round(d, 3), 'voiced': round(voiced, 2), 'why': 'короче 50 мс'})
    return out


def voice_without_text(sig: Signals, lyrics: dict) -> list[dict]:
    covered = np.zeros(sig.n, dtype=bool)
    for _, line in T.vocal_lines(lyrics):
        a = max(0, int((line['words'][0]['s'] - 0.3) / F.HOP))
        b = min(sig.n, int((line['words'][-1]['e'] + 0.5) / F.HOP))
        covered[a:b] = True
    voice = F.fill_runs(sig.act, False, int(0.5 / F.HOP))
    out = []
    for a, b in F.runs(voice & ~covered):
        if (b - a) * F.HOP < 1.5:
            continue
        t0, t1 = a * F.HOP, b * F.HOP
        sec = next((s for s in lyrics['sections'] if s['start'] <= (t0 + t1) / 2 < s['end']), None)
        out.append({'start': round(t0, 2), 'end': round(t1, 2), 'section': sec['id'] if sec else None,
                    'kind': sec['kind'] if sec else None,
                    'level_db': round(float(np.median(sig.db[a:b])), 1)})
    return out


def rel(p: Path) -> str:
    p = p.resolve()
    return str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)


def fmt_t(t: float) -> str:
    m, s = divmod(t, 60)
    return f'{int(m)}:{s:05.2f}'


def ru(x: float, nd: int = 2) -> str:
    return f'{x:.{nd}f}'.replace('.', ',')


VERDICT_RU = {'ok': 'в такт', 'early': 'рано', 'late': 'поздно', 'no-voice': 'нет голоса', 'low': 'не определить'}


def verdict_text(r: dict) -> str:
    v = r['verdict']
    if v == 'early':
        return f"рано на {ru(r['offset'])} с"
    if v == 'late':
        return f"поздно на {ru(-r['offset'])} с"
    if v == 'low':
        return f"не определить (лучший сдвиг {r['offset']:+.2f} с)".replace('.', ',')
    return VERDICT_RU[v]


def summarise(results: list[dict]) -> dict:
    n = len(results)
    counts = {v: sum(r['verdict'] == v for r in results) for v in VERDICT_RU}
    off = np.array([abs(r['offset']) for r in results if r['verdict'] in ('ok', 'early', 'late')])
    sil = np.array([r['silence'] for r in results])
    return {
        'lines': n, **counts,
        'off_lines': counts['early'] + counts['late'],
        'median_abs_offset': round(float(np.median(off)), 2) if len(off) else None,
        'p90_abs_offset': round(float(np.percentile(off, 90)), 2) if len(off) else None,
        'max_abs_offset': round(float(off.max()), 2) if len(off) else None,
        'mean_silence': round(float(sil.mean()), 2) if n else None,
    }


def selftest(sig: Signals, lines: list[list[dict]], groups: list[str]) -> dict:
    """Move text by known amounts and count how often the check names the shift (± 0.1 s).

    Lines the check accepts as they are serve as ground truth. Two cases: `block` — all lines of a
    section moved together (how drafts drift), `single` — one line moved, its neighbours in place."""
    shifts = [-1.5, -0.8, -0.4, 0.4, 0.8, 1.5]
    base = [measure_line(sig, ws) for ws in lines]
    judged = [dict(r) for r in base]
    decide(judged, groups)
    truth = [i for i, r in enumerate(judged) if r['verdict'] == 'ok']

    def moved(ws: list[dict], d: float) -> list[dict]:
        return [{'w': w['w'], 's': w['s'] - d, 'e': w['e'] - d} for w in ws]

    out: dict = {'shifts': shifts, 'lines_used': len(truth),
                 'alarms_unshifted': sum(r['verdict'] in ('early', 'late') for r in judged)}
    for mode in ('block', 'single'):
        hit = miss = wrong = 0
        for d in shifts:
            cases: list[tuple[list[int], list[dict]]] = []
            if mode == 'block':
                for g in dict.fromkeys(groups):
                    idx = [i for i, x in enumerate(groups) if x == g]
                    rs = [dict(r) for r in base]
                    for i in idx:
                        rs[i] = measure_line(sig, moved(lines[i], d))
                    cases.append((idx, rs))
            else:
                for i in truth:
                    rs = [dict(r) for r in base]
                    rs[i] = measure_line(sig, moved(lines[i], d))
                    cases.append(([i], rs))
            for idx, rs in cases:
                decide(rs, groups)
                for i in idx:
                    if i not in truth:
                        continue
                    want = judged[i]['offset'] + d  # text earlier by d: the voice now comes d later
                    r = rs[i]
                    if r['verdict'] in ('early', 'late') and abs(r['offset'] - want) <= 0.1:
                        hit += 1
                    elif r['verdict'] in ('early', 'late', 'ok'):
                        wrong += 1
                    else:
                        miss += 1
        total = hit + miss + wrong
        out[mode] = {'cases': total, 'detected': hit, 'undetected': miss, 'wrong': wrong,
                     'detected_share': round(hit / total, 2) if total else None}
    return out


def render_md(meta: dict, summary: dict, results: list[dict], words: list[dict], gaps: list[dict],
              novoice: list[dict], glob: dict, baseline: dict | None, fixed: list[str], st: dict | None) -> str:
    L = []
    title = meta.get('title') or meta['slug']
    L.append(f"# Синхронизация текста: {title}")
    L.append('')
    L.append(f"Проверка `qa_sync.py` от {meta['date']}. Аудио: `{meta['audio']}`{'' if meta['stem'] else ' (полный микс — вокального стема нет, точность ниже)'}. "
             f"Текст: `{meta['lyrics']}`. Порог: {ru(TOL)} с.")
    L.append('')
    L.append('## Итог')
    L.append('')
    passed = summary['off_lines'] == 0 and summary['no-voice'] == 0
    L.append(f"**{'Проходит' if passed else 'Не проходит'}.** Строк: {summary['lines']}; в такт: {summary['ok']}; "
             f"рано: {summary['early']}; поздно: {summary['late']}; нет голоса: {summary['no-voice']}; "
             f"не определить: {summary['low']}.")
    L.append('')
    if summary['median_abs_offset'] is not None:
        L.append(f"- Смещение по строкам, где оно измерено: медиана {ru(summary['median_abs_offset'])} с, "
                 f"90-й перцентиль {ru(summary['p90_abs_offset'])} с, максимум {ru(summary['max_abs_offset'])} с.")
    L.append(f"- Доля времени слов без голоса (в среднем по строкам): {round(100 * summary['mean_silence'])} %.")
    g = glob
    L.append(f"- Общий сдвиг всей песни: {ru(g['offset'])} с ({'уверенно' if g['confident'] else 'неуверенно'}; "
             f"медиана по строкам с измеренным сдвигом {ru(g['median_line'])} с). "
             + ('Если он больше 0,1 с, сдвиньте все слова на это значение.' if abs(g['offset']) > 0.1 and g['confident'] else 'Общего сдвига нет.'))
    if fixed:
        L.append(f"- `--fix` сдвинул строки: {', '.join(fixed)}. Запустите проверку ещё раз.")
    L.append('')
    if baseline:
        b = baseline['summary']
        L.append('## До и после')
        L.append('')
        L.append(f"Сравнение с `{baseline['meta']['lyrics']}` ({baseline['meta']['date']}).")
        L.append('')
        L.append('| | до | после |')
        L.append('|---|---|---|')
        rows = [('в такт', 'ok'), ('рано', 'early'), ('поздно', 'late'), ('нет голоса', 'no-voice'), ('не определить', 'low')]
        for name, key in rows:
            L.append(f"| {name} | {b[key]} | {summary[key]} |")
        for name, key in [('медиана смещения, с', 'median_abs_offset'), ('90-й перцентиль, с', 'p90_abs_offset'), ('максимум, с', 'max_abs_offset')]:
            bv, av = b.get(key), summary.get(key)
            L.append(f"| {name} | {'—' if bv is None else ru(bv)} | {'—' if av is None else ru(av)} |")
        L.append(f"| слова без голоса, % | {round(100 * b['mean_silence'])} | {round(100 * summary['mean_silence'])} |")
        L.append('')
    if st:
        L.append('## Чувствительность проверки на этой записи')
        L.append('')
        L.append(f"Строки с вердиктом «в такт» ({st['lines_used']}) нарочно сдвинули на {', '.join(ru(x, 1) for x in st['shifts'])} с "
                 f"и проверили, назовёт ли проверка этот сдвиг (± 0,1 с).")
        L.append('')
        L.append('| случай | найден | не определён | назван неверно |')
        L.append('|---|---|---|---|')
        for mode, name in (('block', 'сдвинута вся секция'), ('single', 'сдвинута одна строка')):
            m = st[mode]
            share = round(100 * (m['detected_share'] or 0))
            L.append(f"| {name} | {m['detected']} из {m['cases']} ({share} %) | {m['undetected']} | {m['wrong']} |")
        L.append('')
    L.append('## Строки')
    L.append('')
    L.append('| строка | начало | текст | сдвиг, с | без голоса | вердикт |')
    L.append('|---|---|---|---|---|---|')
    for r in results:
        text = r['text'] if len(r['text']) <= 42 else r['text'][:40] + '…'
        mark = '' if r['verdict'] == 'ok' else ' ⚠'
        L.append(f"| `{r['id']}` | {fmt_t(r['start'])} | {text} | {r['offset']:+.2f} | {round(100 * r['silence'])} % | {verdict_text(r)}{mark} |")
    L.append('')
    L.append('## Текст без голоса')
    L.append('')
    if novoice:
        for r in novoice:
            L.append(f"- `{r['id']}` {fmt_t(r['start'])}–{fmt_t(r['end'])}: {round(100 * r['silence'])} % времени слов приходится на тишину.")
    else:
        L.append('Нет: каждая строка стоит там, где звучит голос.')
    L.append('')
    L.append('## Голос без текста')
    L.append('')
    if gaps:
        L.append('Отрезки ≥ 1,5 с, где в вокальной дорожке есть голос, а строки нет. В инструментальной секции это обычно вокализ, '
                 'хор без слов или просочившийся инструмент; в вокальной — возможно, пропущенная строка.')
        L.append('')
        for g2 in gaps:
            L.append(f"- {fmt_t(g2['start'])}–{fmt_t(g2['end'])} ({ru(g2['end'] - g2['start'], 1)} с), секция `{g2['section']}` ({g2['kind']}), уровень {ru(g2['level_db'], 0)} дБ")
    else:
        L.append('Нет.')
    L.append('')
    L.append('## Слова неправдоподобной длины')
    L.append('')
    if words:
        for w in words:
            L.append(f"- `{w['line']}` «{w['w']}» с {fmt_t(w['s'])}: {ru(w['dur'])} с, голос {round(100 * w['voiced'])} % — {w['why']}")
    else:
        L.append('Нет.')
    L.append('')
    L.append('## Как читать')
    L.append('')
    L.append('- **рано на X с** — строка подсвечивается раньше, чем её поют (текст спешит); **поздно** — позже (текст отстаёт).')
    L.append(f'- Сдвиг ищется в пределах ±{ru(MAX_LAG, 0)} с по совпадению начал слов с атаками голоса вокальной дорожки '
             '(подъём громкости после согласной или вдоха, спектральный поток) и по тому, попадает ли время слов на голос. '
             'Сдвиг засчитывается, если он явно лучше нулевого, или если он умеренный, но соседняя строка той же секции '
             'сдвинута так же: мелодия повторяется по тактам, и одна строка иногда «похожа на себя» на такт позже.')
    L.append('- **не определить** — у строки нет чёткого лучшего сдвига (ровное пение, мелизмы, хор). Это не ошибка, но место стоит послушать.')
    L.append('- **нет голоса** — больше 80 % времени слов строки приходится на тишину в вокальной дорожке.')
    L.append('')
    return '\n'.join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('slug')
    ap.add_argument('--lyrics', default=None, help='lyrics.json to check (default content/songs/<slug>/lyrics.json)')
    ap.add_argument('--audio', default=None)
    ap.add_argument('--tag', default='', help='suffix for the output files: qa-sync-<tag>.{md,json}')
    ap.add_argument('--baseline', default=None, help='an earlier qa-sync json to compare with')
    ap.add_argument('--fix', action='store_true', help='shift lines where the evidence is strong and save lyrics.json')
    ap.add_argument('--strict', action='store_true', help='low confidence also fails')
    ap.add_argument('--selftest', action='store_true', help='measure the detector on artificially shifted lines')
    ap.add_argument('--max-lag', type=float, default=MAX_LAG, help='search range, ± seconds (default 2)')
    args = ap.parse_args()
    slug = args.slug
    globals()['MAX_LAG'] = args.max_lag

    lyr_path = Path(args.lyrics) if args.lyrics else song_dir(slug) / 'lyrics.json'
    lyrics = load_json(lyr_path)
    song_path = song_dir(slug) / 'song.json'
    song = load_json(song_path) if song_path.exists() else {}
    audio, is_stem = vocal_stem(slug, args.audio)
    if not is_stem:
        print(f'ВНИМАНИЕ: нет вокального стема, проверяю по полному миксу {audio.name}: атаки инструментов мешают')
    sig = Signals(load_audio(audio, F.SR))
    lines = T.vocal_lines(lyrics)

    groups = [sec['id'] for sec, _ in lines]
    word_lists = [line['words'] for _, line in lines]
    results = check_lines(sig, word_lists, groups)
    total = sum(r.pop('curve') for r in results) if results else None
    words = []
    for r, (sec, line) in zip(results, lines):
        r.update({'id': line['id'], 'section': sec['id'], 'text': T.line_text(line),
                  'start': line['words'][0]['s'], 'end': line['words'][-1]['e']})
        words += word_issues(sig, line['id'], line['words'])

    gj = judge(total) if total is not None else {'lag': 0.0, 'gain': 0.0, 'prom': 0.0}
    conf_lines = [r['offset'] for r in results if r['verdict'] in ('ok', 'early', 'late')]
    glob = {'offset': round(gj['lag'], 2), 'gain': round(gj['gain'], 3), 'prom': round(gj['prom'], 1),
            'confident': bool(gj['prom'] >= MIN_PROM and gj['gain'] >= MIN_GAIN / 2),
            'median_line': round(float(np.median(conf_lines)), 2) if conf_lines else 0.0}
    gaps = voice_without_text(sig, lyrics)
    novoice = [r for r in results if r['verdict'] == 'no-voice']
    st = selftest(sig, word_lists, groups) if args.selftest else None

    fixed = []
    if args.fix:
        flat = [line for _, line in lines]
        for i, (r, line) in enumerate(zip(results, flat)):
            if not r['strong']:
                continue
            d = r['offset']
            lo = flat[i - 1]['words'][-1]['e'] if i else 0.0
            hi = flat[i + 1]['words'][0]['s'] if i + 1 < len(flat) else sig.duration
            ws = line['words']
            d = min(max(d, lo - ws[0]['s']), hi - ws[-1]['e'])
            if abs(d) < abs(r['offset']) * 0.5 or abs(d) < 0.05:
                continue  # neighbours leave no room: needs a human (or a new alignment)
            for w in ws:
                w['s'], w['e'] = T.r2(w['s'] + d), T.r2(w['e'] + d)
            fixed.append(f"{line['id']} ({d:+.2f} с)")
        if fixed:
            T.enforce_order(lyrics)
            lyr_path.write_text(dump_json(lyrics), encoding='utf-8')

    summary = summarise(results)
    meta = {'slug': slug, 'title': song.get('title'), 'date': dt.date.today().isoformat(), 'audio': audio.name,
            'stem': is_stem, 'lyrics': rel(lyr_path),
            'voice_threshold_db': round(sig.thr, 1)}
    baseline = json.loads(Path(args.baseline).read_text(encoding='utf-8')) if args.baseline else None
    md = render_md(meta, summary, results, words, gaps, novoice, glob, baseline, fixed, st)
    out = {'meta': meta, 'summary': summary, 'global': glob, 'lines': results, 'words': words,
           'voice_without_text': gaps, 'selftest': st, 'fixed': fixed,
           'params': {'max_lag': MAX_LAG, 'tol': TOL, 'no_voice': NO_VOICE, 'min_gain': MIN_GAIN, 'min_prom': MIN_PROM,
                      'strong_gain': STRONG_GAIN, 'strong_prom': STRONG_PROM, 'onset_weights': ONSET_W,
                      'w_act': W_ACT, 'w_edge': W_EDGE}}
    stem = 'qa-sync' + (f'-{args.tag}' if args.tag else '')
    wd = work_dir(slug)
    (wd / f'{stem}.md').write_text(md, encoding='utf-8')
    (wd / f'{stem}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')

    s = summary
    print(f"{slug}: строк {s['lines']} · в такт {s['ok']} · рано {s['early']} · поздно {s['late']} · "
          f"нет голоса {s['no-voice']} · не определить {s['low']} · медиана |сдвига| {s['median_abs_offset']} с · "
          f"общий сдвиг {glob['offset']:+.2f} с")
    for r in results:
        if r['verdict'] != 'ok':
            print(f"  {r['id']:<22} {r['start']:7.2f}  {verdict_text(r)}  (gain {r['gain']}, prom {r['prom']}, тишина {r['silence']})")
    if st:
        for mode in ('block', 'single'):
            m = st[mode]
            print(f"selftest {mode} ({st['lines_used']} строк): найдено {m['detected']}/{m['cases']}, неверно {m['wrong']}, "
                  f"не определено {m['undetected']}")
    print(f'→ {wd / (stem + ".md")}')
    bad = s['off_lines'] + s['no-voice'] + (s['low'] if args.strict else 0)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
