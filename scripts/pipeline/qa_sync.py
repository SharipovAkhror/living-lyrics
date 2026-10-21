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
import unicodedata
from pathlib import Path

import numpy as np

import features as F
import placement as P
import timing as T
from common import ROOT, dump_json, load_audio, load_json, song_dir, vocal_stem, work_dir

MAX_LAG = 2.0          # search ±2 s
TOL = 0.25             # whole-line shift alarm only. Not the word proof, and not the song gate.
WORD_TOL = 0.10        # solo: pre-snap aligner start vs the vocal attack
CHOIR_TOL = 0.20       # choir: the same onset check, wider because several voices share the stem
CUE_TOL = 0.30         # publication (align.py): a placed line further than this keeps the cue time
PROOF_CUE_TOL = 0.30   # the same distance: placement and the site both use it
SONG_SHARE = 0.90      # each group that exists (solo, choir) must be at least this share proved. Goal is 100 %.
ONSET_SEARCH = 0.35    # look for an attack this far from the written start
LEGATO_GAP = 0.20      # previous letter end to this start: the word is still the same gesture
ATTACK_NEAR = 0.30     # path B opens only when no attack is closer than this
SECOND_WORD_TOL = 0.10 # path B, choir included. The attack path keeps CHOIR_TOL
MELISMA_SPAN = 0.80    # a letter spike this long is a held vowel, not a consonant burst
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


def onset_peak_times(sig: Signals, min_height: float = PEAK_HEIGHT, nms_s: float = 0.04,
                     curve: np.ndarray | None = None) -> np.ndarray:
    """Seconds of clear vocal attacks: local maxima of the onset curve, one per attack.

    `curve` replaces the spectral combination. The envelope candidate passes the
    level-rise curve at the same height and the same suppression.
    """
    c = onset_combo(sig) if curve is None else np.asarray(curve, dtype=float)
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


def peaks_on_rise(sig: Signals, peaks: np.ndarray, min_height: float) -> np.ndarray:
    """Keep attacks that are also a local rise in level.

    The stem features have no pitch track. A rise in energy is the measured
    stand-in for "the note or the loudness changed here".
    """
    if len(peaks) == 0:
        return np.zeros(0)
    rise = sig.curves['rise']
    n = len(rise)
    keep: list[float] = []
    for t in peaks:
        i = int(round(float(t) / F.HOP))
        if i <= 0 or i >= n - 1:
            continue
        v = float(rise[i])
        if v >= min_height and v >= float(rise[i - 1]) and v >= float(rise[i + 1]):
            keep.append(float(t))
    return np.asarray(keep, dtype=float)


def envelope_peak_times(sig: Signals, min_height: float = PEAK_HEIGHT, nms_s: float = 0.04) -> np.ndarray:
    """Peaks of the level-rise curve alone, at the same height as the spectral attacks."""
    return onset_peak_times(sig, min_height=min_height, nms_s=nms_s, curve=sig.curves['rise'])


def default_word_rule() -> dict:
    """Attack within 0.10 s (choir 0.20 s), peak height 0.5. Tests use this.

    The runner may replace it with docs/analysis/bench/attack-chance.json.
    build_proof does not read that file unless the caller passes the rule.
    """
    return {
        'name': 'tol-0.10-h0.5',
        'tol': WORD_TOL,
        'choir_tol': CHOIR_TOL,
        'peak_height': PEAK_HEIGHT,
        'require_rise': False,
        'require_second': False,
        'attack_fill': False,
    }


def load_word_rule() -> dict:
    """The rule attack_chance.py wrote, or the 0.10 s default when the file is absent."""
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'attack-chance.json'
    if not path.exists():
        return default_word_rule()
    try:
        chosen = json.loads(path.read_text(encoding='utf-8')).get('chosen') or {}
    except (OSError, json.JSONDecodeError):
        return default_word_rule()
    if 'tol' not in chosen:
        return default_word_rule()
    rule = default_word_rule()
    for key in ('name', 'tol', 'choir_tol', 'peak_height', 'require_rise', 'require_second'):
        if key in chosen:
            rule[key] = chosen[key]
    rule['tol'] = float(rule['tol'])
    rule['choir_tol'] = float(rule['choir_tol'])
    rule['peak_height'] = float(rule['peak_height'])
    rule['require_rise'] = bool(rule['require_rise'])
    rule['require_second'] = bool(rule['require_second'])
    witnesses = chosen.get('witnesses')
    rule['witnesses'] = witnesses if witnesses in ('one', 'two') else None
    if 'agree_tol' in chosen:
        rule['agree_tol'] = float(chosen['agree_tol'])
    bias: dict[str, float] = {}
    for key, value in (chosen.get('bias') or {}).items():
        try:
            bias[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    rule['bias'] = bias
    adopt: dict[str, str] = {}
    for key, value in (chosen.get('adopt') or {}).items():
        if isinstance(value, str) and value:
            adopt[str(key)] = value
    rule['adopt'] = adopt
    scopes = []
    for scope in chosen.get('scopes') or []:
        if not isinstance(scope, dict):
            continue
        if scope.get('witnesses') not in ('one', 'two'):
            continue
        if not scope.get('song') or scope.get('lang') is None:
            continue
        role = scope.get('phoneme') if scope.get('phoneme') in ('off', 'or', 'only') else 'off'
        model = scope.get('phoneme_model')
        scopes.append({
            'song': str(scope['song']),
            'lang': str(scope['lang']),
            'witnesses': scope['witnesses'],
            'phoneme': role,
            'phoneme_model': model if isinstance(model, str) and model else None,
        })
    rule['scopes'] = scopes
    refute_in = chosen.get('refute') if isinstance(chosen.get('refute'), dict) else None
    if refute_in:
        rule['refute'] = {
            'both_agree': float(refute_in.get('both_agree', 0.10)),
            'both_far': float(refute_in.get('both_far', 0.20)),
            'only_far': float(refute_in.get('only_far', 0.30)),
            'attack_tol': float(refute_in.get('attack_tol', 0.10)),
        }
    else:
        rule['refute'] = None
    rule['line_share'] = None if chosen.get('line_share') is None else float(chosen['line_share'])
    rule['line_chance'] = None if chosen.get('line_chance') is None else float(chosen['line_chance'])
    rule['line_min_words'] = int(chosen.get('line_min_words') or 2)
    rule['choir_attack'] = chosen.get('choir_attack') if chosen.get('choir_attack') in ('spectral', 'envelope') else 'spectral'
    rule['choir_clock'] = chosen.get('choir_clock') if chosen.get('choir_clock') in ('phone', 'vowel') else 'phone'
    rule['attack_fill'] = bool(chosen.get('attack_fill'))
    roles = {}
    for line_id, role in (chosen.get('line_roles') or {}).items():
        if role in ('off', 'or', 'only'):
            roles[str(line_id)] = role
    rule['line_roles'] = roles
    retime = {}
    raw_retime = chosen.get('retime') if isinstance(chosen.get('retime'), dict) else {}
    for slug, rows in raw_retime.items():
        if not isinstance(rows, list):
            continue
        kept_rows = []
        for row in rows:
            if isinstance(row, dict) and row.get('id') and row.get('by') and isinstance(row.get('words'), list):
                kept_rows.append(row)
        if kept_rows:
            retime[str(slug)] = kept_rows
    rule['retime'] = retime
    blocked = []
    for name in chosen.get('blocked_primaries') or []:
        if isinstance(name, str) and name:
            blocked.append(name)
    rule['blocked_primaries'] = blocked
    rule['line_fill'] = [str(line_id) for line_id in (chosen.get('line_fill') or []) if line_id]
    rule['line_nucleus'] = [str(line_id) for line_id in (chosen.get('line_nucleus') or []) if line_id]
    stable_of = {}
    for line_id, model in (chosen.get('line_stable') or {}).items():
        if isinstance(model, str) and model:
            stable_of[str(line_id)] = model
    rule['line_stable'] = stable_of
    rule['line_placed_clock'] = [
        str(line_id) for line_id in (chosen.get('line_placed_clock') or []) if line_id]
    phone_of = {}
    for line_id, model in (chosen.get('line_phone_model') or {}).items():
        if isinstance(model, str) and model:
            phone_of[str(line_id)] = model
    rule['line_phone_model'] = phone_of
    if 'translation_half' in chosen and chosen.get('translation_half') is not None:
        rule['translation_half'] = float(chosen['translation_half'])
    else:
        rule['translation_half'] = None
    rule['translation_measured'] = 'translation_half' in chosen
    # Missing or null: every translation line may use the half. A list restricts
    # the wider gate to the lines whose shift cost the join actually paid.
    if 'line_wide' in chosen and chosen.get('line_wide') is not None:
        rule['line_wide'] = [str(line_id) for line_id in chosen.get('line_wide') or [] if line_id]
    else:
        rule['line_wide'] = None
    # A measured file decides witnesses per song and language. The global flag is
    # only the fallback for a file that still names one mode for every line.
    if rule['witnesses'] or rule['scopes']:
        rule['require_second'] = False
    return rule


def apply_saved_retime(slug: str, lyrics: dict, align_report: dict | None, rule: dict | None,
                       sig: Signals) -> int:
    """Write a measured handoff or Latin placement into the report and the lyrics.

    The report keeps the pre-snap start, which is what the proof reads. The
    published `s` moves onto a peak of height 0.5 within 0.10 s, the same snap
    align.py uses. The cue does not move. Returns how many lines were rewritten.
    """
    rows = ((rule or {}).get('retime') or {}).get(slug) or []
    if not rows or not align_report:
        return 0
    by_id = {line.get('id'): line for line in align_report.get('lines') or []}
    peaks = onset_peak_times(sig, min_height=PEAK_HEIGHT)
    changed = 0
    prev_start = None
    for _sec, lyr_line in T.vocal_lines(lyrics):
        row = next((item for item in rows if item.get('id') == lyr_line.get('id')), None)
        rec = by_id.get(lyr_line.get('id'))
        if row is None or rec is None:
            for word in lyr_line.get('words') or []:
                prev_start = float(word['s'])
            continue
        report_words = rec.get('words') or []
        lyr_words = lyr_line.get('words') or []
        by_wi = {}
        for item in row.get('words') or []:
            if item.get('wi') is None:
                continue
            by_wi[int(item['wi'])] = item
        first = None
        for wi, (report_word, lyr_word) in enumerate(zip(report_words, lyr_words)):
            item = by_wi.get(wi)
            if item is None or item.get('ctc_s') is None or item.get('ctc_e') is None:
                prev_start = float(lyr_word['s'])
                continue
            ctc_s = float(item['ctc_s'])
            ctc_e = float(item['ctc_e'])
            report_word['ctc_s'] = round(ctc_s, 3)
            report_word['ctc_e'] = round(ctc_e, 3)
            report_word['second_s'] = item.get('second_s')
            report_word['third_s'] = item.get('third_s')
            report_word['second_kind'] = item.get('second_kind')
            report_word['third_kind'] = item.get('third_kind')
            if row.get('by') == 'phoneme':
                report_word['phoneme_models'] = {}
                report_word['vowel_models'] = {}
            snapped = ctc_s
            if len(peaks):
                dist = np.abs(np.asarray(peaks, dtype=float) - ctc_s)
                peak = float(peaks[int(np.argmin(dist))])
                if abs(peak - ctc_s) <= 0.10 + 1e-12 and peak > ((prev_start + 0.05) if prev_start is not None else 0.0):
                    snapped = peak
            start = T.r2(snapped)
            end = T.r2(ctc_e)
            if end < start + 0.04:
                end = T.r2(start + 0.04)
            lyr_word['s'] = start
            lyr_word['e'] = end
            report_word['s'] = start
            report_word['e'] = end
            if report_word.get('roman') and first is None:
                first = ctc_s
            prev_start = start
        # A row that matched no lettered word must not mark the line placed.
        if first is None:
            continue
        rec['status'] = 'good'
        rec['structure_ok'] = True
        rec['placed_by'] = row.get('by')
        rec['ctc_start'] = round(first, 3)
        lyr_line['placedBy'] = row.get('by')
        changed += 1
    if changed:
        T.enforce_order(lyrics)
    return changed


def apply_rule_times(words: list[dict] | None, lang: str | None, rule: dict | None) -> list[dict] | None:
    """Copy word rows with the calibrated, possibly borrowed, second start.

    The align report keeps the raw clocks. Bias is seconds to subtract, estimated on
    one half of the consonant lines and checked on the other. An adopted language
    (Azerbaijani measured on the Turkish model) reads that probe as its second start.
    The third witness is not shifted.
    """
    if not words or not rule:
        return words
    bias = rule.get('bias') or {}
    adopt = rule.get('adopt') or {}
    if not bias and not adopt:
        return words
    lang = lang or '?'
    src = adopt.get(lang)
    out = []
    for word in words:
        item = dict(word)
        kind = item.get('second_kind') or ''
        # A witness slot that holds MMS or stable-ts is not the Whisper clock.
        # Bias and a borrowed checkpoint apply only to that clock.
        if kind not in ('', 'whisperx', 'second'):
            out.append(item)
            continue
        key = None
        if src:
            borrowed = (word.get('borrow') or {}).get(src)
            if borrowed is not None:
                item['second_s'] = float(borrowed)
                key = f'borrow-{src}|{lang}'
        if key is None and item.get('second_s') is not None:
            key = f'whisperx|{lang}'
        if key and key in bias and item.get('second_s') is not None:
            item['second_s'] = float(item['second_s']) - float(bias[key])
        out.append(item)
    return out


def nearest_attack(t: float, peaks: np.ndarray, owned: float | None) -> float | None:
    """Signed seconds from a pre-snap word start to the nearest attack not claimed by the previous word.

    `owned` is the previous word's pre-snap start plus WORD_TOL. A peak at or before that belongs
    to the previous word and is not evidence about this one. No distance cap: the number in the
    report is the real gap, and the proof fails when it is over WORD_TOL.

    `peaks` is sorted ascending, as onset_peak_times returns it. Two equal gaps keep the earlier
    peak, the same peak argmin keeps on the filtered array.
    """
    n = len(peaks)
    if n == 0:
        return None
    start = 0
    if owned is not None:
        start = int(np.searchsorted(peaks, float(owned), side='right'))
        if start >= n:
            return None
    t = float(t)
    i = int(np.searchsorted(peaks, t, side='left'))
    if i < start:
        i = start
    best_i = -1
    best_d = None
    earlier = i - 1
    if earlier >= start:
        best_i = earlier
        best_d = abs(float(peaks[earlier]) - t)
    if i < n:
        dist = abs(float(peaks[i]) - t)
        if best_d is None or dist < best_d:
            best_i = i
    if best_i < 0:
        return None
    return float(peaks[best_i]) - t


def fill_attack(t: float, primary: np.ndarray, fallback: np.ndarray | None,
                owned: float | None, tol: float) -> float | None:
    """Spectral gap when it is inside the group tolerance, otherwise the envelope gap.

    A spectral peak inside `tol` is kept even when the envelope peak is closer, so a
    word already proved by the spectral attack does not move. The envelope is used
    only when it itself is inside `tol`. It does not refute: the caller still passes
    the spectral peaks to word_refuted. No fallback leaves the spectral gap alone.
    """
    primary_dt = nearest_attack(t, primary, owned)
    if fallback is None or len(fallback) == 0:
        return primary_dt
    if primary_dt is not None and abs(primary_dt) <= float(tol) + 1e-12:
        return primary_dt
    alt = nearest_attack(t, fallback, owned)
    if alt is not None and abs(alt) <= float(tol) + 1e-12:
        return alt
    return primary_dt


def song_share_label() -> str:
    """Whole-percent label of the publication gate, taken from SONG_SHARE."""
    return str(int(round(SONG_SHARE * 100)))


def song_proven(passed: int, n: int) -> bool:
    """True when this group exists and at least SONG_SHARE of its lines are proven.

    Integer comparison at 90 %: 34/38 (89.5 %) fails and 35/38 (92.1 %) passes; 108/120 passes.
    A line whose text was not found stays in the denominator. The gate is not the proof, and the
    goal remains every line.
    """
    if n <= 0:
        return False
    return passed * 1000 >= n * int(round(SONG_SHARE * 1000))


def song_ready(parts: list[tuple[int, int]]) -> bool:
    """True when every group that has lines is song_proven. An empty group does not block."""
    present = [(passed, n) for passed, n in parts if n > 0]
    if not present:
        return False
    return all(song_proven(passed, n) for passed, n in present)


def share_met(got: int, n: int, share: float) -> bool:
    """Integer gate, same rounding as the song threshold. 1 of 2 meets 0.50."""
    if n <= 0:
        return False
    return got * 1000 >= n * int(round(float(share) * 1000))


def witnesses_for(rule: dict | None, song: str | None, lang: str | None) -> str | None:
    """Witness mode for one line. A language scope wins; otherwise the song scope.

    A measured file lists every language. The song row (`lang` `*`) covers a language
    with too few words to judge on its own. No scope and no global mode means the
    caller is on the default rule, which does not use witnesses.
    """
    rule = rule or {}
    scopes = rule.get('scopes') or []
    lang = lang or '?'
    for scope in scopes:
        if song and scope.get('song') == song and scope.get('lang') == lang and scope.get('witnesses') in ('one', 'two'):
            return scope['witnesses']
    for scope in scopes:
        if song and scope.get('song') == song and scope.get('lang') == '*' and scope.get('witnesses') in ('one', 'two'):
            return scope['witnesses']
    mode = rule.get('witnesses')
    return mode if mode in ('one', 'two') else None


def phoneme_for(rule: dict | None, song: str | None, lang: str | None) -> tuple[str, str | None]:
    """Phoneme role for one line. The language scope wins, including an explicit off.

    A short language already carries the song role in its own scope. The song
    row is only the fallback when that language is absent from the file.
    """
    rule = rule or {}
    scopes = rule.get('scopes') or []
    lang = lang or '?'

    def read(scope: dict) -> tuple[str, str | None]:
        role = scope.get('phoneme') if scope.get('phoneme') in ('or', 'only') else 'off'
        model = scope.get('phoneme_model')
        return role, model if isinstance(model, str) and model else None

    for scope in scopes:
        if song and scope.get('song') == song and scope.get('lang') == lang:
            return read(scope)
    for scope in scopes:
        if song and scope.get('song') == song and scope.get('lang') == '*':
            return read(scope)
    return 'off', None


def stamp_phoneme(words: list[dict] | None, role: str, model: str | None,
                  choir_vowel: bool = False) -> list[dict] | None:
    """Copy one model's phoneme clock onto phoneme_s. Missing clocks stay missing.

    The vowel nucleus replaces the phone start only for a choir line when the
    measured rule says so. Solo lines keep the phone start.
    """
    if not words or role not in ('or', 'only') or not model:
        return words
    out = []
    for word in words:
        item = dict(word)
        table = item.get('vowel_models') if choir_vowel else item.get('phoneme_models')
        clock = (table or {}).get(model)
        item['phoneme_s'] = None if clock is None else float(clock)
        item['phoneme_role'] = role
        out.append(item)
    return out


def word_refuted(word: dict, peaks: np.ndarray | None, refute: dict | None) -> str | None:
    """Why this word contradicts MMS, or None when there is simply no proof.

    Both clocks, when both exist, refute the word if they agree with each other and
    both sit far from MMS. One clock refutes it only when that clock is far from MMS
    and a strong attack sits on the clock but not on MMS. No clock is not a refutation.
    """
    if not refute or word.get('ctc_s') is None:
        return None
    ctc = float(word['ctc_s'])
    both_agree = float(refute.get('both_agree', 0.10))
    both_far = float(refute.get('both_far', 0.20))
    only_far = float(refute.get('only_far', 0.30))
    attack_tol = float(refute.get('attack_tol', 0.10))
    clocks = []
    for key in ('second_s', 'third_s'):
        if word.get(key) is not None:
            clocks.append(float(word[key]))
    if len(clocks) >= 2:
        if abs(clocks[0] - clocks[1]) <= both_agree + 1e-12 and all(abs(c - ctc) > both_far + 1e-12 for c in clocks[:2]):
            return 'witnesses-agree-elsewhere'
        return None
    if len(clocks) == 1 and abs(clocks[0] - ctc) > only_far + 1e-12:
        if _peak_near(clocks[0], peaks, attack_tol) and not _peak_near(ctc, peaks, attack_tol):
            return 'witness-attack'
    return None


def _peak_near(t: float, peaks: np.ndarray | None, tol: float) -> bool:
    """True when a sorted peak list has one peak within `tol` of `t`."""
    if peaks is None or len(peaks) == 0:
        return False
    t = float(t)
    i = int(np.searchsorted(peaks, t, side='left'))
    best = None
    if i < len(peaks):
        best = abs(float(peaks[i]) - t)
    if i > 0:
        dist = abs(float(peaks[i - 1]) - t)
        if best is None or dist < best:
            best = dist
    return best is not None and best <= tol + 1e-12


def line_word_ok(proved: list[dict], refuted: list[str | None], share: float, minimum: int = 2) -> bool:
    """A line's words, once the cue already matched. Refutation blocks the line.

    At least `minimum` words must be proved, and they must be at least `share` of the
    lettered words. A word with neither proof nor refutation does not block the line.
    """
    n = len(proved)
    if n < minimum or len(refuted) != n:
        return False
    if any(refuted):
        return False
    got = sum(1 for word in proved if word.get('path') != 'fail')
    if got < minimum:
        return False
    return share_met(got, n, share)


def _refute_detail(why: str, refute: dict | None) -> str:
    refute = refute or {}
    if why == 'witnesses-agree-elsewhere':
        return (f"оба свидетеля согласны (≤ {float(refute.get('both_agree', 0.10)):.2f} с) "
                f"и дальше {float(refute.get('both_far', 0.20)):.2f} с от MMS")
    return (f"единственный свидетель дальше {float(refute.get('only_far', 0.30)):.2f} с, "
            f"сильная атака у него, а не у MMS")


REASON_RU = {
    'pass': 'доказано',
    'not-solo': 'не соло',
    'text-not-found': 'текст не найден в голосе',
    'aligner-failed': 'выравниватель не справился',
    'low-confidence': 'выравниватель не уверен',
    'no-second-aligner': 'нет второго выравнивателя',
    'aligners-disagree': 'выравниватели расходятся',
    'no-voice': 'нет голоса',
    'line-shift': 'строка сдвинута относительно голоса',
    'onset': 'начало слова дальше допуска группы от атаки',
    'cue-disagree': 'расходится с субтитрами',
    'text-changed': 'текст изменился после выравнивания',
    'no-report': 'нет отчёта выравнивания',
    'word-refuted': 'слово опровергнуто',
    'word-share': 'доказанных слов меньше доли строки',
    'primary-chance': 'случайный проход этого постановщика выше 5 %',
    'no-phoneme': 'нет фонемного начала',
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


def _kind(group: str | bool) -> str:
    if group is True or group == 'solo':
        return 'solo'
    if group == 'choir':
        return 'choir'
    return 'other'


def second_status(align_words: list[dict] | None, tol: float) -> str:
    """How the second aligner sits next to the chosen one, for the report.

    agree — every lettered word with a first start also has a second start within `tol`.
    disagree — a second start exists and is further than `tol`.
    partial — some of those words have a second start and some do not.
    absent — no second start on any lettered word.
    This label does not by itself fail a word that has an attack. A vowel, legato or
    melisma with no attack within ATTACK_NEAR fails when the second start is missing
    or further than SECOND_WORD_TOL. That decision is prove_words, not this label.
    """
    if not align_words:
        return 'absent'
    diffs: list[float | None] = []
    for a in align_words:
        if not a.get('roman') or a.get('ctc_s') is None:
            continue
        if a.get('second_s') is None:
            diffs.append(None)
        else:
            diffs.append(abs(float(a['second_s']) - float(a['ctc_s'])))
    if not diffs or all(d is None for d in diffs):
        return 'absent'
    if any(d is None for d in diffs):
        return 'partial'
    worst = max(d for d in diffs if d is not None)
    return 'disagree' if worst > tol else 'agree'


_VOWELS = set('aeiouyæøəɨüöïáéíóúàèìòùäëïöüâêîôûýÿ')


def _vowel_char(ch: str) -> bool:
    if not ch.isalpha():
        return False
    base = unicodedata.normalize('NFD', ch)[0].lower()
    return base in _VOWELS or ch.lower() in _VOWELS


def long_vowel(roman: str, ctc_s: float | None, ctc_e: float | None) -> bool:
    """A held sung vowel: every letter is a vowel, or the letter span is a melisma.

    A consonant with a short vowel in front is not this. Legato alone is not this.
    """
    letters = [ch for ch in (roman or '') if ch.isalpha()]
    if letters and all(_vowel_char(ch) for ch in letters):
        return True
    if ctc_s is not None and ctc_e is not None and float(ctc_e) - float(ctc_s) >= MELISMA_SPAN:
        return True
    return False


def word_soft(roman: str, ctc_s: float | None, ctc_e: float | None, prev_e: float | None) -> bool:
    """A vowel, a legato continuation, or a melisma. The onset detector often sees none of these.

    Legato is the gap from the previous letter's end to this start, at most LEGATO_GAP.
    A melisma is a vowel-only romanisation or a letter spike of MELISMA_SPAN or more.
    The star usually keeps that spike to one frame, so the span check is the rare case.
    """
    letters = [ch for ch in roman if ch.isalpha()]
    if letters and (_vowel_char(letters[0]) or all(_vowel_char(ch) for ch in letters)):
        return True
    if ctc_s is not None and ctc_e is not None and float(ctc_e) - float(ctc_s) >= MELISMA_SPAN:
        return True
    if prev_e is not None and ctc_s is not None and 0 <= float(ctc_s) - float(prev_e) <= LEGATO_GAP:
        return True
    return False


def _path_counts(words: list[dict]) -> dict[str, int]:
    counts = {'attack': 0, 'second': 0, 'fail': 0}
    for word in words:
        key = word.get('path') or 'fail'
        counts[key] = counts.get(key, 0) + 1
    return counts


def _witness_ok(clock, ctc_s: float, agree_tol: float) -> bool:
    return clock is not None and abs(float(clock) - float(ctc_s)) <= agree_tol


def prove_words(align_words: list[dict] | None, presnap: list[float | None], tol: float,
                require_second: bool = False, witnesses: str | None = None,
                agree_tol: float = SECOND_WORD_TOL, phoneme_role: str | None = None,
                nucleus: bool = False) -> list[dict]:
    """How each lettered word is proved. Interpolation between neighbours is not a path.

    attack — |onset| is within the group tolerance (0.10 s solo, 0.20 s choir,
    unless a measured rule tightened it). When `require_second` is set, that
    attack also needs the second aligner within SECOND_WORD_TOL.
    second — the word is soft, no attack is closer than ATTACK_NEAR, and the second
    aligner agrees within SECOND_WORD_TOL (0.10 s even for the choir).
    witness-second / witness-third / witness-both — a measured rule replaced both
    paths. The attack is still required. `one` needs the second or the third clock
    within `agree_tol` of the MMS start. `two` needs both. A missing clock is not
    an agreement. The second path is not used.
    witness-phoneme — the attack is still required. Role `only` proves the word
    from the phoneme start alone. Role `or` proves it when the phoneme start
    agrees and the clocks the legacy mode already required do not. A missing
    phoneme clock is not an agreement and not a refutation.
    fail — anything else. A consonant with no attack fails. A missing second start
    cannot take the second path. A missing CTC start fails.
    """
    if witnesses not in ('one', 'two'):
        witnesses = None
    out = []
    prev_e: float | None = None
    for word, dt in zip(align_words or [], presnap):
        roman = word.get('roman') or ''
        if not roman:
            continue
        ctc_s = word.get('ctc_s')
        ctc_e = word.get('ctc_e')
        soft = word_soft(
            roman,
            None if ctc_s is None else float(ctc_s),
            None if ctc_e is None else float(ctc_e),
            prev_e,
        )
        abs_dt = None if dt is None else abs(float(dt))
        nucleus_used = False
        span_s = word.get('own_t', ctc_s)
        span_e = word.get('own_e', ctc_e)
        if (nucleus and ctc_s is not None and long_vowel(roman, span_s, span_e)
                and (abs_dt is None or abs_dt > tol + 1e-12)):
            vowel = word.get('vowel_s')
            if vowel is not None and abs(float(vowel) - float(ctc_s)) <= tol + 1e-12:
                abs_dt = abs(float(vowel) - float(ctc_s))
                nucleus_used = True
        second = word.get('second_s')
        third = word.get('third_s')
        path, reason, detail = 'fail', 'onset', ''
        if ctc_s is None:
            detail = 'нет начала выравнивателя у слова'
        elif witnesses:
            if abs_dt is not None and abs_dt <= tol:
                second_ok = _witness_ok(second, float(ctc_s), agree_tol)
                third_ok = _witness_ok(third, float(ctc_s), agree_tol)
                legacy_ok = (second_ok and third_ok) if witnesses == 'two' else (second_ok or third_ok)
                role = phoneme_role if phoneme_role in ('or', 'only') else (word.get('phoneme_role') or 'off')
                if role not in ('or', 'only'):
                    role = 'off'
                phoneme_ok = _witness_ok(word.get('phoneme_s'), float(ctc_s), agree_tol)
                if role == 'only':
                    ok = phoneme_ok
                elif role == 'or':
                    ok = bool(legacy_ok or phoneme_ok)
                else:
                    ok = legacy_ok
                if ok:
                    if nucleus_used:
                        path = 'nucleus'
                    elif role == 'only' or (role == 'or' and phoneme_ok and not legacy_ok):
                        path = 'witness-phoneme'
                    elif second_ok and third_ok:
                        path = 'witness-both'
                    elif third_ok:
                        path = 'witness-third'
                    else:
                        path = 'witness-second'
                    reason = 'pass'
                elif role == 'only' and word.get('phoneme_s') is None:
                    reason = 'no-phoneme'
                    detail = 'атака есть, фонемного начала нет'
                elif role == 'only':
                    reason = 'aligners-disagree'
                    detail = 'фонемное начало не совпало'
                elif second is None and third is None and (role != 'or' or word.get('phoneme_s') is None):
                    reason = 'no-second-aligner'
                    detail = 'атака есть, независимых начал нет'
                else:
                    reason = 'aligners-disagree'
                    if role == 'or':
                        detail = (f'второй {"да" if second_ok else "нет"}, '
                                  f'третий {"да" if third_ok else "нет"}, '
                                  f'фонема {"да" if phoneme_ok else "нет"}')
                    else:
                        detail = f'второй {"да" if second_ok else "нет"}, третий {"да" if third_ok else "нет"}'
            elif abs_dt is None:
                detail = 'атаки рядом с началом выравнивателя нет'
            else:
                detail = f'до притяжения дальше всего {abs_dt:.3f} с'
        elif abs_dt is not None and abs_dt <= tol:
            if not require_second:
                path, reason = ('nucleus', 'pass') if nucleus_used else ('attack', 'pass')
            elif second is None:
                reason = 'no-second-aligner'
                detail = 'атака есть, второго начала нет'
            else:
                gap = abs(float(second) - float(ctc_s))
                if gap <= SECOND_WORD_TOL:
                    path, reason = 'attack', 'pass'
                else:
                    reason = 'aligners-disagree'
                    detail = f'второй выравниватель в {gap:.3f} с'
        elif soft and (abs_dt is None or abs_dt >= ATTACK_NEAR):
            if second is None:
                reason = 'no-second-aligner'
                detail = 'атаки ближе 0,3 с нет, второго начала нет'
            else:
                gap = abs(float(second) - float(ctc_s))
                if gap <= SECOND_WORD_TOL:
                    path, reason = 'second', 'pass'
                else:
                    reason = 'aligners-disagree'
                    detail = f'второй выравниватель в {gap:.3f} с'
        elif abs_dt is None:
            detail = 'атаки рядом с началом выравнивателя нет'
        else:
            detail = f'до притяжения дальше всего {abs_dt:.3f} с'
        out.append({
            'path': path, 'soft': soft, 'reason': reason, 'detail': detail,
            'abs': None if abs_dt is None else round(abs_dt, 3),
        })
        if ctc_s is not None:
            prev_e = float(ctc_e) if ctc_e is not None else float(ctc_s)
    return out


def proof_line(group: str | bool, ctc_status: str | None, text_same: bool, presnap: list[float | None], align_words: list[dict] | None, has_report: bool,
               cue_start: float | None = None, ctc_line_start: float | None = None, structure_ok: bool = True,
               tol: float | None = None, require_second: bool = False, witnesses: str | None = None,
               agree_tol: float = SECOND_WORD_TOL, peaks: np.ndarray | None = None,
               refute: dict | None = None, line_share: float | None = None,
               line_min_words: int = 2, cue_tol: float | None = None,
               nucleus: bool = False) -> dict:
    """Whether one line may lose timing-draft.

    Without `line_share`, the first failing word sets the reason: each lettered
    word needs an attack within the group tolerance, or, when it is soft and no
    attack is closer than 0.30 s, a second aligner within 0.10 s.
    With `line_share`, a refuted word blocks the line, and the rest pass when at
    least that share of the lettered words is proved and at least `line_min_words`
    of them are. A word with neither proof nor a refutation does not block it.
    Placed (`good`) for a cued line already means the structural checks and
    |start − cue| ≤ 0.30 s. The MMS score does not decide that.
    `tol` overrides the group tolerance when a measured rule tightened it.
    A duet or tutti is neither group. The whole-line shift alarm is not a gate.
    A cued line that was not placed does not blame the text.
    """
    kind = _kind(group)
    if tol is None:
        tol = CHOIR_TOL if kind == 'choir' else WORD_TOL
    second = second_status(align_words, tol)

    def fail(reason: str, detail: str, words_proof: list[dict] | None = None) -> dict:
        proved = words_proof or []
        return {'pass': False, 'reason': reason, 'detail': detail, 'second': second,
                'paths': _path_counts(proved), 'word_proof': proved}

    if not has_report:
        return fail('no-report', '')
    if not text_same:
        return fail('text-changed', '')
    if kind == 'other':
        return fail('not-solo', 'дуэт, тутти или несколько голосов')
    has_cue = cue_start is not None
    drift = None
    agrees = False
    gate = PROOF_CUE_TOL if cue_tol is None else float(cue_tol)
    if has_cue and ctc_line_start is not None:
        drift = abs(float(ctc_line_start) - float(cue_start))
        agrees = round(drift, 3) <= gate
    if ctc_status in ('draft', None):
        if has_cue:
            return fail('aligner-failed', 'постановки нет')
        return fail('text-not-found', 'MMS не нашёл эти слова в секции')
    if ctc_status != 'good':
        # A path exists and was not placed. Blame the text only when there is no cue
        # to check it against and the path itself failed the structural checks.
        if not structure_ok and not agrees:
            if has_cue:
                return fail('aligner-failed', 'путь не прошёл структурные проверки и с репликой не сошёлся')
            return fail('text-not-found', 'путь не прошёл структурные проверки')
        if not agrees:
            if not has_cue:
                return fail('cue-disagree', 'нет реплики')
            if ctc_line_start is None:
                return fail('cue-disagree', 'нет начала выравнивателя')
            return fail('cue-disagree', f'{drift:.3f} с при допуске {gate:.2f} с')
        if not structure_ok:
            return fail('aligner-failed', 'структурные проверки')
        return fail('low-confidence', ctc_status or 'нет оценки')
    # Round to a millisecond so exactly 0.30 s stays inside.
    if not has_cue:
        return fail('cue-disagree', 'нет реплики')
    if ctc_line_start is None:
        return fail('cue-disagree', 'нет начала выравнивателя')
    if not agrees:
        return fail('cue-disagree', f'{drift:.3f} с при допуске {gate:.2f} с')
    if not align_words or len(presnap) != len(align_words):
        return fail('no-report', 'нет допритяжного времени')
    proved = prove_words(align_words, presnap, tol, require_second=require_second,
                         witnesses=witnesses, agree_tol=agree_tol, nucleus=nucleus)
    if not proved:
        if has_cue:
            return fail('aligner-failed', 'в строке не осталось букв')
        return fail('text-not-found', 'в строке не осталось букв')
    paths = _path_counts(proved)
    if line_share is None:
        first = next((word for word in proved if word['path'] == 'fail'), None)
        if first:
            return {'pass': False, 'reason': first['reason'], 'detail': first['detail'], 'second': second,
                    'paths': paths, 'word_proof': proved}
        return {'pass': True, 'reason': 'pass', 'detail': '', 'second': second, 'paths': paths, 'word_proof': proved}
    lettered = [word for word in (align_words or []) if word.get('roman')]
    flags: list[str | None] = []
    for word, item in zip(lettered, proved):
        why = word_refuted(word, peaks, refute)
        item['refuted'] = why
        flags.append(why)
    first_why = next((why for why in flags if why), None)
    if first_why:
        return {'pass': False, 'reason': 'word-refuted', 'detail': _refute_detail(first_why, refute),
                'second': second, 'paths': paths, 'word_proof': proved}
    if line_word_ok(proved, flags, float(line_share), line_min_words):
        return {'pass': True, 'reason': 'pass', 'detail': '', 'second': second, 'paths': paths, 'word_proof': proved}
    got = sum(1 for word in proved if word.get('path') != 'fail')
    return {'pass': False, 'reason': 'word-share',
            'detail': f'{got} из {len(proved)} при доле {float(line_share):.2f}, нужно не меньше {line_min_words}',
            'second': second, 'paths': paths, 'word_proof': proved}


def build_proof(sig: Signals, lines: list[tuple[dict, dict]], qa_rows: list[dict], align_report: dict | None,
                cues: dict | None = None, word_rule: dict | None = None) -> dict:
    """Per-line pass/fail. Headline numbers are pre-snap only; published times may already be snapped.

    `cues` is the official subtitle file keyed by line id. The cue check reads it here, not the
    published word time, so a line that kept its cue cannot agree with itself.
    """
    cues = cues or {}
    rule = default_word_rule() if word_rule is None else word_rule
    by_id = {r['id']: r for r in align_report.get('lines', [])} if align_report else {}
    height = float(rule.get('peak_height', PEAK_HEIGHT))
    global_mode = rule.get('witnesses') if rule.get('witnesses') in ('one', 'two') else None
    agree_tol = float(rule.get('agree_tol', SECOND_WORD_TOL))
    line_share = None if rule.get('line_share') is None else float(rule['line_share'])
    line_min = int(rule.get('line_min_words') or 2)
    refute = rule.get('refute') if line_share is not None else None
    scoped = bool(rule.get('scopes'))
    song = rule.get('song')
    peaks = onset_peak_times(sig, min_height=height)
    if rule.get('require_rise'):
        peaks = peaks_on_rise(sig, peaks, height)
    fill_on = bool(rule.get('attack_fill'))
    line_fill = set(rule.get('line_fill') or [])
    line_nucleus = set(rule.get('line_nucleus') or [])
    line_placed_clock = set(rule.get('line_placed_clock') or [])
    report_summary = (align_report or {}).get('summary') or {}
    placement_model = report_summary.get('placement_model') or report_summary.get('stable_model')
    proof_models = report_summary.get('proof_models') or {}
    env_for_choir = rule.get('choir_attack') == 'envelope'
    env_peaks = envelope_peak_times(sig, min_height=height) if (env_for_choir or fill_on or line_fill) else None
    choir_vowel = rule.get('choir_clock') == 'vowel'
    rows = []
    prev_ctc: float | None = None
    ordered_ids = [line['id'] for _, line in lines]
    for index, ((sec, line), _qa) in enumerate(zip(lines, qa_rows)):
        rec = by_id.get(line['id'])
        words = line['words']
        kind = T.group(sec, line)
        tol = float(rule['choir_tol']) if kind == 'choir' else float(rule['tol'])
        text_same = bool(rec) and rec.get('text') == T.line_text(line)
        align_words = apply_rule_times(_lettered(rec.get('words') if rec else None, len(words)), line.get('lang'), rule)
        phone_role, phone_model = phoneme_for(rule, song, line.get('lang'))
        override = (rule.get('line_roles') or {}).get(line['id'])
        if override in ('off', 'or', 'only'):
            phone_role = override
            if override == 'off':
                phone_model = None
        alt_phone = (rule.get('line_phone_model') or {}).get(line['id'])
        if alt_phone and phone_role in ('or', 'only'):
            phone_model = alt_phone
        align_words = stamp_phoneme(
            align_words, phone_role, phone_model,
            choir_vowel=bool(choir_vowel and kind == 'choir'))
        use_nucleus = line['id'] in line_nucleus
        if use_nucleus and align_words:
            stamped = []
            for aw in align_words:
                item = dict(aw)
                if item.get('vowel_s') is None:
                    table = item.get('vowel_models') or {}
                    clock = None
                    for name in ('xlsr-53-espeak', 'lv-60-espeak'):
                        if table.get(name) is not None:
                            clock = float(table[name])
                            break
                    if clock is None and phone_model and table.get(phone_model) is not None:
                        clock = float(table[phone_model])
                    item['vowel_s'] = clock
                stamped.append(item)
            align_words = stamped
        stable_model = (rule.get('line_stable') or {}).get(line['id'])
        if stable_model and align_words:
            swapped = []
            for aw in align_words:
                item = dict(aw)
                if item.get('third_kind') == 'stable-ts':
                    clock = (item.get('stable_models') or {}).get(stable_model)
                    if clock is not None:
                        item['third_s'] = float(clock)
                        item['clock_stable'] = float(clock)
                swapped.append(item)
            align_words = swapped
        if line['id'] in line_placed_clock and align_words:
            stamped = [dict(item) for item in align_words]
            P.stamp_placed_clock(
                stamped, (rec or {}).get('placed_by'),
                proof_models.get(line.get('lang')), placement_model)
            align_words = stamped
        line_peaks = env_peaks if kind == 'choir' and env_for_choir and env_peaks is not None else peaks
        fallback = env_peaks if (fill_on or line['id'] in line_fill) else None
        cue = cues.get(line['id'])
        cue_start = float(cue['start']) if cue and cue.get('start') is not None else None
        ctc_line = None
        for aw in align_words or []:
            if aw.get('roman') and aw.get('ctc_s') is not None:
                ctc_line = float(aw['ctc_s'])
                break
        cue_tol = None
        half = rule.get('translation_half')
        wide_ids = rule.get('line_wide')
        wide_ok = wide_ids is None or line['id'] in wide_ids
        if (half is not None and wide_ok and cue is not None and ctc_line is not None and cue_start is not None
                and P.cue_is_translation(line.get('lang'), cue.get('lang'))):
            prev_cue = next((cues[ordered_ids[j]].get('end') for j in range(index - 1, -1, -1)
                             if ordered_ids[j] in cues and cues[ordered_ids[j]].get('end') is not None), None)
            next_cue = next((cues[ordered_ids[j]].get('start') for j in range(index + 1, len(ordered_ids))
                             if ordered_ids[j] in cues and cues[ordered_ids[j]].get('start') is not None), None)
            if P.in_translation_window(ctc_line, cue_start, prev_cue, next_cue, float(half)):
                cue_tol = float(half)
        presnap: list[float | None] = []
        abs_pre: list[float] = []
        agree: list[float] = []
        for aw in align_words:
            if not aw.get('roman') or aw.get('ctc_s') is None:
                presnap.append(None)
                continue
            t = float(aw['ctc_s'])
            owned = None if prev_ctc is None else prev_ctc + tol
            if fallback is not None:
                dt = fill_attack(t, line_peaks, fallback, owned, tol)
            else:
                dt = nearest_attack(t, line_peaks, owned)
            presnap.append(None if dt is None else dt)
            if dt is not None:
                abs_pre.append(abs(dt))
            if aw.get('second_s') is not None:
                agree.append(abs(float(aw['second_s']) - t))
            prev_ctc = t
        mode = witnesses_for(rule, song, line.get('lang'))
        if line_share is not None and mode is None:
            mode = 'two'
        elif mode is None:
            mode = global_mode
        placed_by = (rec or {}).get('placed_by')
        blocked = set(rule.get('blocked_primaries') or [])
        if placed_by and P.primary_family(placed_by) in blocked and (rec or {}).get('status') == 'good':
            decision = {
                'pass': False, 'reason': 'primary-chance',
                'detail': f"постановщик {P.primary_family(placed_by)} исключён: случайный проход строки выше 5 %",
                'second': second_status(align_words, tol), 'paths': {}, 'word_proof': [],
            }
        else:
            decision = proof_line(kind, rec.get('status') if rec else None, text_same, presnap, align_words or None, align_report is not None,
                              cue_start=cue_start, ctc_line_start=ctc_line,
                              structure_ok=True if rec is None else bool(rec.get('structure_ok', True)),
                              tol=tol, require_second=bool(rule.get('require_second')) and not mode,
                              witnesses=mode, agree_tol=agree_tol, peaks=line_peaks, refute=refute,
                              line_share=line_share, line_min_words=line_min, cue_tol=cue_tol,
                              nucleus=use_nucleus)
        found_line = (rec or {}).get('status') in ('good', 'weak')
        cue_delta = None
        if found_line and cue_start is not None and ctc_line is not None:
            cue_delta = round(abs(ctc_line - cue_start), 3)
        rows.append({
            'id': line['id'], 'lang': line.get('lang'), 'solo': kind == 'solo', 'group': kind,
            'pass': decision['pass'], 'reason': decision['reason'],
            'detail': decision['detail'], 'second': decision.get('second', ''), 'engine': (rec or {}).get('second'),
            'paths': decision.get('paths') or {}, 'word_proof': decision.get('word_proof') or [],
            'ctc': (rec or {}).get('status'), 'placed_by': placed_by, 'start': words[0]['s'],
            'cue_start': cue_start, 'cue_delta': cue_delta,
            'window': (rec or {}).get('second_window'),
            'onset_abs': [round(a, 3) for a in abs_pre] if decision['pass'] else [],
            'presnap_abs': [round(a, 3) for a in abs_pre] if decision['pass'] else [],
            'agree_abs': [round(a, 3) for a in agree] if decision['pass'] else [],
            'presnap_max': round(max(abs_pre), 3) if abs_pre else None,
            'aligner_max': round(max(agree), 3) if agree else None,
        })
    solo_rows = [r for r in rows if r['group'] == 'solo']
    choir_rows = [r for r in rows if r['group'] == 'choir']
    passed = [r for r in solo_rows if r['pass']]
    choir_passed = [r for r in choir_rows if r['pass']]
    solo_onset, solo_agree, solo_med, solo_p90, solo_amed, solo_ap90 = _group_spread(passed)
    choir_onset, choir_agree, choir_med, choir_p90, choir_amed, choir_ap90 = _group_spread(choir_passed)
    # Headline numbers stay the solo group when it has proved words, so a report that only
    # prints them does not mix the 0.10 s and 0.20 s gates. The text below names each group.
    if solo_onset:
        onset, agreed = solo_onset, solo_agree
        onset_median, onset_p90, agree_median, agree_p90 = solo_med, solo_p90, solo_amed, solo_ap90
    elif choir_onset:
        onset, agreed = choir_onset, choir_agree
        onset_median, onset_p90, agree_median, agree_p90 = choir_med, choir_p90, choir_amed, choir_ap90
    else:
        onset, agreed = [], []
        onset_median = onset_p90 = agree_median = agree_p90 = None
    aligned = song_ready([(len(passed), len(solo_rows)), (len(choir_passed), len(choir_rows))])
    reasons: dict[str, int] = {}
    for r in rows:
        if not r['pass']:
            reasons[r['reason']] = reasons.get(r['reason'], 0) + 1
    failed_solo = [r for r in solo_rows if not r['pass']]
    failed_choir = [r for r in choir_rows if not r['pass']]
    worst = sorted(failed_solo + failed_choir, key=lambda r: (-(r.get('cue_delta') or 0), -(r['aligner_max'] or 0), -(r['presnap_max'] or 0), r['start']))[:15]
    cue_vals = [r['cue_delta'] for r in rows if r.get('cue_delta') is not None]
    found = sum(1 for r in rows if r.get('ctc') in ('good', 'weak'))
    placed = sum(1 for r in rows if r.get('ctc') == 'good')
    weak = sum(1 for r in rows if r.get('ctc') == 'weak')
    missing = [r for r in rows if r['reason'] == 'text-not-found']
    aligner_failed = [r for r in rows if r['reason'] == 'aligner-failed']
    by_lang: dict[str, dict] = {}
    word_paths = {
        'attack': 0, 'second': 0, 'fail': 0,
        'witness-second': 0, 'witness-third': 0, 'witness-both': 0, 'witness-phoneme': 0,
        'nucleus': 0,
    }
    consonant: list[float | None] = []
    soft: list[float | None] = []
    for r in rows:
        lang = r.get('lang') or '?'
        bucket = by_lang.setdefault(lang, {'n': 0, 'placed': 0, 'proved': 0, 'words': 0, 'refuted': 0})
        bucket['n'] += 1
        if r.get('ctc') == 'good':
            bucket['placed'] += 1
            for word in r.get('word_proof') or []:
                key = word['path'] if word['path'] in word_paths else 'fail'
                word_paths[key] += 1
                (soft if word['soft'] else consonant).append(word['abs'])
                bucket['words'] += 1
                if word.get('refuted'):
                    bucket['refuted'] += 1
        if r.get('pass'):
            bucket['proved'] += 1
    return {
        'aligned': aligned, 'solo': len(solo_rows), 'passed': len(passed), 'failed_solo': len(failed_solo),
        'choir': len(choir_rows), 'choir_passed': len(choir_passed), 'failed_choir': len(failed_choir),
        'lines_n': len(rows), 'reasons': reasons, 'lines': rows, 'worst': worst, 'missing': missing,
        'word_tol': float(rule['tol']), 'choir_tol': float(rule['choir_tol']), 'line_tol': TOL, 'song_share': SONG_SHARE,
        'word_rule': rule.get('name'), 'peak_height': height,
        'require_rise': bool(rule.get('require_rise')), 'require_second': bool(rule.get('require_second')),
        'witnesses': 'scoped' if scoped else global_mode, 'agree_tol': agree_tol,
        'line_share': line_share, 'line_chance': rule.get('line_chance'), 'refute': refute,
        'onset_median': onset_median, 'onset_p90': onset_p90, 'onset_words': len(onset),
        'presnap_median': onset_median, 'presnap_p90': onset_p90,
        'agree_median': agree_median, 'agree_p90': agree_p90,
        'solo_onset_median': solo_med, 'solo_onset_p90': solo_p90, 'solo_onset_words': len(solo_onset),
        'solo_agree_median': solo_amed, 'solo_agree_p90': solo_ap90,
        'choir_onset_median': choir_med, 'choir_onset_p90': choir_p90, 'choir_onset_words': len(choir_onset),
        'choir_agree_median': choir_amed, 'choir_agree_p90': choir_ap90,
        'found': found, 'placed': placed, 'weak': weak, 'cue_n': len(cue_vals),
        'cue_tol': PROOF_CUE_TOL, 'publish_cue_tol': CUE_TOL,
        'cue_median': round(float(np.median(cue_vals)), 3) if cue_vals else None,
        'aligner_failed': aligner_failed, 'by_lang': by_lang,
        'fill_lines': len(passed) + len(choir_passed),
        'placed_by': _placed_by_counts(rows),
        'word_paths': word_paths,
        'attack_fill': fill_on,
        'onset_consonant': _onset_stat(consonant), 'onset_soft': _onset_stat(soft),
    }


def _placed_by_counts(rows: list[dict]) -> dict[str, int]:
    """Who placed the lines that are `good`. The cue-kept lines have no placer."""
    counts: dict[str, int] = {}
    for row in rows:
        if row.get('ctc') != 'good' or not row.get('placed_by'):
            continue
        if row.get('group') not in ('solo', 'choir'):
            continue
        name = str(row['placed_by'])
        counts[name] = counts.get(name, 0) + 1
    return counts


def _onset_stat(vals: list[float | None]) -> dict:
    """n, how many have no attack closer than 0.30 s, and median/p90 of the distances that exist."""
    known = [float(v) for v in vals if v is not None]
    if not known:
        median = p90 = None
    else:
        median = round(float(np.median(known)), 3)
        p90 = round(float(np.percentile(known, 90)), 3)
    return {
        'n': len(vals),
        'no_near': sum(1 for v in vals if v is None or v >= ATTACK_NEAR),
        'median': median, 'p90': p90,
    }


def _group_spread(passed: list[dict]) -> tuple[list[float], list[float], float | None, float | None, float | None, float | None]:
    """Pre-snap onset and aligner distances for one group's proved lines, plus median and p90."""
    onset = [a for r in passed for a in r['presnap_abs']]
    agreed = [a for r in passed for a in r['agree_abs']]

    def stat(vals: list[float]) -> tuple[float | None, float | None]:
        if not vals:
            return None, None
        return round(float(np.median(vals)), 3), round(float(np.percentile(vals, 90)), 3)

    omed, op90 = stat(onset)
    amed, ap90 = stat(agreed)
    return onset, agreed, omed, op90, amed, ap90


def _share_text(passed: int, n: int) -> str:
    if not n:
        return '—'
    return f"{100.0 * passed / n:.1f}".replace('.', ',')


def _groups_sentence(proof: dict) -> str:
    """Counts per group. An empty group is left out so a solo-only song is not described as a choir."""
    bits = []
    solo_n = proof.get('solo') or 0
    choir_n = proof.get('choir') or 0
    if solo_n:
        bits.append(f"соло {proof.get('passed', 0)} из {solo_n} ({_share_text(proof.get('passed', 0), solo_n)} %)")
    if choir_n:
        bits.append(f"хор {proof.get('choir_passed', 0)} из {choir_n} ({_share_text(proof.get('choir_passed', 0), choir_n)} %)")
    if not bits:
        bits.append(f"соло {proof.get('passed', 0)} из {solo_n}")
    return '; '.join(bits)


def _num(x: float | None) -> str:
    return '—' if x is None else f"{x:.3f}".replace('.', ',')


def timing_payload(slug: str, proof: dict, align_report: dict | None) -> dict:
    """song.json timing after the check. `aligned` only when every existing group is proved."""
    engines_used = sorted({r['engine'] for r in proof['lines'] if r.get('engine')})
    method = 'mms-fa' + ''.join('+' + e for e in engines_used) if align_report else None
    reasons = ', '.join(f'{REASON_RU.get(k, k)} {v}' for k, v in sorted(proof['reasons'].items(), key=lambda kv: -kv[1]))
    groups = _groups_sentence(proof)
    solo_med = proof.get('solo_onset_median', proof.get('onset_median'))
    solo_p90 = proof.get('solo_onset_p90', proof.get('onset_p90'))
    if proof['aligned']:
        wt = proof.get('word_tol', WORD_TOL)
        ct = proof.get('choir_tol', CHOIR_TOL)
        notes = (f"qa_sync: {groups}, порог песни {song_share_label()} % в каждой группе, где она есть. "
                 f"Соло, до притяжения: медиана {_num(solo_med)} с, 90-й перцентиль {_num(solo_p90)} с (порог {_num(wt)} с). ")
        if proof.get('choir'):
            notes += (f"Хор, до притяжения: медиана {_num(proof.get('choir_onset_median'))} с, "
                      f"90-й перцентиль {_num(proof.get('choir_onset_p90'))} с (порог {_num(ct)} с). ")
        notes += ("Цифры посчитаны до притяжения; записанное время может стоять на атаке. "
                  f"Остальные строки с флагом timing-draft. Отчёт: docs/analysis/{slug}-qa.md.")
        status = 'aligned'
    else:
        notes = (f"qa_sync: критерий не пройден, статус оставлен draft. "
                 f"{groups}, нужно не меньше {song_share_label()} % в каждой группе, где она есть. "
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


def _group_name(row: dict) -> str:
    return {'solo': 'соло', 'choir': 'хор'}.get(row.get('group') or '', 'не соло')


def proof_md(proof: dict) -> list[str]:
    L = []
    failed = proof['failed_solo'] + proof.get('failed_choir', 0)
    L.append(f"**{'Критерий песни пройден' if proof['aligned'] else 'Критерий песни не пройден'}.** "
             f"Порог песни: не меньше {song_share_label()} % в каждой группе, где она есть ({_groups_sentence(proof)}). "
             f"Строка, где текст не найден в голосе, в доказанные не входит. "
             f"Не доказано в этих группах: {failed}; всего вокальных строк: {proof['lines_n']}.")
    L.append('')
    L.append('Pass/fail и цифры ниже считаются до притяжения начала слова к атаке. '
             'Притяжение (не дальше 0,1 с) может сдвинуть записанное время на пик, но в эти цифры не входит. '
             'Окно поиска строки — официальная реплика с запасом; черновые s/e окном не служат. '
             'Строка без реплики ищется по своей вокальной секции. '
             'Окно второго выравнивателя — фраза, которую первый проход уже поставил, плюс до 2 с, '
             'но не дальше соседней строки (её поставленного края или реплики) и не длиннее 12 с. '
             'Фразу, которая уже стоит вне своей секции, окно в секцию не затаскивает. '
             'Соло и хор ниже посчитаны отдельно: пороги 0,1 с и 0,2 с в одну цифру не смешиваются.')
    wt = proof.get('word_tol', WORD_TOL)
    ct = proof.get('choir_tol', CHOIR_TOL)
    rule_name = proof.get('word_rule') or 'tol-0.10-h0.5'
    extra = []
    if proof.get('require_rise'):
        extra.append('атака только на подъёме энергии')
    if proof.get('witnesses') == 'one':
        extra.append('сильная атака и хотя бы один независимый выравниватель в пределах 0,10 с')
    elif proof.get('witnesses') == 'two':
        extra.append('сильная атака и оба независимых выравнивателя в пределах 0,10 с')
    elif proof.get('witnesses') == 'scoped':
        extra.append('сильная атака и один или оба свидетеля, как решено для песни и языка')
    elif proof.get('require_second'):
        extra.append('нужно согласие второго выравнивателя')
    if proof.get('line_share') is not None:
        extra.append(f"строка при доле доказанных слов {ru(float(proof['line_share']))} и без опровержений")
    extra_bit = (', ' + ', '.join(extra)) if extra else ''
    L.append(f"- Поставлено: {proof.get('placed', 0)} из {proof['lines_n']} "
             f"(у строки с репликой — структурные проверки и |Δ| ≤ {ru(PROOF_CUE_TOL)} с; "
             f"оценка MMS в отчёте и строку не бракует). "
             f"Путь есть, но строка не поставлена: {proof.get('weak', 0)}. "
             f"|начало строки − начало реплики|: медиана {_fmt_opt(proof.get('cue_median'))} с "
             f"по {proof.get('cue_n', 0)} строкам, где путь есть и реплика есть. "
             f"Дальше {ru(proof.get('cue_tol', PROOF_CUE_TOL))} с строка не поставлена и не доказана. "
             f"На сайт время выравнивателя пишется только у поставленной строки; "
             f"у непоставленной с репликой первое слово начинается с реплики.")
    L.append(f"- Правило слова: `{rule_name}`, атака {ru(wt)} с у соло и {ru(ct)} с у хора"
             f"{extra_bit}. Сила пика {ru(proof.get('peak_height', PEAK_HEIGHT))}.")
    L.append(f"- Соло, только доказанные строки, до притяжения. Атака: медиана {_fmt_opt(proof.get('solo_onset_median', proof.get('onset_median')))} с, "
             f"90-й перцентиль {_fmt_opt(proof.get('solo_onset_p90', proof.get('onset_p90')))} с, порог {ru(wt)} с, "
             f"слов {proof.get('solo_onset_words', proof.get('onset_words', 0))}. "
             f"Второй выравниватель, где поставил время (порог не решает): медиана {_fmt_opt(proof.get('solo_agree_median', proof.get('agree_median')))} с, "
             f"90-й перцентиль {_fmt_opt(proof.get('solo_agree_p90', proof.get('agree_p90')))} с.")
    if proof.get('choir'):
        L.append(f"- Хор, отдельно. Атака: медиана {_fmt_opt(proof.get('choir_onset_median'))} с, "
                 f"90-й перцентиль {_fmt_opt(proof.get('choir_onset_p90'))} с, порог {ru(ct)} с, "
                 f"слов {proof.get('choir_onset_words', 0)}. "
                 f"Второй выравниватель, где поставил время: медиана {_fmt_opt(proof.get('choir_agree_median'))} с, "
                 f"90-й перцентиль {_fmt_opt(proof.get('choir_agree_p90'))} с.")
    asked = [r for r in proof['lines'] if r.get('group') in ('solo', 'choir') and r.get('ctc') == 'good']
    if asked:
        names = (('agree', 'сошёлся'), ('disagree', 'разошёлся'), ('partial', 'поставил не все слова'), ('absent', 'времени нет'))
        bits = [f"{label} {sum(1 for r in asked if r.get('second') == key)}" for key, label in names]
        if proof.get('witnesses'):
            if proof.get('witnesses') == 'one':
                who = 'хотя бы один из двух независимых выравнивателей'
            elif proof.get('witnesses') == 'scoped':
                who = 'столько независимых выравнивателей, сколько требует язык этой строки'
            else:
                who = 'оба независимых выравнивателя'
            L.append('- Второй выравниватель на поставленных строках: ' + ', '.join(bits) + '. '
                     f'Слово доказано, когда атака сильная и {who} '
                     'совпадает с началом того, кто поставил строку, не дальше 0,10 с. '
                     'Сам постановщик себе свидетелем не служит. Путь без атаки при этом правиле закрыт. '
                     'Если для языка допущен фонемный свидетель, роль «или» добавляет его начало к уже нужным часам, '
                     'а роль «только он» доказывает слово атакой и одним фонемным началом. '
                     'Фонемные часы строку не ставят и слово не опровергают.')
        else:
            L.append('- Второй выравниватель на поставленных строках: ' + ', '.join(bits) + '. '
                     'Доказательством он служит только у слова на гласную или связного, если атаки ближе 0,3 с нет, '
                     'и только когда его начало не дальше 0,10 с. Для согласной атака по-прежнему нужна.')
    if proof.get('attack_fill'):
        L.append('- Атака. Где спектрального пика внутри допуска группы нет, слово может опереться '
                 'на пик огибающей внутри того же допуска. Спектральный пик внутри допуска остаётся. '
                 'Огибающая слово не опровергает и строку не ставит.')
    L.append(f"- Сдвиг строки целиком — отдельная тревога с порогом {ru(TOL)} с. В pass/fail слова он не входит.")
    paths = proof.get('word_paths') or {}
    if proof.get('witnesses'):
        L.append(f"- Слова на поставленных строках. Только второй свидетель: {paths.get('witness-second', 0)}. "
                 f"Только третий (stable-ts): {paths.get('witness-third', 0)}. "
                 f"Оба: {paths.get('witness-both', 0)}. "
                 f"Фонемный свидетель: {paths.get('witness-phoneme', 0)}. "
                 f"Не доказано: {paths.get('fail', 0)}. "
                 f"Интерполяция между соседними словами доказательством не считается.")
    else:
        L.append(f"- Слова на поставленных строках. Доказано атакой: {paths.get('attack', 0)}. "
                 f"Доказано вторым выравнивателем: {paths.get('second', 0)}. "
                 f"Не доказано: {paths.get('fail', 0)}. "
                 f"Интерполяция между соседними словами доказательством не считается.")
    placed_by = proof.get('placed_by') or {}
    if placed_by:
        bits = ', '.join(f'{name} — {n}' for name, n in sorted(placed_by.items()))
        L.append(f"- Кто поставил: {bits}. "
                 f"Окно MMS и стем htdemucs_ft записаны отдельно и в доказательстве считаются одним постановщиком.")
    if proof.get('line_share') is not None:
        L.append(f"- Если бы пословная заливка включалась по строке, а не на всю песню, её получили бы "
                 f"{proof.get('fill_lines', 0)} строк: начало не дальше 0,3 с от реплики, "
                 f"ни одного опровергнутого слова и не меньше {ru(float(proof['line_share']))} доказанных слов "
                 f"(не меньше двух). "
                 f"Сайт так не делает: заливка включается на всю песню, когда статус не draft, "
                 f"и не горит у строки с флагом timing-draft.")
    else:
        L.append(f"- Если бы пословная заливка включалась по строке, а не на всю песню, её получили бы "
                 f"{proof.get('fill_lines', 0)} строк — только доказанные. "
                 f"Сайт так не делает: заливка включается на всю песню, когда статус не draft, "
                 f"и не горит у строки с флагом timing-draft.")
    if proof['reasons']:
        bits = ', '.join(f"{REASON_RU.get(k, k)} — {v}" for k, v in sorted(proof['reasons'].items(), key=lambda kv: -kv[1]))
        L.append(f"- Почему строки не доказаны: {bits}.")
    L.append('')
    L.append('## По языкам')
    L.append('')
    if proof.get('line_share') is not None:
        L.append('Поставлено у строки с репликой — структура и |Δ| ≤ 0,3 с. Оценка строку не бракует. '
                 f"Доказано — поставленная строка соло или хора, у которой ни одно слово не опровергнуто "
                 f"и доказано не меньше {ru(float(proof['line_share']))} слов (не меньше двух). "
                 'Опровергнуто — слова поставленных строк, у которых свидетели сходятся в стороне от MMS.')
        L.append('')
        L.append('| язык | строк | поставлено | доказано | слов | опровергнуто слов |')
        L.append('|---|---:|---:|---:|---:|---:|')
        for lang, bucket in sorted((proof.get('by_lang') or {}).items()):
            L.append(f"| {lang} | {bucket['n']} | {bucket['placed']} | {bucket['proved']} | "
                     f"{bucket.get('words', 0)} | {bucket.get('refuted', 0)} |")
    else:
        L.append('Поставлено у строки с репликой — структура и |Δ| ≤ 0,3 с. Оценка строку не бракует. Доказано — поставленная строка, у которой прошло каждое слово.')
        L.append('')
        L.append('| язык | строк | поставлено | доказано |')
        L.append('|---|---:|---:|---:|')
        for lang, bucket in sorted((proof.get('by_lang') or {}).items()):
            L.append(f"| {lang} | {bucket['n']} | {bucket['placed']} | {bucket['proved']} |")
    if not proof.get('by_lang'):
        if proof.get('line_share') is not None:
            L.append('| — | 0 | 0 | 0 | 0 | 0 |')
        else:
            L.append('| — | 0 | 0 | 0 |')
    L.append('')
    cons = proof.get('onset_consonant') or {}
    soft = proof.get('onset_soft') or {}
    L.append('## Атаки на поставленных строках')
    L.append('')
    L.append('Расстояние от начала слова до притяжения до ближайшей своей атаки. '
             '«Нет ближе 0,3 с» — атаки в этом окне нет, в том числе когда ближайшая атака дальше. '
             'Медиана и 90-й перцентиль — только по словам, у которых атака где-то нашлась.')
    L.append('')
    L.append('| слова | n | нет атаки ближе 0,3 с | медиана | 90-й |')
    L.append('|---|---:|---:|---:|---:|')
    L.append(f"| на согласную | {cons.get('n', 0)} | {cons.get('no_near', 0)} | {_fmt_opt(cons.get('median'))} | {_fmt_opt(cons.get('p90'))} |")
    L.append(f"| на гласную или связные | {soft.get('n', 0)} | {soft.get('no_near', 0)} | {_fmt_opt(soft.get('median'))} | {_fmt_opt(soft.get('p90'))} |")
    L.append('')
    soft_n = int(soft.get('n') or 0)
    soft_far = int(soft.get('no_near') or 0)
    if soft_n == 0:
        L.append('Поставленных строк со словами нет, поэтому про систематический пропуск атаки на легато сказать нечего.')
    elif soft_far * 2 >= soft_n:
        L.append('У гласных и связных атака ближе 0,3 с отсутствует не реже чем в половине слов. '
                 'Для них основной путь доказательства — второй выравниватель, а не атака.')
    else:
        L.append('У гласных и связных атака ближе 0,3 с чаще есть. '
                 'Путь через второй выравниватель посчитан и на этих данных не главный.')
    L.append('')
    L.append('## Худшие места')
    L.append('')
    L.append('Строки соло и хора, которые проверка не доказала. Дуэт и тутти в этот список не входят. '
             'Время — начало строки в записи, чтобы его можно было прослушать. Расхождения — до притяжения.')
    L.append('')
    if proof['worst']:
        for r in proof['worst']:
            extra = f", {r['detail']}" if r['detail'] else ''
            bits = []
            if r.get('aligner_max') is not None:
                bits.append(f"выравниватели до {ru(r['aligner_max'], 3)} с")
            if r.get('presnap_max') is not None:
                bits.append(f"атака до притяжения до {ru(r['presnap_max'], 3)} с")
            if r.get('cue_delta') is not None:
                bits.append(f"реплика {ru(r['cue_delta'], 3)} с")
            if r.get('window'):
                w0, w1 = r['window']
                bits.append(f"окно {ru(w0, 1)}–{ru(w1, 1)} с")
            more = f" ({'; '.join(bits)})" if bits else ''
            L.append(f"- `{r['id']}` ({_group_name(r)}) {fmt_t(r['start'])} — {REASON_RU.get(r['reason'], r['reason'])}{extra}{more}")
    else:
        L.append('Нет строк соло и хора с отказом.')
    L.append('')
    L.append('## Текст не найден в голосе')
    L.append('')
    L.append('Только строки без реплики, у которых постановки нет или путь не прошёл структурные проверки. '
             'Слова в `lyrics.json`, скорее всего, не те, что поются. Текст здесь не менялся.')
    L.append('')
    if proof['missing']:
        for r in proof['missing']:
            L.append(f"- `{r['id']}` {fmt_t(r['start'])} ({_group_name(r)})")
    else:
        L.append('Нет.')
    L.append('')
    L.append('## Выравниватель не справился')
    L.append('')
    L.append('У этих строк есть официальная реплика. Постановки нет, либо путь не прошёл структурные проверки и с репликой не сошёлся. '
             'Слова сверены с субтитрами и здесь не называются неверными. Текст не менялся.')
    L.append('')
    failed_align = proof.get('aligner_failed') or []
    if failed_align:
        for r in failed_align:
            extra = f" — {r['detail']}" if r.get('detail') else ''
            L.append(f"- `{r['id']}` {fmt_t(r['start'])} ({_group_name(r)}){extra}")
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
    wt = (proof or {}).get('word_tol', WORD_TOL)
    ct = (proof or {}).get('choir_tol', CHOIR_TOL)
    witness_mode = (proof or {}).get('witnesses')
    if witness_mode == 'one':
        word_rule_text = (f"Слово доказано сильной атакой и согласием хотя бы одного независимого выравнивателя "
                          f"в пределах {ru((proof or {}).get('agree_tol', SECOND_WORD_TOL))} с от начала MMS.")
    elif witness_mode == 'two':
        word_rule_text = (f"Слово доказано сильной атакой и согласием обоих независимых выравнивателей "
                          f"в пределах {ru((proof or {}).get('agree_tol', SECOND_WORD_TOL))} с от начала MMS.")
    elif witness_mode == 'scoped':
        share = (proof or {}).get('line_share')
        share_bit = '' if share is None else f" Строка доказана при доле таких слов {ru(float(share))} и без опровержений."
        word_rule_text = ("Слово доказано сильной атакой и согласием одного или обоих независимых выравнивателей, "
                          f"как решено для этой песни и языка.{share_bit}")
    else:
        word_rule_text = (f"Слово на гласную или связное без атаки ближе {ru(ATTACK_NEAR)} с доказывается вторым выравнивателем "
                          f"в пределах {ru(SECOND_WORD_TOL)} с.")
    L.append(f"Проверка `qa_sync.py` от {meta['date']}. Аудио: `{meta['audio']}`{'' if meta['stem'] else ' (полный микс — вокального стема нет, точность ниже)'}. "
             f"Текст: `{meta['lyrics']}`. "
             f"Порог доказательства слова: {ru(wt)} с для соло и {ru(ct)} с для хора — атака до притяжения. "
             f"{word_rule_text} "
             f"Начало строки против реплики — {ru(PROOF_CUE_TOL)} с. У строки с репликой оценка MMS строку не бракует. "
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
        L.append('| строка | начало | отрывок | группа | сдвиг строки, с | без голоса | вердикт сдвига | решение |')
        L.append('|---|---|---|---|---|---|---|---|')
    else:
        L.append('| строка | начало | текст | сдвиг, с | без голоса | вердикт |')
        L.append('|---|---|---|---|---|---|')
    for r in results:
        if dec:
            d = dec.get(r['id']) or {'group': 'other', 'reason': 'no-report'}
            excerpt = r['text'] if len(r['text']) <= 32 else r['text'][:30] + '…'
            L.append(f"| `{r['id']}` | {fmt_t(r['start'])} | {excerpt} | {_group_name(d)} | {r['offset']:+.2f} | "
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


def reject_wide_translation(lyrics: dict, align_report: dict | None, rule: dict | None,
                            cues: dict) -> int:
    """Pull a translation line back onto its cue when the measured window does not cover it.

    The report stops being placed, so the proof does not treat a far start as
    sung time. Same-language lines stay. A file that never measured the window
    (no `translation_half` key) is left alone: those lines were aligned at 0.30 s.
    """
    if not rule or not rule.get('translation_measured') or not align_report:
        return 0
    half = rule.get('translation_half')
    allowed = rule.get('line_wide')
    allowed_ids = None if allowed is None else set(allowed)
    by_id = {rec.get('id'): rec for rec in align_report.get('lines') or []}
    vocal = list(T.vocal_lines(lyrics))
    ids = [line['id'] for _sec, line in vocal]
    moved = 0
    for index, (_sec, line) in enumerate(vocal):
        cue = cues.get(line['id'])
        words = line.get('words') or []
        if cue is None or cue.get('start') is None or not words:
            continue
        if not P.cue_is_translation(line.get('lang'), cue.get('lang')):
            continue
        cue_s = float(cue['start'])
        published = float(words[0]['s'])
        rec = by_id.get(line['id'])
        ctc = None if rec is None else rec.get('ctc_start')
        if ctc is None and rec is not None:
            for word in rec.get('words') or []:
                if word.get('roman') and word.get('ctc_s') is not None:
                    ctc = word.get('ctc_s')
                    break
        far_published = round(abs(published - cue_s), 3) > PROOF_CUE_TOL
        far_ctc = ctc is not None and round(abs(float(ctc) - cue_s), 3) > PROOF_CUE_TOL
        if not far_published and not far_ctc:
            continue
        covered = False
        if half is not None and (allowed_ids is None or line['id'] in allowed_ids):
            prev = next(
                (cues[ids[j]].get('end') for j in range(index - 1, -1, -1)
                 if ids[j] in cues and cues[ids[j]].get('end') is not None),
                None)
            nxt = next(
                (cues[ids[j]].get('start') for j in range(index + 1, len(ids))
                 if ids[j] in cues and cues[ids[j]].get('start') is not None),
                None)
            heard = float(ctc) if ctc is not None else published
            covered = P.in_translation_window(heard, cue_s, prev, nxt, float(half))
        if covered:
            continue
        # The aligner already agreed with the cue. A published drift past 0.30 s
        # is rounding, not a missed placement. Leave the proof status and pull
        # only the published excess back inside the gate.
        if ctc is not None and round(abs(float(ctc) - cue_s), 3) <= PROOF_CUE_TOL:
            if far_published:
                sign = 1.0 if published > cue_s else -1.0
                target = T.r2(cue_s + sign * (PROOF_CUE_TOL - 0.01))
                delta = target - published
                if abs(delta) >= 0.001:
                    for word in words:
                        word['s'] = T.r2(float(word['s']) + delta)
                        if word.get('e') is not None:
                            word['e'] = T.r2(float(word['e']) + delta)
                    moved += 1
            continue
        delta = cue_s - published
        if abs(delta) >= 0.001:
            for word in words:
                word['s'] = T.r2(float(word['s']) + delta)
                if word.get('e') is not None:
                    word['e'] = T.r2(float(word['e']) + delta)
        if rec is not None:
            rec['status'] = 'weak'
            rec['placed_by'] = None
        moved += 1
    if moved:
        T.enforce_order(lyrics)
    return moved


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('slug')
    ap.add_argument('--lyrics', default=None, help='lyrics.json to check (default content/songs/<slug>/lyrics.json)')
    ap.add_argument('--audio', default=None)
    ap.add_argument('--tag', default='', help='suffix for the output files: qa-sync-<tag>.{md,json}')
    ap.add_argument('--baseline', default=None, help='an earlier qa-sync json to compare with')
    ap.add_argument('--fix', action='store_true', help='shift lines where the evidence is strong and save lyrics.json')
    ap.add_argument('--apply', action='store_true', help='set timing-draft and song.json timing from the proof; does not change word text. Word times change only when the measurement kept a handoff or a Latin placement')
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
    align_path = work_dir(slug) / 'align-report.json'
    use_report = args.lyrics is None and align_path.exists()
    align_report = json.loads(align_path.read_text(encoding='utf-8')) if use_report else None
    rule = load_word_rule()
    rule['song'] = slug
    if align_report is not None and apply_saved_retime(slug, lyrics, align_report, rule, sig):
        if args.apply:
            align_path.write_text(json.dumps(align_report, ensure_ascii=False, indent=1), encoding='utf-8')

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
    proof = None
    if use_report or args.apply:
        cue_path = ROOT / 'docs' / 'analysis' / slug / 'cues.json'
        cues = {}
        if cue_path.exists():
            cues = {r['line']: r for r in json.loads(cue_path.read_text(encoding='utf-8')) if r.get('line')}
        if args.apply and align_report is not None:
            pulled = reject_wide_translation(lyrics, align_report, rule, cues)
            if pulled:
                align_path.write_text(json.dumps(align_report, ensure_ascii=False, indent=1), encoding='utf-8')
                print(f'переводные реплики вне допущенного окна возвращены на реплику: {pulled}')
        proof = build_proof(sig, lines, results, align_report, cues, word_rule=rule)
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
        choir_bit = ''
        if proof.get('choir'):
            choir_bit = f" · хор {proof.get('choir_passed', 0)} из {proof['choir']}"
        print(f"критерий: {'пройден' if proof['aligned'] else 'не пройден'} · соло {proof['passed']} из {proof['solo']}{choir_bit} · "
              f"найдено {proof.get('found', 0)} · "
              f"до притяжения медиана {_fmt_opt(proof['onset_median'])} с · "
              f"90-й перцентиль {_fmt_opt(proof['onset_p90'])} с · "
              f"|реплика| медиана {_fmt_opt(proof.get('cue_median'))} с")
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
    if proof and (not proof['aligned'] or proof['failed_solo'] or proof.get('failed_choir')):
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
