"""Second opinions for align.py: an aligner that measures word starts again, independently of MMS_FA.

qa_sync proves a line from the chosen aligner's onset and the cue. This second start is an
extra check where the model places one; a missing or disagreeing time does not fail the line
(see qa_sync.py). This module holds the second aligners.

Interface of an engine:
    name: str
    def word_starts(self, x: np.ndarray, jobs: list[dict]) -> dict[str, list[float | None]]
x is mono 16 kHz. Every job is
    {'id', 'lang', 'script', 'words': [...], 't0': seconds, 't1': seconds}
Return the start of every word in seconds, or None for a word the engine cannot place.
Lines the engine cannot handle are left out of the result.

whisperx — the acoustic models WhisperX uses for forced alignment (not the whisperx package:
that package also transcribes and pulls diarisation, and the text here is already known).
English, French, German, Spanish and Italian come from torchaudio; Arabic, Persian, Turkish and
the other languages in WHISPERX_HF come from the same Hugging Face wav2vec2 checkpoints WhisperX
selects. Different weights from MMS_FA, so the mistakes are largely independent.

A second MMS (mms-1b-all, or ctc-forced-aligner's copy of the MMS_FA weights) is not an independent
opinion and is not called. Azerbaijani, Latin, medieval German and Ottoman Turkish have no
WhisperX checkpoint here; those lines stay unproven. A language tagged `de` uses the modern German
model and is not relabelled as medieval German.
"""
from __future__ import annotations

import gc
import os
import unicodedata

import numpy as np

from ctc import token_spans, viterbi

SR = 16000

# WhisperX's tables (m-bain/whisperX whisperx/alignment.py), copied so a missing package
# cannot change which model a language gets.
WHISPERX_TORCH = {
    'en': 'WAV2VEC2_ASR_BASE_960H',
    'fr': 'VOXPOPULI_ASR_BASE_10K_FR',
    'de': 'VOXPOPULI_ASR_BASE_10K_DE',
    'es': 'VOXPOPULI_ASR_BASE_10K_ES',
    'it': 'VOXPOPULI_ASR_BASE_10K_IT',
}
WHISPERX_HF = {
    'ja': 'jonatasgrosman/wav2vec2-large-xlsr-53-japanese',
    'zh': 'jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn',
    'nl': 'jonatasgrosman/wav2vec2-large-xlsr-53-dutch',
    'uk': 'Yehor/wav2vec2-xls-r-300m-uk-with-small-lm',
    'pt': 'jonatasgrosman/wav2vec2-large-xlsr-53-portuguese',
    'ar': 'jonatasgrosman/wav2vec2-large-xlsr-53-arabic',
    'ru': 'jonatasgrosman/wav2vec2-large-xlsr-53-russian',
    'pl': 'jonatasgrosman/wav2vec2-large-xlsr-53-polish',
    'hu': 'jonatasgrosman/wav2vec2-large-xlsr-53-hungarian',
    'fi': 'jonatasgrosman/wav2vec2-large-xlsr-53-finnish',
    'fa': 'jonatasgrosman/wav2vec2-large-xlsr-53-persian',
    'el': 'jonatasgrosman/wav2vec2-large-xlsr-53-greek',
    'tr': 'mpoyraz/wav2vec2-xls-r-300m-cv7-turkish',
    'da': 'saattrupdan/wav2vec2-xls-r-300m-ftspeech',
    'he': 'imvladikon/wav2vec2-xls-r-300m-hebrew',
    'vi': 'nguyenvulebinh/wav2vec2-base-vi-vlsp2020',
    'ko': 'kresnik/wav2vec2-large-xlsr-korean',
    'ur': 'kingabzpro/wav2vec2-large-xls-r-300m-Urdu',
    'hi': 'theainerd/Wav2Vec2-large-xlsr-hindi',
    'cs': 'comodoro/wav2vec2-xls-r-300m-cs-250',
}

TWINS = {
    'ی': 'ي', 'ي': 'ی', 'ک': 'ك', 'ك': 'ک', 'ى': 'ي', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
    'ة': 'ه', 'ۀ': 'ه', 'ؤ': 'و', 'ئ': 'ي', 'ı': 'i', 'İ': 'i',
}


def preferred(lang: str) -> list[str]:
    """WhisperX where alignment.py has a checkpoint, otherwise nothing.

    Empty for Azerbaijani, Latin, medieval German and Ottoman Turkish: there is no second
    aligner, and a modern-language model is not substituted for them.
    """
    if lang in WHISPERX_TORCH or lang in WHISPERX_HF:
        return ['whisperx']
    return []


def _threads() -> None:
    import torch

    torch.set_num_threads(os.cpu_count() or 4)


def _log_softmax(x: np.ndarray) -> np.ndarray:
    """WhisperX applies log_softmax to both torchaudio and Hugging Face emissions (they are logits)."""
    m = x.max(axis=-1, keepdims=True)
    e = np.exp(x - m)
    return (x - m) - np.log(e.sum(axis=-1, keepdims=True) + 1e-12)


def _lower_vocab(vocab: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, idx in vocab.items():
        if key is None:
            continue
        out.setdefault(str(key).lower(), int(idx))
    return out


def _drop_marks(word: str) -> str:
    word = unicodedata.normalize('NFC', word)
    return ''.join(ch for ch in word if unicodedata.category(ch) not in ('Mn', 'Cf'))


def encode_chars(word: str, vocab: dict[str, int], skip: set[int]) -> list[int]:
    """Letter ids for one word. Unknown letters are skipped; too many skips and the word is refused."""
    chars = []
    for ch in _drop_marks(word):
        if ch.isspace() or ch in '.,;:!?…—–«»"“”()[]':
            continue
        chars.append(ch)
    ids: list[int] = []
    letters = 0
    for ch in chars:
        letters += 1
        hit = None
        bare = unicodedata.normalize('NFD', ch)[0]
        for cand in (ch, ch.lower(), ch.upper(), bare, bare.lower(), bare.upper(), TWINS.get(ch)):
            if cand is None or cand not in vocab:
                continue
            idx = vocab[cand]
            if idx in skip:
                continue
            hit = idx
            break
        if hit is not None:
            ids.append(hit)
    if letters and len(ids) * 2 < letters:
        return []
    return ids


def line_tokens(words: list[str], vocab: dict[str, int], skip: set[int], blank: int) -> tuple[list[int], list[int]]:
    """Letter ids for a line, and the word index of each id.

    These models emit `|` between words (WhisperX puts that token in the path). A word start is
    the first letter after the bar, so the bar itself has owner −1 and does not time a word.
    """
    boundary = vocab.get('|')
    insert = boundary is not None and boundary != blank
    tokens: list[int] = []
    owner: list[int] = []
    started = False
    for wi, word in enumerate(words):
        ids = encode_chars(word, vocab, skip)
        if not ids:
            continue
        if insert and started:
            tokens.append(int(boundary))
            owner.append(-1)
        tokens.extend(ids)
        owner.extend([wi] * len(ids))
        started = True
    return tokens, owner


def _place(first: np.ndarray, owner: list[int], starts: list[float | None], t0: float, n_frames: int, span: float) -> list[float | None]:
    """Map token frames to word starts. `span` is the window length in seconds."""
    scale = span / n_frames if n_frames else 0.02
    for k, wi in enumerate(owner):
        if wi < 0 or starts[wi] is not None or int(first[k]) < 0:
            continue
        starts[wi] = t0 + float(first[k]) * scale
    return starts


def align_window(lp: np.ndarray, tokens: list[int], owner: list[int], n_words: int, blank: int, t0: float, span: float) -> list[float | None] | None:
    if not tokens or lp.shape[0] == 0:
        return None
    path = viterbi(lp, tokens, blank)
    if path is None:
        return None
    first, _ = token_spans(path, len(tokens))
    starts: list[float | None] = [None] * n_words
    return _place(first, owner, starts, t0, lp.shape[0], span)


class WhisperX:
    """WhisperX alignment models, one language at a time, released before the next is loaded."""

    name = 'whisperx'

    def __init__(self) -> None:
        _threads()

    def close(self) -> None:
        gc.collect()

    def word_starts(self, x: np.ndarray, jobs: list[dict]) -> dict[str, list[float | None]]:
        out: dict[str, list[float | None]] = {}
        by_lang: dict[str, list[dict]] = {}
        for j in jobs:
            if j['lang'] in WHISPERX_TORCH or j['lang'] in WHISPERX_HF:
                by_lang.setdefault(j['lang'], []).append(j)
        for lang, js in by_lang.items():
            try:
                if lang in WHISPERX_TORCH:
                    part = self._torch(x, lang, js)
                else:
                    part = self._hf(x, lang, js)
            except Exception as e:
                print(f'{self.name}: {lang} не загрузился ({e.__class__.__name__}: {e})')
                continue
            out.update(part)
            gc.collect()
        return out

    def _torch(self, x: np.ndarray, lang: str, jobs: list[dict]) -> dict[str, list[float | None]]:
        import torch
        import torchaudio

        bundle_name = WHISPERX_TORCH[lang]
        bundle = getattr(torchaudio.pipelines, bundle_name, None)
        if bundle is None:
            raise RuntimeError(f'torchaudio.pipelines.{bundle_name} нет в этой версии torchaudio')
        model = bundle.get_model().eval()
        labels = list(bundle.get_labels())
        vocab = _lower_vocab({lab: i for i, lab in enumerate(labels)})
        blank = vocab.get('-', 0)
        skip = {blank, vocab['|']} if '|' in vocab else {blank}
        out: dict[str, list[float | None]] = {}
        try:
            for j in jobs:
                placed = _one_line(torch, model, None, x, j, vocab, blank, skip, hf=False)
                if placed is not None:
                    out[j['id']] = placed
        finally:
            del model
            gc.collect()
        print(f'{self.name}: {lang} ({bundle_name}) — {len(jobs)} строк', flush=True)
        return out

    def _hf(self, x: np.ndarray, lang: str, jobs: list[dict]) -> dict[str, list[float | None]]:
        import torch
        from transformers import Wav2Vec2ForCTC

        model_id = WHISPERX_HF[lang]
        proc = _load_processor(model_id)
        model = Wav2Vec2ForCTC.from_pretrained(model_id).eval()
        raw_vocab = proc.tokenizer.get_vocab()
        vocab = _lower_vocab(raw_vocab)
        blank = int(proc.tokenizer.pad_token_id)
        for key, idx in vocab.items():
            if key in ('[pad]', '<pad>'):
                blank = int(idx)
        skip = {blank}
        for tok in ('|', '[pad]', '<pad>', '<s>', '</s>', '<unk>', proc.tokenizer.pad_token, proc.tokenizer.bos_token, proc.tokenizer.eos_token, proc.tokenizer.unk_token):
            if tok and str(tok).lower() in vocab:
                skip.add(int(vocab[str(tok).lower()]))
        out: dict[str, list[float | None]] = {}
        try:
            for j in jobs:
                placed = _one_line(torch, model, proc, x, j, vocab, blank, skip, hf=True)
                if placed is not None:
                    out[j['id']] = placed
        finally:
            del model, proc
            gc.collect()
        print(f'{self.name}: {lang} ({model_id}) — {len(jobs)} строк', flush=True)
        return out


def _load_processor(model_id: str):
    """Feature extractor and CTC tokenizer. The KenLM decoder is not used for alignment.

    Some WhisperX checkpoints (Turkish) ship a Wav2Vec2ProcessorWithLM. AutoProcessor then
    imports pyctcdecode and fails when that package is absent. Emissions do not need the
    language model, so the fallback builds a plain processor from the same tokenizer.
    """
    from transformers import AutoProcessor, Wav2Vec2CTCTokenizer, Wav2Vec2FeatureExtractor, Wav2Vec2Processor

    try:
        return AutoProcessor.from_pretrained(model_id)
    except ImportError as e:
        print(f'{model_id}: процессор с LM не загрузился ({e.__class__.__name__}), беру CTC-токенайзер')
        tok = Wav2Vec2CTCTokenizer.from_pretrained(model_id)
        fe = Wav2Vec2FeatureExtractor.from_pretrained(model_id)
        return Wav2Vec2Processor(feature_extractor=fe, tokenizer=tok)


def _one_line(torch, model, proc, x: np.ndarray, job: dict, vocab: dict[str, int], blank: int, skip: set[int], hf: bool) -> list[float | None] | None:
    a = max(0, int(job['t0'] * SR))
    b = min(len(x), int(job['t1'] * SR))
    if b - a < int(0.05 * SR):
        return None
    seg = np.ascontiguousarray(x[a:b])
    tokens, owner = line_tokens(job['words'], vocab, skip, blank)
    if not tokens:
        return None
    if hf:
        inputs = proc(seg, sampling_rate=SR, return_tensors='pt')
        with torch.inference_mode():
            logits = model(**inputs).logits[0]
        lp = torch.log_softmax(logits, dim=-1).numpy()
    else:
        wave = torch.from_numpy(seg).unsqueeze(0)
        with torch.inference_mode():
            em = model(wave)[0]
        arr = em[0].numpy() if em.ndim == 3 else em.numpy()
        lp = _log_softmax(arr)
    return align_window(lp, tokens, owner, len(job['words']), blank, a / SR, (b - a) / SR)


ENGINES = {'whisperx': WhisperX}


def run_engine(name: str, x: np.ndarray, jobs: list[dict]) -> dict[str, list[float | None]]:
    eng = ENGINES[name]()
    try:
        return eng.word_starts(x, jobs)
    finally:
        closer = getattr(eng, 'close', None)
        if closer:
            closer()


def align_jobs(which: str, x: np.ndarray, jobs: list[dict]) -> tuple[dict[str, list[float | None]], dict[str, str]]:
    """Word starts and the engine name that produced them, per line id.

    `which` is `auto` (WhisperX where the language has a model), `whisperx`, or `none`.
    A failing engine is skipped; the line then has no second opinion. That does not by itself
    keep the line unproved: qa_sync records the gap and still checks the onset and the cue.
    """
    if which in ('', 'none') or not jobs:
        return {}, {}
    if which != 'auto' and which not in ENGINES:
        raise SystemExit(f'неизвестный второй выравниватель: {which} (есть: auto, {", ".join(ENGINES)}, none)')
    starts: dict[str, list[float | None]] = {}
    names: dict[str, str] = {}
    order = [which] if which != 'auto' else ['whisperx']
    for name in order:
        if which == 'auto':
            batch = [j for j in jobs if j['id'] not in starts and name in preferred(j['lang'])]
        else:
            batch = [j for j in jobs if j['id'] not in starts]
        if not batch:
            continue
        try:
            part = run_engine(name, x, batch)
        except Exception as e:
            print(f'второй выравниватель {name} недоступен ({e.__class__.__name__}: {e})')
            continue
        for j in batch:
            got = part.get(j['id'])
            if got is None or len(got) != len(j['words']):
                continue
            if not any(s is not None for s in got):
                continue
            starts[j['id']] = got
            names[j['id']] = ENGINES[name].name
    missed = [j['id'] for j in jobs if j['id'] not in starts]
    if missed:
        print(f'без второго мнения: {len(missed)} строк ({", ".join(missed[:8])}{"…" if len(missed) > 8 else ""})')
    return starts, names
