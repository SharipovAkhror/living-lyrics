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
TOL = 0.25             # whole-line shift alarm only. Not the word proof, and not the song gate.
WORD_TOL = 0.10        # proof: pre-snap aligner start vs the attack, and the two aligners vs each other
SONG_SHARE = 0.80      # song is aligned only when at least this share of solo lines is proven
ONSET_SEARCH = 0.35    # look for an attack this far from the written start
LEGATO_GAP = 0.20      # a word continuing the previous one, with no new attack, may have no onset
PEAK_HEIGHT = 0.5      # onset curve units; 1 is the recording's 95th percentile
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


def onset_combo(sig: Signals) -> np.ndarray:
    return sum(ONSET_W[k] * sig.curves[k] for k in ONSET_W) / sum(ONSET_W.values())


def onset_peak_times(sig: Signals, min_height: float = PEAK_HEIGHT, nms_s: float = 0.04) -> np.ndarray:
    """Seconds of clear vocal attacks: local maxima of the onset curve, one per attack."""
    c = onset_combo(sig)
    n = len(c)
    if n < 3:
        return np.zeros(0)
    idx = np.flatnonzero((c[1:-1] >= c[:-2]) & (c[1:-1] >= c[2:]) & (c[1:-1] >= min_height)) + 1
    if len(idx) == 0:
        return np.zeros(0)
    order = idx[np.argsort(-c[idx])]
    keep: list[int] = []
    radius = max(1, int(round(nms_s / F.HOP)))
    taken = np.zeros(n, dtype=bool)
    for i in order:
        if taken[i]:
            continue
        keep.append(int(i))
        taken[max(0, i - radius):min(n, i + radius + 1)] = True
    keep.sort()
    return np.asarray(keep, dtype=float) * F.HOP


def nearest_attack(t: float, peaks: np.ndarray, owned: float | None) -> float | None:
    """Signed seconds from a pre-snap word start to the nearest attack not claimed by the previous word.

    `owned` is the previous word's pre-snap start plus WORD_TOL. A peak at or before that belongs
    to the previous word and is not evidence about this one. No distance cap: the number in the
    report is the real gap, and the proof fails when it is over WORD_TOL.
    """
    usable = peaks
    if owned is not None and len(peaks):
        usable = peaks[peaks > owned]
    if len(usable) == 0:
        return None
    return float(usable[int(np.argmin(np.abs(usable - t)))] - t)


def song_proven(passed: int, solo: int) -> bool:
    """True when solo lines exist and at least SONG_SHARE of them are proven.

    Integer comparison, so 30/38 (78.9 %) fails and 31/38 (81.6 %) passes. A line whose text was
    not found is solo and not passed, so it stays in the denominator.
    """
    if solo <= 0:
        return False
    return passed * 1000 >= solo * int(round(SONG_SHARE * 1000))


REASON_RU = {
    'pass': 'доказано',
    'not-solo': 'не соло',
    'text-not-found': 'текст не найден в голосе',
    'low-confidence': 'выравниватель не уверен',
    'no-second-aligner': 'нет второго выравнивателя',
    'aligners-disagree': 'выравниватели расходятся',
    'no-voice': 'нет голоса',
    'line-shift': 'строка сдвинута относительно голоса',
    'onset': 'начало слова дальше 0,1 с от атаки',
    'text-changed': 'текст изменился после выравнивания',
    'no-report': 'нет отчёта выравнивания',
}


def measure_word_voices(sig: Signals, words: list[dict], peaks: np.ndarray, prev_end: float | None) -> list[dict]:
    """Per word: distance to the nearest vocal attack, and whether that is within WORD_TOL.

    A word that continues the previous one across a gap of at most LEGATO_GAP, with the voice
    already sounding and no attack nearby, is legato: there is no new attack to miss.
    The first word of a phrase has to land on an attack.
    """
    act = sig.act
    out = []
    for i, w in enumerate(words):
        t = float(w['s'])
        # An attack already claimed by the previous word is not evidence about this one.
        # Inside the line that is any peak at or before the previous start plus WORD_TOL.
        # Across a line boundary, peaks at or before the previous line's last word end.
        if i:
            owned = float(words[i - 1]['s']) + WORD_TOL
        else:
            owned = prev_end
        usable = peaks[peaks > owned] if owned is not None and len(peaks) else peaks
        dt = None
        if len(usable):
            delta = float(usable[int(np.argmin(np.abs(usable - t)))] - t)
            if abs(delta) <= ONSET_SEARCH:
                dt = delta
        k = int(round(t / F.HOP))
        rad = max(1, int(round(WORD_TOL / F.HOP)))
        lo, hi = max(0, k - rad), min(len(act), k + rad + 1)
        voice_near = bool(act[lo:hi].any()) if hi > lo else False
        prev = float(words[i - 1]['e']) if i else prev_end
        continuation = prev is not None and 0 <= (t - prev) <= LEGATO_GAP
        if dt is not None and abs(dt) <= WORD_TOL:
            kind, ok = 'onset', True
        elif dt is None and voice_near and continuation:
            kind, ok = 'legato', True
        elif dt is not None:
            kind, ok = 'onset-far', False
        else:
            kind, ok = 'no-onset', False
        out.append({'dt': None if dt is None else round(dt, 3), 'abs': None if dt is None else round(abs(dt), 3), 'kind': kind, 'ok': ok})
    return out


def _lettered(align_words: list[dict] | None, n: int) -> list[dict]:
    if not align_words or len(align_words) != n:
        return []
    return align_words


def proof_line(solo: bool, ctc_status: str | None, text_same: bool, presnap: list[float | None], align_words: list[dict] | None, has_report: bool) -> dict:
    """Whether one line may lose timing-draft. The first failing reason wins.

    The two measurements that count are independent of the published time: the first aligner's
    word start before any snap to an attack, and the second aligner's start. A word that merely
    continues the previous one (legato) does not pass. The whole-line shift alarm is not a gate.
    """
    if not has_report:
        return {'pass': False, 'reason': 'no-report', 'detail': ''}
    if not text_same:
        return {'pass': False, 'reason': 'text-changed', 'detail': ''}
    if not solo:
        return {'pass': False, 'reason': 'not-solo', 'detail': 'смешанный или неназванный голос'}
    if ctc_status == 'draft':
        return {'pass': False, 'reason': 'text-not-found', 'detail': 'MMS не нашёл эти слова в окне'}
    if ctc_status != 'good':
        return {'pass': False, 'reason': 'low-confidence', 'detail': ctc_status or 'нет оценки'}
    if not align_words:
        return {'pass': False, 'reason': 'no-second-aligner', 'detail': ''}
    if len(presnap) != len(align_words):
        return {'pass': False, 'reason': 'no-report', 'detail': 'нет допритяжного времени'}
    diffs = []
    ons: list[float | None] = []
    for a, dt in zip(align_words, presnap):
        if not a.get('roman'):
            continue
        if a.get('ctc_s') is None or a.get('second_s') is None:
            ons.append(None if dt is None else abs(float(dt)))
            diffs.append(None)
            continue
        diffs.append(abs(float(a['second_s']) - float(a['ctc_s'])))
        ons.append(None if dt is None else abs(float(dt)))
    if not diffs:
        return {'pass': False, 'reason': 'no-second-aligner', 'detail': 'в строке не осталось букв для сверки'}
    if all(d is None for d in diffs):
        return {'pass': False, 'reason': 'no-second-aligner', 'detail': 'модель не поставила ни одного слова'}
    numbers = [d for d in diffs if d is not None]
    if len(numbers) != len(diffs):
        return {'pass': False, 'reason': 'aligners-disagree', 'detail': 'у слова нет второго времени'}
    worst = max(numbers)
    if worst > WORD_TOL:
        return {'pass': False, 'reason': 'aligners-disagree', 'detail': f'максимум {worst:.3f} с'}
    far = [d for d in ons if d is None or d > WORD_TOL]
    if far:
        known = [d for d in far if d is not None]
        if not known:
            return {'pass': False, 'reason': 'onset', 'detail': 'атаки рядом с началом выравнивателя нет'}
        return {'pass': False, 'reason': 'onset', 'detail': f'до притяжения дальше всего {max(known):.3f} с'}
    return {'pass': True, 'reason': 'pass', 'detail': ''}


def build_proof(sig: Signals, lines: list[tuple[dict, dict]], qa_rows: list[dict], align_report: dict | None) -> dict:
    """Per-line pass/fail. Headline numbers are pre-snap only; published times may already be snapped."""
    by_id = {r['id']: r for r in align_report.get('lines', [])} if align_report else {}
    peaks = onset_peak_times(sig)
    rows = []
    prev_ctc: float | None = None
    for (sec, line), _qa in zip(lines, qa_rows):
        rec = by_id.get(line['id'])
        words = line['words']
        solo = T.is_solo(sec, line)
        text_same = bool(rec) and rec.get('text') == T.line_text(line)
        align_words = _lettered(rec.get('words') if rec else None, len(words))
        presnap: list[float | None] = []
        abs_pre: list[float] = []
        agree: list[float] = []
        for aw in align_words:
            if not aw.get('roman') or aw.get('ctc_s') is None:
                presnap.append(None)
                continue
            t = float(aw['ctc_s'])
            owned = None if prev_ctc is None else prev_ctc + WORD_TOL
            dt = nearest_attack(t, peaks, owned)
            presnap.append(None if dt is None else dt)
            if dt is not None:
                abs_pre.append(abs(dt))
            if aw.get('second_s') is not None:
                agree.append(abs(float(aw['second_s']) - t))
            prev_ctc = t
        decision = proof_line(solo, rec.get('status') if rec else None, text_same, presnap, align_words or None, align_report is not None)
        rows.append({
            'id': line['id'], 'solo': solo, 'pass': decision['pass'], 'reason': decision['reason'],
            'detail': decision['detail'], 'engine': (rec or {}).get('second'),
            'ctc': (rec or {}).get('status'), 'start': words[0]['s'],
            'window': (rec or {}).get('second_window'),
            'onset_abs': [round(a, 3) for a in abs_pre] if decision['pass'] else [],
            'presnap_abs': [round(a, 3) for a in abs_pre] if decision['pass'] else [],
            'agree_abs': [round(a, 3) for a in agree] if decision['pass'] else [],
            'presnap_max': round(max(abs_pre), 3) if abs_pre else None,
            'aligner_max': round(max(agree), 3) if agree else None,
        })
    solo_rows = [r for r in rows if r['solo']]
    passed = [r for r in solo_rows if r['pass']]
    onset = [a for r in passed for a in r['presnap_abs']]
    agreed = [a for r in passed for a in r['agree_abs']]
    aligned = song_proven(len(passed), len(solo_rows))
    reasons: dict[str, int] = {}
    for r in rows:
        if not r['pass']:
            reasons[r['reason']] = reasons.get(r['reason'], 0) + 1
    failed_solo = [r for r in solo_rows if not r['pass']]
    worst = sorted(failed_solo, key=lambda r: (-(r['aligner_max'] or 0), -(r['presnap_max'] or 0), r['start']))[:15]
    missing = [r for r in rows if r['ctc'] == 'draft']
    return {
        'aligned': aligned, 'solo': len(solo_rows), 'passed': len(passed), 'failed_solo': len(failed_solo),
        'lines_n': len(rows), 'reasons': reasons, 'lines': rows, 'worst': worst, 'missing': missing,
        'word_tol': WORD_TOL, 'line_tol': TOL, 'song_share': SONG_SHARE,
        'onset_median': round(float(np.median(onset)), 3) if onset else None,
        'onset_p90': round(float(np.percentile(onset, 90)), 3) if onset else None,
        'onset_words': len(onset),
        'presnap_median': round(float(np.median(onset)), 3) if onset else None,
        'presnap_p90': round(float(np.percentile(onset, 90)), 3) if onset else None,
        'agree_median': round(float(np.median(agreed)), 3) if agreed else None,
        'agree_p90': round(float(np.percentile(agreed, 90)), 3) if agreed else None,
    }


def _share_text(proof: dict) -> str:
    if not proof['solo']:
        return '—'
    return f"{100.0 * proof['passed'] / proof['solo']:.1f}".replace('.', ',')


def timing_payload(slug: str, proof: dict, align_report: dict | None) -> dict:
    """song.json timing after the check. `aligned` only when the song share is proven."""
    engines_used = sorted({r['engine'] for r in proof['lines'] if r.get('engine')})
    method = 'mms-fa' + ''.join('+' + e for e in engines_used) if align_report else None
    reasons = ', '.join(f'{REASON_RU.get(k, k)} {v}' for k, v in sorted(proof['reasons'].items(), key=lambda kv: -kv[1]))
    med = '—' if proof['onset_median'] is None else f"{proof['onset_median']:.3f}".replace('.', ',')
    p90 = '—' if proof['onset_p90'] is None else f"{proof['onset_p90']:.3f}".replace('.', ',')
    share = _share_text(proof)
    if proof['aligned']:
        notes = (f"qa_sync: сольных строк {proof['solo']}, доказано {proof['passed']} ({share} %, порог песни 80 %). "
                 f"Расхождение начала слова у выравнивателя до притяжения к атаке: медиана {med} с, 90-й перцентиль {p90} с (порог слова 0,1 с). "
                 f"Цифры посчитаны до притяжения; записанное время может стоять на атаке. "
                 f"Остальные строки с флагом timing-draft. Отчёт: docs/analysis/{slug}-qa.md.")
        status = 'aligned'
    else:
        notes = (f"qa_sync: критерий не пройден, статус оставлен draft. "
                 f"Доказано {proof['passed']} из {proof['solo']} сольных строк ({share} %), нужно не меньше 80 %. "
                 f"Строка «текст не найден» в доказанные не входит. "
                 f"Причины: {reasons or 'нет данных'}. Отчёт: docs/analysis/{slug}-qa.md.")
        status = 'draft'
    out = {'status': status, 'notes': notes}
    if method:
        out['method'] = method
    return out


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


def _fmt_opt(x: float | None) -> str:
    return '—' if x is None else ru(x, 3)


def proof_md(proof: dict) -> list[str]:
    L = []
    share = _share_text(proof)
    L.append(f"**{'Критерий песни пройден' if proof['aligned'] else 'Критерий песни не пройден'}.** "
             f"Порог песни: доказано не меньше 80 % сольных строк (сейчас {proof['passed']} из {proof['solo']}, {share} %). "
             f"Строка, где текст не найден в голосе, в доказанные не входит. "
             f"Не доказано: {proof['failed_solo']}; всего вокальных строк: {proof['lines_n']}.")
    L.append('')
    L.append('Pass/fail и цифры ниже считаются до притяжения начала слова к атаке. '
             'Притяжение (не дальше 0,1 с) может сдвинуть записанное время на пик, но в эти цифры не входит. '
             'Окно второго выравнивателя — фраза, которую первый проход уже поставил на голос, плюс 2 с, '
             'но не длиннее 12 с и не шире секции с запасом 2 с. Черновые времена слов окном не служат, '
             'и длинный якорь общего прохода тоже: в него попадает следующий припев.')
    L.append(f"- Расхождение начала слова у первого выравнивателя (до притяжения) с ближайшей атакой голоса, "
             f"только у доказанных сольных строк: медиана {_fmt_opt(proof['onset_median'])} с, "
             f"90-й перцентиль {_fmt_opt(proof['onset_p90'])} с. Порог слова {ru(WORD_TOL)} с. Слов: {proof['onset_words']}.")
    L.append(f"- Согласие двух выравнивателей (второе начало минус первое, до притяжения), у тех же строк: "
             f"медиана {_fmt_opt(proof.get('agree_median'))} с, 90-й перцентиль {_fmt_opt(proof.get('agree_p90'))} с. Порог {ru(WORD_TOL)} с.")
    L.append(f"- Сдвиг строки целиком — отдельная тревога с порогом {ru(TOL)} с. В pass/fail слова он не входит.")
    if proof['reasons']:
        bits = ', '.join(f"{REASON_RU.get(k, k)} — {v}" for k, v in sorted(proof['reasons'].items(), key=lambda kv: -kv[1]))
        L.append(f"- Почему строки не доказаны: {bits}.")
    L.append('')
    L.append('## Худшие места')
    L.append('')
    L.append('Сольные строки, которые проверка не доказала. Время — начало строки в записи, чтобы его можно было прослушать. '
             'Расхождения — до притяжения.')
    L.append('')
    if proof['worst']:
        for r in proof['worst']:
            extra = f", {r['detail']}" if r['detail'] else ''
            bits = []
            if r.get('aligner_max') is not None:
                bits.append(f"выравниватели до {ru(r['aligner_max'], 3)} с")
            if r.get('presnap_max') is not None:
                bits.append(f"атака до притяжения до {ru(r['presnap_max'], 3)} с")
            if r.get('window'):
                w0, w1 = r['window']
                bits.append(f"окно {ru(w0, 1)}–{ru(w1, 1)} с")
            more = f" ({'; '.join(bits)})" if bits else ''
            L.append(f"- `{r['id']}` {fmt_t(r['start'])} — {REASON_RU.get(r['reason'], r['reason'])}{extra}{more}")
    else:
        L.append('Нет сольных строк с отказом.')
    L.append('')
    L.append('## Текст не найден в голосе')
    L.append('')
    L.append('Эти строки MMS не смог поставить на вокальную дорожку: слова в `lyrics.json`, скорее всего, не те, что поются. Текст здесь не менялся.')
    L.append('')
    if proof['missing']:
        for r in proof['missing']:
            L.append(f"- `{r['id']}` {fmt_t(r['start'])} ({'соло' if r['solo'] else 'не соло'})")
    else:
        L.append('Нет.')
    L.append('')
    return L


def render_md(meta: dict, summary: dict, results: list[dict], words: list[dict], gaps: list[dict],
              novoice: list[dict], glob: dict, baseline: dict | None, fixed: list[str], st: dict | None,
              proof: dict | None = None) -> str:
    L = []
    title = meta.get('title') or meta['slug']
    L.append(f"# Синхронизация текста: {title}")
    L.append('')
    L.append(f"Проверка `qa_sync.py` от {meta['date']}. Аудио: `{meta['audio']}`{'' if meta['stem'] else ' (полный микс — вокального стема нет, точность ниже)'}. "
             f"Текст: `{meta['lyrics']}`. "
             f"Порог доказательства слова: {ru(WORD_TOL)} с — расстояние от начала выравнивателя до притяжения до ближайшей атаки и расхождение двух выравнивателей. "
             f"Порог сдвига строки целиком: {ru(TOL)} с — отдельная тревога, не порог доказательства.")
    L.append('')
    L.append('## Итог')
    L.append('')
    if proof:
        L.extend(proof_md(proof))
        L.append('## Сдвиг строки целиком')
        L.append('')
    else:
        passed = summary['off_lines'] == 0 and summary['no-voice'] == 0
        L.append(f"**{'Проходит' if passed else 'Не проходит'}.** Строк: {summary['lines']}; в такт: {summary['ok']}; "
                 f"рано: {summary['early']}; поздно: {summary['late']}; нет голоса: {summary['no-voice']}; "
                 f"не определить: {summary['low']}.")
        L.append('')
    L.append(f"Сдвиг строки целиком (не пословный): в такт {summary['ok']}, рано {summary['early']}, поздно {summary['late']}, "
             f"нет голоса {summary['no-voice']}, не определить {summary['low']}.")
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
    dec = {d['id']: d for d in proof['lines']} if proof else {}
    if dec:
        L.append('| строка | начало | отрывок | соло | сдвиг строки, с | без голоса | вердикт сдвига | решение |')
        L.append('|---|---|---|---|---|---|---|---|')
    else:
        L.append('| строка | начало | текст | сдвиг, с | без голоса | вердикт |')
        L.append('|---|---|---|---|---|---|')
    for r in results:
        if dec:
            d = dec.get(r['id']) or {'solo': False, 'reason': 'no-report'}
            excerpt = r['text'] if len(r['text']) <= 32 else r['text'][:30] + '…'
            L.append(f"| `{r['id']}` | {fmt_t(r['start'])} | {excerpt} | {'да' if d['solo'] else 'нет'} | {r['offset']:+.2f} | "
                     f"{round(100 * r['silence'])} % | {verdict_text(r)} | {REASON_RU.get(d['reason'], d['reason'])} |")
        else:
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
    ap.add_argument('--apply', action='store_true', help='set timing-draft and song.json timing from the proof; does not change word text or times')
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
    # The proof uses the alignment report only for the lyrics align.py just wrote. A check of an
    # older copy (--lyrics … --tag before) must not borrow that report.
    align_path = work_dir(slug) / 'align-report.json'
    use_report = args.lyrics is None and align_path.exists()
    align_report = json.loads(align_path.read_text(encoding='utf-8')) if use_report else None
    proof = None
    if use_report or args.apply:
        proof = build_proof(sig, lines, results, align_report)
    if args.apply and proof is not None and song.get('timing', {}).get('status') == 'verified':
        print('song.json: timing.status = verified — qa_sync --apply ничего не меняет')
    elif args.apply and proof is not None:
        passed_ids = {r['id'] for r in proof['lines'] if r['pass']}
        for _, line in lines:
            T.set_flag(line, 'timing-draft', line['id'] not in passed_ids)
        payload = timing_payload(slug, proof, align_report)
        if 'method' not in payload:
            payload['method'] = song.get('timing', {}).get('method', 'unmeasured')
        song['timing'] = payload
        lyr_path.write_text(dump_json(lyrics), encoding='utf-8')
        if song_path.exists():
            song_path.write_text(dump_json(song), encoding='utf-8')
    meta = {'slug': slug, 'title': song.get('title'), 'date': dt.date.today().isoformat(), 'audio': audio.name,
            'stem': is_stem, 'lyrics': rel(lyr_path),
            'voice_threshold_db': round(sig.thr, 1)}
    baseline = json.loads(Path(args.baseline).read_text(encoding='utf-8')) if args.baseline else None
    md = render_md(meta, summary, results, words, gaps, novoice, glob, baseline, fixed, st, proof)
    out = {'meta': meta, 'summary': summary, 'proof': proof, 'global': glob, 'lines': results, 'words': words,
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
    if proof:
        print(f"критерий: {'пройден' if proof['aligned'] else 'не пройден'} · соло {proof['solo']} · "
              f"доказано {proof['passed']} · до притяжения медиана {_fmt_opt(proof['onset_median'])} с · "
              f"90-й перцентиль {_fmt_opt(proof['onset_p90'])} с")
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
    if proof and (not proof['aligned'] or proof['failed_solo']):
        bad += 1
    return 1 if bad else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(2)
