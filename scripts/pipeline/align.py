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
   align.py does not decide the flag. It marks every line `timing-draft` and leaves
   `timing.status` at `draft`. qa_sync.py --apply clears the flag only for a placed line
   whose words the measured rule proves. The default, when no rule file exists, is an
   attack within 0.10 s (0.20 s choir), or, for a vowel, legato or melisma with no
   attack within 0.30 s, a second aligner within 0.10 s. The song becomes `aligned`
   only when every group that exists is at least 80 % proved.

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
import re
import sys
import unicodedata

import numpy as np

import calibrate_score as Cal
import engines
import features as F
import qa_sync as Q
import timing as T
from ctc import token_spans, viterbi
from common import ROOT, dump_json, load_audio, load_json, song_dir, vocal_stem, work_dir

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
        changed = False
        for _ in range(8):
            first = float(words[0]['s'])
            gap = first - cue_s
            if placed and round(abs(gap), 3) <= Q.CUE_TOL:
                break
            goal = T.r2(cue_s) if not placed else T.r2(cue_s + (1.0 if gap > 0 else -1.0) * (Q.CUE_TOL - 0.01))
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


def keep_cue_time(status: str, has_cue: bool, drift: float | None = None) -> bool:
    """Cue times stay unless the aligner is confident and agrees with the cue.

    A person placed the subtitle cue, and that start is the line's anchor. `drift` is
    |aligner line start − cue start| in seconds, before any snap. A confident aligner
    further than CUE_TOL still publishes the cue (the line is not proved). None means
    the aligner did not place the line. A line with no cue is not locked.
    """
    if not has_cue:
        return False
    if status != 'good':
        return True
    if drift is None or round(float(drift), 3) > Q.CUE_TOL:
        return True
    return False


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
        structure_ok, structure = (False, 'missing') if missing else Cal.structural(starts, ends, next_cue)
        cue = cues.get(u.id)
        raw_drift = [None if w is None else w['f0'] / FPS for w in placed_words]
        delta = line_drift(raw_drift, u.roman, None if cue is None else float(cue['start']))
        near = delta is not None and round(delta, 3) <= Q.PROOF_CUE_TOL
        score_ok = (not missing) and metric_value is not None and float(metric_value) >= threshold
        status = placement_status(missing or r is None, score_ok, structure_ok, near, cue is not None)
        conf.append({
            'scores': scores, 'score': score, 'gap': gap, 'agree': agree, 'status': status,
            'structure_ok': structure_ok, 'structure': structure,
            'metric': metric_name, 'metric_value': metric_value, 'threshold': threshold,
        })

    # Word times (seconds). Aligner times are published only for a placed line, which is
    # already within 0.30 s of the cue. Anything else that has a cue is shifted so its
    # first word starts on the cue. Copying the stored s/e left shushtari-s2 at 489.82
    # while the cue is 486.296. A draft with no cue is still fitted between neighbours.
    times: list[list[list[float] | None]] = []
    ctc_starts: list[list[float | None]] = []
    ctc_ends: list[list[float | None]] = []
    publish: list[bool] = []
    for u, p, c in zip(units, passes, conf):
        placed: list[list[float] | None] = [None] * len(u.roman)
        if p['res'] is not None:
            for wi, w in enumerate(p['res']['words']):
                if w is not None:
                    placed[wi] = [w['f0'] / FPS, w['f1'] / FPS]
        raw = [None if w is None else w[0] for w in placed]
        ctc_starts.append(raw)
        ctc_ends.append([None if w is None else w[1] for w in placed])
        cue = cues.get(u.id)
        drift = line_drift(raw, u.roman, None if cue is None else float(cue['start']))
        keep = keep_cue_time(c['status'], cue is not None, drift)
        use_aligner = (not keep) and c['status'] != 'draft'
        publish.append(use_aligner)
        if use_aligner:
            times.append([None if w is None else [w[0], w[1]] for w in placed])
        else:
            copied = [[w['s'], w['e']] for w in u.line['words']]
            if cue is not None:
                shift_block(copied, float(cue['start']))
            times.append(copied)
    fit_drafts(times, [c['status'] == 'draft' and not keep_cue_time(c['status'], u.id in cues)
                       for u, c in zip(units, conf)], duration)

    # Words without letters (punctuation): a 10 ms slot right after the previous word.
    for ws in times:
        for j, w in enumerate(ws):
            if w is None:
                prev = next((ws[k] for k in range(j - 1, -1, -1) if ws[k] is not None), None)
                nxt = next((ws[k] for k in range(j + 1, len(ws)) if ws[k] is not None), None)
                t = prev[1] if prev else (nxt[0] - 0.01 if nxt else 0.0)
                ws[j] = [t, t + 0.01]

    # Word starts move to the nearest clear vocal onset (see snap_onsets); ends follow the voice.
    # The second aligner needs the phrase from before that move.
    sig = Q.Signals(x)
    phrase = [(ws[0][0], ws[-1][1]) for ws in times]
    # Snap and voice-end extension only where the aligner time is the one we publish.
    # A cue we kept must stay the cue, not an onset near it.
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

    # Snap can walk a start that was 0.30 s from the cue out to 0.40 s. Pull the
    # published line back by the excess so the written first word stays inside.
    for ws, u, pub in zip(times, units, publish):
        if not pub:
            continue
        cue = cues.get(u.id)
        if cue is None:
            continue
        clamp_block(ws, float(cue['start']), Q.CUE_TOL)

    # Second opinion on solo and choir lines the cue window placed confidently. The window is
    # the measured phrase, padded, but cut at the neighbouring line: a good neighbour by its
    # aligner edge, any other neighbour by its cue. Draft word times are not used. A duet or
    # a tutti stays out.
    jobs = []
    second_window: dict[str, tuple[float, float]] = {}
    fence_start: list[float | None] = []
    fence_end: list[float | None] = []
    for u, c, span in zip(units, conf, phrase):
        cue = cues.get(u.id)
        if c['status'] == 'good':
            fence_start.append(span[0])
            fence_end.append(span[1])
        elif cue is not None:
            fence_start.append(float(cue['start']))
            fence_end.append(float(cue['end']))
        else:
            fence_start.append(None)
            fence_end.append(None)
    for i, (u, c, span) in enumerate(zip(units, conf, phrase)):
        if c['status'] != 'good' or T.group(u.sec, u.line) == 'other':
            continue
        prev_end = next((fence_end[j] for j in range(i - 1, -1, -1) if fence_end[j] is not None), None)
        next_start = next((fence_start[j] for j in range(i + 1, len(fence_start)) if fence_start[j] is not None), None)
        t0, t1 = second_span(span[0], span[1], float(u.sec['start']), float(u.sec['end']), duration,
                             prev_end, next_start)
        second_window[u.id] = (t0, t1)
        jobs.append({'id': u.id, 'lang': u.line['lang'], 'script': u.line['script'],
                     'words': [w['w'] for w in u.line['words']], 't0': t0, 't1': t1})
    second_starts, second_name = engines.align_jobs(args.second, x, jobs)

    # Third witness: stable-ts on the same placed lines and the same windows. A failure
    # leaves the column empty. It does not fail the alignment.
    third_starts: dict[str, list] = {}
    if jobs:
        try:
            third_starts = engines.run_engine('stable-ts', x, jobs)
        except Exception as e:
            print(f'stable-ts недоступен ({e.__class__.__name__}: {e})')

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
        words_out, proven_n, letters_n = [], 0, 0
        for wi, (w, rm, t, sc) in enumerate(zip(u.line['words'], u.roman, ws, scores)):
            has_letters = bool(rm)
            e2 = float(s2[wi]) if (s2 and s2[wi] is not None) else None
            e3 = float(s3[wi]) if (s3 and s3[wi] is not None) else None
            borrow_times = {}
            for model_lang, times in borrowed.items():
                if wi < len(times) and times[wi] is not None:
                    borrow_times[model_lang] = round(float(times[wi]), 3)
            tol = Q.CHOIR_TOL if T.group(u.sec, u.line) == 'choir' else ENGINE_AGREE
            engines_agree = None if e2 is None or raw[wi] is None else bool(abs(e2 - raw[wi]) <= tol)
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
                              'second_s': None if e2 is None else round(e2, 2),
                              'third_s': None if e3 is None else round(e3, 3),
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
            'ctc_start': None if ctc_line is None else round(ctc_line, 3),
            'time_source': 'aligner' if pub else ('cue' if cue is not None else 'draft'),
            'score': round(score, 3), 'gap': round(gap, 3),
            'metric': c['metric'], 'metric_value': None if c['metric_value'] is None else round(float(c['metric_value']), 4),
            'structure_ok': c['structure_ok'], 'structure': c['structure'],
            'words': words_out,
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
    placed_ids = {u.id for u, pub in zip(units, publish) if pub}
    locked = lock_written_cues(lyrics, cues, placed_ids, only)
    edge_fixes = T.fit_section_edges(lyrics)
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
        'third_engine': 'stable-ts',
        'third_compared': sum(1 for w in ws_good if w.get('third_s') is not None and w.get('ctc_s') is not None),
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
    wd = work_dir(slug)
    (wd / 'align-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')

    timing_note = (f'align.py {t_start:%Y-%m-%d}: времена слов записаны, все строки помечены timing-draft. '
                   f'Выравниватель уверен в {n_good} из {n}, не нашёл текст в {n_draft}. '
                   f'Статус aligned ставит только qa_sync.py --apply, если каждая группа строк (соло и хор, где она есть) доказана не меньше чем на 80 %. '
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
