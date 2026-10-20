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
2. One CTC pass per vocal line, inside that line's official subtitle cue plus a short margin
   (docs/analysis/<slug>/cues.json: start and end, no cue text). The recording is the video's
   own audio, so the cue clock is the file. A neighbour cue stops the window half a second
   into that neighbour. A line with no cue falls back to one pass of its vocal section. Draft
   s/e are not a window. A repeatable star sits between words, with a flat log-score of 0, so
   a pause or a melisma is not soaked up by a letter and one line cannot eat the next.
3. Word ends of a confident line are extended while the voice still sounds (CTC marks the
   letter spike, not the held vowel), never into the next word. A start may then move onto an
   attack within 0.10 s; that move is not the measurement.
4. A cued line is placed (`good`) when the structural checks pass and the pre-snap
   start rounds to at most 0.30 s from the cue. The MMS score is reported and does
   not reject that line: |Δ| already drops a false placement. A line with no cue is
   placed when its score clears docs/analysis/bench/calibration.json and the
   structural checks pass. The gap to another label is recorded and is not a gate.
   Without that file the letter mean at 0.30 is the test fallback for the uncued gate.
     placed — its start and end are written, and a second aligner runs for solo and choir;
     anything else with a cue — the whole word block shifts so the first word starts
     on the cue. Copying the file's s/e is not that: those times may be an older
     aligner (shushtari-s2 sat at 489.82 while the cue is 486.296). They are not
     slid into a gap.
   A cued line the first pass did not place is tried again, in order: MMS on the span
   from this cue to the next cue (several margins), MMS on an htdemucs_ft clip of that
   line while a time budget holds, stable-ts, then the second aligner. The first one
   that passes structure and |Δ| ≤ 0.30 s is the placer. A word start outside the
   line's section, slack 0.05 s, fails that step. Its pre-snap start is the
   primary clock. The other two clocks are the witnesses. stable-ts measures every
   Whisper model that finishes inside 90 minutes, on windows of lines MMS already
   placed, and keeps each model's word starts. The largest of those places lines
   that are still open. The proof witness is chosen later, per song and language,
   by how many lines it proves. The song stem stays htdemucs.
   align.py does not decide the flag. It marks every line `timing-draft` and leaves
   `timing.status` at `draft`. qa_sync.py --apply clears the flag only for a placed line
   whose words the measured rule proves. The default, when no rule file exists, is an
   attack within 0.10 s (0.20 s choir), or, for a vowel, legato or melisma with no
   attack within 0.30 s, a second aligner within 0.10 s. The song becomes `aligned`
   only when every group that exists is at least 90 % proved. The goal remains every line.

Writes lyrics.json (word s/e and the timing-draft flag; a vocal section end may move
forward, or a word end may be cut, so a word does not sit past the section. Starts are
not moved. Other section bounds change only with --move-sections),
song.json timing (status stays draft), work/<slug>/align-report.json and work/<slug>/timing.json.
`--dry-run` writes only the two work files.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata

import numpy as np

import calibrate_score as Cal
import engines
import features as F
import placement as P
import qa_sync as Q
import timing as T
import whisper_witness as W
from ctc import token_spans, viterbi
from common import ROOT, dump_json, find_source, load_audio, load_json, song_dir, vocal_stem, work_dir

ISO3 = {'ar': 'ara', 'fa': 'fas', 'az': 'aze', 'tr': 'tur', 'ota': 'ota', 'en': 'eng', 'la': 'lat', 'de': 'deu', 'gmh': 'deu',
        'es': 'spa', 'ur': 'urd', 'hi': 'hin', 'ru': 'rus', 'uz': 'uzb', 'fr': 'fra', 'it': 'ita'}
FPS = 50                 # MMS_FA: one frame per 320 samples at 16 kHz
CHUNK_S, CTX_S = 30.0, 3.0
SECTION_PAD = 15.0       # --anchors sections: search this far around the section map
ANCHOR_SLACK = 2.0       # a global-pass span this far outside its section is a different occurrence
MAX_EXTEND = 4.0         # a word end may follow the voice this far
MAX_TOKEN = 0.5          # longest stretch one letter may hold in the CTC path
MAX_WORD_SPAN = 2.5      # longest span from a word's first to its last letter
SNAP_WIN = 0.10          # a word start moves to a clear vocal onset at most this far (the proof gate)
ENGINE_AGREE = 0.10      # recorded gap for the second aligner. qa_sync does not fail the line on it
# Official subtitle cue. A person places it to about 0.1–0.5 s. The search window is the cue
# plus this margin. A neighbour cue stops the window CUE_OVERLAP inside that neighbour, so
# this line's text is not aligned on the next line. The section map is the same kind of fence.
CUE_LEAD = 0.80
CUE_TAIL = 0.50
CUE_OVERLAP = 0.50
CUE_SECTION_PAD = 0.50
# Fallback when calibration.json is absent (tests, a manual run). The singing gate is the
# threshold choose_threshold writes. GOOD_GAP is recorded and is not a placement gate.
GOOD_SCORE = 0.30
GOOD_GAP = 1.2
GOOD_AGREE = 0.5
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
        # Vowel signs stay on the word. uroman turns fatha/kasra/damma into a/i/u, doubles a
        # consonant for shadda and drops sukun. Stripping the signs first would leave the
        # consonant skeleton and delete the vowels MMS has to hear. The letters do not change.
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

def _mms_model():
    """One MMS_FA load. A clip must call this itself and must not use the song cache."""
    import os

    import torch
    from torchaudio.pipelines import MMS_FA

    torch.set_num_threads(os.cpu_count() or 4)
    return MMS_FA.get_model(with_star=False).eval()


def emissions_array(x: np.ndarray, model=None) -> np.ndarray:
    """Log posteriors for one waveform. No cache: a clip must not replace the song file."""
    import torch

    own = model is None
    if own:
        model = _mms_model()
    hop = 320
    chunk, ctx = int(CHUNK_S * F.SR) // hop * hop, int(CTX_S * F.SR) // hop * hop
    parts = []
    with torch.inference_mode():
        for c in range(0, len(x), chunk or 1):
            a, b = max(0, c - ctx), min(len(x), c + chunk + ctx)
            if b <= a:
                break
            em, _ = model(torch.from_numpy(x[a:b]).unsqueeze(0))
            em = em[0].numpy()
            off = (c - a) // hop
            keep = (min(chunk, len(x) - c)) // hop
            parts.append(em[off:off + keep])
            if own:
                print(f'emission {c / F.SR:6.0f} / {len(x) / F.SR:.0f} s', flush=True)
    if not parts:
        width = 28
        return np.zeros((0, width), np.float32)
    return np.concatenate(parts).astype(np.float32)


def emissions(slug: str, audio, x: np.ndarray) -> np.ndarray:
    """Log posteriors (frames × 28 letters incl. blank) for the whole file, cached per audio file."""
    cache = work_dir(slug) / 'align-emission.npy'
    meta_path = cache.with_suffix('.json')
    st = audio.stat()
    meta = {'audio': str(audio), 'size': st.st_size, 'mtime': st.st_mtime_ns, 'model': 'MMS_FA', 'chunk': CHUNK_S, 'ctx': CTX_S}
    if cache.exists() and meta_path.exists() and json.loads(meta_path.read_text()) == meta:
        print(f'emission: cache {cache.name}')
        return np.load(cache)
    lp = emissions_array(x)
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


def align_stars(lp_letters: np.ndarray, units: list[Unit]) -> list[dict] | None:
    """CTC of one section. A star between words may repeat and absorbs pauses and melismas.

    The star column is a flat log-score of 0 (the wildcard torchaudio uses for audio that is
    not a letter). Each letter then lands on its best single frame instead of stretching.
    Frames are relative to `lp_letters`. None when the text does not fit.
    """
    if len(lp_letters) == 0 or not units:
        return None
    star = int(lp_letters.shape[1])
    lp = np.concatenate([lp_letters, np.zeros((len(lp_letters), 1), np.float32)], axis=1)
    best = lp_letters.max(axis=1)
    tokens: list[int] = [star]
    owner: list[tuple[int, int] | None] = [None]
    for ui, u in enumerate(units):
        by_word: dict[int, list[int]] = {}
        for tok, wi in zip(u.tokens, u.word_of):
            by_word.setdefault(wi, []).append(int(tok))
        for wi in range(len(u.roman)):
            letters = by_word.get(wi)
            if not letters:
                continue
            for tok in letters:
                tokens.append(tok)
                owner.append((ui, wi))
            tokens.append(star)
            owner.append(None)
    path = viterbi(lp, tokens)
    if path is None:
        return None
    first, last = token_spans(path, len(tokens))
    posts: dict[tuple[int, int], list[float]] = {}
    gaps: dict[int, list[float]] = {}
    spans: dict[tuple[int, int], list[int]] = {}
    for k, own in enumerate(owner):
        if own is None or int(first[k]) < 0:
            continue
        ui, wi = own
        f0 = int(first[k])
        spans.setdefault((ui, wi), [f0, int(last[k])])
        spans[(ui, wi)][0] = min(spans[(ui, wi)][0], f0)
        spans[(ui, wi)][1] = max(spans[(ui, wi)][1], int(last[k]))
        posts.setdefault((ui, wi), []).append(float(np.exp(lp_letters[f0, tokens[k]])))
        gaps.setdefault(ui, []).append(float(best[f0] - lp_letters[f0, tokens[k]]))
    out = []
    for ui, u in enumerate(units):
        words = []
        line_posts: list[float] = []
        for wi in range(len(u.roman)):
            sp = spans.get((ui, wi))
            ps = posts.get((ui, wi))
            if sp is None or not ps:
                words.append(None)
                continue
            words.append({'f0': sp[0], 'f1': sp[1], 'score': float(np.mean(ps))})
            line_posts.extend(ps)
        gs = gaps.get(ui, [])
        out.append({
            'words': words,
            'score': float(np.mean(line_posts)) if line_posts else 0.0,
            'gap': float(np.mean(gs)) if gs else 99.0,
            'n': len(line_posts),
        })
    return out


def _section_groups(units: list[Unit]) -> list[tuple[dict, list[Unit]]]:
    groups: list[tuple[dict, list[Unit]]] = []
    for u in units:
        if groups and groups[-1][0] is u.sec:
            groups[-1][1].append(u)
        else:
            groups.append((u.sec, [u]))
    return groups


def section_pass(lp: np.ndarray, units: list[Unit]) -> list[dict]:
    """Place every line by one CTC pass of its vocal section. Draft times are not a window."""
    results = [{'method': 'section', 'window': (0.0, 0.0), 'res': None} for _ in units]
    for sec, group in _section_groups(units):
        placed = None
        t0 = t1 = 0
        for pad in (0.0, 2.0):
            t0 = max(0, int((float(sec['start']) - pad) * FPS))
            t1 = min(len(lp), int((float(sec['end']) + pad) * FPS))
            placed = align_stars(lp[t0:t1], group)
            if placed is not None:
                break
        window = (t0 / FPS, t1 / FPS)
        if placed is None:
            for u in group:
                results[u.idx] = {'method': 'section', 'window': window, 'res': None}
            print(f"section {sec.get('id')}: text does not fit", flush=True)
            continue
        print(f"section {sec.get('id')}: {window[0]:.1f}–{window[1]:.1f} s", flush=True)
        for u, rec in zip(group, placed):
            words = []
            for w in rec['words']:
                if w is None:
                    words.append(None)
                else:
                    words.append({'f0': t0 + int(w['f0']), 'f1': t0 + int(w['f1']) + 1, 'score': w['score']})
            placed_w = [w for w in words if w is not None]
            results[u.idx] = {
                'method': 'section',
                'window': window,
                'res': None if not placed_w else {
                    'words': words, 'gap': rec['gap'], 'score': rec['score'],
                    'f0': min(w['f0'] for w in placed_w), 'f1': max(w['f1'] for w in placed_w),
                },
            }
    return results


def load_cues(slug: str) -> dict[str, dict]:
    """Official subtitle cues keyed by line id. Empty when the song has none."""
    path = ROOT / 'docs' / 'analysis' / slug / 'cues.json'
    if not path.exists():
        return {}
    rows = json.loads(path.read_text(encoding='utf-8'))
    return {row['line']: row for row in rows if row.get('line') and row.get('start') is not None and row.get('end') is not None}


def cue_window(start: float, end: float, prev: tuple[float, float] | None, nxt: tuple[float, float] | None,
               sec_start: float, sec_end: float, duration: float) -> tuple[float, float]:
    """Search window around one subtitle cue. Draft word times are not an input.

    Lead and tail cover the 0.1–0.5 s a person misses, plus a short attack. A neighbour
    cue is a fence: the window may enter it by CUE_OVERLAP and no further. The section
    map is the same kind of fence, not the search itself.
    """
    start = float(start)
    end = max(float(end), start)
    t0 = start - CUE_LEAD
    t1 = end + CUE_TAIL
    if prev is not None:
        t0 = max(t0, float(prev[1]) - CUE_OVERLAP)
    if nxt is not None:
        t1 = min(t1, float(nxt[0]) + CUE_OVERLAP)
    t0 = max(0.0, t0, float(sec_start) - CUE_SECTION_PAD)
    t1 = min(float(duration), t1, float(sec_end) + CUE_SECTION_PAD)
    if t1 < t0 + 0.40:
        t1 = min(float(duration), t0 + 0.40)
    return t0, t1


def borrow_jobs(units: list, cues: dict[str, dict], duration: float) -> tuple[list[dict], list[tuple[str, str, str]]]:
    """Cue-window probes for languages that may borrow a checkpoint.

    Every cued Turkish, Azerbaijani and Latin line is included, placed or not. The native
    Turkish probe uses the same window and the same model as the Azerbaijani one, with an
    identity letter map. Italian and Spanish are Common Voice wav2vec2 models, not the
    torchaudio VoxPopuli bundles `it` and `es` would otherwise select. The job id is the
    line id plus the model language. Returns jobs and (line id, model language, job id).
    """
    jobs: list[dict] = []
    meta: list[tuple[str, str, str]] = []
    vocal = [(u, cues.get(u.id)) for u in units]
    for i, (u, cue) in enumerate(vocal):
        if cue is None:
            continue
        specs = engines.BORROW_FOR.get(u.line.get('lang') or '')
        if not specs:
            continue
        prev = next((vocal[j][1] for j in range(i - 1, -1, -1) if vocal[j][1] is not None), None)
        nxt = next((vocal[j][1] for j in range(i + 1, len(vocal)) if vocal[j][1] is not None), None)
        prev_t = None if prev is None else (float(prev['start']), float(prev['end']))
        nxt_t = None if nxt is None else (float(nxt['start']), float(nxt['end']))
        t0, t1 = cue_window(float(cue['start']), float(cue['end']), prev_t, nxt_t,
                            float(u.sec['start']), float(u.sec['end']), duration)
        words = [w['w'] for w in u.line['words']]
        for model_lang, table in specs:
            model = engines.BORROW_MODELS[model_lang]
            jid = f'{u.id}\t{model_lang}'
            jobs.append({
                'id': jid,
                'lang': model_lang,
                'hf_model': model['id'],
                'script': u.line.get('script'),
                'words': [engines.map_word(w, table) for w in words],
                't0': t0,
                't1': t1,
            })
            meta.append((u.id, model_lang, jid))
    return jobs, meta


def placement_status(missing: bool, score_ok: bool, structure_ok: bool, near: bool, has_cue: bool) -> str:
    """`good`, `weak` or `draft`.

    A cued line is placed on structure and |Δ| ≤ 0.30 s. The score does not
    reject it. A line with no cue keeps the calibrated score and the structure:
    there is no cue distance to test. No path at all stays `draft`.
    """
    if missing:
        return 'draft'
    if has_cue:
        if structure_ok and near:
            return 'good'
        return 'weak'
    if score_ok and structure_ok:
        return 'good'
    return 'weak'


def shift_block(words: list, target: float) -> float:
    """Move every [s, e] so the first start equals `target`. Empty slots stay empty.

    Relative gaps stay. An unplaced cued line publishes the cue this way, not the
    s/e already stored in the file.
    """
    first = next((w for w in words if w is not None), None)
    if first is None:
        return 0.0
    delta = float(target) - float(first[0])
    if delta == 0.0:
        return 0.0
    for w in words:
        if w is None:
            continue
        w[0] += delta
        w[1] += delta
    return delta


def clamp_block(words: list, cue_start: float, limit: float = 0.30) -> float:
    """Pull a block toward the cue until its first start is within `limit`.

    A start already inside does not move. The shift is the excess only.
    """
    first = next((w for w in words if w is not None), None)
    if first is None:
        return 0.0
    drift = float(first[0]) - float(cue_start)
    if round(abs(drift), 3) <= limit:
        return 0.0
    target = float(cue_start) + (limit if drift > 0 else -limit)
    return shift_block(words, target)


def _nudge_line(words: list[dict], delta: float) -> None:
    for w in words:
        w['s'] = T.r2(float(w['s']) + delta)
        w['e'] = T.r2(float(w['e']) + delta)
        if w['e'] <= w['s']:
            w['e'] = T.r2(float(w['s']) + 0.02)


def _trim_overlap(lyrics: dict) -> None:
    """Shorten a word end that overlaps the next start by more than 0.02 s. Starts stay."""
    prev = None
    for _, line in T.vocal_lines(lyrics):
        for w in line.get('words') or []:
            if prev is not None and float(w['s']) < float(prev['e']) - 0.02:
                prev['e'] = T.r2(max(float(prev['s']) + 0.02, float(w['s'])))
                if prev['e'] <= prev['s']:
                    prev['e'] = T.r2(float(prev['s']) + 0.02)
            if float(w['e']) <= float(w['s']):
                w['e'] = T.r2(float(w['s']) + 0.02)
            prev = w


def lock_written_cues(lyrics: dict, cues: dict[str, dict], placed_ids: set[str], only: set[str] | None = None) -> int:
    """After rounding, a cued line's first word stays within 0.30 s of the cue.

    A line that was not placed (`placed_ids`) starts on the cue, on the file's
    two-decimal grid. A placed line moves only when it sits further than 0.30 s,
    and only by the excess. Returns how many lines moved.
    """
    only = only or set()
    moved = 0
    for _, line in T.vocal_lines(lyrics):
        if only and line['id'] not in only:
            continue
        words = line.get('words') or []
        cue = cues.get(line['id'])
        if cue is None or not words:
            continue
        cue_s = float(cue['start'])
        placed = line['id'] in placed_ids
        limit = P.cue_accept_limit(line.get('lang'), cue.get('lang'))
        changed = False
        for _ in range(8):
            first = float(words[0]['s'])
            gap = first - cue_s
            if placed and round(abs(gap), 3) <= limit:
                break
            goal = T.r2(cue_s) if not placed else T.r2(cue_s + (1.0 if gap > 0 else -1.0) * (limit - 0.01))
            if not placed and abs(first - goal) <= 0.001:
                break
            delta = goal - first
            if abs(delta) < 0.001:
                delta = -0.01 if gap > 0 else 0.01
            _nudge_line(words, delta)
            changed = True
        if changed:
            moved += 1
    _trim_overlap(lyrics)
    return moved


def keep_cue_time(status: str, has_cue: bool, drift: float | None = None,
                  limit: float | None = None) -> bool:
    """Cue times stay unless the aligner is confident and agrees with the cue.

    A person placed the subtitle cue, and that start is the line's anchor. `drift` is
    |aligner line start − cue start| in seconds, before any snap. A confident aligner
    further than the gate still publishes the cue (the line is not proved). The gate
    is 0.30 s. A translation cue may pass its measured half. None means the aligner
    did not place the line. A line with no cue is not locked.
    """
    tol = Q.CUE_TOL if limit is None else float(limit)
    if not has_cue:
        return False
    if status != 'good':
        return True
    if drift is None or round(float(drift), 3) > tol:
        return True
    return False


def _cue_limit(unit: Unit, cues: dict[str, dict]) -> float:
    """0.30 s for the line's own language. The measured half for a translation cue."""
    cue = cues.get(unit.id)
    if not cue:
        return P.CUE_TOL
    return P.cue_accept_limit(unit.line.get('lang'), cue.get('lang'))


def line_drift(starts: list[float | None], roman: list[str], cue_start: float | None) -> float | None:
    """|first lettered aligner start − cue start|, or None when either side is missing."""
    if cue_start is None:
        return None
    placed = next((t for t, rm in zip(starts, roman) if rm and t is not None), None)
    if placed is None:
        return None
    return abs(float(placed) - float(cue_start))


def _pack_star(rec: dict | None, t0: int, window: tuple[float, float], method: str, cue: dict | None) -> dict:
    """One line's star pass, frames shifted back onto the whole-file axis."""
    if rec is None:
        return {'method': method, 'window': window, 'res': None, 'cue': cue}
    words = []
    for w in rec['words']:
        if w is None:
            words.append(None)
        else:
            words.append({'f0': t0 + int(w['f0']), 'f1': t0 + int(w['f1']) + 1, 'score': w['score']})
    placed_w = [w for w in words if w is not None]
    res = None
    if placed_w:
        res = {
            'words': words, 'gap': rec['gap'], 'score': rec['score'],
            'f0': min(w['f0'] for w in placed_w), 'f1': max(w['f1'] for w in placed_w),
        }
    return {'method': method, 'window': window, 'res': res, 'cue': cue}


def cue_pass(lp: np.ndarray, units: list[Unit], cues: dict[str, dict], duration: float) -> list[dict]:
    """Place each line inside its cue. Lines with no cue share one pass of their section."""
    results: list[dict | None] = [None] * len(units)
    uncued: list[Unit] = []
    for i, u in enumerate(units):
        cue = cues.get(u.id)
        if cue is None:
            uncued.append(u)
            continue
        prev = cues.get(units[i - 1].id) if i else None
        nxt = cues.get(units[i + 1].id) if i + 1 < len(units) else None
        prev_t = (float(prev['start']), float(prev['end'])) if prev else None
        nxt_t = (float(nxt['start']), float(nxt['end'])) if nxt else None
        win = cue_window(float(cue['start']), float(cue['end']), prev_t, nxt_t,
                         float(u.sec['start']), float(u.sec['end']), duration)
        if P.cue_is_translation(u.line.get('lang'), cue.get('lang')):
            # The ordinary window stays. A translation cue also searches ± the
            # measured half, fenced by the neighbour cues and the section.
            prev_end = None if prev is None else float(prev['end'])
            next_start = None if nxt is None else float(nxt['start'])
            lo, hi = P.translation_span(float(cue['start']), prev_end, next_start, P.TRANSLATION_HALF)
            lo = max(0.0, lo, float(u.sec['start']) - CUE_SECTION_PAD)
            hi = min(float(duration), hi, float(u.sec['end']) + CUE_SECTION_PAD)
            if hi < lo:
                lo = hi = float(cue['start'])
            win = (min(win[0], lo), max(win[1], hi))
        t0 = max(0, int(win[0] * FPS))
        t1 = min(len(lp), int(win[1] * FPS))
        placed = align_stars(lp[t0:t1], [u]) if t1 > t0 else None
        rec = placed[0] if placed else None
        results[u.idx] = _pack_star(rec, t0, win, 'cue', cue)
        print(f"cue {u.id}: {win[0]:.2f}–{win[1]:.2f} s", flush=True)
    for sec, group in _section_groups(uncued):
        placed = None
        t0 = t1 = 0
        for pad in (0.0, 2.0):
            t0 = max(0, int((float(sec['start']) - pad) * FPS))
            t1 = min(len(lp), int((float(sec['end']) + pad) * FPS))
            placed = align_stars(lp[t0:t1], group)
            if placed is not None:
                break
        window = (t0 / FPS, t1 / FPS)
        if placed is None:
            for u in group:
                results[u.idx] = {'method': 'section', 'window': window, 'res': None, 'cue': None}
            print(f"section {sec.get('id')}: text does not fit", flush=True)
            continue
        print(f"section {sec.get('id')}: {window[0]:.1f}–{window[1]:.1f} s", flush=True)
        for u, rec in zip(group, placed):
            results[u.idx] = _pack_star(rec, t0, window, 'section', None)
    return [r if r is not None else {'method': 'section', 'window': (0.0, 0.0), 'res': None, 'cue': None} for r in results]


# ---------------------------------------------------------------- passes

def anchor_in_section(a0: float, a1: float, sec_start: float, sec_end: float, slack: float = ANCHOR_SLACK) -> bool:
    """True when a global-pass span sits in the section map, slack included.

    Draft word times are not the fence. A span that starts in an earlier vocalise or runs into
    the next chorus is rejected, and the caller aligns that song by sections instead.
    """
    return sec_start - slack <= a0 <= sec_end + slack and sec_start - slack <= a1 <= sec_end + slack and a1 > a0


def anchor_pass(lp: np.ndarray, units: list[Unit], mode: str) -> dict[int, tuple[float, float]]:
    """Expected (start, end) seconds per unit index."""
    if mode == 'global':
        states = 2 * sum(len(u.tokens) for u in units) + 1
        if len(lp) * states > 1.5e9:  # back-pointer table would not fit comfortably
            print('anchors: text too long for one pass, using sections')
            mode = 'sections'
        else:
            res = align_window(lp, 0, len(lp), units)
            if res is None:
                print('anchors: global pass failed, using sections')
                mode = 'sections'
            else:
                # Kept even when a few spans leave their section. Replacing the whole path with a
                # section pass makes `agree` a distance to a coarse bound, and a line the model did
                # find is then thrown away as "text not found".
                return {u.idx: (r['f0'] / FPS, r['f1'] / FPS) for u, r in zip(units, res)}
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
        # The section map fences the search. A global anchor on an earlier vocalise must not
        # become this line's window. Draft word times are not a fence.
        fence_lo = float(u.sec['start']) - SECTION_PAD
        fence_hi = float((look or u).sec['end']) + SECTION_PAD
        t0 = max(prev_end, int(max(a_start - margin, fence_lo) * FPS))
        t1 = int(min(max(a_end + margin, fence_lo + 0.4), fence_hi) * FPS)
        if t1 < t0 + int(0.4 * FPS):
            t1 = t0 + int(0.4 * FPS)
        group = [u, look] if look else [u]
        res = align_window(lp, t0, t1, group)
        method = 'line'
        if res is None:  # window too short: try alone, then wider, still inside the section map
            alone_hi = min(anchors[u.idx][1] + 2 * margin, float(u.sec['end']) + SECTION_PAD)
            res = align_window(lp, t0, int(max(alone_hi, t0 / FPS + 0.4) * FPS), [u])
            method = 'line-alone'
        if res is None:
            results.append({'method': 'anchor', 'window': (t0 / FPS, t1 / FPS), 'res': None})
            prev_end = int(anchors[u.idx][1] * FPS)
            continue
        r = res[0]
        results.append({'method': method, 'window': (t0 / FPS, t1 / FPS), 'res': r})
        prev_end = r['f1']
    return results


def second_span(phrase_start: float, phrase_end: float, sec_start: float, sec_end: float, duration: float,
                prev_end: float | None = None, next_start: float | None = None,
                pad: float = 2.0, max_win: float = 12.0, sec_pad: float = 0.5) -> tuple[float, float]:
    """Search window for the second aligner.

    The phrase is the line pass (measured on the vocal stem, before any snap). Pad it by `pad`
    seconds, but stop at a neighbouring measured line: a 2 s pad on back-to-back lines feeds the
    next lyric to WhisperX, which then disagrees by that same 1–2 s. A smeared phrase is capped
    at `max_win`. The section map is a fence of `sec_pad`, not of `pad`. Draft word times are
    not a window and not a neighbour.
    """
    phrase_end = max(phrase_end, phrase_start)
    t0 = max(0.0, phrase_start - pad)
    t1 = min(duration, phrase_end + pad)
    if prev_end is not None:
        t0 = max(t0, min(phrase_start, float(prev_end)))
    if next_start is not None:
        t1 = min(t1, max(phrase_end, float(next_start)))
    if t1 < t0 + 0.4:
        t1 = min(duration, t0 + 0.4)
    if t1 - t0 > max_win:
        t1 = min(duration, t0 + max_win)
    sec0 = max(0.0, sec_start - sec_pad)
    sec1 = min(duration, sec_end + sec_pad)
    # Trim a pad that sticks out of the section. Do not drag a phrase that already sits
    # outside the section back in: that plays the wrong audio to the second aligner.
    if sec1 - sec0 >= 0.4 and phrase_end >= sec0 and phrase_start <= sec1:
        t0 = min(max(t0, sec0), sec1 - 0.4)
        t1 = max(min(t1, sec1), t0 + 0.4)
    return t0, t1


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


def _next_cue_start(units: list[Unit], cues: dict[str, dict], i: int) -> float | None:
    for nxt in units[i + 1:]:
        cue = cues.get(nxt.id)
        if cue is not None:
            return float(cue['start'])
    return None


def _chain_line(unit: Unit, cues: dict[str, dict]) -> bool:
    """Solo and choir lines with a cue. A duet is outside the song gate."""
    if cues.get(unit.id) is None:
        return False
    return T.group(unit.sec, unit.line) != 'other'


def star_seconds(lp: np.ndarray, unit: Unit, t0: float, t1: float) -> list[list[float] | None] | None:
    """Word [start, end] seconds on the whole-file axis, or None when the text does not fit."""
    a = max(0, int(float(t0) * FPS))
    b = min(len(lp), int(float(t1) * FPS))
    if b <= a:
        return None
    placed = align_stars(lp[a:b], [unit])
    if not placed:
        return None
    out: list[list[float] | None] = []
    for w in placed[0]['words']:
        if w is None:
            out.append(None)
        else:
            out.append([(a + int(w['f0'])) / FPS, (a + int(w['f1']) + 1) / FPS])
    return out


def seconds_from_engine(starts: list, roman: list[str], next_cue: float | None) -> list[list[float] | None]:
    """Start-only clocks need ends before the structural check. Punctuation stays empty."""
    index = []
    letter_starts: list[float | None] = []
    for i, (start, rm) in enumerate(zip(starts, roman)):
        if not rm:
            continue
        index.append(i)
        letter_starts.append(None if start is None else float(start))
    letter_ends = P.ends_from_starts(letter_starts, next_cue)
    out: list[list[float] | None] = [None] * len(roman)
    for i, start, end in zip(index, letter_starts, letter_ends):
        if start is None or end is None:
            continue
        if end < start:
            end = start + 0.02
        out[i] = [float(start), float(end)]
    return out


def _section(unit: Unit) -> tuple[float, float]:
    return (float(unit.sec['start']), float(unit.sec['end']))


def _placement_attempt(by: str, seconds, roman, cue_start, next_cue, window,
                       section: tuple[float, float] | None = None,
                       limit: float | None = None) -> dict:
    if not seconds:
        window_out = None if window is None else [round(float(window[0]), 2), round(float(window[1]), 2)]
        return {'by': by, 'placed': False, 'structure_ok': False, 'structure': 'missing',
                'delta': None, 'near': False, 'window': window_out}
    starts, ends = P.lettered_pairs(seconds, roman)
    judged = P.judge(starts, ends, cue_start, next_cue, section, limit=limit)
    # Lettered starts are in the structural check. Punctuation still has a time,
    # and the validator warns on every word, so the full list is checked too.
    if judged.get('placed') and not P.spans_inside(seconds, section):
        judged['placed'] = False
        judged['structure_ok'] = False
        judged['structure'] = 'outside-section'
    judged['by'] = by
    judged['window'] = None if window is None else [round(float(window[0]), 2), round(float(window[1]), 2)]
    return judged


def _adopt(c: dict, by: str, seconds: list, attempt: dict) -> None:
    c['placed_by'] = by
    c['chosen_seconds'] = [None if w is None else [float(w[0]), float(w[1])] for w in seconds]
    c['status'] = 'good'
    c['structure_ok'] = True
    c['structure'] = attempt.get('structure') or 'ok'
    c['attempts'].append(attempt)


def _copy_spans(seconds: list | None) -> list | None:
    if seconds is None:
        return None
    return [None if w is None else [float(w[0]), float(w[1])] for w in seconds]


def rescue_mms_windows(lp: np.ndarray, units: list[Unit], conf: list[dict], passes: list[dict],
                       cues: dict[str, dict], duration: float) -> int:
    """MMS again, from this cue to the next, on lines the first window did not place."""
    placed = 0
    for i, (u, c, p) in enumerate(zip(units, conf, passes)):
        if c.get('placed_by') is not None or not _chain_line(u, cues):
            continue
        cue = cues[u.id]
        cue_s, cue_e = float(cue['start']), float(cue['end'])
        nxt = _next_cue_start(units, cues, i)
        original = (float(p['window'][0]), float(p['window'][1]))
        for lead, tail in P.WINDOW_MARGINS:
            win = P.span_to_next(cue_s, cue_e, nxt, duration, lead, tail)
            if P.same_window(win, original):
                continue
            seconds = star_seconds(lp, u, win[0], win[1])
            attempt = _placement_attempt(
                'mms-window', seconds, u.roman, cue_s, nxt, win, _section(u), _cue_limit(u, cues))
            if attempt['placed'] and seconds is not None:
                _adopt(c, 'mms-window', seconds, attempt)
                placed += 1
                print(f"окно {u.id}: {win[0]:.2f}–{win[1]:.2f} с, |Δ| {attempt['delta']}", flush=True)
                break
            c['attempts'].append(attempt)
    return placed


def _mix_path(slug: str):
    """The original mix. The stem cache restores the four stems and not the mix.

    `find_source` raises SystemExit, which is not an Exception. The caller still
    has to catch that: a missing mix must not fail the alignment.
    """
    try:
        return find_source(slug)
    except SystemExit:
        import decrypt_audio
        decrypt_audio.main(slug)
        return find_source(slug)


def rescue_ft(slug: str, units: list[Unit], conf: list[dict], cues: dict[str, dict], duration: float) -> dict:
    """htdemucs_ft on the lines still open, one model load, inside the time budget.

    The song stem and its emission cache stay as they are. A failure leaves the lines unplaced.
    """
    info = {'ran': False, 'clips': 0, 'skipped': 0, 'elapsed_s': 0.0, 'budget_s': P.FT_BUDGET_S,
            'skipped_ids': [], 'error': None}
    open_rows = []
    for i, u in enumerate(units):
        if conf[i].get('placed_by') is not None or not _chain_line(u, cues):
            continue
        cue = cues[u.id]
        nxt = _next_cue_start(units, cues, i)
        t0, t1 = P.span_to_next(float(cue['start']), float(cue['end']), nxt, duration, 0.30, 0.0)
        open_rows.append((t0, t1, u.id))
    if not open_rows:
        return info
    merged = P.merge_spans(open_rows)
    kept, skipped = P.fit_budget(merged, P.FT_BUDGET_S)
    info['skipped_ids'] = skipped
    info['skipped'] = len(skipped)
    if not kept:
        info['error'] = 'budget'
        print(f'htdemucs_ft: бюджет {P.FT_BUDGET_S:.0f} с не вместил ни одного отрезка, пропущено строк {len(skipped)}', flush=True)
        return info
    try:
        # Resolve the mix before loading a model. A missing file must stay inside this handler.
        mix_path = _mix_path(slug)
        import torch
        import torchaudio

        mix = load_audio(mix_path, P.FT_RATE)
        vocals, separated = P.separate_ft_clips(mix, [(a, b) for a, b, _ids in kept])
        info.update(separated)
        info['skipped_ids'] = list(dict.fromkeys(list(skipped) + list(info.get('skipped_ids') or [])))
        info['ran'] = True
        del mix
        model = _mms_model()
        id_to_i = {u.id: i for i, u in enumerate(units)}
        for (t0, t1, ids), vocal in zip(kept, vocals):
            if vocal is None:
                for lid in ids:
                    c = conf[id_to_i[lid]]
                    if c.get('placed_by') is not None:
                        continue
                    c['attempts'].append({'by': 'mms-ft', 'placed': False, 'structure_ok': False,
                                          'structure': 'missing', 'delta': None, 'near': False, 'window': None})
                continue
            wave = torchaudio.functional.resample(torch.from_numpy(np.ascontiguousarray(vocal)), P.FT_RATE, F.SR)
            clip = emissions_array(wave.numpy().astype(np.float32), model)
            for lid in ids:
                i = id_to_i[lid]
                u, c = units[i], conf[i]
                if c.get('placed_by') is not None:
                    continue
                cue = cues[u.id]
                nxt = _next_cue_start(units, cues, i)
                win = P.span_to_next(float(cue['start']), float(cue['end']), nxt, duration, 0.30, 0.0)
                rel0 = max(0.0, win[0] - t0)
                rel1 = max(rel0 + 0.40, min(t1, win[1]) - t0)
                seconds = star_seconds(clip, u, rel0, rel1)
                if seconds:
                    seconds = [None if span is None else [span[0] + t0, span[1] + t0] for span in seconds]
                attempt = _placement_attempt(
                    'mms-ft', seconds, u.roman, float(cue['start']), nxt, (t0, t1), _section(u),
                    _cue_limit(u, cues))
                if attempt['placed'] and seconds is not None:
                    _adopt(c, 'mms-ft', seconds, attempt)
                    print(f"ft {u.id}: |Δ| {attempt['delta']}", flush=True)
                else:
                    c['attempts'].append(attempt)
        del model
    except (Exception, SystemExit) as e:
        info['ran'] = False
        info['error'] = f'{e.__class__.__name__}: {e}'
        print(f'htdemucs_ft пропущен ({info["error"]})', flush=True)
    return info


def _witness_lines(units: list[Unit], conf: list[dict], cues: dict[str, dict],
                   starts_by_id: dict) -> list[dict]:
    """|stable − MMS| on lines an MMS placer already kept, plus |start − cue|.

    The MMS time is the one that placed the line: the first window, a later window,
    or the ft stem. A word both clocks missed is left out of the share.
    """
    rows = []
    for u, c in zip(units, conf):
        if P.primary_family(c.get('placed_by')) != 'mms':
            continue
        starts = starts_by_id.get(u.id)
        if not starts or len(starts) != len(u.line['words']):
            continue
        chosen = c.get('chosen_seconds') or []
        deltas = []
        first = None
        for rm, span, start in zip(u.roman, list(chosen) + [None] * len(u.roman), starts):
            if not rm:
                continue
            if first is None and start is not None:
                first = float(start)
            if span is None or start is None:
                continue
            deltas.append(abs(float(start) - float(span[0])))
        cue = cues.get(u.id)
        cue_delta = None
        if cue is not None and first is not None:
            cue_delta = abs(first - float(cue['start']))
        rows.append({'lang': u.line['lang'], 'deltas': deltas, 'cue_delta': cue_delta})
    return rows


def _whisper_budget_s() -> float:
    """Seconds for the whole ladder. WHISPER_BUDGET_S overrides the default.

    A missing or unusable value keeps the default. The cap is 100 minutes so the
    separate 15 minute pass on unplaced lines still fits a 150 minute job.
    """
    raw = os.environ.get('WHISPER_BUDGET_S', '').strip()
    if not raw:
        return float(W.BUDGET_S)
    try:
        value = float(raw)
    except ValueError:
        return float(W.BUDGET_S)
    if value < 60.0 or value > 100 * 60:
        return float(W.BUDGET_S)
    return value


def run_whisper_witness(x: np.ndarray, jobs: list[dict], units: list[Unit], conf: list[dict],
                        cues: dict[str, dict]) -> tuple[dict, dict]:
    """Compare Whisper sizes on placed windows, then align the rest with the largest.

    Small and medium always run. A larger model runs only when its estimate fits
    the ladder budget (90 minutes unless WHISPER_BUDGET_S says otherwise). Every
    model that finishes keeps its word starts. The largest one places lines that
    are still open. It is not the proof witness. A model that does not finish
    leaves no times. Alignment itself does not fail.
    """
    budget = _whisper_budget_s()
    by_id = {j['id']: j for j in jobs}
    placed_jobs = []
    unplaced_jobs = []
    for i, u in enumerate(units):
        job = by_id.get(u.id)
        if job is None:
            continue
        if conf[i].get('placed_by'):
            placed_jobs.append(job)
        elif _chain_line(u, cues):
            unplaced_jobs.append(job)
    held: dict[str, dict] = {}

    def run_model(name: str, deadline):
        try:
            starts, info = engines.align_stable(x, placed_jobs, name, deadline)
        except Exception as e:
            return {'model': name, 'ran': False, 'complete': False, 'elapsed_s': 0.0,
                    'lines': len(placed_jobs), 'placed': 0, 'error': f'{e.__class__.__name__}: {e}',
                    'stopped': False, 'reason': None}
        if not info.get('complete'):
            starts = {}
        else:
            info['stats'] = W.agreement(_witness_lines(units, conf, cues, starts))
        held[name] = starts
        return info

    if not placed_jobs:
        # Nothing to compare. The chain can still try small on the lines still open.
        chosen, rows = 'small', [{'model': 'small', 'ran': False, 'complete': False, 'elapsed_s': 0.0,
                                 'reason': 'no-placed', 'lines': 0, 'placed': 0, 'error': None, 'stopped': False}]
    else:
        try:
            chosen, rows = W.ladder(run_model, budget_s=budget, clock=time.monotonic)
        except Exception as e:
            print(f'лестница stable-ts не собрана ({e.__class__.__name__}: {e})', flush=True)
            chosen, rows = None, [{'model': 'small', 'ran': False, 'complete': False, 'elapsed_s': 0.0,
                                   'reason': f'{e.__class__.__name__}: {e}', 'lines': len(placed_jobs),
                                   'placed': 0, 'error': f'{e.__class__.__name__}: {e}', 'stopped': False}]
    third: dict = {}
    if chosen and held.get(chosen):
        third.update(held[chosen])
    if chosen and unplaced_jobs:
        try:
            extra, extra_info = engines.align_stable(
                x, unplaced_jobs, chosen, time.monotonic() + W.UNPLACED_BUDGET_S)
        except Exception as e:
            extra, extra_info = {}, {'complete': False, 'elapsed_s': 0.0, 'lines': len(unplaced_jobs),
                                     'placed': 0, 'error': f'{e.__class__.__name__}: {e}', 'reason': None}
        if not extra_info.get('complete'):
            extra = {}
            print(f'stable-ts {chosen}: непоставленные строки не домерены '
                  f'({extra_info.get("error") or extra_info.get("reason") or "время"})', flush=True)
        else:
            third.update(extra)
        for row in rows:
            if row.get('model') == chosen:
                row['unplaced'] = {
                    'complete': bool(extra_info.get('complete')),
                    'elapsed_s': extra_info.get('elapsed_s'),
                    'lines': extra_info.get('lines'),
                    'placed': extra_info.get('placed'),
                    'error': extra_info.get('error'),
                    'reason': extra_info.get('reason'),
                }
    print(f'постановка stable-ts: наибольшая домеренная {chosen or "нет"}, бюджет {budget:.0f} с', flush=True)
    return third, {'model': chosen, 'budget_s': budget, 'rows': rows, 'clocks': held}


def _mark_engine(c: dict, prefix: str, attempt: dict) -> None:
    c[f'{prefix}_would'] = bool(attempt.get('placed'))
    c[f'{prefix}_near'] = bool(attempt.get('near'))
    c[f'{prefix}_structure'] = bool(attempt.get('structure_ok'))
    c['attempts'].append(attempt)


def adopt_engines(units: list[Unit], conf: list[dict], cues: dict[str, dict],
                  second_starts: dict, third_starts: dict, second_window: dict) -> tuple[int, int]:
    """stable-ts, then the second aligner, only where MMS has not placed the line.

    Both clocks are judged on every still-open line, including one a window or the
    ft stem already placed, so the report can say what they would have done.
    """
    n_stable = n_second = 0
    for i, u in enumerate(units):
        c = conf[i]
        if not _chain_line(u, cues):
            continue
        if c.get('placed_by') == 'mms':
            continue
        cue = cues[u.id]
        cue_s = float(cue['start'])
        nxt = _next_cue_start(units, cues, i)
        window = second_window.get(u.id)
        s3 = third_starts.get(u.id)
        if s3 is not None and len(s3) == len(u.line['words']):
            seconds = seconds_from_engine(s3, u.roman, nxt)
            attempt = _placement_attempt(
                'stable-ts', seconds, u.roman, cue_s, nxt, window, _section(u), _cue_limit(u, cues))
        else:
            seconds = None
            attempt = _placement_attempt(
                'stable-ts', None, u.roman, cue_s, nxt, window, _section(u), _cue_limit(u, cues))
        _mark_engine(c, 'stable', attempt)
        if c.get('placed_by') is None and attempt['placed'] and seconds is not None:
            # _mark_engine already stored the attempt. Do not store it twice.
            c['attempts'].pop()
            _adopt(c, 'stable-ts', seconds, attempt)
            n_stable += 1
        s2 = second_starts.get(u.id)
        if s2 is not None and len(s2) == len(u.line['words']):
            seconds = seconds_from_engine(s2, u.roman, nxt)
            attempt = _placement_attempt(
                'second', seconds, u.roman, cue_s, nxt, window, _section(u), _cue_limit(u, cues))
        else:
            seconds = None
            attempt = _placement_attempt(
                'second', None, u.roman, cue_s, nxt, window, _section(u), _cue_limit(u, cues))
        _mark_engine(c, 'second', attempt)
        if c.get('placed_by') is None and attempt['placed'] and seconds is not None:
            c['attempts'].pop()
            _adopt(c, 'second', seconds, attempt)
            n_second += 1
    return n_stable, n_second


def assemble_times(units: list[Unit], conf: list[dict], cues: dict[str, dict], duration: float):
    """Published times, and the pre-snap primary starts beside them.

    A placed line publishes the placer. Anything else with a cue is shifted onto the cue.
    """
    times: list[list[list[float]]] = []
    ctc_starts: list[list[float | None]] = []
    ctc_ends: list[list[float | None]] = []
    publish: list[bool] = []
    for u, c in zip(units, conf):
        n = len(u.roman)
        primary = c.get('chosen_seconds') if c.get('placed_by') else c.get('mms_seconds')
        if primary is None:
            primary = [None] * n
        if len(primary) < n:
            primary = list(primary) + [None] * (n - len(primary))
        raw = [None if w is None else float(w[0]) for w in primary[:n]]
        raw_e = [None if w is None else float(w[1]) for w in primary[:n]]
        ctc_starts.append(raw)
        ctc_ends.append(raw_e)
        cue = cues.get(u.id)
        drift = line_drift(raw, u.roman, None if cue is None else float(cue['start']))
        limit = None if cue is None else _cue_limit(u, cues)
        keep = keep_cue_time(c['status'], cue is not None, drift, limit=limit)
        use_aligner = (not keep) and c['status'] != 'draft'
        publish.append(use_aligner)
        if use_aligner:
            times.append([None if w is None else [float(w[0]), float(w[1])] for w in primary[:n]])
        else:
            copied = [[float(w['s']), float(w['e'])] for w in u.line['words']]
            if cue is not None:
                shift_block(copied, float(cue['start']))
            times.append(copied)
    fit_drafts(times, [c['status'] == 'draft' and not keep_cue_time(c['status'], u.id in cues)
                       for u, c in zip(units, conf)], duration)
    for ws in times:
        for j, w in enumerate(ws):
            if w is None:
                prev = next((ws[k] for k in range(j - 1, -1, -1) if ws[k] is not None), None)
                nxt = next((ws[k] for k in range(j + 1, len(ws)) if ws[k] is not None), None)
                t = prev[1] if prev else (nxt[0] - 0.01 if nxt else 0.0)
                ws[j] = [t, t + 0.01]
    return times, ctc_starts, ctc_ends, publish


def _placement_summary(report_lines: list[dict], conf: list[dict], units: list[Unit], ft_info: dict) -> dict:
    """Why the first MMS pass missed, who placed the line, and the 0.30–0.70 s disputes."""
    by_id = {u.id: c for u, c in zip(units, conf)}
    rows = []
    for rec in report_lines:
        if rec.get('group') == 'other':
            continue
        c = by_id.get(rec['id']) or {}
        attempts = c.get('attempts') or []
        rows.append({
            'lang': rec.get('lang'),
            'mms_placed': c.get('placed_by') == 'mms',
            'mms_missing': bool(rec.get('mms_missing')),
            'mms_structure_ok': bool(rec.get('mms_structure_ok')),
            'mms_delta': rec.get('mms_delta'),
            'second_placed': bool(c.get('second_would')),
            'second_near': bool(c.get('second_near')),
            'second_structure': bool(c.get('second_structure')),
            'stable_placed': bool(c.get('stable_would')),
            'stable_near': bool(c.get('stable_near')),
            'stable_structure': bool(c.get('stable_structure')),
            'window_placed': any(a.get('by') == 'mms-window' and a.get('placed') for a in attempts),
            'ft_placed': any(a.get('by') == 'mms-ft' and a.get('placed') for a in attempts),
        })
    disputes = [rec['dispute'] for rec in report_lines if rec.get('dispute')]
    choir = [rec for rec in report_lines if rec.get('group') == 'choir']
    finale_ids = {rec['id'] for rec in choir if str(rec['id']).startswith('eckhart-f-')}
    finale = [rec for rec in choir if rec['id'] in finale_ids]
    verses = [rec for rec in choir if rec['id'] not in finale_ids]

    def pack(lines: list[dict]) -> dict:
        counts: dict[str, int] = {}
        for rec in lines:
            name = rec.get('placed_by')
            if name:
                counts[name] = counts.get(name, 0) + 1
        deltas = [float(rec['mms_delta']) for rec in lines if rec.get('mms_delta') is not None]
        ids = {rec['id'] for rec in lines}
        band = [row for row in disputes if row.get('id') in ids]
        starts = sorted(float(rec['cue_start']) for rec in lines if rec.get('cue_start') is not None)
        gaps = [round(b - a, 3) for a, b in zip(starts, starts[1:])]
        return {
            'n': len(lines),
            'placed': sum(counts.values()),
            'by': counts,
            'median_mms_delta': None if not deltas else round(float(np.median(deltas)), 3),
            'dispute': len(band),
            'dispute_agree': sum(1 for row in band if row.get('agree')),
            'dispute_attack': sum(1 for row in band if row.get('attack')),
            'cue_gap_median': None if not gaps else round(float(np.median(gaps)), 3),
            'cue_gap_min': None if not gaps else round(min(gaps), 3),
            'cue_gaps': gaps,
        }

    by: dict[str, int] = {}
    for rec in report_lines:
        if rec.get('group') == 'other' or not rec.get('placed_by'):
            continue
        by[rec['placed_by']] = by.get(rec['placed_by'], 0) + 1
    return {
        'by': by,
        'unplaced': P.summarize_unplaced(rows),
        'dispute': disputes,
        'dispute_n': len(disputes),
        'dispute_agree': sum(1 for row in disputes if row.get('agree')),
        'dispute_attack': sum(1 for row in disputes if row.get('attack')),
        'choir': {'all': pack(choir), 'verses': pack(verses), 'finale': pack(finale)},
        'ft': ft_info or {'ran': False},
    }


def _clock_round(value: float | None, kind: str | None) -> float | None:
    """Whisper stays at two decimals, as the report always stored it. MMS and stable-ts keep three."""
    if value is None:
        return None
    if kind in ('mms', 'stable-ts'):
        return round(float(value), 3)
    return round(float(value), 2)


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
        raise SystemExit('song.json: timing.status = verified — владелец уже принял время после прослушивания. Перезапись: --force')
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

    # The search window is the official cue, not the draft s/e and not the previous line's end.
    # A line with no cue falls back to its vocal section. The section map is only a fence.
    cues = load_cues(slug)
    passes = cue_pass(lp, units, cues, duration)

    # Voice activity for word-end extension and onset snapping.
    act, _ = F.activity(F.rms_db(x))

    def active(t: float) -> bool:
        k = int(t / F.HOP)
        return 0 <= k < len(act) and bool(act[k])

    # Placement per line. A cued line is structure plus |Δ| ≤ 0.30 s. The score is
    # stored and does not reject it. A line with no cue still needs the calibrated score.
    metric_name, threshold = Cal.load_gate()
    print(f'отбор: с репликой — структура и |Δ| ≤ {Q.PROOF_CUE_TOL:.2f} с; без реплики — {metric_name} ≥ {threshold:.3f}', flush=True)
    conf = []
    for i, (u, p) in enumerate(zip(units, passes)):
        r = p['res']
        placed_words = r['words'] if r else [None] * len(u.roman)
        scores = [None if w is None else round(w['score'], 3) for w in placed_words]
        letter, word_mean, word_min, _n_letters = Cal._metric_values(r, u.roman, placed_words)
        values = {'letter': letter, 'word_mean': word_mean, 'word_min': word_min}
        metric_value = values.get(metric_name)
        score = 0.0 if letter is None else float(letter)
        gap = r['gap'] if r else 99.0
        agree = 0.0
        missing = r is None or any(rm and w is None for rm, w in zip(u.roman, placed_words))
        starts: list[float | None] = []
        ends: list[float | None] = []
        for rm, w in zip(u.roman, placed_words):
            if not rm:
                continue
            if w is None:
                starts.append(None)
                ends.append(None)
            else:
                starts.append(w['f0'] / FPS)
                ends.append(w['f1'] / FPS)
        next_cue = None
        for nxt in units[i + 1:]:
            nxt_cue = cues.get(nxt.id)
            if nxt_cue is not None:
                next_cue = float(nxt_cue['start'])
                break
        section = (float(u.sec['start']), float(u.sec['end']))
        mms_seconds: list[list[float] | None] = []
        for w in placed_words:
            if w is None:
                mms_seconds.append(None)
            else:
                mms_seconds.append([w['f0'] / FPS, w['f1'] / FPS])
        structure_ok, structure = (False, 'missing') if missing else Cal.structural(starts, ends, next_cue, section)
        if structure_ok and not P.spans_inside(mms_seconds, section):
            structure_ok, structure = False, 'outside-section'
        cue = cues.get(u.id)
        raw_drift = [None if w is None else w['f0'] / FPS for w in placed_words]
        delta = line_drift(raw_drift, u.roman, None if cue is None else float(cue['start']))
        accept = _cue_limit(u, cues)
        near = delta is not None and round(delta, 3) <= accept
        score_ok = (not missing) and metric_value is not None and float(metric_value) >= threshold
        status = placement_status(missing or r is None, score_ok, structure_ok, near, cue is not None)
        placed_now = status == 'good'
        conf.append({
            'scores': scores, 'score': score, 'gap': gap, 'agree': agree, 'status': status,
            'structure_ok': structure_ok, 'structure': structure,
            'metric': metric_name, 'metric_value': metric_value, 'threshold': threshold,
            'mms_seconds': mms_seconds,
            'chosen_seconds': _copy_spans(mms_seconds) if placed_now else None,
            'placed_by': 'mms' if placed_now else None,
            'mms_missing': bool(missing or r is None),
            'mms_structure_ok': bool(structure_ok),
            'mms_structure': structure,
            'mms_delta': None if delta is None else round(float(delta), 3),
            'attempts': [],
            'stable_would': False, 'stable_near': False, 'stable_structure': False,
            'second_would': False, 'second_near': False, 'second_structure': False,
        })

    # Lines the first MMS pass already placed keep that pass. The chain runs only
    # where it did not. Their witness window stays the pre-snap phrase, so a line
    # that was already placed is not re-measured on a wider span.
    orig_good = {u.id for u, c in zip(units, conf) if c['status'] == 'good'}
    n_window = rescue_mms_windows(lp, units, conf, passes, cues, duration)
    ft_info = rescue_ft(slug, units, conf, cues, duration)

    # Phrase for the original good lines, before any snap and before a later aligner
    # is allowed to place what MMS missed. Newly placed lines are not a fence yet:
    # a neighbour that was not good on the first pass is still fenced by its cue.
    times, ctc_starts, ctc_ends, publish = assemble_times(units, conf, cues, duration)
    phrase = [(ws[0][0], ws[-1][1]) for ws in times]
    jobs = []
    second_window: dict[str, tuple[float, float]] = {}
    fence_start: list[float | None] = []
    fence_end: list[float | None] = []
    for u, span in zip(units, phrase):
        cue = cues.get(u.id)
        if u.id in orig_good:
            fence_start.append(span[0])
            fence_end.append(span[1])
        elif cue is not None:
            fence_start.append(float(cue['start']))
            fence_end.append(float(cue['end']))
        else:
            fence_start.append(None)
            fence_end.append(None)
    for i, u in enumerate(units):
        if T.group(u.sec, u.line) == 'other':
            continue
        cue = cues.get(u.id)
        if u.id in orig_good or (cue is None and conf[i]['status'] == 'good'):
            span = phrase[i]
            prev_end = next((fence_end[j] for j in range(i - 1, -1, -1) if fence_end[j] is not None), None)
            next_start = next((fence_start[j] for j in range(i + 1, len(fence_start)) if fence_start[j] is not None), None)
            t0, t1 = second_span(span[0], span[1], float(u.sec['start']), float(u.sec['end']), duration,
                                 prev_end, next_start)
        elif cue is not None:
            t0, t1 = P.span_to_next(float(cue['start']), float(cue['end']), _next_cue_start(units, cues, i),
                                    duration, CUE_LEAD, 0.0)
        else:
            continue
        second_window[u.id] = (t0, t1)
        jobs.append({'id': u.id, 'lang': u.line['lang'], 'script': u.line['script'],
                     'words': [w['w'] for w in u.line['words']], 't0': t0, 't1': t1})
    second_starts, second_name = engines.align_jobs(args.second, x, jobs)
    third_starts, witness_info = run_whisper_witness(x, jobs, units, conf, cues)
    n_stable, n_second = adopt_engines(units, conf, cues, second_starts, third_starts, second_window)
    by_counts: dict[str, int] = {}
    for c in conf:
        if c.get('placed_by'):
            by_counts[c['placed_by']] = by_counts.get(c['placed_by'], 0) + 1
    print(f"цепочка: окно {n_window}, ft {by_counts.get('mms-ft', 0)}, stable-ts {n_stable}, "
          f"второй {n_second}; поставлено {sum(by_counts.values())}", flush=True)

    # Rebuild after the chain. Snap runs once, on the placer's times.
    times, ctc_starts, ctc_ends, publish = assemble_times(units, conf, cues, duration)
    sig = Q.Signals(x)
    onset_dt = snap_onsets(sig, times, units, publish)
    flat = [(w, pub) for ws, pub in zip(times, publish) for w in ws]
    for j, (w, measured) in enumerate(flat):
        if not measured:
            continue
        limit = flat[j + 1][0][0] if j + 1 < len(flat) else duration
        limit = min(limit, w[1] + MAX_EXTEND)
        e = w[1]
        while e + F.HOP <= limit and active(e):
            e += F.HOP
        w[1] = max(w[1], min(e, limit))
    for ws, u, pub in zip(times, units, publish):
        if not pub:
            continue
        cue = cues.get(u.id)
        if cue is None:
            continue
        clamp_block(ws, float(cue['start']), _cue_limit(u, cues))

    # Borrowed checkpoints on every cued line of tr, az and la. The cue window, not the
    # phrase the first aligner already placed, so a language is not graded only on the
    # lines MMS kept. Adoption is decided later, on these times, not here.
    borrow_by_line: dict[str, dict[str, list]] = {}
    probe_jobs, probe_meta = borrow_jobs(units, cues, duration)
    if probe_jobs:
        try:
            probed = engines.run_engine('whisperx', x, probe_jobs)
        except Exception as e:
            print(f'проба чужой модели недоступна ({e.__class__.__name__}: {e})')
            probed = {}
        for line_id, model_lang, jid in probe_meta:
            got = probed.get(jid)
            n_words = next(len(u.line['words']) for u in units if u.id == line_id)
            if got is None or len(got) != n_words:
                continue
            borrow_by_line.setdefault(line_id, {})[model_lang] = got

    # The sync check on the final times, line by line.
    qa = Q.check_lines(sig, [[{'w': w['w'], 's': t[0], 'e': t[1]} for w, t in zip(u.line['words'], ws)] for u, ws in zip(units, times)],
                       [u.sec['id'] for u in units])

    def _first_value(values, roman) -> float | None:
        if not values:
            return None
        for value, rm in zip(values, roman):
            if rm and value is not None:
                return float(value)
        return None

    dispute_peaks = Q.onset_peak_times(sig, min_height=0.7)
    report_lines, good, placed = [], set(), set()
    for u, p, ws, c, raw, raw_e, odt, q, pub in zip(units, passes, times, conf, ctc_starts, ctc_ends, onset_dt, qa, publish):
        status, scores, score, gap, agree = c['status'], c['scores'], c['score'], c['gap'], c['agree']
        s2 = second_starts.get(u.id)
        if s2 is not None and len(s2) != len(u.line['words']):
            s2 = None
        s3 = third_starts.get(u.id)
        if s3 is not None and len(s3) != len(u.line['words']):
            s3 = None
        borrowed = borrow_by_line.get(u.id) or {}
        mms_seconds = c.get('mms_seconds') or []
        words_out, proven_n, letters_n = [], 0, 0
        for wi, (w, rm, t, sc) in enumerate(zip(u.line['words'], u.roman, ws, scores)):
            has_letters = bool(rm)
            e2 = float(s2[wi]) if (s2 and s2[wi] is not None) else None
            e3 = float(s3[wi]) if (s3 and s3[wi] is not None) else None
            mms_t = None
            if wi < len(mms_seconds) and mms_seconds[wi] is not None:
                mms_t = float(mms_seconds[wi][0])
            # The placer's pre-snap start is already `raw`. The other two clocks are the witnesses.
            slot2, kind2, slot3, kind3 = P.witness_slots(c.get('placed_by'), mms_t, e2, e3)
            borrow_times = {}
            # `times` above is every line's (start, end) pairs and is written after this
            # loop. A loop variable here would replace that list with one model's starts.
            for model_lang, model_starts in borrowed.items():
                if wi < len(model_starts) and model_starts[wi] is not None:
                    borrow_times[model_lang] = round(float(model_starts[wi]), 3)
            stable_models = {}
            for model_name, by_line in (witness_info.get('clocks') or {}).items():
                starts = by_line.get(u.id)
                if not starts or wi >= len(starts) or starts[wi] is None:
                    continue
                stable_models[str(model_name)] = round(float(starts[wi]), 3)
            placement_model = witness_info.get('model')
            if placement_model and e3 is not None and placement_model not in stable_models:
                stable_models[str(placement_model)] = round(float(e3), 3)
            tol = Q.CHOIR_TOL if T.group(u.sec, u.line) == 'choir' else ENGINE_AGREE
            engines_agree = None if slot2 is None or raw[wi] is None else bool(abs(slot2 - raw[wi]) <= tol)
            onset_ok = odt[wi] is not None
            # Report note only. The line flag is qa_sync.proof_line.
            proven = (status == 'good' and q['verdict'] == 'ok' and engines_agree is True
                      and (onset_ok or args.proof != 'strict'))
            if has_letters:
                letters_n += 1
                proven_n += proven
            words_out.append({'w': w['w'], 'roman': rm, 's': round(t[0], 2), 'e': round(t[1], 2), 'draft_s': w['s'],
                              'score': sc, 'ctc_s': None if raw[wi] is None else round(raw[wi], 3),
                              'ctc_e': None if raw_e[wi] is None else round(raw_e[wi], 3),
                              'second_s': _clock_round(slot2, kind2),
                              'third_s': _clock_round(slot3, kind3),
                              'second_kind': kind2, 'third_kind': kind3,
                              'clock_mms': None if mms_t is None else round(mms_t, 3),
                              'clock_second': None if e2 is None else round(float(e2), 3),
                              'clock_stable': None if e3 is None else round(float(e3), 3),
                              'stable_models': stable_models,
                              'borrow': borrow_times,
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
        cue = cues.get(u.id)
        ctc_line = next((t for t, rm in zip(raw, u.roman) if rm and t is not None), None)
        mms_line = _first_value([None if span is None else span[0] for span in mms_seconds], u.roman)
        second_line = _first_value(s2, u.roman) if s2 else None
        stable_line = _first_value(s3, u.roman) if s3 else None
        group = T.group(u.sec, u.line)
        dispute = None
        if group != 'other':
            dispute = P.dispute_row(u.id, u.line['lang'], group,
                                    None if cue is None else float(cue['start']),
                                    mms_line, second_line, stable_line, dispute_peaks)
        report_lines.append({
            'id': u.id, 'section': u.sec['id'], 'lang': u.line['lang'], 'text': T.line_text(u.line),
            'solo': T.is_solo(u.sec, u.line), 'group': T.group(u.sec, u.line), 'second': second_name.get(u.id),
            'status': status, 'level': level, 'conf': round(proven_n / letters_n, 2) if letters_n else 0.0,
            'qa': q['verdict'], 'qa_offset': q['offset'], 'method': p['method'],
            'window': [round(p['window'][0], 2), round(p['window'][1], 2)],
            'second_window': ([round(second_window[u.id][0], 2), round(second_window[u.id][1], 2)]
                              if u.id in second_window else None),
            'start': round(ws[0][0], 2), 'end': round(ws[-1][1], 2),
            'draft_start': u.draft[0], 'shift': round(ws[0][0] - u.draft[0], 2),
            'anchor_start': round(p['window'][0], 2), 'agree': round(agree, 2),
            'cue_start': None if cue is None else round(float(cue['start']), 3),
            'cue_end': None if cue is None else round(float(cue['end']), 3),
            'cue_lang': None if cue is None else cue.get('lang'),
            'ctc_start': None if ctc_line is None else round(ctc_line, 3),
            'time_source': c['placed_by'] if pub and c.get('placed_by') else ('cue' if cue is not None else 'draft'),
            'placed_by': c.get('placed_by'),
            'mms_start': None if mms_line is None else round(mms_line, 3),
            'mms_delta': c.get('mms_delta'),
            'mms_missing': bool(c.get('mms_missing')),
            'mms_structure_ok': bool(c.get('mms_structure_ok')),
            'score': round(score, 3), 'gap': round(gap, 3),
            'metric': c['metric'], 'metric_value': None if c['metric_value'] is None else round(float(c['metric_value']), 4),
            'structure_ok': c['structure_ok'], 'structure': c['structure'],
            'dispute': dispute,
            'words': words_out,
        })

    # Times are written for every requested line. The flag stays on: qa_sync.py --apply is the
    # only step that may clear timing-draft, and only for a line it can prove.
    level_of = {r['id']: r['level'] for r in report_lines}
    for u, ws, pub, c in zip(units, times, publish, conf):
        if only and u.id not in only:
            continue
        for w, t in zip(u.line['words'], ws):
            w['s'], w['e'] = T.r2(t[0]), T.r2(t[1])
        T.set_flag(u.line, 'timing-draft', True)
        if pub and c.get('placed_by'):
            u.line['placedBy'] = c['placed_by']
        else:
            u.line.pop('placedBy', None)
    fixes = T.enforce_order(lyrics)
    placed_ids = {u.id for u, pub in zip(units, publish) if pub}
    locked = lock_written_cues(lyrics, cues, placed_ids, only)
    edge_fixes = T.fit_section_edges(lyrics)
    pulled = T.pull_outside_starts(lyrics)
    by_written = {line['id']: line for _, line in T.vocal_lines(lyrics)}
    for rec in report_lines:
        line = by_written.get(rec['id'])
        if not line or not line.get('words'):
            continue
        rec['start'] = line['words'][0]['s']
        rec['end'] = line['words'][-1]['e']
        rec['shift'] = round(rec['start'] - rec['draft_start'], 2)
        for rw, w in zip(rec['words'], line['words']):
            rw['s'], rw['e'] = w['s'], w['e']
    section_notes = T.fit_sections(lyrics, song['duration'], placed) if args.move_sections else []

    n, n_good = len(units), len(good)
    n_weak = sum(r['status'] == 'weak' for r in report_lines)
    n_draft = sum(r['status'] == 'draft' for r in report_lines)
    levels = {lv: sum(r['level'] == lv for r in report_lines) for lv in ('word', 'line', 'none')}
    shifts = np.array([abs(r['shift']) for r in report_lines if r['status'] == 'good'])
    cue_deltas = [abs(r['ctc_start'] - r['cue_start']) for r in report_lines
                  if r['status'] in ('good', 'weak') and r['ctc_start'] is not None and r['cue_start'] is not None]
    ws_good = [w for r in report_lines if r['status'] == 'good' for w in r['words'] if w['roman']]
    pair = np.array([abs(w['second_s'] - w['ctc_s']) for w in ws_good if w['second_s'] is not None and w['ctc_s'] is not None])
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
        'found': n_good + n_weak,
        'cue_n': len(cue_deltas),
        'cue_median': round(float(np.median(cue_deltas)), 3) if cue_deltas else None,
        'order_fixes': fixes,
        'cue_locks': locked,
        'section_edge_fixes': edge_fixes,
        'outside_start_pulls': pulled,
        'third_engine': 'stable-ts',
        'placement_model': witness_info.get('model'),
        'stable_model': witness_info.get('model'),
        'proof_models': {},
        'whisper_budget_s': witness_info.get('budget_s'),
        'whisper_witness': witness_info.get('rows') or [],
        'third_compared': sum(1 for w in ws_good if w.get('third_s') is not None and w.get('ctc_s') is not None),
        'placement': _placement_summary(report_lines, conf, units, ft_info),
    }
    report = {
        'slug': slug, 'created': t_start.isoformat(timespec='seconds'), 'audio': audio.name, 'stem': is_stem,
        'engine': 'torchaudio MMS_FA + uroman, CTC Viterbi', 'second': summary['second_engine'],
        'anchors': 'cue' if cues else 'section', 'margin': CUE_LEAD if cues else margin,
        'thresholds': {'metric': metric_name, 'score': threshold, 'fallback_score': GOOD_SCORE,
                       'gap_recorded': GOOD_GAP, 'agree': GOOD_AGREE, 'keep_score': KEEP_SCORE,
                       'keep_agree': KEEP_AGREE, 'snap_win': SNAP_WIN, 'snap_min': Q.PEAK_HEIGHT, 'engine_agree': ENGINE_AGREE,
                       'cue_tol': Q.CUE_TOL, 'cue_lead': CUE_LEAD, 'cue_tail': CUE_TAIL, 'cue_overlap': CUE_OVERLAP},
        'summary': summary, 'sections': section_notes, 'lines': report_lines,
    }
    # Phoneme clocks are a witness. The same pass may propose starts for
    # still-unplaced Latin lines under summary.phoneme.latin_place. Those
    # starts are not written into the lyrics here: the prove job keeps a
    # placement only when proved lines rise and the gates still hold.
    # A failure must not drop the Whisper clocks or the align report.
    try:
        import phoneme
        phoneme.measure(x, report)
    except Exception as e:
        print(f'фонемный свидетель не посчитан ({e.__class__.__name__}: {e})', flush=True)
        report.setdefault('summary', {})['phoneme_error'] = f'{e.__class__.__name__}: {e}'
    wd = work_dir(slug)
    (wd / 'align-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    clock_path = ROOT / 'docs' / 'analysis' / slug / 'whisper-clocks.json'
    clock_path.parent.mkdir(parents=True, exist_ok=True)
    clock_path.write_text(
        json.dumps(W.clock_cache(report, witness_info.get('model')), ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8')

    timing_note = (f'align.py {t_start:%Y-%m-%d}: времена слов записаны, все строки помечены timing-draft. '
                   f'Выравниватель уверен в {n_good} из {n}, не нашёл текст в {n_draft}. '
                   f'Статус aligned ставит только qa_sync.py --apply, если каждая группа строк (соло и хор, где она есть) доказана не меньше чем на 90 %. '
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

    print(f"\nСтрок: {n}. Найдено: {n_good + n_weak}. Уверен: {n_good}, не уверен: {n_weak}, не нашёл текст: {n_draft}.")
    if cue_deltas:
        print(f"Реплика: медиана |начало строки − начало реплики| {float(np.median(cue_deltas)):.3f} с по {len(cue_deltas)} найденным строкам.")
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
