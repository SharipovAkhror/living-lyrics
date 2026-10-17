"""Stage 5: measure word times by forced alignment of the known text on the vocal stem.

    python3 scripts/pipeline/align.py <slug> [--anchors global|sections|draft] [--margin 6]
                                       [--lines id,id…] [--audio PATH] [--move-sections]
                                       [--dry-run] [--force]

Engine: torchaudio MMS_FA (wav2vec2 CTC aligner trained on 1100+ languages). Its alphabet is Latin
letters, so Arabic-script words are romanised with uroman, and Latin-script words lose their
diacritics (Turkish ş → s, ı → i; German ß → ss).

How it works:
1. Letter posteriors for the whole vocal stem (50 frames per second) are computed once, in 30 s
   chunks with 3 s of context on each side, and cached in work/<slug>/align-emission.npy.
2. Anchor pass — roughly where is each line? By default one Viterbi pass of the whole text over the
   whole song: it needs no draft times at all. `--anchors sections` aligns each vocal section in its
   own window (section bounds ± 15 s) instead; `--anchors draft` trusts the times in lyrics.json.
3. Line pass, in lyrics.json order. Line i is searched in a window that starts where line i-1 ended
   (or `margin` s before its anchor, whichever is later) and ends `margin` s after the anchor end of
   line i+1. Line i+1 is aligned together with it as look-ahead and then discarded, so line i cannot
   take the next line's audio, a repeated line cannot jump to its next occurrence, and an error stays
   inside one line. If a window is too short for its text, the line takes the anchor-pass result.
4. Word ends are extended while the voice still sounds (CTC marks letters, not the held vowel), never
   into the next word; a line's first word may move back to the onset of the phrase (≤ 0.25 s).
5. Confidence per line: `score` (mean posterior of its letters), `gap` (log-likelihood per frame
   between the best unconstrained path and the forced one over the line: near 0 when the text is
   what is sung) and `agree` (distance to the anchor pass). Three outcomes, recorded in the report:
     good  — the text was found; a second aligner is run for solo lines;
     weak  — measured and plausible, but not sure enough to prove;
     draft — the text was not found (wrong words, a verse that is not sung): the draft times stay,
             fitted between the measured neighbours.
   align.py does not decide the flag. It marks every line `timing-draft` and leaves
   `timing.status` at `draft`. qa_sync.py --apply clears the flag only where the pre-snap start
   and a WhisperX start agree with each other and with a vocal attack within 0.1 s. The song
   becomes `aligned` only when at least 80 % of its solo lines are proved that way.

Writes lyrics.json (word s/e and the timing-draft flag; section bounds only with --move-sections),
song.json timing (status stays draft), work/<slug>/align-report.json and work/<slug>/timing.json.
`--dry-run` writes only the two work files.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import unicodedata

import numpy as np

import engines
import features as F
import qa_sync as Q
import timing as T
from ctc import viterbi
from common import dump_json, load_audio, load_json, song_dir, vocal_stem, work_dir

ISO3 = {'ar': 'ara', 'fa': 'fas', 'az': 'aze', 'tr': 'tur', 'ota': 'ota', 'en': 'eng', 'la': 'lat', 'de': 'deu', 'gmh': 'deu',
        'es': 'spa', 'ur': 'urd', 'hi': 'hin', 'ru': 'rus', 'uz': 'uzb', 'fr': 'fra', 'it': 'ita'}
FPS = 50                 # MMS_FA: one frame per 320 samples at 16 kHz
CHUNK_S, CTX_S = 30.0, 3.0
SECTION_PAD = 15.0       # --anchors sections: search this far around the drafted section
MAX_EXTEND = 4.0         # a word end may follow the voice this far
MAX_TOKEN = 0.5          # longest stretch one letter may hold in the CTC path
MAX_WORD_SPAN = 2.5      # longest span from a word's first to its last letter
SNAP_WIN = 0.10          # a word start moves to a clear vocal onset at most this far (the proof gate)
ENGINE_AGREE = 0.10      # the second aligner must put the word start this close to the first
# A line is "good" when all three hold. These are gates, not a fit to one recording.
GOOD_SCORE = 0.30
GOOD_GAP = 1.2
GOOD_AGREE = 0.5
# Below this the text was not found at all (wrong words, a verse not sung, a choir the model cannot
# hear): the measured position is arbitrary, so the line keeps its draft, fitted between neighbours.
KEEP_SCORE = 0.20
KEEP_AGREE = 2.0


# ---------------------------------------------------------------- text → letters

def normalise(text: str) -> str:
    """Latin letters only, lower case. MMS_FA has no apostrophe, so «I've» becomes «ive»."""
    text = text.lower().replace('ı', 'i').replace('ə', 'e').replace('ß', 'ss').replace('æ', 'ae').replace('ø', 'o').replace('œ', 'oe')
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return re.sub(r'[^a-z]', '', text)


class Romaniser:
    """uroman for non-Latin scripts (loaded lazily: it takes a few seconds)."""

    def __init__(self) -> None:
        self._u = None

    def __call__(self, word: str, lang: str, script: str) -> str:
        if script == 'Latn':
            return normalise(word)
        if self._u is None:
            import uroman

            self._u = uroman.Uroman()
        return normalise(self._u.romanize_string(word, lcode=ISO3.get(lang, 'eng')))


class Unit:
    """One sung line prepared for the aligner."""

    def __init__(self, idx: int, sec: dict, line: dict, roman: list[str], vocab: dict[str, int]) -> None:
        self.idx, self.sec, self.line = idx, sec, line
        self.roman = roman
        self.tokens: list[int] = []
        self.word_of: list[int] = []      # word index of each token
        for wi, r in enumerate(roman):
            for ch in r:
                idx = vocab.get(ch)
                if idx is None:
                    continue
                self.tokens.append(idx)
                self.word_of.append(wi)
        ws = line['words']
        self.draft = (ws[0]['s'], ws[-1]['e'])

    @property
    def id(self) -> str:
        return self.line['id']


# ---------------------------------------------------------------- audio → letter posteriors

def emissions(slug: str, audio, x: np.ndarray) -> np.ndarray:
    """Log posteriors (frames × 28 letters incl. blank) for the whole file, cached per audio file."""
    cache = work_dir(slug) / 'align-emission.npy'
    meta_path = cache.with_suffix('.json')
    st = audio.stat()
    meta = {'audio': str(audio), 'size': st.st_size, 'mtime': st.st_mtime_ns, 'model': 'MMS_FA', 'chunk': CHUNK_S, 'ctx': CTX_S}
    if cache.exists() and meta_path.exists() and json.loads(meta_path.read_text()) == meta:
        print(f'emission: cache {cache.name}')
        return np.load(cache)

    import os

    import torch
    from torchaudio.pipelines import MMS_FA

    torch.set_num_threads(os.cpu_count() or 4)
    model = MMS_FA.get_model(with_star=False).eval()
    hop = 320
    chunk, ctx = int(CHUNK_S * F.SR) // hop * hop, int(CTX_S * F.SR) // hop * hop
    parts = []
    with torch.inference_mode():
        for c in range(0, len(x), chunk):
            a, b = max(0, c - ctx), min(len(x), c + chunk + ctx)
            em, _ = model(torch.from_numpy(x[a:b]).unsqueeze(0))
            em = em[0].numpy()
            off = (c - a) // hop
            keep = (min(chunk, len(x) - c)) // hop
            parts.append(em[off:off + keep])
            print(f'emission {c / F.SR:6.0f} / {len(x) / F.SR:.0f} s', flush=True)
    lp = np.concatenate(parts).astype(np.float32)
    np.save(cache, lp)
    meta_path.write_text(json.dumps(meta))
    return lp


def vocabulary() -> dict[str, int]:
    from torchaudio.pipelines import MMS_FA

    return MMS_FA.get_dict(star=None)


# ---------------------------------------------------------------- CTC alignment of lines

def align_window(lp: np.ndarray, t0: int, t1: int, units: list[Unit]) -> list[dict] | None:
    """Align the concatenated text of `units` inside frames [t0, t1). Per unit: word frame spans,
    word scores and the line's likelihood gap. None when the text does not fit."""
    t0, t1 = max(0, t0), min(len(lp), t1)
    flat = [tk for u in units for tk in u.tokens]
    if t1 <= t0 or not flat:
        return None
    seg = lp[t0:t1]
    path = viterbi(seg, flat)
    if path is None:
        return None
    ext = np.zeros(2 * len(flat) + 1, dtype=np.int64)
    ext[1::2] = flat
    on = seg[np.arange(len(seg)), ext[path]]
    best = seg.max(axis=1)
    tok_of_frame = np.where(path % 2 == 1, (path - 1) // 2, -1)
    first = np.full(len(flat), -1)
    last = np.full(len(flat), -1)
    idx = np.flatnonzero(tok_of_frame >= 0)
    for f in idx:  # frames are in order, so the first assignment is the first frame
        k = tok_of_frame[f]
        if first[k] < 0:
            first[k] = f
        last[k] = f
    # A letter held for longer than MAX_TOKEN is the path soaking up audio that matches nothing
    # (a verse missing from the text, a long instrumental bleed): keep only its head. Real held
    # vowels come back through the voice-activity extension of word ends.
    last = np.minimum(last, first + int(MAX_TOKEN * FPS))
    tok_of_frame = np.where((tok_of_frame >= 0) & (np.arange(len(seg)) <= last[np.maximum(tok_of_frame, 0)]), tok_of_frame, -1)
    out, base = [], 0
    for u in units:
        words = []
        for wi in range(len(u.roman)):
            ks = [base + j for j, w in enumerate(u.word_of) if w == wi]
            if not ks or int(first[ks[0]]) < 0:
                words.append(None)
                continue
            frames = np.flatnonzero(np.isin(tok_of_frame, ks))
            # Letters of one word spread over more than MAX_WORD_SPAN: the path stretched the word
            # over audio that belongs to nothing in the text. Keep its head; a real melisma comes
            # back through the voice-activity extension.
            f1 = min(int(last[ks[-1]]) + 1, int(first[ks[0]]) + int(MAX_WORD_SPAN * FPS))
            score = float(np.exp(on[frames]).mean()) if len(frames) else 0.0
            words.append({'f0': t0 + int(first[ks[0]]), 'f1': t0 + f1, 'score': score})
        lo = first[base]
        hi = max([w['f1'] - t0 for w in words if w] or [last[base + len(u.tokens) - 1] + 1])
        gap = float((best[lo:hi] - on[lo:hi]).mean()) if hi > lo else 99.0
        out.append({'words': words, 'gap': gap, 'f0': t0 + int(lo), 'f1': t0 + int(hi)})
        base += len(u.tokens)
    return out


# ---------------------------------------------------------------- passes

def anchor_pass(lp: np.ndarray, units: list[Unit], mode: str) -> dict[int, tuple[float, float]]:
    """Expected (start, end) seconds per unit index."""
    if mode == 'global':
        states = 2 * sum(len(u.tokens) for u in units) + 1
        if len(lp) * states > 1.5e9:  # back-pointer table would not fit comfortably
            print('anchors: text too long for one pass, using sections')
            mode = 'sections'
        else:
            res = align_window(lp, 0, len(lp), units)
            if res is not None:
                return {u.idx: (r['f0'] / FPS, r['f1'] / FPS) for u, r in zip(units, res)}
            print('anchors: global pass failed, using sections')
            mode = 'sections'
    if mode == 'sections':
        out: dict[int, tuple[float, float]] = {}
        prev_end = 0
        groups: list[list[Unit]] = []
        for u in units:
            if groups and groups[-1][0].sec is u.sec:
                groups[-1].append(u)
            else:
                groups.append([u])
        for g in groups:
            sec = g[0].sec
            t0 = max(prev_end, int((sec['start'] - SECTION_PAD) * FPS))
            t1 = int((sec['end'] + SECTION_PAD) * FPS)
            res = align_window(lp, t0, t1, g)
            if res is None:
                # Draft word times are the estimate being replaced, so they are not a search window.
                # The section map is. line_pass then pads it by `margin`.
                lo, hi = float(sec['start']), float(sec['end'])
                for u in g:
                    out[u.idx] = (lo, hi)
                prev_end = int(hi * FPS)
                continue
            for u, r in zip(g, res):
                out[u.idx] = (r['f0'] / FPS, r['f1'] / FPS)
            prev_end = res[-1]['f1']
        return out
    return {u.idx: u.draft for u in units}


def line_pass(lp: np.ndarray, units: list[Unit], anchors: dict, margin: float) -> list[dict]:
    """Each line in its own window with the next line as look-ahead (see the module docstring)."""
    results = []
    prev_end = 0
    for i, u in enumerate(units):
        look = units[i + 1] if i + 1 < len(units) else None
        a_start = anchors[u.idx][0]
        a_end = anchors[look.idx][1] if look else anchors[u.idx][1]
        t0 = max(prev_end, int((a_start - margin) * FPS))
        t1 = int((a_end + margin) * FPS)
        group = [u, look] if look else [u]
        res = align_window(lp, t0, t1, group)
        method = 'line'
        if res is None:  # window too short: try alone, then wider
            res = align_window(lp, t0, int((anchors[u.idx][1] + 2 * margin) * FPS), [u])
            method = 'line-alone'
        if res is None:
            results.append({'method': 'anchor', 'window': (t0 / FPS, t1 / FPS), 'res': None})
            prev_end = int(anchors[u.idx][1] * FPS)
            continue
        r = res[0]
        results.append({'method': method, 'window': (t0 / FPS, t1 / FPS), 'res': r})
        prev_end = r['f1']
    return results


def snap_onsets(sig, times: list[list], units: list[Unit], measured: list[bool]) -> list[list[float | None]]:
    """Move a measured word start onto a clear vocal attack within SNAP_WIN.

    This changes the published time only. A snapped word then sits on the attack, so the distance
    from the published start to that attack is 0 and is not a measurement. qa_sync scores the
    start from before this move (`ctc_s`). Returns the shift per word, None where no attack was
    close enough."""
    peaks = Q.onset_peak_times(sig, min_height=Q.PEAK_HEIGHT)
    out: list[list[float | None]] = []
    prev = None  # previous word of the song, [s, e]
    for ui, (u, ws) in enumerate(zip(units, times)):
        dts: list[float | None] = [None] * len(ws)
        for wi, w in enumerate(ws):
            if measured[ui] and u.roman[wi] and len(peaks):
                dist = peaks - w[0]
                k = int(np.argmin(np.abs(dist)))
                t = float(peaks[k])
                if abs(t - w[0]) <= SNAP_WIN and t > (prev[0] + 0.05 if prev else 0.0):
                    dts[wi] = t - w[0]
                    w[0] = t
                    if w[1] < t + 0.04:
                        w[1] = t + 0.04
                    if prev and prev[1] > t:
                        prev[1] = max(prev[0] + 0.02, t)
            prev = w
        out.append(dts)
    return out


def fit_drafts(times: list[list], is_draft: list[bool], duration: float) -> None:
    """Each run of consecutive draft lines keeps its own layout but must sit between the measured
    lines around it: moved into the gap if it fits, squeezed into it if it does not."""
    def first(ws):
        return next(w[0] for w in ws if w is not None)

    def last(ws):
        return next(w[1] for w in reversed(ws) if w is not None)

    i = 0
    while i < len(times):
        if not is_draft[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(times) and is_draft[j + 1]:
            j += 1
        lo = (last(times[i - 1]) if i else 0.0) + 0.05
        hi = (first(times[j + 1]) if j + 1 < len(times) else duration) - 0.05
        b0, b1 = first(times[i]), last(times[j])
        if not (b0 >= lo and b1 <= hi) and hi > lo:
            if b1 - b0 <= hi - lo:
                d = min(max(b0, lo), hi - (b1 - b0)) - b0
                f = lambda t: t + d  # noqa: E731
            else:
                k = (hi - lo) / max(1e-3, b1 - b0)
                f = lambda t: lo + (t - b0) * k  # noqa: E731
            for ws in times[i:j + 1]:
                for w in ws:
                    w[0], w[1] = f(w[0]), f(w[1])
        i = j + 1


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('slug')
    ap.add_argument('--anchors', choices=['global', 'sections', 'draft'], default='global')
    ap.add_argument('--margin', type=float, default=None, help='search margin, s (default 6; 10 with --anchors draft)')
    ap.add_argument('--lines', default='', help='comma-separated line ids to rewrite (default: all)')
    ap.add_argument('--audio', default=None, help='audio to align on (default work/<slug>/stems/vocals.wav)')
    ap.add_argument('--move-sections', action='store_true', help='move section bounds to the measured words (off by default)')
    ap.add_argument('--dry-run', action='store_true', help='write only work/<slug>/align-report.json and timing.json')
    ap.add_argument('--force', action='store_true', help='overwrite even when song.json timing is "verified"')
    ap.add_argument('--second', default='auto', help='second aligner: auto | whisperx | none (default auto)')
    ap.add_argument('--proof', choices=['agree', 'strict'], default='agree',
                    help='agree: two aligners within 100 ms + line on the voice; strict: also a clear onset at every word')
    args = ap.parse_args()
    slug = args.slug
    margin = args.margin if args.margin is not None else (10.0 if args.anchors == 'draft' else 6.0)

    lyr_path, song_path = song_dir(slug) / 'lyrics.json', song_dir(slug) / 'song.json'
    lyrics, song = load_json(lyr_path), load_json(song_path)
    if song['timing']['status'] == 'verified' and not args.force and not args.dry_run:
        raise SystemExit('song.json: timing.status = verified — время проверено человеком. Перезапись: --force')
    only = {x for x in args.lines.split(',') if x}

    audio, is_stem = vocal_stem(slug, args.audio)
    if not is_stem:
        print(f'ВНИМАНИЕ: нет вокального стема, выравниваю по полному миксу {audio.name} — точность ниже')
    x = load_audio(audio, F.SR)
    duration = len(x) / F.SR
    t_start = dt.datetime.now()
    lp = emissions(slug, audio, x)

    vocab = vocabulary()
    rom = Romaniser()
    units = []
    for idx, (sec, line) in enumerate(T.vocal_lines(lyrics)):
        roman = [rom(w['w'], line['lang'], line['script']) for w in line['words']]
        units.append(Unit(idx, sec, line, roman, vocab))

    anchors = anchor_pass(lp, units, args.anchors)
    passes = line_pass(lp, units, anchors, margin)

    # Voice activity for word-end extension and onset snapping.
    act, _ = F.activity(F.rms_db(x))

    def active(t: float) -> bool:
        k = int(t / F.HOP)
        return 0 <= k < len(act) and bool(act[k])

    # Confidence per line, from the raw CTC result.
    conf = []
    for u, p in zip(units, passes):
        r = p['res']
        scores = [None if (r is None or w is None) else round(w['score'], 3) for w in (r['words'] if r else [None] * len(u.roman))]
        known = [s for s in scores if s is not None]
        score = float(np.mean(known)) if known else 0.0
        gap = r['gap'] if r else 99.0
        agree = abs(r['f0'] / FPS - anchors[u.idx][0]) if (r and args.anchors != 'draft') else 0.0
        if p['method'] == 'line' and score >= GOOD_SCORE and gap <= GOOD_GAP and agree <= GOOD_AGREE:
            status = 'good'
        elif r is not None and score >= KEEP_SCORE and agree <= KEEP_AGREE:
            status = 'weak'     # measured, plausible, but not sure: written, flagged
        else:
            status = 'draft'    # text not found where expected: keep the draft, fitted between neighbours
        conf.append({'scores': scores, 'score': score, 'gap': gap, 'agree': agree, 'status': status})

    # Word times (seconds) per unit; drafts for lines the aligner could not place.
    times: list[list[list[float] | None]] = []
    for u, p, c in zip(units, passes, conf):
        if c['status'] == 'draft':
            times.append([[w['s'], w['e']] for w in u.line['words']])
        else:
            times.append([None if w is None else [w['f0'] / FPS, w['f1'] / FPS] for w in p['res']['words']])
    fit_drafts(times, [c['status'] == 'draft' for c in conf], duration)

    # Words without letters (punctuation): a 10 ms slot right after the previous word.
    for ws in times:
        for j, w in enumerate(ws):
            if w is None:
                prev = next((ws[k] for k in range(j - 1, -1, -1) if ws[k] is not None), None)
                nxt = next((ws[k] for k in range(j + 1, len(ws)) if ws[k] is not None), None)
                t = prev[1] if prev else (nxt[0] - 0.01 if nxt else 0.0)
                ws[j] = [t, t + 0.01]

    # Word starts move to the nearest clear vocal onset (see snap_onsets); ends follow the voice.
    sig = Q.Signals(x)
    raw_starts = [[w[0] for w in ws] for ws in times]
    onset_dt = snap_onsets(sig, times, units, [c['status'] != 'draft' for c in conf])
    flat = [(w, c['status'] != 'draft') for ws, c in zip(times, conf) for w in ws]
    for j, (w, measured) in enumerate(flat):
        if not measured:
            continue
        limit = flat[j + 1][0][0] if j + 1 < len(flat) else duration
        limit = min(limit, w[1] + MAX_EXTEND)
        e = w[1]
        while e + F.HOP <= limit and active(e):
            e += F.HOP
        w[1] = max(w[1], min(e, limit))

    # Second opinion on solo lines the main aligner placed confidently. The window is the anchor
    # (global CTC, or the section bounds when that pass failed) plus the same margin — never the
    # draft word times, and never ±1 s around the already snapped starts. Choir is not run.
    jobs = []
    second_window: dict[str, tuple[float, float]] = {}
    for u, c in zip(units, conf):
        if c['status'] != 'good' or not T.is_solo(u.sec, u.line):
            continue
        if args.anchors == 'draft':
            t0 = max(0.0, float(u.sec['start']) - SECTION_PAD)
            t1 = min(duration, float(u.sec['end']) + SECTION_PAD)
        else:
            a0, a1 = anchors[u.idx]
            t0 = max(0.0, float(a0) - margin)
            t1 = min(duration, float(a1) + margin)
        if t1 - t0 < 0.4:
            t0 = max(0.0, float(u.sec['start']) - SECTION_PAD)
            t1 = min(duration, float(u.sec['end']) + SECTION_PAD)
        second_window[u.id] = (t0, t1)
        jobs.append({'id': u.id, 'lang': u.line['lang'], 'script': u.line['script'],
                     'words': [w['w'] for w in u.line['words']], 't0': t0, 't1': t1})
    second_starts, second_name = engines.align_jobs(args.second, x, jobs)

    # The sync check on the final times, line by line.
    qa = Q.check_lines(sig, [[{'w': w['w'], 's': t[0], 'e': t[1]} for w, t in zip(u.line['words'], ws)] for u, ws in zip(units, times)],
                       [u.sec['id'] for u in units])

    report_lines, good, placed = [], set(), set()
    for u, p, ws, c, raw, odt, q in zip(units, passes, times, conf, raw_starts, onset_dt, qa):
        status, scores, score, gap, agree = c['status'], c['scores'], c['score'], c['gap'], c['agree']
        s2 = second_starts.get(u.id)
        if s2 is not None and len(s2) != len(u.line['words']):
            s2 = None
        words_out, proven_n, letters_n = [], 0, 0
        for wi, (w, rm, t, sc) in enumerate(zip(u.line['words'], u.roman, ws, scores)):
            has_letters = bool(rm)
            e2 = float(s2[wi]) if (s2 and s2[wi] is not None) else None
            engines_agree = None if e2 is None else bool(abs(e2 - raw[wi]) <= ENGINE_AGREE)
            onset_ok = odt[wi] is not None
            # Proof: the line is placed confidently, the sync check finds it on the voice, and the
            # second aligner puts this word where the first did. --proof strict also wants a clear
            # vocal onset at the word start itself (unstressed legato words rarely have one).
            proven = (status == 'good' and q['verdict'] == 'ok' and engines_agree is True
                      and (onset_ok or args.proof != 'strict'))
            if has_letters:
                letters_n += 1
                proven_n += proven
            words_out.append({'w': w['w'], 'roman': rm, 's': round(t[0], 2), 'e': round(t[1], 2), 'draft_s': w['s'],
                              'score': sc, 'ctc_s': round(raw[wi], 2), 'second_s': None if e2 is None else round(e2, 2),
                              'onset_dt': None if odt[wi] is None else round(odt[wi], 2), 'proven': proven})
        all_proven = letters_n > 0 and proven_n == letters_n
        if status == 'good' and q['verdict'] == 'ok':
            level = 'word' if all_proven else 'line'
        else:
            level = 'none'
        if status == 'good':
            good.add(u.id)
        if level != 'none':
            placed.add(u.id)
        report_lines.append({
            'id': u.id, 'section': u.sec['id'], 'lang': u.line['lang'], 'text': T.line_text(u.line),
            'solo': T.is_solo(u.sec, u.line), 'second': second_name.get(u.id),
            'status': status, 'level': level, 'conf': round(proven_n / letters_n, 2) if letters_n else 0.0,
            'qa': q['verdict'], 'qa_offset': q['offset'], 'method': p['method'],
            'window': [round(p['window'][0], 2), round(p['window'][1], 2)],
            'second_window': ([round(second_window[u.id][0], 2), round(second_window[u.id][1], 2)]
                              if u.id in second_window else None),
            'start': round(ws[0][0], 2), 'end': round(ws[-1][1], 2),
            'draft_start': u.draft[0], 'shift': round(ws[0][0] - u.draft[0], 2),
            'anchor_start': round(anchors[u.idx][0], 2), 'agree': round(agree, 2),
            'score': round(score, 3), 'gap': round(gap, 3), 'words': words_out,
        })

    # Times are written for every requested line. The flag stays on: qa_sync.py --apply is the
    # only step that may clear timing-draft, and only for a line it can prove.
    level_of = {r['id']: r['level'] for r in report_lines}
    for u, ws in zip(units, times):
        if only and u.id not in only:
            continue
        for w, t in zip(u.line['words'], ws):
            w['s'], w['e'] = T.r2(t[0]), T.r2(t[1])
        T.set_flag(u.line, 'timing-draft', True)
    fixes = T.enforce_order(lyrics)
    section_notes = T.fit_sections(lyrics, song['duration'], placed) if args.move_sections else []

    n, n_good = len(units), len(good)
    n_weak = sum(r['status'] == 'weak' for r in report_lines)
    n_draft = sum(r['status'] == 'draft' for r in report_lines)
    levels = {lv: sum(r['level'] == lv for r in report_lines) for lv in ('word', 'line', 'none')}
    shifts = np.array([abs(r['shift']) for r in report_lines if r['status'] == 'good'])
    ws_good = [w for r in report_lines if r['status'] == 'good' for w in r['words'] if w['roman']]
    pair = np.array([abs(w['second_s'] - w['ctc_s']) for w in ws_good if w['second_s'] is not None])
    snaps = np.array([abs(w['onset_dt']) for w in ws_good if w['onset_dt'] is not None])
    summary = {
        'lines': n, 'good': n_good, 'weak': n_weak, 'draft': n_draft, 'levels': levels,
        'words': sum(len(u.line['words']) for u in units),
        'words_in_good_lines': len(ws_good),
        'words_proven': sum(w['proven'] for w in ws_good),
        'second_engine': args.second,
        'second_engines_used': sorted(set(second_name.values())),
        'second_compared': int(len(pair)),
        'second_within_100ms': int((pair <= ENGINE_AGREE).sum()) if len(pair) else 0,
        'second_median_diff': round(float(np.median(pair)), 3) if len(pair) else None,
        'onset_snapped': int(len(snaps)),
        'onset_median_shift': round(float(np.median(snaps)), 3) if len(snaps) else None,
        'median_shift_from_draft_good': round(float(np.median(shifts)), 2) if len(shifts) else None,
        'max_shift_from_draft_good': round(float(shifts.max()), 2) if len(shifts) else None,
        'order_fixes': fixes,
    }
    report = {
        'slug': slug, 'created': t_start.isoformat(timespec='seconds'), 'audio': audio.name, 'stem': is_stem,
        'engine': 'torchaudio MMS_FA + uroman, CTC Viterbi', 'second': summary['second_engine'],
        'anchors': args.anchors, 'margin': margin,
        'thresholds': {'score': GOOD_SCORE, 'gap': GOOD_GAP, 'agree': GOOD_AGREE, 'keep_score': KEEP_SCORE,
                       'keep_agree': KEEP_AGREE, 'snap_win': SNAP_WIN, 'snap_min': Q.PEAK_HEIGHT, 'engine_agree': ENGINE_AGREE},
        'summary': summary, 'sections': section_notes, 'lines': report_lines,
    }
    wd = work_dir(slug)
    (wd / 'align-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')

    timing_note = (f'align.py {t_start:%Y-%m-%d}: времена слов записаны, все строки помечены timing-draft. '
                   f'Выравниватель уверен в {n_good} из {n}, не нашёл текст в {n_draft}. '
                   f'Статус aligned ставит только qa_sync.py --apply, если сольные строки доказаны. '
                   f'Отчёт выравнивания: work/{slug}/align-report.json.')
    # status stays draft until qa_sync proves lines. method records that these times came from MMS_FA.
    new_timing = {'status': 'draft', 'method': 'mms-fa', 'notes': timing_note}
    compact = {
        'slug': slug, 'created': report['created'], 'timing': new_timing,
        'lines': {u.id: {'sig': T.text_sig(u.line), 'draft': True, 'level': level_of[u.id],
                         'w': [[w['s'], w['e']] for w in u.line['words']]} for u in units if not only or u.id in only},
        'sections': {s['id']: [s['start'], s['end'], 'timing-draft' in s.get('flags', [])] for s in lyrics['sections']},
    }
    (wd / 'timing.json').write_text(json.dumps(compact, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    if args.dry_run:
        print('dry run: lyrics.json и song.json не изменены')
    else:
        lyr_path.write_text(dump_json(lyrics), encoding='utf-8')
        song['timing'] = new_timing
        song_path.write_text(dump_json(song), encoding='utf-8')

    print(f"\nСтрок: {n}. Выравниватель уверен: {n_good}, не уверен: {n_weak}, не нашёл текст (черновик): {n_draft}.")
    print(f"Доказано пословно: {levels['word']} строк, только построчно: {levels['line']}, не подтверждено: {levels['none']}. "
          f"Слов доказано: {summary['words_proven']} из {summary['words_in_good_lines']} в уверенных строках.")
    if second_name:
        print(f"Второй выравниватель ({', '.join(summary['second_engines_used'])}): сравнено {summary['second_compared']} слов, "
              f"в пределах {ENGINE_AGREE * 1000:.0f} мс — {summary['second_within_100ms']}, медиана расхождения {summary['second_median_diff']} с.")
    print(f"Атаки голоса: начало сдвинуто к атаке у {summary['onset_snapped']} слов, медиана сдвига {summary['onset_median_shift']} с.")
    for r in report_lines:
        mark = {'word': '✓', 'line': '~', 'none': '·'}[r['level']]
        print(f"{mark} {r['id']:<22} {r['start']:7.2f}–{r['end']:7.2f}  score {r['score']:.2f} gap {r['gap']:.2f} "
              f"agree {r['agree']:.2f}  {r['status']:<5} qa {r['qa']:<8} доказано {r['conf']:.0%}")
    for note in section_notes:
        print('  секции:', note)
    print(f'→ {wd / "align-report.json"}, {wd / "timing.json"}')


if __name__ == '__main__':
    sys.exit(main())
