"""Omnilingual CTC 300M as a witness for Latin and Azerbaijani only.

The card is exactly omniASR_CTC_300M. Not the LLM-ASR models, not 1B/3B/7B,
not a v2 checkpoint. Clocks are Viterbi on the CTC logits of the known line,
not a recognition. A language missing from lang_ids.py on the day of the run
is skipped. Windows of 40 seconds or longer are skipped, not split.

The five XLS-R languages are not measured again. Weights are not committed.
Lyrics change only when the published line count rises and the 158-line
baseline is kept. Otherwise the bench files this pass rewrote are put back.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

import engines
import lang_ctc
import phoneme
import stem_cache
from common import ROOT, load_audio, vocal_stem, work_dir

CARD = 'omniASR_CTC_300M'
README = 'https://raw.githubusercontent.com/facebookresearch/omnilingual-asr/main/README.md'
LANGS = {'la': 'lat_Latn', 'az': 'aze_Latn'}
SONGS = ('i-have-come-alive', 'karitas', 'one')
ALIGN_RUN = '39548436423'
MODEL_NAME = 'omni-ctc-300m'
MAX_WINDOW_S = 40.0
# The job is 150 minutes. Leave the chance pass and qa their own time.
DEFAULT_BUDGET_S = 70 * 60
# Published lines that must not fall. Internal union can be one higher.
BASE_GROUPS = {
    ('i-have-come-alive', 'solo'): 85,
    ('karitas', 'solo'): 36,
    ('one', 'solo'): 24,
    ('one', 'choir'): 13,
}
BASE_PUBLISHED = 158
BASE_INTERNAL = 159


def budget_s() -> float:
    raw = os.environ.get('OMNI_BUDGET_S', '')
    try:
        value = float(raw) if str(raw).strip() else DEFAULT_BUDGET_S
    except ValueError:
        value = DEFAULT_BUDGET_S
    return value if value > 0 else DEFAULT_BUDGET_S


def _get_text(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'living-lyrics-omni'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode('utf-8', errors='replace')


def read_license() -> dict:
    """The README sentence, fetched the day of the run. No weights before this."""
    if CARD != 'omniASR_CTC_300M':
        return {'ok': False, 'card': CARD, 'why': 'карточка не omniASR_CTC_300M'}
    banned = ('LLM', '7B', '1B', '3B', 'v2', 'ZS')
    if any(mark in CARD for mark in banned):
        return {'ok': False, 'card': CARD, 'why': 'карточка не голова CTC 300M'}
    text = _get_text(README)
    sentence = ''
    for line in text.splitlines():
        if 'Apache 2.0' in line and 'models are released under' in line:
            sentence = line.strip()
            break
    return {
        'ok': bool(sentence),
        'card': CARD,
        'url': README,
        'sentence': sentence,
        'why': '' if sentence else 'в README нет фразы про Apache 2.0 для моделей',
    }


def _report_path() -> Path:
    return ROOT / 'docs' / 'analysis' / 'bench' / 'omni-ctc.json'


def _already() -> bool:
    if os.environ.get('OMNI_FORCE') == '1':
        return False
    path = _report_path()
    if not path.is_file():
        return False
    try:
        old = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    return bool(old.get('finished'))


def _write(payload: dict) -> None:
    payload['finished'] = True
    payload['moved_times'] = bool(payload.get('moved_times'))
    out = _report_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    md = ROOT / 'docs' / 'analysis' / 'bench' / 'omni-ctc.md'
    md.write_text(render_md(payload), encoding='utf-8')
    print(render_md(payload), flush=True)


def render_md(payload: dict) -> str:
    lic = payload.get('license') or {}
    lines = [
        '# Omnilingual CTC 300M, латынь и азербайджанский',
        '',
        'Карточка ровно `omniASR_CTC_300M`. Не LLM-ASR, не 1B, не 3B, не 7B, не v2. '
        'Часы — Витерби проекта по логитам известной строки, не распознавание. '
        'Окно 40 с и длиннее пропускается и не режется. '
        'Арабский, английский, персидский, турецкий и немецкий этим проходом не мерились. '
        'Время строк меняется только если опубликованных строк стало больше и база 158 удержана.',
        '',
        f"Лицензия: `{lic.get('sentence') or lic.get('why') or '—'}`. "
        f"Бюджет {payload.get('budget_s')} с. {payload.get('note') or ''}",
        '',
        '| язык | код | в списке | строк | пропущено окон | слов с часом | пустые |',
        '|---|---|---|---:|---:|---:|---|',
    ]
    for row in payload.get('languages') or []:
        lines.append(
            f"| {row.get('lang')} | {row.get('code')} | {row.get('listed')} | "
            f"{row.get('lines') if row.get('lines') is not None else '—'} | "
            f"{row.get('skipped_windows') if row.get('skipped_windows') is not None else '—'} | "
            f"{row.get('words') if row.get('words') is not None else '—'} | "
            f"{row.get('empty') if row.get('empty') is not None else '—'} |"
        )
    chance = payload.get('chance') or {}
    lines += [
        '',
        f"Проход строки: {chance.get('line_chance') if chance.get('line_chance') is not None else '—'}. "
        f"База удержана: {chance.get('baseline_kept')}. "
        f"Внутренне доказано: {chance.get('internal_proved') if chance.get('internal_proved') is not None else '—'}. "
        f"Опубликовано после прохода: {chance.get('published_after') if chance.get('published_after') is not None else '—'}. "
        f"Время строк изменено: {payload.get('moved_times')}.",
        '',
        '| песня | язык | слов | модель | в 0,10 с | проход слова | решение |',
        '|---|---|---:|---|---:|---:|---|',
    ]
    for row in chance.get('rows') or []:
        value = row.get('word_chance')
        shown = '—' if value is None else f'{float(value):.3f}'.replace('.', ',')
        lines.append(
            f"| {row.get('song')} | {row.get('lang')} | {row.get('words')} | "
            f"{row.get('model') or '—'} | {row.get('agreement') or 0} | {shown} | {row.get('why') or '—'} |"
        )
    if not (chance.get('rows') or []):
        lines.append('| — | — | — | — | — | — | проход не считался |')
    lines.append('')
    return '\n'.join(lines)


def _download(slug: str) -> Path:
    dest = work_dir('.omni-artifact') / slug
    report = work_dir(slug) / 'align-report.json'
    if report.is_file() and vocal_stem(slug, None)[1]:
        return report
    if not dest.exists() or not any(dest.rglob('align-report.json')):
        dest.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ['gh', 'run', 'download', ALIGN_RUN, '-n', f'align-{slug}', '-D', str(dest)],
            check=True,
        )
    found = next(dest.rglob('align-report.json'), None)
    if found is None:
        raise RuntimeError(f'{slug}: в артефакте нет align-report.json')
    report.parent.mkdir(parents=True, exist_ok=True)
    if not report.is_file():
        shutil.copyfile(found, report)
    cache = ROOT / 'work' / 'stem-cache'
    cache.mkdir(parents=True, exist_ok=True)
    for enc in dest.rglob('*.flac.enc'):
        target = cache / enc.name
        if not target.is_file():
            shutil.copyfile(enc, target)
    stem_cache.unpack(slug, cache)
    if not (work_dir(slug) / 'stems' / 'vocals.wav').is_file():
        raise RuntimeError(f'{slug}: вокал htdemucs из артефакта не восстановлен')
    return report


def _eligible(line: dict, lang: str) -> bool:
    return lang_ctc._eligible(line, lang)


def _jobs(report: dict, audio: np.ndarray, lang: str) -> list[dict]:
    duration = len(audio) / float(engines.SR)
    rows = []
    for line in report.get('lines') or []:
        if not _eligible(line, lang):
            continue
        t0, t1 = phoneme._window(line, duration)
        rows.append({'line': line, 't0': t0, 't1': t1, 'duration': duration})
    return rows


def _specials(tokenizer) -> tuple[int, set[int], dict]:
    info = tokenizer.vocab_info
    named = {}
    for key in ('pad_idx', 'bos_idx', 'eos_idx', 'unk_idx'):
        value = getattr(info, key, None)
        if value is not None:
            named[key] = int(value)
    blank = int(named.get('pad_idx', 0))
    drop = {blank}
    for key in ('bos_idx', 'eos_idx'):
        if key in named:
            drop.add(named[key])
    return blank, drop, named


def _as_ids(raw) -> list[int]:
    if hasattr(raw, 'tolist'):
        raw = raw.tolist()
    if isinstance(raw, int):
        return [int(raw)]
    return [int(item) for item in list(raw)]


def _word_ids(encoder, word: str, drop: set[int], unk: int | None) -> list[int]:
    text = str(word or '').strip().strip('.,;:!?…—–«»"“”()[]')
    if not any(ch.isalpha() for ch in text):
        return []
    ids = [item for item in _as_ids(encoder(text)) if item not in drop]
    if unk is not None and unk in ids:
        return []
    return ids


def _line_tokens(words: list[dict], encoder, drop: set[int], unk: int | None) -> tuple[list[int], list[int]]:
    tokens: list[int] = []
    owner: list[int] = []
    for index, word in enumerate(words):
        ids = _word_ids(encoder, str(word.get('w') or ''), drop, unk)
        if not ids:
            continue
        tokens.extend(ids)
        owner.extend([index] * len(ids))
    return tokens, owner


def _logits(pipe, samples: np.ndarray):
    import torch
    from fairseq2.nn.batch_layout import BatchLayout

    item = {
        'waveform': np.ascontiguousarray(samples, dtype=np.float32),
        'sample_rate': 16000,
    }
    waves = list(pipe._build_audio_wavform_pipeline([item]).and_return())
    if not waves:
        raise RuntimeError('пустая волна')
    batch = pipe._create_batch_simple([(waves[0], None)])
    layout = BatchLayout(
        batch.source_seqs.shape,
        seq_lens=batch.source_seq_lens,
        device=batch.source_seqs.device,
    )
    with torch.inference_mode():
        logits, bound = pipe.model(batch.source_seqs, layout)
    n = int(bound.seq_lens[0])
    if n < 1:
        raise RuntimeError('логиты пустые')
    return torch.log_softmax(logits[0, :n].float(), dim=-1).detach().cpu().numpy()


def _align_job(pipe, audio: np.ndarray, job: dict, blank: int, drop: set[int], unk: int | None):
    line = job['line']
    words = line.get('words') or []
    span = float(job['t1']) - float(job['t0'])
    if span >= MAX_WINDOW_S:
        return None, 'окно длиннее 40 с'
    tokens, owner = _line_tokens(words, pipe.token_encoder, drop, unk)
    if not tokens:
        return [None] * len(words), None
    a = max(0, int(float(job['t0']) * engines.SR))
    b = min(len(audio), int(float(job['t1']) * engines.SR))
    if b - a < int(0.4 * engines.SR):
        return [None] * len(words), 'окно короче 0,4 с'
    lp = _logits(pipe, audio[a:b])
    placed = engines.align_window(lp, tokens, owner, len(words), blank, float(job['t0']), span)
    if placed is None:
        return [None] * len(words), None
    return placed, None


def _load_pipe():
    import torch
    from fairseq2.models.wav2vec2.asr import Wav2Vec2AsrModel
    from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline
    from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs

    torch.set_num_threads(4)
    device = 'cpu'
    pipe = ASRInferencePipeline(model_card=CARD, device=device, dtype=torch.float32)
    if not isinstance(pipe.model, Wav2Vec2AsrModel):
        raise RuntimeError(f'загрузился {type(pipe.model).__name__}, не Wav2Vec2AsrModel')
    name = type(pipe.model).__name__
    if 'Llama' in name or 'LLM' in name:
        raise RuntimeError(f'загрузился {name}')
    return pipe, list(supported_langs), device


def _published() -> dict[tuple[str, str], int]:
    import timing as T

    counts: dict[tuple[str, str], int] = {}
    for slug in SONGS:
        lyrics = json.loads((ROOT / 'content' / 'songs' / slug / 'lyrics.json').read_text(encoding='utf-8'))
        for sec, line in T.vocal_lines(lyrics):
            if 'timing-draft' in (line.get('flags') or []):
                continue
            kind = T.group(sec, line)
            if kind not in ('solo', 'choir'):
                continue
            key = (slug, kind)
            counts[key] = counts.get(key, 0) + 1
    return counts


def _snapshot(folder: Path) -> None:
    if folder.exists():
        shutil.rmtree(folder)
    bench = ROOT / 'docs' / 'analysis' / 'bench'
    shutil.copytree(bench, folder / 'bench')
    songs = folder / 'songs'
    songs.mkdir(parents=True)
    for slug in SONGS:
        src = ROOT / 'content' / 'songs' / slug
        dst = songs / slug
        dst.mkdir()
        for name in ('lyrics.json', 'song.json'):
            shutil.copyfile(src / name, dst / name)


def _restore(folder: Path) -> None:
    bench = ROOT / 'docs' / 'analysis' / 'bench'
    if bench.exists():
        shutil.rmtree(bench)
    shutil.copytree(folder / 'bench', bench)
    for slug in SONGS:
        src = folder / 'songs' / slug
        dst = ROOT / 'content' / 'songs' / slug
        for name in ('lyrics.json', 'song.json'):
            shutil.copyfile(src / name, dst / name)


def _lang_rows(payload_chance: dict) -> list[dict]:
    rows = []
    for row in (payload_chance or {}).get('pairs') or []:
        if row.get('lang') in LANGS:
            rows.append({
                'song': row.get('song'),
                'lang': row.get('lang'),
                'words': row.get('words'),
                'model': row.get('model'),
                'agreement': row.get('agreement'),
                'word_chance': row.get('word_chance'),
                'why': row.get('why'),
                'admitted': row.get('admitted'),
            })
    return rows


def _choose(snapshot: Path) -> dict:
    """Run the existing chance pass. Put the bench back unless a publish is kept."""
    import attack_chance

    before = _published()
    if before != {key: BASE_GROUPS[key] for key in BASE_GROUPS} or sum(before.values()) != BASE_PUBLISHED:
        return {
            'ran': False,
            'why': f'опубликованный счёт до прохода {before} не равен базе {BASE_GROUPS}',
            'baseline_kept': False,
            'published_before': {f'{a}|{b}': n for (a, b), n in before.items()},
            'rows': [],
        }
    _snapshot(snapshot)
    try:
        code = int(attack_chance.main(['--choose', *SONGS]))
    except SystemExit as exc:
        code = int(exc.code or 2)
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'attack-chance.json'
    data = {}
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            data = {}
    chosen = data.get('chosen') or {}
    union = chosen.get('union') or {}
    info = {
        'ran': True,
        'exit': code,
        'within_limit': chosen.get('within_limit'),
        'line_chance': chosen.get('chance'),
        'baseline_kept': chosen.get('baseline_kept'),
        'baseline_n': chosen.get('baseline_n'),
        'baseline_reason': chosen.get('baseline_reason'),
        'baseline_lost': chosen.get('baseline_lost'),
        'internal_proved': union.get('proved'),
        'rows': _lang_rows(data.get('lang_ctc') or {}),
        'published_before': sum(before.values()),
        'published_after': sum(before.values()),
        'kept_files': False,
    }
    rise = (
        code == 0
        and chosen.get('within_limit')
        and chosen.get('baseline_kept')
        and chosen.get('chance') is not None
        and float(chosen['chance']) <= 0.05 + 1e-12
        and isinstance(union.get('proved'), int)
        and int(union['proved']) > BASE_INTERNAL
    )
    if rise:
        for slug in SONGS:
            subprocess.run([sys.executable, 'qa_sync.py', slug, '--apply'], check=False)
        after = _published()
        info['published_after'] = sum(after.values())
        info['published_groups'] = {f'{a}|{b}': n for (a, b), n in sorted(after.items())}
        dropped = any(after.get(key, 0) < BASE_GROUPS[key] for key in BASE_GROUPS)
        if dropped or sum(after.values()) <= BASE_PUBLISHED:
            _restore(snapshot)
            info['kept_files'] = False
            info['why'] = 'qa не поднял опубликованный счёт или уронил группу, файлы возвращены'
            info['published_after'] = BASE_PUBLISHED
        else:
            info['kept_files'] = True
            info['why'] = 'опубликованный счёт вырос, база удержана'
    else:
        _restore(snapshot)
        info['kept_files'] = False
        info['why'] = 'прибавки опубликованных строк нет, файлы возвращены'
    return info


def measure() -> int:
    if _already():
        print('отчёт omni-ctc уже записан, повтор не считался', flush=True)
        return 0
    started = time.monotonic()
    payload: dict = {
        'budget_s': budget_s(),
        'card': CARD,
        'align_run': ALIGN_RUN,
        'languages': [],
        'license': {},
        'chance': {},
        'moved_times': False,
        'note': '',
        'blank': None,
    }
    try:
        payload['license'] = read_license()
    except Exception as exc:
        payload['license'] = {'ok': False, 'error': f'{exc.__class__.__name__}: {exc}'}
        payload['note'] = 'README не прочитан, веса не качались'
        payload['languages'] = [{'lang': lang, 'code': code, 'listed': None, 'status': 'лицензия не прочитана'} for lang, code in LANGS.items()]
        _write(payload)
        return 0
    if not payload['license'].get('ok'):
        payload['note'] = payload['license'].get('why') or 'лицензия не Apache 2.0, веса не качались'
        payload['languages'] = [{'lang': lang, 'code': code, 'listed': None, 'status': 'лицензия не Apache-2.0'} for lang, code in LANGS.items()]
        _write(payload)
        return 0

    songs = []
    try:
        for slug in SONGS:
            path = _download(slug)
            report = json.loads(path.read_text(encoding='utf-8'))
            audio_path, is_stem = vocal_stem(slug, None)
            if not is_stem:
                raise RuntimeError(f'{slug}: нет вокального стема')
            audio = np.asarray(load_audio(audio_path, engines.SR))
            songs.append({'slug': slug, 'path': path, 'report': report, 'audio': audio})
    except Exception as exc:
        payload['note'] = f'артефакт не подготовлен ({exc.__class__.__name__}: {exc})'
        payload['languages'] = [{'lang': lang, 'code': code, 'listed': None, 'status': 'ошибка'} for lang, code in LANGS.items()]
        _write(payload)
        return 0

    pending = []
    for lang, code in LANGS.items():
        jobs = []
        for song in songs:
            jobs.extend({'song': song, **job, 'lang': lang} for job in _jobs(song['report'], song['audio'], lang))
        pending.append({'lang': lang, 'code': code, 'jobs': jobs})
    if not any(row['jobs'] for row in pending):
        payload['note'] = 'поставленных строк латыни и азербайджанского нет'
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'listed': None, 'lines': 0, 'status': 'нет строк'}
            for row in pending
        ]
        _write(payload)
        return 0

    try:
        from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs
        supported = list(supported_langs)
    except Exception as exc:
        payload['note'] = f'список языков не прочитан ({exc.__class__.__name__}: {exc}), веса не качались'
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'lines': len(row['jobs']), 'status': 'модель не загрузилась'}
            for row in pending
        ]
        _write(payload)
        return 0
    if not any(row['code'] in supported and row['jobs'] for row in pending):
        payload['note'] = 'кодов lat_Latn и aze_Latn в списке языка на день прогона нет, веса не качались'
        payload['languages'] = [
            {
                'lang': row['lang'], 'code': row['code'], 'listed': row['code'] in supported,
                'lines': len(row['jobs']), 'status': 'языка нет',
            }
            for row in pending
        ]
        _write(payload)
        return 0

    try:
        pipe, supported, device = _load_pipe()
    except Exception as exc:
        payload['note'] = f'модель не загрузилась ({exc.__class__.__name__}: {exc})'
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'lines': len(row['jobs']), 'status': 'модель не загрузилась'}
            for row in pending
        ]
        _write(payload)
        return 0
    payload['device'] = device
    blank, drop, named = _specials(pipe.tokenizer)
    payload['blank'] = blank
    payload['specials'] = named
    unk = named.get('unk_idx')

    listed = []
    runnable = []
    for row in pending:
        ok = row['code'] in supported
        row['listed'] = ok
        listed.append(row)
        if ok and row['jobs']:
            runnable.append(row)
    if not runnable:
        payload['note'] = 'кодов lat_Latn и aze_Latn в списке языка на день прогона нет, веса после проверки класса не использовались для часов'
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'listed': row['listed'], 'lines': len(row['jobs']), 'status': 'языка нет'}
            for row in listed
        ]
        _write(payload)
        return 0

    first = runnable[0]['jobs'][0]
    probe_started = time.monotonic()
    try:
        _align_job(pipe, first['song']['audio'], first, blank, drop, unk)
    except Exception as exc:
        payload['note'] = f'пробная строка не посчитана ({exc.__class__.__name__}: {exc})'
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'listed': row['listed'], 'status': 'ошибка строки'}
            for row in listed
        ]
        _write(payload)
        return 0
    probe_s = time.monotonic() - probe_started
    n_lines = sum(len(row['jobs']) for row in runnable)
    estimate = probe_s * max(n_lines - 1, 0) * 1.15
    payload['probe_s'] = round(probe_s, 1)
    payload['estimate_s'] = round(estimate, 1)
    remaining = budget_s() - (time.monotonic() - started)
    if estimate > remaining:
        payload['note'] = (
            f'оценка {estimate:.0f} с на {n_lines} строк не входит в остаток {remaining:.0f} с. '
            f'Одна строка заняла {probe_s:.0f} с. Часы не записаны.'
        )
        payload['languages'] = [
            {'lang': row['lang'], 'code': row['code'], 'listed': row['listed'], 'lines': len(row['jobs']), 'status': 'не влезло'}
            for row in listed
        ]
        _write(payload)
        return 0

    lang_rows = []
    any_written = False
    for row in listed:
        if not row['listed']:
            lang_rows.append({
                'lang': row['lang'], 'code': row['code'], 'listed': False,
                'lines': len(row['jobs']), 'status': 'языка нет',
            })
            continue
        attempted = 0
        errors = 0
        skipped = 0
        buffered: list[tuple[dict, float | None]] = []
        error = None
        for job in row['jobs']:
            if time.monotonic() - started > budget_s():
                error = 'бюджет исчерпан'
                break
            span = float(job['t1']) - float(job['t0'])
            words = job['line'].get('words') or []
            if span >= MAX_WINDOW_S:
                skipped += 1
                buffered.extend((word, None) for word in words)
                continue
            attempted += 1
            try:
                placed, why = _align_job(pipe, job['song']['audio'], job, blank, drop, unk)
            except Exception as exc:
                errors += 1
                placed = None
                error = error or f'{exc.__class__.__name__}: {exc}'
                why = None
            if why == 'окно длиннее 40 с':
                skipped += 1
            if placed is None:
                placed = [None] * len(words)
            for word, start in zip(words, placed):
                buffered.append((word, None if start is None else float(start)))
        complete = error != 'бюджет исчерпан' and not (attempted and errors * 2 > attempted)
        empty = lang_ctc.only_empty_clocks(buffered)
        words_n = 0
        if complete and not empty:
            for word, start in buffered:
                if not word.get('roman'):
                    continue
                word.setdefault('lang_models', {})[MODEL_NAME] = start
                words_n += 1
                any_written = True
        elif empty:
            error = error or 'алфавит модели не покрыл слова'
        lang_rows.append({
            'lang': row['lang'], 'code': row['code'], 'listed': True,
            'lines': attempted, 'skipped_windows': skipped, 'errors': errors,
            'words': words_n, 'empty': empty, 'status': 'измерено' if complete and not empty else 'пустые часы' if empty else 'неполно',
            'error': error,
        })
    for song in songs:
        song['path'].write_text(json.dumps(song['report'], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    payload['languages'] = lang_rows
    if not any_written:
        payload['note'] = 'часов, которые можно допустить, нет. Случайный проход не запускался, время строк не менялось.'
        _write(payload)
        return 0

    snapshot = work_dir('.omni-snapshot')
    try:
        chance = _choose(snapshot)
    except Exception as exc:
        if snapshot.exists():
            try:
                _restore(snapshot)
            except Exception:
                pass
        payload['note'] = f'случайный проход не собран ({exc.__class__.__name__}: {exc}). Файлы возвращены, если снимок был.'
        payload['moved_times'] = False
        _write(payload)
        return 0
    payload['chance'] = chance
    payload['moved_times'] = bool(chance.get('kept_files'))
    payload['note'] = chance.get('why') or ''
    _write(payload)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if '--measure' not in args:
        raise SystemExit(__doc__)
    try:
        return measure()
    except Exception as exc:
        payload = {
            'budget_s': budget_s(), 'card': CARD, 'languages': [],
            'license': {}, 'note': f'{exc.__class__.__name__}: {exc}', 'moved_times': False,
        }
        try:
            _write(payload)
        except Exception:
            print(payload['note'], flush=True)
            return 2
        return 0


if __name__ == '__main__':
    sys.exit(main())
