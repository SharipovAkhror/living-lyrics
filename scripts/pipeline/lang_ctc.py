"""Language CTC witness: one wav2vec2 fine-tune per language.

Independent of MMS and of the WhisperX second aligner. The known words of a
placed line are forced-aligned in that line's window. Each language uses a
checkpoint trained on its own speech, not the checkpoint already stored as
`second_s`. Weights stay in the Hugging Face cache and are not committed.

Azerbaijani and Latin have no admissible model. An MMS-1B fine-tune shares
the placer contour. A Turkish, Italian or Spanish model is not borrowed.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import time

import numpy as np

import engines
import phoneme
from common import ROOT, load_audio, vocal_stem, work_dir

# One model per language, in the order of blocked lines. A different author
# or a different pretraining corpus from the WhisperX table, so the clock is
# not a copy of second_s.
MODELS = (
    {
        'lang': 'ar',
        'id': 'kmfoda/wav2vec2-large-xlsr-arabic',
        'fallback': None,
        'name': 'xlsr-53-ar-kmfoda',
        'license': 'Apache-2.0',
        'noncommercial': False,
        'note': (
            'XLSR-53 on Arabic Common Voice, Arabic script. '
            'Not the WhisperX Arabic checkpoint. '
            'elgeish/wav2vec2-large-xlsr-53-arabic is Buckwalter and was not used: '
            'Arabic letters did not encode, so every clock was empty.'
        ),
    },
    {
        'lang': 'fa',
        'id': 'm3hrdadfi/wav2vec2-large-xlsr-persian',
        'fallback': None,
        'name': 'xlsr-53-fa-m3hrdadfi',
        'license': 'Apache-2.0',
        'noncommercial': False,
        'note': 'XLSR-53 on Persian Common Voice. Not the WhisperX Persian checkpoint.',
    },
    {
        'lang': 'de',
        'id': 'jonatasgrosman/wav2vec2-large-xlsr-53-german',
        'fallback': None,
        'name': 'xlsr-53-de-grosman',
        'license': 'Apache-2.0',
        'noncommercial': False,
        'note': 'XLSR-53 on German Common Voice 6.1. The second aligner for German is VoxPopuli base.',
    },
    {
        'lang': 'tr',
        'id': 'cahya/wav2vec2-large-xlsr-turkish',
        'fallback': 'cahya-wirawan/wav2vec2-large-xlsr-turkish',
        'name': 'xlsr-53-tr-cahya',
        'license': 'Apache-2.0',
        'noncommercial': False,
        'note': 'XLSR-53 on Turkish Common Voice. Not the WhisperX Turkish XLS-R 300M checkpoint.',
    },
    {
        'lang': 'en',
        'id': 'jonatasgrosman/wav2vec2-large-xlsr-53-english',
        'fallback': None,
        'name': 'xlsr-53-en-grosman',
        'license': 'Apache-2.0',
        'noncommercial': False,
        'note': 'XLSR-53 on English Common Voice. The second aligner for English is LibriSpeech base 960h.',
    },
)

# No clock is invented for these. The reasons are the measurement.
ABSENT = (
    {
        'lang': 'az',
        'reason': (
            'Отдельной модели, обученной на азербайджанском и не делящей контур MMS, нет. '
            'Найденные карточки — дообучение facebook/mms-1b-all, лицензия CC-BY-NC 4.0. '
            'Они не измерялись. Турецкая модель на азербайджанский не переносится.'
        ),
    },
    {
        'lang': 'la',
        'reason': (
            'Отдельной CTC-модели латыни нет. Итальянская и испанская модели не '
            'переносятся: родного итальянского или испанского пения в этих записях нет.'
        ),
    },
)

MMS_REJECTION = (
    'Адаптеры facebook/mms-1b-all делят акустический контур с постановщиком MMS '
    'и не измерялись.'
)

# Prove job is 120 minutes. This budget leaves the attack measurement and qa
# their own time. A model that does not finish is not measured.
DEFAULT_BUDGET_S = 4500.0
SR = engines.SR


def budget_s() -> float:
    raw = os.environ.get('LANG_CTC_BUDGET_S', '')
    try:
        value = float(raw) if str(raw).strip() else DEFAULT_BUDGET_S
    except ValueError:
        value = DEFAULT_BUDGET_S
    return value if value > 0 else DEFAULT_BUDGET_S


def _banned_ids() -> set[str]:
    banned = set(engines.WHISPERX_HF.values())
    banned.update({
        'facebook/mms-1b-all',
        'nijatzeynalov/wav2vec2-large-mms-1b-azerbaijani-common_voice15.0',
        'tahmaz/wav2vec2-large-mms-1b-azerbaijani',
    })
    return banned


def assert_independent() -> None:
    """The catalogue must not copy the second aligner or an MMS adapter."""
    banned = _banned_ids()
    for spec in MODELS:
        for key in ('id', 'fallback'):
            model_id = spec.get(key)
            if model_id and model_id in banned:
                raise RuntimeError(f'{spec["name"]}: {model_id} не независим')
        if spec['lang'] in ('az', 'la'):
            raise RuntimeError(f'{spec["lang"]}: модели нет')
        if spec.get('noncommercial'):
            raise RuntimeError(f'{spec["name"]}: некоммерческая модель в каталоге допуска')


def _eligible(line: dict, lang: str) -> bool:
    return (
        line.get('status') == 'good'
        and line.get('group') in ('solo', 'choir')
        and str(line.get('lang') or '') == lang
    )


def _skip_ids(vocab: dict[str, int], proc, blank: int) -> set[int]:
    skip = {blank}
    tokens = [
        '|', '[pad]', '<pad>', '<s>', '</s>', '<unk>',
        proc.tokenizer.pad_token, proc.tokenizer.bos_token,
        proc.tokenizer.eos_token, proc.tokenizer.unk_token,
    ]
    for tok in tokens:
        if tok and str(tok).lower() in vocab:
            skip.add(int(vocab[str(tok).lower()]))
    return skip


def _load(model_id: str):
    import torch

    torch.set_num_threads(4)
    proc = engines._load_processor(model_id)
    model = engines._ctc_class().from_pretrained(model_id).eval()
    vocab = engines._lower_vocab(proc.tokenizer.get_vocab())
    blank = int(proc.tokenizer.pad_token_id)
    for key, idx in vocab.items():
        if key in ('[pad]', '<pad>'):
            blank = int(idx)
    skip = _skip_ids(vocab, proc, blank)
    return torch, model, proc, vocab, blank, skip


def _load_spec(spec: dict):
    """The card id, then the rename, if the card names one. Never a substitute language."""
    ids = [spec['id']]
    if spec.get('fallback') and spec['fallback'] not in ids:
        ids.append(spec['fallback'])
    last = None
    for model_id in ids:
        try:
            loaded = _load(model_id)
            return loaded, model_id
        except Exception as e:
            last = e
            print(f'{spec["name"]}: {model_id} не загрузился ({e.__class__.__name__}: {e})', flush=True)
    if last is None:
        raise RuntimeError(f'{spec["name"]}: нет карточки')
    raise last


def _jobs(songs: list[dict], lang: str) -> list[tuple[dict, dict, float]]:
    rows = []
    for song in songs:
        x = song['x']
        duration = len(x) / float(SR)
        for line in song['report'].get('lines') or []:
            if not _eligible(line, lang):
                continue
            rows.append((song, line, duration))
    return rows


def _run_model(spec: dict, songs: list[dict], deadline: float) -> dict:
    started = time.monotonic()
    name = spec['name']
    jobs = _jobs(songs, spec['lang'])
    attempted = 0
    errors = 0
    shown = 0
    complete = True
    error = None
    loaded_id = None
    buffered: list[tuple[dict, float | None]] = []
    torch = model = proc = None
    try:
        if not jobs:
            return _row(spec, None, 0.0, 0, 0, 'поставленных строк этого языка нет', False, True)
        loaded, loaded_id = _load_spec(spec)
        torch, model, proc, vocab, blank, skip = loaded
        for song, line, duration in jobs:
            if time.monotonic() > deadline:
                complete = False
                error = 'бюджет исчерпан'
                break
            attempted += 1
            words = line.get('words') or []
            t0, t1 = phoneme._window(line, duration)
            job = {
                'id': line.get('id'),
                'lang': spec['lang'],
                'words': [str(word.get('w') or '') for word in words],
                't0': t0,
                't1': t1,
            }
            try:
                placed = engines._one_line(
                    torch, model, proc, song['x'], job, vocab, blank, skip, hf=True)
            except Exception as e:
                errors += 1
                placed = None
                if shown < 3:
                    shown += 1
                    print(f'{name}: {line.get("id")} ({e.__class__.__name__}: {e})', flush=True)
                error = error or f'{e.__class__.__name__}: {e}'
            if placed is None:
                placed = [None] * len(words)
            for word, start in zip(words, placed):
                buffered.append((word, None if start is None else float(start)))
            if attempted % 20 == 0:
                print(f'{name}: строк {attempted}, ошибок {errors}, '
                      f'{time.monotonic() - started:.0f} с', flush=True)
        if attempted and errors * 2 > attempted:
            complete = False
            error = error or 'ошибки больше чем на половине строк'
    except Exception as e:
        complete = False
        error = f'{e.__class__.__name__}: {e}'
        print(f'{name} не запущен ({error})', flush=True)
    finally:
        del model, proc, torch
        gc.collect()
    elapsed = time.monotonic() - started
    if complete and only_empty_clocks(buffered):
        # A finished loop of empty clocks is not a measurement. Buckwalter
        # vocab does this: the Arabic letters never enter the path.
        complete = False
        error = error or 'алфавит модели не покрыл слова'
    words_n = 0
    if complete:
        for word, start in buffered:
            if not word.get('roman'):
                continue
            word.setdefault('lang_models', {})[name] = start
            words_n += 1
    print(f'{name}: готово {complete}, строк {attempted}, слов {words_n}, '
          f'{elapsed:.0f} с, карточка {loaded_id or spec["id"]}', flush=True)
    return _row(spec, loaded_id, elapsed, attempted if complete else 0, words_n,
                error, error is None or complete or attempted > 0, complete)


def only_empty_clocks(pairs: list[tuple[dict, float | None]]) -> bool:
    """True when every lettered word was timed and every time is missing.

    A Buckwalter vocabulary does this to Arabic script: the loop finishes,
    and the path never contained a letter.
    """
    lettered = [start for word, start in pairs if word.get('roman')]
    return bool(lettered) and all(start is None for start in lettered)


def _row(spec: dict, loaded_id: str | None, elapsed: float, lines: int, words: int,
         error: str | None, ran: bool, complete: bool) -> dict:
    return {
        'lang': spec['lang'],
        'id': spec['id'],
        'loaded_id': loaded_id or spec['id'],
        'name': spec['name'],
        'license': spec['license'],
        'noncommercial': bool(spec['noncommercial']),
        'note': spec['note'],
        'elapsed_s': round(elapsed, 1),
        'lines': lines,
        'words': words,
        'error': error,
        'ran': ran,
        'complete': complete,
    }


def _skipped(spec: dict, why: str) -> dict:
    return _row(spec, None, 0.0, 0, 0, why, False, False)


def measure_songs(slugs: list[str], budget_s_value: float | None = None) -> dict:
    """Write lang_models onto placed words and a bench file. A failure is recorded.

    One load per model, then every song. An unfinished model writes no clocks.
    Its elapsed time is not the estimate for the next language: the next one
    starts only when the last finished model says it fits, or, before any
    model has finished, when more than about a minute remains.
    """
    assert_independent()
    budget = float(budget_s() if budget_s_value is None else budget_s_value)
    summary = {
        'budget_s': budget,
        'models': [],
        'absent': [dict(row) for row in ABSENT],
        'mms_adapters': MMS_REJECTION,
        'songs': list(slugs),
    }
    songs = []
    for slug in slugs:
        path = work_dir(slug) / 'align-report.json'
        if not path.is_file():
            print(f'{slug}: нет align-report.json, языковой CTC пропущен', flush=True)
            summary.setdefault('missing', []).append(slug)
            continue
        try:
            audio, is_stem = vocal_stem(slug, None)
        except SystemExit as e:
            print(f'{slug}: {e}', flush=True)
            summary.setdefault('missing', []).append(slug)
            continue
        if not is_stem:
            print(f'{slug}: нет голосового стема, языковой CTC пропущен', flush=True)
            summary.setdefault('missing', []).append(slug)
            continue
        report = json.loads(path.read_text(encoding='utf-8'))
        songs.append({
            'slug': slug,
            'path': path,
            'report': report,
            'x': np.asarray(load_audio(audio, SR)),
        })
    deadline = time.monotonic() + budget
    previous_elapsed = None
    previous_lines = None
    for index, spec in enumerate(MODELS):
        remaining = deadline - time.monotonic()
        n_lines = len(_jobs(songs, spec['lang']))
        if index == 0 or previous_elapsed is None:
            if remaining <= 60:
                summary['models'].append(_skipped(spec, f'осталось {remaining:.0f} с'))
                continue
        else:
            per_line = previous_elapsed / previous_lines if previous_lines else previous_elapsed
            estimate = per_line * max(n_lines, 1) * 1.15 + 60
            if estimate > remaining:
                summary['models'].append(_skipped(
                    spec, f'оценка {estimate:.0f} с не входит в остаток {remaining:.0f} с'))
                continue
        row = _run_model(spec, songs, deadline)
        summary['models'].append(row)
        # A failure writes no clocks and does not become the next estimate.
        # The last finished language still does: a later language is smaller
        # or larger by its own line count, not by the crashed run's wall time.
        if row.get('complete') and row.get('lines'):
            previous_elapsed = float(row['elapsed_s'])
            previous_lines = int(row['lines'])
    for song in songs:
        report = song['report']
        report.setdefault('summary', {})['lang_ctc'] = summary
        song['path'].write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    out = ROOT / 'docs' / 'analysis' / 'bench' / 'lang-ctc-measure.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'языковой CTC: моделей {len(summary["models"])}, файл {out.name}', flush=True)
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--measure', action='store_true')
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    if not args.measure:
        ap.error('нужен --measure')
    try:
        measure_songs(args.slugs)
    except Exception as e:
        print(f'языковой CTC не измерен ({e.__class__.__name__}: {e})', flush=True)
        return 0
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
