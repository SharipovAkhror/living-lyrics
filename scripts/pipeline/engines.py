"""Second opinions for align.py: independent aligners that measure the word starts of a line again.

A word is "proven" only when the main aligner (torchaudio MMS_FA on romanised text), a second
aligner and the vocal onsets agree (see align.py). This module holds the second aligners.

Interface — to add an engine, write a class with
    name: str
    def word_starts(self, x: np.ndarray, jobs: list[dict]) -> dict[str, list[float | None]]
where x is mono 16 kHz audio and every job is
    {'id': line id, 'lang': 'fa', 'script': 'Arab', 'words': ['مرده', 'بدم', …], 't0': s, 't1': s}
(t0/t1 — the audio window to search, seconds). Return the start of every word in seconds, or None
for a word the engine cannot place (letters outside its alphabet). Lines it cannot handle at all
(no model for the language) are simply left out of the result. Register the class in ENGINES.

mms1b — facebook/mms-1b-all (wav2vec2, 1 B parameters, one adapter per language) through
transformers. Different weights, size and alphabet from MMS_FA: it reads the native script
(Arabic and Persian letters, Turkish ç ğ ı ö ş ü) instead of uroman Latin, so its mistakes are
largely independent. CPU: about 1 s per second of audio on 4 cores; only lines that the main
aligner placed confidently are measured. Model: 3.9 GB download, cached by Hugging Face.
"""
from __future__ import annotations

import unicodedata

import numpy as np

from ctc import token_spans, viterbi

SR = 16000

# MMS adapter codes (ISO 639-3, with a script suffix where MMS has several).
MMS_LANG = {'en': 'eng', 'tr': 'tur', 'ar': 'ara', 'fa': 'fas', 'az': 'azj-script_latin', 'de': 'deu',
            'es': 'spa', 'la': 'lat', 'ru': 'rus', 'uz': 'uzb-script_latin', 'ur': 'urd-script_arabic',
            'hi': 'hin', 'fr': 'fra', 'it': 'ita', 'ota': 'tur', 'gmh': 'deu'}
# Letter variants: if the adapter's alphabet lacks a letter, try its twin.
TWINS = {'ی': 'ي', 'ي': 'ی', 'ک': 'ك', 'ك': 'ک', 'ى': 'ي', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
         'ة': 'ه', 'ۀ': 'ه', 'ؤ': 'و', 'ئ': 'ي', 'ı': 'i', 'İ': 'i'}


class Mms1b:
    name = 'mms-1b-all'
    model_id = 'facebook/mms-1b-all'

    def __init__(self) -> None:
        import os

        import torch
        from transformers import AutoProcessor, Wav2Vec2ForCTC

        torch.set_num_threads(os.cpu_count() or 4)
        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(self.model_id)
        self.model = Wav2Vec2ForCTC.from_pretrained(self.model_id).eval()

    def letters(self, word: str, vocab: dict[str, int]) -> list[int]:
        out = []
        for ch in unicodedata.normalize('NFC', word.lower()):
            if unicodedata.category(ch) in ('Mn', 'Cf'):  # harakat, ZWNJ
                continue
            if ch in vocab:
                out.append(vocab[ch])
            elif TWINS.get(ch) in vocab:
                out.append(vocab[TWINS[ch]])
            elif unicodedata.normalize('NFD', ch)[0] in vocab:
                out.append(vocab[unicodedata.normalize('NFD', ch)[0]])
        return out

    def word_starts(self, x: np.ndarray, jobs: list[dict]) -> dict[str, list[float | None]]:
        out: dict[str, list[float | None]] = {}
        by_lang: dict[str, list[dict]] = {}
        for j in jobs:
            code = MMS_LANG.get(j['lang'])
            if code:
                by_lang.setdefault(code, []).append(j)
        for code, js in by_lang.items():
            try:
                self.proc.tokenizer.set_target_lang(code)
                self.model.load_adapter(code)
            except Exception as e:  # no adapter for this language: no second opinion
                print(f'{self.name}: нет адаптера {code} ({e.__class__.__name__}) — строки на этом языке без второго мнения')
                continue
            vocab = self.proc.tokenizer.get_vocab()
            blank = self.proc.tokenizer.pad_token_id
            for j in js:
                a, b = max(0, int(j['t0'] * SR)), min(len(x), int(j['t1'] * SR))
                seg = x[a:b]
                inputs = self.proc(seg, sampling_rate=SR, return_tensors='pt')
                with self.torch.inference_mode():
                    logits = self.model(**inputs).logits[0]
                lp = self.torch.log_softmax(logits, dim=-1).numpy()
                tokens, owner = [], []
                for wi, w in enumerate(j['words']):
                    ls = self.letters(w, vocab)
                    tokens += ls
                    owner += [wi] * len(ls)
                path = viterbi(lp, tokens, blank) if tokens else None
                if path is None:
                    continue
                first, _ = token_spans(path, len(tokens))
                step = (b - a) / SR / lp.shape[0]
                starts: list[float | None] = [None] * len(j['words'])
                for k, wi in enumerate(owner):
                    if starts[wi] is None:
                        starts[wi] = a / SR + first[k] * step
                out[j['id']] = starts
            print(f'{self.name}: {code} — {len(js)} строк')
        return out


ENGINES = {'mms1b': Mms1b}


def load(name: str):
    """The engine, or None (with a note) when it or its dependencies are missing."""
    if name in ('', 'none'):
        return None
    try:
        return ENGINES[name]()
    except KeyError:
        raise SystemExit(f'неизвестный второй выравниватель: {name} (есть: {", ".join(ENGINES)})')
    except ImportError as e:
        print(f'второй выравниватель {name} недоступен ({e}); слова подтверждаются только атаками голоса')
        return None
