"""Compare aligners and vocal stems against the official subtitle cues.

    python3 bench_align.py i-have-come-alive karitas one --stems i-have-come-alive

The cue start in docs/analysis/<slug>/cues.json is the line-start standard (a person
placed it, about 0.1–0.3 s). For every aligner the script reports, per language, how
many lines it placed, the share within 0.3 s and within 0.7 s, the median and the 90th
percentile of |line start − cue start|, and the CPU time. Weights are downloaded on
the runner and are not written into the repository.

Aligners: MMS-CTC with the star (the current pipeline), WhisperX wav2vec2 forced
alignment, stable-ts (Whisper small forced alignment of the known text), NeMo Forced
Aligner when the CPU install actually imports, and the Huang multilingual singing
model (LyricsAlignment-Multilingual, MIT, DALI / Jamendo / MUSDB, ISMIR 2025).
gmh is not run as modern German, and Latin and Azerbaijani are not relabelled.

Stems, measured separately with MMS and WhisperX on one shared excerpt of I Have Come
Alive (the first STEM_SECONDS of the mix): htdemucs, htdemucs_ft, an UVR MDX vocal
model, and a Mel-Band RoFormer vocal model. A full-song four-stem sweep does not fit
the runner. Licences are recorded in the report.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
import unicodedata
from pathlib import Path

import numpy as np

import align
import engines
import timing as T
from common import ROOT, find_source, load_audio, load_json, song_dir, work_dir

LANGS = ('en', 'tr', 'ar', 'fa', 'az', 'la', 'de', 'gmh')
# Whisper's own language codes. Medieval German is absent on purpose.
WHISPER_LANG = {'en': 'en', 'tr': 'tr', 'ar': 'ar', 'fa': 'fa', 'az': 'az', 'de': 'de', 'la': 'la', 'es': 'es', 'fr': 'fr', 'it': 'it'}
# The singing model was trained with these espeak voices. gmh is not in the list.
HUANG_LANG = {'en': 'en-us', 'de': 'de', 'fr': 'fr-fr', 'es': 'es', 'it': 'it'}
HUANG_REPO = 'https://github.com/jhuang448/LyricsAlignment-Multilingual.git'
SR = 16000
# Stem models are compared on this much of the mix, not the whole song: htdemucs_ft is
# about four times htdemucs, and a Mel-RoFormer on a 16-minute track does not fit the runner.
STEM_SECONDS = 240.0

LICENSES = {
    'mms-ctc-star': 'torchaudio MMS_FA, веса CC-BY-NC 4.0. В репозиторий не коммитятся.',
    'whisperx': 'Чекпоинты wav2vec2, которые выбирает WhisperX (torchaudio и Hugging Face). Веса не коммитятся.',
    'stable-ts': 'Код stable-ts — MIT (архив с 2026-05-30). Веса Whisper small — MIT. Это выравнивание известного текста, не распознавание. Веса не коммитятся.',
    'nemo': 'Код NeMo Apache-2.0. Модель nvidia/stt_en_fastconformer_ctc_large — лицензия NVIDIA (исследование), только английский. Веса не коммитятся.',
    'huang-2025': 'jhuang448/LyricsAlignment-Multilingual: код и checkpoint_Baseline под MIT. Обучена на DALI, проверялась на Jamendo и MUSDB (ISMIR 2025, акустическая модель ICASSP 2022). Фонемы espeak только для en/de/fr/es/it. gmh немецким не подменяется. Веса не коммитятся.',
    'htdemucs': 'Код Demucs MIT. Веса автор не относит к MIT и оставляет для научного использования. Не коммитятся.',
    'htdemucs_ft': 'Тот же статус весов, что у htdemucs: набор из четырёх дообученных моделей. Не коммитятся.',
    'mdx': 'UVR-MDX-NET-Voc_FT.onnx. Код UVR MIT, веса моделей UVR — MIT с указанием Anjok07 и aufr33. Не коммитятся.',
    'mel-roformer': 'Вокальный Mel-Band RoFormer из каталога audio-separator. У весов Kimberley Jensen и viperx нет явной коммерческой лицензии. Только стенд, в репозиторий не коммитятся. Сайт некоммерческий.',
}

NOT_RUN = [
    'Cheng, Nakano, Goto, DAFx 2025 (masked cross-entropy, Jamendo MedAE 0,041 с): публичных весов для прогона нет.',
    'Kick и др., box loss, 2025 (github.com/tikick/LyricsAlignment): код есть, готового чекпоинта в репозитории нет, нужен DALI и phonemizer IPA. Не запускался.',
    'schufo/lyrics-aligner (2021, MIT, MUSDB, английские фонемы) старше запрошенного окна 2022–2026. Вместо него взята многоязычная модель Huang.',
]


def summarize(rows: list[dict]) -> dict:
    """Shares are over every row. The median and p90 are over rows that have a delta."""
    by: dict[str, list] = {}
    for row in rows:
        by.setdefault(row.get('lang') or '?', []).append(row.get('delta'))
    return {'all': _stats([r.get('delta') for r in rows]), 'by_lang': {lang: _stats(vals) for lang, vals in sorted(by.items())}}


def _stats(deltas: list) -> dict:
    placed = [float(d) for d in deltas if d is not None]
    n = len(deltas)
    return {
        'n': n,
        'placed': len(placed),
        'within_0_3': sum(d <= 0.30 for d in placed),
        'within_0_7': sum(d <= 0.70 for d in placed),
        'median': None if not placed else round(float(np.median(placed)), 3),
        'p90': None if not placed else round(float(np.percentile(placed, 90)), 3),
    }


def recommend(blocks: list[dict]) -> dict[str, str]:
    """Per language, the aligner with the highest share of lines within 0.3 s.

    A tie breaks on a smaller median, then a smaller p90. An aligner that placed
    nothing in that language is not a candidate.
    """
    langs = sorted({row['lang'] for block in blocks for row in block.get('rows', [])})
    choice: dict[str, str] = {}
    for lang in langs:
        best_name, best_key = None, None
        for block in blocks:
            if block.get('error') and not block.get('rows'):
                continue
            vals = [row['delta'] for row in block['rows'] if row['lang'] == lang]
            if not vals:
                continue
            st = _stats(vals)
            if st['placed'] == 0:
                continue
            share = st['within_0_3'] / st['n'] if st['n'] else 0.0
            key = (share, -(st['median'] if st['median'] is not None else 99.0), -(st['p90'] if st['p90'] is not None else 99.0))
            if best_key is None or key > best_key:
                best_key, best_name = key, block['aligner']
        if best_name:
            choice[lang] = best_name
    return choice


def _letter(word: str) -> bool:
    return any(unicodedata.category(ch).startswith('L') for ch in word)


def _rows(song: dict, starts: dict[str, float | None] | None) -> list[dict]:
    out = []
    for line in song['lines']:
        start = None if not starts else starts.get(line['id'])
        delta = None if start is None else round(abs(float(start) - line['cue_start']), 3)
        out.append({
            'slug': song['slug'], 'id': line['id'], 'lang': line['lang'],
            'cue': round(line['cue_start'], 3),
            'start': None if start is None else round(float(start), 3),
            'delta': delta,
        })
    return out


def load_song(slug: str) -> dict:
    lyrics = load_json(song_dir(slug) / 'lyrics.json')
    song = load_json(song_dir(slug) / 'song.json')
    cues = align.load_cues(slug)
    vocal = list(T.vocal_lines(lyrics))
    lines = []
    for i, (sec, line) in enumerate(vocal):
        cue = cues.get(line['id'])
        if cue is None:
            continue
        prev = cues.get(vocal[i - 1][1]['id']) if i else None
        nxt = cues.get(vocal[i + 1][1]['id']) if i + 1 < len(vocal) else None
        prev_t = (float(prev['start']), float(prev['end'])) if prev else None
        nxt_t = (float(nxt['start']), float(nxt['end'])) if nxt else None
        win = align.cue_window(float(cue['start']), float(cue['end']), prev_t, nxt_t,
                                float(sec['start']), float(sec['end']), float(song['duration']))
        lines.append({
            'id': line['id'], 'lang': line.get('lang') or '?', 'script': line.get('script') or '',
            'words': [w['w'] for w in line['words']], 'sec': sec, 'line': line,
            'cue_start': float(cue['start']), 'cue_end': float(cue['end']), 'win': win,
        })
    return {'slug': slug, 'duration': float(song['duration']), 'lines': lines}


def ensure_source(slug: str) -> Path:
    try:
        return find_source(slug)
    except SystemExit:
        rc = subprocess.call([sys.executable, str(ROOT / 'scripts' / 'pipeline' / 'decrypt_audio.py'), slug])
        if rc != 0:
            raise SystemExit(f'не расшифровать {slug}')
        return find_source(slug)


def ensure_htdemucs(slug: str) -> Path:
    stems = work_dir(slug) / 'stems'
    vocals = stems / 'vocals.wav'
    drums = stems / 'drums.wav'
    label = (stems / 'model.txt').read_text(encoding='utf-8').strip() if (stems / 'model.txt').exists() else ''
    if vocals.is_file() and drums.is_file() and label in ('', 'htdemucs'):
        return vocals
    ensure_source(slug)
    import separate
    separate.main(slug, 'htdemucs')
    return vocals


def separate_to(slug: str, model: str, dest: Path, source: Path | None = None) -> Path:
    vocals = dest / 'vocals.wav'
    label = (dest / 'model.txt').read_text(encoding='utf-8').strip() if (dest / 'model.txt').exists() else ''
    if vocals.is_file() and label == model:
        return vocals
    if source is None:
        ensure_source(slug)
    import separate
    separate.main(slug, model, dest=dest, source=source)
    return vocals


def excerpt_mix(slug: str, seconds: float = STEM_SECONDS) -> Path:
    """The first `seconds` of the mix, so every stem model hears the same piece."""
    dest = work_dir(slug) / f'bench-excerpt-{int(seconds)}.wav'
    if dest.is_file() and dest.stat().st_size > 1000:
        return dest
    src = ensure_source(slug)
    subprocess.check_call(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-t', str(seconds), '-ac', '2', str(dest)])
    return dest


def _first_lettered(words: list[str], starts: list) -> float | None:
    for word, start in zip(words, starts):
        if start is not None and _letter(word):
            return float(start)
    for start in starts:
        if start is not None:
            return float(start)
    return None


def run_mms(song: dict, audio: Path) -> dict[str, float | None]:
    x = load_audio(audio, SR)
    duration = len(x) / SR
    lp = align.emissions(song['slug'], audio, x)
    vocab = align.vocabulary()
    rom = align.Romaniser()
    units = []
    cues = {}
    for i, line in enumerate(song['lines']):
        roman = [rom(w, line['lang'], line['script']) for w in line['words']]
        units.append(align.Unit(i, line['sec'], line['line'], roman, vocab))
        cues[line['id']] = {'start': line['cue_start'], 'end': line['cue_end']}
    passes = align.cue_pass(lp, units, cues, duration)
    out: dict[str, float | None] = {}
    for unit, passed in zip(units, passes):
        placed = [None] * len(unit.roman)
        if passed.get('res'):
            for i, word in enumerate(passed['res']['words']):
                if word is not None and i < len(placed):
                    placed[i] = word['f0'] / align.FPS
        out[unit.id] = _first_lettered([w['w'] for w in unit.line['words']], placed)
    return out


def run_whisperx(song: dict, audio: Path) -> dict[str, float | None]:
    x = load_audio(audio, SR)
    jobs = []
    for line in song['lines']:
        if line['lang'] not in engines.WHISPERX_TORCH and line['lang'] not in engines.WHISPERX_HF:
            continue
        jobs.append({'id': line['id'], 'lang': line['lang'], 'script': line['script'],
                     'words': line['words'], 't0': line['win'][0], 't1': line['win'][1]})
    got = engines.WhisperX().word_starts(x, jobs) if jobs else {}
    out = {}
    for line in song['lines']:
        starts = got.get(line['id'])
        out[line['id']] = None if not starts else _first_lettered(line['words'], starts)
    return out


def _stable_start(result) -> float | None:
    words = []
    for seg in getattr(result, 'segments', None) or []:
        words.extend(getattr(seg, 'words', None) or [])
    if not words:
        words = list(getattr(result, 'words', None) or [])
    for word in words:
        start = getattr(word, 'start', None)
        if start is not None:
            return float(start)
    return None


def run_stable(songs: list[tuple[dict, Path]]) -> dict[str, dict[str, float | None]]:
    import stable_whisper

    model = stable_whisper.load_model('small', device='cpu')
    out: dict[str, dict[str, float | None]] = {}
    for song, audio in songs:
        x = load_audio(audio, SR)
        starts: dict[str, float | None] = {}
        for line in song['lines']:
            lang = WHISPER_LANG.get(line['lang'])
            text = ' '.join(w for w in line['words'] if w.strip())
            if not lang or not text.strip():
                starts[line['id']] = None
                continue
            a, b = int(line['win'][0] * SR), int(line['win'][1] * SR)
            seg = np.ascontiguousarray(x[max(0, a):min(len(x), b)])
            if len(seg) < int(0.2 * SR):
                starts[line['id']] = None
                continue
            try:
                result = _stable_align(model, seg, text, lang)
                rel = _stable_start(result)
            except Exception as e:
                print(f"stable-ts {line['id']}: {e.__class__.__name__}: {e}", flush=True)
                rel = None
            starts[line['id']] = None if rel is None else line['win'][0] + rel
        out[song['slug']] = starts
        print(f"stable-ts {song['slug']}: поставлено {sum(v is not None for v in starts.values())}/{len(starts)}", flush=True)
    return out


def _stable_align(model, seg: np.ndarray, text: str, lang: str):
    try:
        return model.align(seg, text, language=lang)
    except Exception:
        import soundfile
        path = work_dir('_bench') / 'clip.wav'
        path.parent.mkdir(parents=True, exist_ok=True)
        soundfile.write(str(path), seg, SR)
        return model.align(str(path), text, language=lang)


def _huang_root() -> Path:
    dest = ROOT / 'work' / 'bench-src' / 'LyricsAlignment-Multilingual'
    if not (dest / 'checkpoints' / 'checkpoint_Baseline').is_file():
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            subprocess.check_call(['git', '-C', str(dest), 'pull', '--ff-only'])
        else:
            subprocess.check_call(['git', 'clone', '--depth', '1', HUANG_REPO, str(dest)])
    return dest


def _huang_model():
    root = _huang_root()
    sys.path.insert(0, str(root))
    import torch
    from model import AcousticModel, train_audio_transforms
    from utils import load_model

    model = AcousticModel(1, 256, 72, 32, 1, 0.1)
    load_model(model, str(root / 'checkpoints' / 'checkpoint_Baseline'), False)
    model.eval()
    return model, train_audio_transforms


def _phones(words: list[str], backend, separator) -> tuple[list[str], list[list[int]]]:
    seq: list[str] = []
    idx: list[list[int]] = []
    for word in words:
        cleaned = ''.join(ch for ch in word if ch not in ';:,.!"?()-«»').lower()
        if not cleaned or not _letter(cleaned):
            continue
        raw = backend.phonemize([cleaned], separator=separator, strip=True)[0]
        phones = []
        for phone in raw.split(';'):
            phone = phone.replace('ˈ', '').replace('ˌ', '').strip()
            if phone and phone[-1] in '012':
                phone = phone[:-1]
            if phone:
                phones.append(phone)
        if not phones:
            continue
        start = len(seq)
        seq.extend(phones)
        end = len(seq)
        seq.append(' ')
        idx.append([start, end])
    return seq, idx


def run_huang(songs: list[tuple[dict, Path]]) -> dict[str, dict[str, float | None]]:
    import librosa
    import torch
    import torch.nn.functional as F
    from phonemizer.backend import EspeakBackend
    from phonemizer.separator import Separator

    model, transforms = _huang_model()
    from utils import alignment
    backends = {code: EspeakBackend(voice) for code, voice in HUANG_LANG.items()}
    separator = Separator(phone=';', word=None)
    resolution = 256 / 22050 * 3
    out: dict[str, dict[str, float | None]] = {}
    for song, audio in songs:
        y, _ = librosa.load(str(audio), sr=22050, mono=True)
        starts: dict[str, float | None] = {}
        for line in song['lines']:
            voice = HUANG_LANG.get(line['lang'])
            if voice is None:
                starts[line['id']] = None
                continue
            phones, idx = _phones(line['words'], backends[line['lang']], separator)
            a, b = int(line['win'][0] * 22050), int(line['win'][1] * 22050)
            seg = np.ascontiguousarray(y[max(0, a):min(len(y), b)])
            if not phones or len(seg) < int(0.2 * 22050):
                starts[line['id']] = None
                continue
            try:
                starts[line['id']] = _huang_line(model, transforms, seg, phones, idx, line['win'][0], resolution, torch, F, alignment)
            except Exception as e:
                print(f"huang {line['id']}: {e.__class__.__name__}: {e}", flush=True)
                starts[line['id']] = None
        out[song['slug']] = starts
        print(f"huang-2025 {song['slug']}: поставлено {sum(v is not None for v in starts.values())}/{len(starts)}", flush=True)
    return out


def _huang_line(model, transforms, seg, phones, idx, t0, resolution, torch, F, alignment) -> float | None:
    wave = torch.from_numpy(seg).view(1, -1)
    with torch.inference_mode():
        spec = transforms(wave)
        if spec.dim() == 3:
            spec = spec.unsqueeze(1)
        logits = model(spec)
        lp = F.log_softmax(logits, dim=2)[0].cpu().numpy()
    total = max(1, int(len(seg) / 22050 / resolution))
    lp = lp[:total]
    spans, _score = alignment(lp, phones, idx)
    if not spans:
        return None
    return t0 + float(spans[0][0]) * resolution


def run_nemo(songs: list[tuple[dict, Path]]) -> tuple[str, dict[str, dict[str, float | None]]]:
    """English fastconformer CTC forced alignment, or an honest reason it did not run."""
    try:
        import nemo.collections.asr as nemo_asr
        import torch
        from ctc import token_spans, viterbi
    except Exception as e:
        return f'not-installed: {e.__class__.__name__}: {e}', {}
    try:
        model = nemo_asr.models.EncDecCTCModelBPE.from_pretrained('nvidia/stt_en_fastconformer_ctc_large')
        model = model.cpu().eval()
    except Exception as e:
        return f'no-model: {e.__class__.__name__}: {e}', {}
    blank = int(getattr(model, 'blank_id', None) or model.tokenizer.vocab_size)
    out: dict[str, dict[str, float | None]] = {}
    for song, audio in songs:
        x = load_audio(audio, SR)
        starts: dict[str, float | None] = {}
        for line in song['lines']:
            if line['lang'] != 'en':
                starts[line['id']] = None
                continue
            text = ' '.join(w for w in line['words'] if _letter(w))
            a, b = int(line['win'][0] * SR), int(line['win'][1] * SR)
            seg = np.ascontiguousarray(x[max(0, a):min(len(x), b)])
            if not text or len(seg) < int(0.2 * SR):
                starts[line['id']] = None
                continue
            try:
                signal = torch.tensor(seg, dtype=torch.float32).unsqueeze(0)
                length = torch.tensor([seg.shape[0]], dtype=torch.long)
                with torch.inference_mode():
                    log_probs, _encoded, _ = model.forward(input_signal=signal, input_signal_length=length)
                lp = log_probs[0].cpu().numpy()
                ids = [int(i) for i in model.tokenizer.text_to_ids(text)]
                path = viterbi(lp, ids, blank)
                if path is None:
                    starts[line['id']] = None
                    continue
                first, _last = token_spans(path, len(ids))
                scale = (len(seg) / SR) / max(1, lp.shape[0])
                starts[line['id']] = line['win'][0] + float(first[0]) * scale
            except Exception as e:
                print(f"nemo {line['id']}: {e.__class__.__name__}: {e}", flush=True)
                starts[line['id']] = None
        out[song['slug']] = starts
        print(f"nemo {song['slug']}: поставлено {sum(v is not None for v in starts.values())}/{len(starts)}", flush=True)
    return '', out


def _mel_filename() -> str:
    try:
        proc = subprocess.run(['audio-separator', '--list_models'], capture_output=True, text=True, timeout=120)
    except Exception as e:
        print(f'mel list: {e}', flush=True)
        return 'vocals_mel_band_roformer.ckpt'
    names = re.findall(r'[\w.-]*[Mm]el[\w.-]*\.ckpt', (proc.stdout or '') + (proc.stderr or ''))
    vocal = [name for name in names if 'vocal' in name.lower()]
    return (vocal or names or ['vocals_mel_band_roformer.ckpt'])[0]


def _block(name: str, rows: list[dict], cpu_s: float, note: str = '', error: str = '') -> dict:
    summary = summarize(rows)
    worst = sorted((r for r in rows if r['delta'] is not None), key=lambda r: -r['delta'])[:8]
    print(f"BENCH {name}: ≤0.3 {summary['all']['within_0_3']}/{summary['all']['n']} "
          f"median {summary['all']['median']} p90 {summary['all']['p90']} cpu {cpu_s:.0f}s {error}", flush=True)
    return {
        'aligner': name, 'license': LICENSES.get(name, ''), 'cpu_s': round(cpu_s, 1),
        'note': note, 'error': error, 'summary': summary, 'worst': worst, 'rows': rows,
    }


def _run_named(name: str, songs: list[tuple[dict, Path]]) -> dict:
    t0 = time.perf_counter()
    note, error = '', ''
    rows: list[dict] = []
    try:
        if name == 'mms-ctc-star':
            for song, audio in songs:
                rows.extend(_rows(song, run_mms(song, audio)))
            note = 'MMS_FA, окно реплики, звёздочка между словами. Поставлено — есть начало первого слова с буквами.'
        elif name == 'whisperx':
            for song, audio in songs:
                rows.extend(_rows(song, run_whisperx(song, audio)))
            note = 'wav2vec2 WhisperX внутри того же окна. az, la, gmh, ota модели не имеют и не подменяются.'
        elif name == 'stable-ts':
            got = run_stable(songs)
            for song, _audio in songs:
                rows.extend(_rows(song, got.get(song['slug'])))
            note = 'Whisper small, выравнивание известного текста внутри окна реплики. gmh не подменяется немецким.'
        elif name == 'huang-2025':
            got = run_huang(songs)
            for song, _audio in songs:
                rows.extend(_rows(song, got.get(song['slug'])))
            note = 'Поющая модель Huang, фонемы espeak, то же окно. Языки вне en/de/fr/es/it не ставятся.'
        elif name == 'nemo':
            error, got = run_nemo(songs)
            for song, _audio in songs:
                rows.extend(_rows(song, got.get(song['slug'])))
            note = 'NeMo CTC, только английский, то же окно. Пустой error значит, что пакет встал.'
        else:
            error = f'неизвестный выравниватель {name}'
    except Exception as e:
        traceback.print_exc()
        error = f'{e.__class__.__name__}: {e}'
        rows = []
    return _block(name, rows, time.perf_counter() - t0, note, error)


def _fmt(stats: dict, n_key: str = 'n') -> str:
    n = stats[n_key]
    if not n:
        return '— | — | — | —'
    return (f"{stats['within_0_3']}/{n} | {stats['within_0_7']}/{n} | "
            f"{'—' if stats['median'] is None else stats['median']} | "
            f"{'—' if stats['p90'] is None else stats['p90']}")


def render_md(payload: dict) -> str:
    lines = [
        '# Стенд выравнивания',
        '',
        'Эталон начала строки — реплика `cues.json` (её ставит человек, точность около 0,1–0,3 с).',
        'Доли «≤ 0,3 с» и «≤ 0,7 с» считаются от всех строк: строка без начала в долю не входит.',
        'Медиана и 90-й перцентиль — модуль |начало выравнивателя − начало реплики| по строкам, где начало есть.',
        'Окно у всех одно и то же: реплика с запасом 0,8 с до начала и 0,5 с после конца, на соседа не больше 0,5 с.',
        'Средневековый немецкий (`gmh`) современным немецким не подменяется. Латынь и азербайджанский тоже.',
        '',
        '## Выравниватели на вокале htdemucs',
        '',
        '| выравниватель | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 | CPU, с |',
        '|---|---:|---:|---:|---:|---:|---:|',
    ]
    for block in payload['aligners']:
        st = block['summary']['all']
        err = f" — {block['error']}" if block.get('error') else ''
        lines.append(f"| {block['aligner']}{err} | {st['n']} | {st['within_0_3']} | {st['within_0_7']} | "
                     f"{'—' if st['median'] is None else st['median']} | {'—' if st['p90'] is None else st['p90']} | {block['cpu_s']} |")
    lines += ['', '### По языкам', '', '| выравниватель | язык | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 |', '|---|---|---:|---:|---:|---:|---:|']
    for block in payload['aligners']:
        for lang in LANGS:
            st = block['summary']['by_lang'].get(lang)
            if not st:
                continue
            lines.append(f"| {block['aligner']} | {lang} | {st['n']} | {st['within_0_3']} | {st['within_0_7']} | "
                         f"{'—' if st['median'] is None else st['median']} | {'—' if st['p90'] is None else st['p90']} |")
    lines += ['', '### Что выбрано бы по доле строк в пределах 0,3 с', '']
    for lang, name in payload.get('choice', {}).items():
        lines.append(f'- {lang}: {name}')
    lines += ['', 'Правило выбора: больше доля ≤ 0,3 с, при равенстве меньше медиана, затем меньше 90-й перцентиль.',
              'Выравниватель, который в этом языке ничего не поставил, не выбирается.', '']
    lines += ['## Вокальный стем', '',
              f'Тот же замер на других стемах, на первых {int(STEM_SECONDS)} с микса (один и тот же отрывок для каждой модели).',
              'Полная песня на htdemucs_ft и Mel-RoFormer на CPU в лимит раннера не входит. Строка берётся, только если её окно целиком внутри отрывка.',
              'Плохой стем ломает любой выравниватель, поэтому здесь MMS и WhisperX, а не все пять.',
              '', '| стем | выравниватель | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 | отделение, с | выравнивание, с |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for block in payload.get('stems', []):
        st = block['summary']['all']
        err = f" — {block['error']}" if block.get('error') else ''
        lines.append(f"| {block['stem']}{err} | {block['aligner']} | {st['n']} | {st['within_0_3']} | {st['within_0_7']} | "
                     f"{'—' if st['median'] is None else st['median']} | {'—' if st['p90'] is None else st['p90']} | "
                     f"{block.get('separate_s', '—')} | {block['cpu_s']} |")
    lines += ['', '## Лицензии', '']
    for name, text in LICENSES.items():
        lines.append(f'- {name}: {text}')
    lines += ['', '## Что из литературы не запускалось', '']
    lines += [f'- {item}' for item in NOT_RUN]
    lines += ['', '## Худшие места', '']
    for block in payload['aligners']:
        if not block.get('worst'):
            continue
        bits = ', '.join(f"{r['slug']} {r['id']} {r['delta']} с" for r in block['worst'][:5])
        lines.append(f"- {block['aligner']}: {bits}")
    lines.append('')
    return '\n'.join(lines)


def write_out(payload: dict) -> None:
    dest = ROOT / 'docs' / 'analysis' / 'bench'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'align.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    (dest / 'align.md').write_text(render_md(payload), encoding='utf-8')
    print(f"→ {dest / 'align.md'}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('slugs', nargs='+')
    ap.add_argument('--aligners', default='mms-ctc-star,whisperx,stable-ts,huang-2025,nemo')
    ap.add_argument('--stems', default='', help='slugs for the stem comparison, comma-separated')
    args = ap.parse_args()
    os.environ.setdefault('OMP_NUM_THREADS', '4')
    os.environ.setdefault('MKL_NUM_THREADS', '4')
    songs = []
    for slug in args.slugs:
        audio = ensure_htdemucs(slug)
        song = load_song(slug)
        print(f"{slug}: {len(song['lines'])} строк с репликой, вокал {audio}", flush=True)
        songs.append((song, audio))
    payload: dict = {'slugs': args.slugs, 'standard': 'cues.json start', 'aligners': [], 'stems': [], 'not_run': NOT_RUN, 'licenses': LICENSES}
    for name in [p.strip() for p in args.aligners.split(',') if p.strip()]:
        payload['aligners'].append(_run_named(name, songs))
        payload['choice'] = recommend(payload['aligners'])
        write_out(payload)
    stem_slugs = [p.strip() for p in args.stems.split(',') if p.strip()]
    stem_models = [('htdemucs', 'htdemucs'), ('htdemucs_ft', 'htdemucs_ft'), ('mdx', 'UVR-MDX-NET-Voc_FT.onnx')]
    if stem_slugs:
        stem_models.append(('mel-roformer', _mel_filename()))
    by_slug = {song['slug']: song for song, _audio in songs}
    for slug in stem_slugs:
        full = by_slug.get(slug) or load_song(slug)
        song = dict(full)
        song['lines'] = [line for line in full['lines'] if line['win'][1] <= STEM_SECONDS]
        print(f"стем {slug}: {len(song['lines'])} строк в первых {int(STEM_SECONDS)} с", flush=True)
        mix = None
        for stem_name, filename in stem_models:
            t_sep = time.perf_counter()
            error = ''
            try:
                if mix is None:
                    mix = excerpt_mix(slug)
                audio = separate_to(slug, filename, work_dir(slug) / 'bench-stems' / stem_name, source=mix)
            except Exception as e:
                traceback.print_exc()
                error = f'{e.__class__.__name__}: {e}'
                audio = None
            separate_s = round(time.perf_counter() - t_sep, 1)
            for aligner_name, runner in (('mms-ctc-star', run_mms), ('whisperx', run_whisperx)):
                if audio is None:
                    payload['stems'].append(_block(aligner_name, [], 0.0, '', error) | {'stem': stem_name, 'separate_s': separate_s, 'file': filename})
                    continue
                t0 = time.perf_counter()
                try:
                    rows = _rows(song, runner(song, audio))
                    err = ''
                except Exception as e:
                    traceback.print_exc()
                    rows, err = [], f'{e.__class__.__name__}: {e}'
                block = _block(aligner_name, rows, time.perf_counter() - t0, f'стем {filename}', err)
                block['stem'] = stem_name
                block['file'] = filename
                block['separate_s'] = separate_s
                payload['stems'].append(block)
                write_out(payload)
    payload['choice'] = recommend(payload['aligners'])
    write_out(payload)
    print(render_md(payload), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
