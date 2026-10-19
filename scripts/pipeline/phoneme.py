"""Phoneme witness: espeak-ng IPA plus a wav2vec2 CTC model.

Independent of MMS and of Whisper. The model hears phones, not words.
The known lyric is phonemised per word; CTC forced alignment places those
phones in the line's second-aligner window. Weights stay in the Hugging Face
cache and are not committed.

espeak-ng is GPL-3.0 and is run as an external program. It is not vendored
and it is not linked into the site. The phonemizer package is not imported:
it breaks `from transformers import Wav2Vec2ForCTC` on the song job.
"""
from __future__ import annotations

import gc
import os
import subprocess
import time
import unicodedata

import numpy as np

import ctc

# Languages that have an espeak-ng voice. gmh and ota are not mapped onto
# modern German or Turkish: a missing voice is a missing clock.
VOICES = {
    'en': 'en',
    'de': 'de',
    'ar': 'ar',
    'fa': 'fa',
    'tr': 'tr',
    'az': 'az',
    'la': 'la',
}

# Apache-2.0. Paper: Xu, Baevski, Auli, arXiv 2109.11680.
# xlsr-53 always runs. lv-60 runs only when the remaining align budget fits.
# The two models share the phoneme labels, so a pair keeps one of them.
MODELS = (
    {
        'id': 'facebook/wav2vec2-xlsr-53-espeak-cv-ft',
        'name': 'xlsr-53-espeak',
        'license': 'Apache-2.0',
        'note': 'XLS-R 53, then Common Voice phonemes (arXiv 2109.11680).',
    },
    {
        'id': 'facebook/wav2vec2-lv-60-espeak-cv-ft',
        'name': 'lv-60-espeak',
        'license': 'Apache-2.0',
        'note': 'Libri-Light LV-60, then the same phoneme labels (arXiv 2109.11680).',
    },
)

# facebook/mms-1b-all adapters share the placer's acoustic model. They are not
# an independent witness and are not loaded.
MMS_REJECTION = (
    'Адаптеры facebook/mms-1b-all делят акустический контур с постановщиком MMS '
    'и не измерялись.'
)

SR = 16000
HOP = 320
# Align-job cap. A model that does not finish is not measured, so a slow run
# cannot also drop the Whisper clocks by timing the 150 minute job out.
DEFAULT_BUDGET_S = 1800.0
ESPEAK_TIMEOUT_S = 15.0

_STRESS = str.maketrans('', '', "ˈˌ'")
_MODIFIERS = set('ˈˌːˑʰʲʷ̥̃̊͡')
# ɚ ᵻ ʉ are vowels in this model's vocabulary. The rest is the IPA vowel test.
_VOWEL_BASE = set('aeiouyæøəɨɑɔɛɪʊʌɐɒɜœɯɵäöüɚᵻʉ')


def voice_for(lang: str | None) -> str | None:
    """espeak-ng voice for an ISO 639 code, or None when this project has none."""
    if not lang:
        return None
    return VOICES.get(str(lang))


def budget_s() -> float:
    raw = os.environ.get('PHONEME_BUDGET_S', '')
    try:
        value = float(raw) if str(raw).strip() else DEFAULT_BUDGET_S
    except ValueError:
        value = DEFAULT_BUDGET_S
    return value if value > 0 else DEFAULT_BUDGET_S


def spoken(text: str) -> str:
    """Letters, apostrophes, hyphens and combining marks. The lyric, not the romanisation."""
    out = []
    for ch in str(text or ''):
        if ch.isalnum() or ch in "'’ʼ-" or unicodedata.combining(ch):
            out.append(ch)
    return ''.join(out)


def _phone_vocab(vocab: dict) -> dict[str, int]:
    """IPA keys only. <pad>, <s>, </s> and <unk> are not phones."""
    out = {}
    for key, idx in vocab.items():
        if not isinstance(key, str) or not key or key.startswith('<'):
            continue
        try:
            out[key] = int(idx)
        except (TypeError, ValueError):
            continue
    return out


def tokenize(ipa: str, vocab: dict) -> tuple[list[int], list[str], int]:
    """Token ids for one espeak string, the phones that matched, and how many were skipped.

    `--sep=_` splits into phones and each piece is looked up whole. Without a
    separator the same vocabulary is matched longest-first. Stress marks are
    removed before the lookup. Length marks and dots stay: `iː`, `s.` and `i.`
    are vocabulary keys. An unknown phone is skipped, not substituted.
    """
    phones = _phone_vocab(vocab)
    text = (ipa or '').replace('\n', ' ').replace('\r', ' ').strip()
    skipped = 0
    ids: list[int] = []
    names: list[str] = []
    if not text or not phones:
        return ids, names, skipped
    if '_' in text:
        for part in text.split('_'):
            key = part.translate(_STRESS).strip()
            if not key:
                continue
            idx = phones.get(key)
            if idx is None:
                skipped += 1
                continue
            ids.append(idx)
            names.append(key)
        return ids, names, skipped
    raw = text.translate(_STRESS).replace(' ', '')
    keys = sorted(phones, key=len, reverse=True)
    i = 0
    while i < len(raw):
        matched = False
        for key in keys:
            if raw.startswith(key, i):
                ids.append(phones[key])
                names.append(key)
                i += len(key)
                matched = True
                break
        if not matched:
            skipped += 1
            i += 1
    return ids, names, skipped


def _is_vowel(phone: str) -> bool:
    for ch in phone:
        if ch in _MODIFIERS:
            continue
        return ch in _VOWEL_BASE
    return False


def _espeak(voice: str, text: str) -> str | None:
    """IPA from the espeak-ng binary. None when the program or the voice fails.

    `--sep=_` is the current way to separate phones. The numeric `--ipa=3`
    switch is deprecated: on current espeak-ng it is not the underscore.
    Phonemizer, which produced this model's labels, also splits on `_`.
    """
    try:
        proc = subprocess.run(
            ['espeak-ng', '-v', voice, '-q', '-x', '--ipa', '--sep=_', text],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=ESPEAK_TIMEOUT_S, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return (proc.stdout or '').strip()


def espeak_available() -> bool:
    try:
        proc = subprocess.run(
            ['espeak-ng', '--version'],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=ESPEAK_TIMEOUT_S, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0


def _window(line: dict, duration: float) -> tuple[float, float]:
    """The second-aligner window, or the cue with the first-pass pad when it is absent."""
    sw = line.get('second_window')
    if isinstance(sw, (list, tuple)) and len(sw) == 2 and sw[0] is not None and sw[1] is not None:
        t0, t1 = float(sw[0]), float(sw[1])
    else:
        cue = line.get('cue_start')
        end = line.get('cue_end')
        if end is None:
            end = line.get('end')
        if cue is None:
            cue = line.get('ctc_start')
        if cue is None:
            cue = line.get('start') or 0.0
        if end is None:
            end = float(cue) + 0.4
        t0 = float(cue) - 0.8
        t1 = float(end) + 0.5
    t0 = max(0.0, min(t0, duration))
    t1 = max(t0, min(t1, duration))
    if t1 - t0 < 0.4:
        t1 = min(duration, t0 + 0.4)
    return t0, t1


def _frame_s(n_frames: int, n_samples: int) -> float:
    expected = n_samples / float(HOP)
    if n_frames > 0 and expected > 0 and abs(n_frames - expected) / expected > 0.20:
        return (n_samples / float(SR)) / float(n_frames)
    return HOP / float(SR)


def _align_line(chunk: np.ndarray, t0: float, word_phones: list[list[str]],
                ids: list[int], blank: int, model, extractor) -> list[tuple[float | None, float | None]]:
    """(phone start, vowel time) per word. A word with no matched phone has neither."""
    empty = [(None, None) for _ in word_phones]
    if not ids or len(chunk) < HOP:
        return empty
    import torch

    audio = np.asarray(chunk, dtype=np.float32)
    inputs = extractor(audio, sampling_rate=SR, return_tensors='pt')
    with torch.inference_mode():
        logits = model(inputs.input_values).logits
    lp = torch.log_softmax(logits, dim=-1)[0].detach().cpu().numpy().astype(np.float32)
    if lp.ndim != 2 or lp.shape[1] <= blank:
        return empty
    path = ctc.viterbi(lp, ids, blank=blank)
    if path is None:
        return empty
    first, _last = ctc.token_spans(path, len(ids))
    frame = _frame_s(int(lp.shape[0]), int(len(audio)))
    out = list(empty)
    cursor = 0
    for wi, phones in enumerate(word_phones):
        if not phones:
            continue
        start = None
        vowel = None
        for pi, phone in enumerate(phones):
            frame_i = int(first[cursor + pi]) if cursor + pi < len(first) else -1
            if frame_i < 0:
                if pi == 0:
                    break
                continue
            when = round(t0 + frame_i * frame, 3)
            if pi == 0:
                start = when
            if vowel is None and _is_vowel(phone):
                vowel = when
        out[wi] = (start, vowel)
        cursor += len(phones)
    return out


def _eligible(line: dict) -> bool:
    return line.get('status') == 'good' and line.get('group') in ('solo', 'choir')


def _load(model_id: str):
    """CTC model and its vocab. The processor is not loaded: its tokenizer imports phonemizer."""
    import json
    from huggingface_hub import hf_hub_download
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_id)
    model = Wav2Vec2ForCTC.from_pretrained(model_id)
    model.eval()
    path = hf_hub_download(model_id, 'vocab.json')
    with open(path, encoding='utf-8') as fh:
        vocab = json.load(fh)
    blank = int(vocab.get('<pad>', 0))
    return model, extractor, vocab, blank


def measure(x, report: dict, budget_s_value: float | None = None) -> dict:
    """Write phoneme_models and vowel_models onto placed solo and choir words.

    A model that does not finish, or whose lines throw more often than not, is
    recorded and its clocks are left unset. The caller still gets a summary.
    """
    budget = float(budget_s() if budget_s_value is None else budget_s_value)
    summary = {
        'budget_s': budget,
        'espeak': {
            'program': 'espeak-ng',
            'license': 'GPL-3.0',
            'how': 'внешняя программа, в сайт и в репозиторий не входит',
            'command': 'espeak-ng -v <voice> -q -x --ipa --sep=_',
        },
        'models': [],
        'no_voice': [],
        'skipped_phones': 0,
        'mms_adapters': MMS_REJECTION,
    }
    report.setdefault('summary', {})['phoneme'] = summary
    try:
        _measure(np.asarray(x), report, budget, summary)
    except Exception as e:
        summary['error'] = f'{e.__class__.__name__}: {e}'
        print(f'фонемный свидетель не посчитан ({summary["error"]})', flush=True)
    return summary


def _measure(x: np.ndarray, report: dict, budget: float, summary: dict) -> None:
    lines = [line for line in (report.get('lines') or []) if _eligible(line)]
    no_voice = sorted({str(line.get('lang') or '?') for line in lines if voice_for(line.get('lang')) is None})
    summary['no_voice'] = no_voice
    if not espeak_available():
        for spec in MODELS:
            summary['models'].append({
                'id': spec['id'], 'name': spec['name'], 'license': spec['license'],
                'note': spec['note'], 'elapsed_s': 0.0, 'lines': 0, 'words': 0,
                'error': 'espeak-ng не найден', 'ran': False, 'complete': False,
            })
        print('фонемный свидетель: espeak-ng не найден', flush=True)
        return
    deadline = time.monotonic() + budget
    previous_elapsed = None
    cache: dict[tuple[str, str], str | None] = {}
    for index, spec in enumerate(MODELS):
        remaining = deadline - time.monotonic()
        if index == 0:
            if remaining <= 60:
                summary['models'].append(_skipped(spec, f'осталось {remaining:.0f} с'))
                continue
        elif previous_elapsed is None or previous_elapsed * 1.15 + 60 > remaining:
            estimate = None if previous_elapsed is None else previous_elapsed * 1.15 + 60
            why = 'предыдущая модель не домерена' if estimate is None else (
                f'оценка {estimate:.0f} с не входит в остаток {remaining:.0f} с')
            summary['models'].append(_skipped(spec, why))
            continue
        row, elapsed = _run_model(spec, x, lines, cache, summary, deadline)
        summary['models'].append(row)
        # The next model runs only after a finished one. An unfinished model is
        # not measured, and its elapsed time is not a budget estimate.
        previous_elapsed = elapsed if row.get('complete') else None


def _skipped(spec: dict, why: str) -> dict:
    return {
        'id': spec['id'], 'name': spec['name'], 'license': spec['license'],
        'note': spec['note'], 'elapsed_s': 0.0, 'lines': 0, 'words': 0,
        'error': why, 'ran': False, 'complete': False,
    }


def _run_model(spec: dict, x: np.ndarray, lines: list[dict], cache: dict,
               summary: dict, deadline: float) -> tuple[dict, float]:
    started = time.monotonic()
    name = spec['name']
    clocks: dict[str, list[tuple[float | None, float | None]]] = {}
    errors = 0
    attempted = 0
    shown = 0
    complete = True
    error = None
    model = extractor = None
    try:
        import torch
        torch.set_num_threads(4)
        model, extractor, vocab, blank = _load(spec['id'])
        duration = len(x) / float(SR)
        for line in lines:
            if time.monotonic() > deadline:
                complete = False
                error = 'бюджет исчерпан'
                break
            attempted += 1
            try:
                clocks[line['id']] = _line_clocks(
                    x, line, duration, vocab, blank, model, extractor, cache, summary)
            except Exception as e:
                errors += 1
                clocks[line['id']] = [(None, None) for _ in (line.get('words') or [])]
                if shown < 3:
                    shown += 1
                    print(f'фонемы {name}: {line.get("id")} ({e.__class__.__name__}: {e})', flush=True)
                error = error or f'{e.__class__.__name__}: {e}'
            if attempted % 20 == 0:
                print(f'фонемы {name}: строк {attempted}, ошибок {errors}, '
                      f'{time.monotonic() - started:.0f} с', flush=True)
        if attempted and errors * 2 > attempted:
            complete = False
            error = error or 'ошибки больше чем на половине строк'
    except Exception as e:
        complete = False
        error = f'{e.__class__.__name__}: {e}'
        print(f'фонемы {name} не запущены ({error})', flush=True)
    finally:
        del model, extractor
        gc.collect()
    elapsed = time.monotonic() - started
    words = 0
    if complete:
        by_id = {line['id']: line for line in lines}
        for line_id, times in clocks.items():
            line = by_id.get(line_id)
            if line is None:
                continue
            for word, pair in zip(line.get('words') or [], times):
                if not word.get('roman'):
                    continue
                start, vowel = pair
                word.setdefault('phoneme_models', {})[name] = start
                word.setdefault('vowel_models', {})[name] = vowel
                words += 1
    else:
        clocks.clear()
    print(f'фонемы {name}: готово {complete}, строк {attempted}, слов {words}, '
          f'{elapsed:.0f} с', flush=True)
    return {
        'id': spec['id'], 'name': name, 'license': spec['license'], 'note': spec['note'],
        'elapsed_s': round(elapsed, 1), 'lines': attempted if complete else 0, 'words': words,
        'error': error, 'ran': error is None or complete or attempted > 0, 'complete': complete,
    }, elapsed


def _line_clocks(x, line, duration, vocab, blank, model, extractor, cache, summary):
    words = line.get('words') or []
    voice = voice_for(line.get('lang'))
    pieces: list[list[str]] = []
    ids: list[int] = []
    for word in words:
        if not word.get('roman'):
            pieces.append([])
            continue
        if voice is None:
            pieces.append([])
            continue
        text = spoken(word.get('w') or '')
        if not text:
            pieces.append([])
            continue
        key = (voice, text)
        if key not in cache:
            cache[key] = _espeak(voice, text)
        ipa = cache[key]
        if not ipa:
            pieces.append([])
            continue
        tok, names, skipped = tokenize(ipa, vocab)
        summary['skipped_phones'] = int(summary.get('skipped_phones') or 0) + skipped
        pieces.append(names)
        ids.extend(tok)
    t0, t1 = _window(line, duration)
    i0, i1 = int(round(t0 * SR)), int(round(t1 * SR))
    i0 = max(0, min(i0, len(x)))
    i1 = max(i0, min(i1, len(x)))
    return _align_line(x[i0:i1], t0, pieces, ids, blank, model, extractor)
