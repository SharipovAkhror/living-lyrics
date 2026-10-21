"""Clip-only onset clarity for Kimberley Jensen's Mel-Band RoFormer.

The song is not separated. Twelve proved-word starts, the same sample as
stem_onset.py, are cut from the mix and scored with the published gate:
median attack at the word at least 5 % above htdemucs_ft, and the
word/shift ratio not worse. A miss does not move a lyric time. A hit is
recorded and still does not move the proof attack: that move needs a new
chance pass, which this stage does not apply.

Weights stay in the Hugging Face cache. The author's inference code is
cloned under work/ and is not committed. The licence field is read from
the model card on the day of the run. Anything other than MIT stops the
pass before the checkpoint is downloaded.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

from common import ROOT, find_source, work_dir

SONGS = ('i-have-come-alive', 'karitas', 'one')
CARD = 'KimberleyJSN/melbandroformer'
WEIGHT = 'MelBandRoformer.ckpt'
REPO = 'https://github.com/KimberleyJensen/Mel-Band-Roformer-Vocal-Model.git'
API = f'https://huggingface.co/api/models/{CARD}'
SR = 44100
# Leave the install and the report inside the 150 minute job.
DEFAULT_BUDGET_S = 100 * 60


def budget_s() -> float:
    raw = os.environ.get('ROFORMER_BUDGET_S', '')
    try:
        value = float(raw) if str(raw).strip() else DEFAULT_BUDGET_S
    except ValueError:
        value = DEFAULT_BUDGET_S
    return value if value > 0 else DEFAULT_BUDGET_S


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'living-lyrics-roformer'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode('utf-8'))


def read_license() -> dict:
    """The card field, not a search snippet. Download nothing until this passes."""
    data = _get(API)
    card = data.get('cardData') or {}
    license_name = str(card.get('license') or '').strip().lower()
    return {
        'repo': CARD,
        'file': WEIGHT,
        'license': license_name,
        'sha': data.get('sha'),
        'modified': data.get('lastModified'),
        'ok': license_name == 'mit',
    }


def _vendor() -> Path:
    dest = work_dir('.vendor') / 'Mel-Band-Roformer-Vocal-Model'
    if not (dest / 'utils.py').is_file():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ['git', 'clone', '--depth', '1', REPO, str(dest)],
            check=True,
        )
    return dest


def _sha(dest: Path) -> str | None:
    proc = subprocess.run(
        ['git', '-C', str(dest), 'rev-parse', 'HEAD'],
        check=False, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    return (proc.stdout or '').strip() or None


def _state_dict(torch, ckpt: str) -> tuple[dict, str]:
    """The author's file is a tensor dump. Prefer a weights-only load."""
    try:
        state = torch.load(ckpt, map_location='cpu', weights_only=True)
        how = 'weights_only'
    except Exception:
        state = torch.load(ckpt, map_location='cpu', weights_only=False)
        how = 'full_pickle'
    if isinstance(state, dict) and 'state_dict' in state and isinstance(state['state_dict'], dict):
        state = state['state_dict']
    if not isinstance(state, dict):
        raise RuntimeError('чекпоинт не словарь весов')
    return state, how


def _load_model(vendor: Path, device: str):
    import torch
    import yaml
    from ml_collections import ConfigDict

    sys.path.insert(0, str(vendor))
    from utils import get_model_from_config

    config_path = vendor / 'configs' / 'config_vocals_mel_band_roformer.yaml'
    with config_path.open(encoding='utf-8') as handle:
        config = ConfigDict(yaml.load(handle, Loader=yaml.FullLoader))
    target = config.training.get('target_instrument')
    if target != 'vocals':
        raise RuntimeError(f'конфиг целится не в vocals, а в {target!r}')
    # The flag selects the attention kernel. The checkpoint has no flash
    # weights of its own. flash=True calls the CUDA kernel even on CPU.
    flash_forced_off = False
    if device == 'cpu' and config.model.get('flash_attn'):
        config.model.flash_attn = False
        flash_forced_off = True
    model = get_model_from_config('mel_band_roformer', config)
    if model is None:
        raise RuntimeError('get_model_from_config вернул пусто')
    from huggingface_hub import hf_hub_download

    ckpt = hf_hub_download(CARD, WEIGHT)
    state, how = _state_dict(torch, ckpt)
    try:
        model.load_state_dict(state)
    except RuntimeError:
        stripped = {
            (key[7:] if key.startswith('module.') else key): value
            for key, value in state.items()
        }
        model.load_state_dict(stripped)
        how += '+strip-module'
    model.eval()
    model.to(device)
    return model, config, {
        'ckpt': ckpt,
        'load': how,
        'flash_forced_off': flash_forced_off,
        'target': target,
        'chunk_size': int(config.inference.chunk_size),
        'num_overlap': int(config.inference.num_overlap),
        'code_sha': _sha(vendor),
    }


def _fade(window_size: int, fade_size: int, device: str):
    import torch

    fadein = torch.linspace(0, 1, fade_size)
    fadeout = torch.linspace(1, 0, fade_size)
    window = torch.ones(window_size)
    window[-fade_size:] *= fadeout
    window[:fade_size] *= fadein
    return window.to(device)


def demix_vocals(config, model, mix, device: str) -> np.ndarray:
    """Vocals for one clip. Chunk and overlap are the author's inference config.

    CUDA autocast is omitted: this runner is CPU, and the author's context
    calls torch.cuda.amp. A shorter clip is padded inside one chunk and the
    pad is not returned.
    """
    import torch

    audio = torch.as_tensor(mix, dtype=torch.float32)
    if audio.ndim != 2:
        raise RuntimeError(f'ожидался стерео-отрезк, пришло {tuple(audio.shape)}')
    length0 = int(audio.shape[1])
    chunk = int(config.inference.chunk_size)
    overlap = max(1, int(config.inference.num_overlap))
    step = max(1, chunk // overlap)
    fade = max(1, chunk // 10)
    border = chunk - step
    padded = False
    if length0 > 2 * border and border > 0:
        audio = torch.nn.functional.pad(audio, (border, border), mode='reflect')
        padded = True
    windowing = _fade(chunk, fade, device)
    audio = audio.to(device)
    req = (1,) + tuple(audio.shape)
    result = torch.zeros(req, dtype=torch.float32, device=device)
    counter = torch.zeros(req, dtype=torch.float32, device=device)
    total = int(audio.shape[1])
    pos = 0
    while pos < total:
        part = audio[:, pos:pos + chunk]
        length = int(part.shape[-1])
        if length < chunk:
            pad = chunk - length
            mode = 'reflect' if length > chunk // 2 + 1 else 'constant'
            part = torch.nn.functional.pad(part, (0, pad), mode=mode, value=0)
        with torch.inference_mode():
            produced = model(part.unsqueeze(0))
        # num_stems == 1 returns (batch, channels, time). Match the unpadded
        # clip. A few inverse-STFT samples of difference are not a new vocal.
        if produced.ndim == 3:
            produced = produced[0]
        elif produced.ndim == 4:
            produced = produced[0, 0]
        got = int(produced.shape[-1])
        if got < length:
            produced = torch.nn.functional.pad(produced, (0, length - got))
        produced = produced[..., :length]
        window = windowing.clone()
        if pos == 0:
            window[:fade] = 1
        elif pos + chunk >= total:
            window[-fade:] = 1
        result[..., pos:pos + length] += produced[..., :length] * window[..., :length]
        counter[..., pos:pos + length] += window[..., :length]
        pos += step
    estimate = (result / counter.clamp_min(1e-8)).detach().cpu().numpy()
    np.nan_to_num(estimate, copy=False, nan=0.0)
    if padded:
        estimate = estimate[..., border:-border]
    vocal = np.asarray(estimate[0])
    if vocal.ndim == 2:
        vocal = vocal.mean(axis=0)
    return np.ascontiguousarray(vocal[:length0], dtype=np.float32)


def _mix(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
        check=True, capture_output=True,
    ).stdout
    data = np.frombuffer(raw, dtype=np.float32)
    if len(data) % 2:
        data = data[:-1]
    if len(data) < SR:
        raise RuntimeError('запись короче секунды')
    return np.ascontiguousarray(data.reshape(-1, 2).T)


def _decrypt(slug: str) -> Path:
    try:
        return find_source(slug)
    except SystemExit:
        pass
    import decrypt_audio

    decrypt_audio.main(slug)
    return find_source(slug)


def _lyrics(slug: str) -> dict:
    path = ROOT / 'content' / 'songs' / slug / 'lyrics.json'
    return json.loads(path.read_text(encoding='utf-8'))


def _prepare(slug: str) -> dict:
    import stem_onset as S

    source = _decrypt(slug)
    mix = _mix(source)
    duration = mix.shape[1] / float(SR)
    times = S.sample_times(_lyrics(slug))
    clips = S.group_clips(times, duration)
    return {'slug': slug, 'mix': mix, 'duration': duration, 'clips': clips, 'mono': mix.mean(axis=0)}


def _row(slug: str, status: str, **extra) -> dict:
    row = {'slug': slug, 'status': status, 'license': 'MIT'}
    row.update(extra)
    return row


def _score_roformer(model, config, device: str, song: dict,
                    first_vocal: np.ndarray | None = None) -> tuple[list[np.ndarray | None], float]:
    vocals: list[np.ndarray | None] = []
    elapsed = 0.0
    for index, (t0, t1, _times) in enumerate(song['clips']):
        if index == 0 and first_vocal is not None:
            vocals.append(first_vocal)
            continue
        a = max(0, int(t0 * SR))
        b = min(song['mix'].shape[1], int(t1 * SR))
        started = time.monotonic()
        vocal = demix_vocals(config, model, song['mix'][:, a:b], device)
        elapsed += time.monotonic() - started
        vocals.append(vocal)
    return vocals, elapsed


def _baseline(song: dict, budget: float) -> tuple[dict | None, dict]:
    import stem_onset as S

    spec = dict(S.CANDIDATES[0])
    spans = [(t0, t1) for t0, t1, _times in song['clips']]
    vocals, info = S.separate_spans(song['mono'], spans, rate=SR, budget_s=budget, spec=spec)
    at, off = S._score_cached(vocals, song['clips'], SR)
    return S._summary(at, off), info


def _roformer_summary(vocals, clips) -> dict | None:
    import stem_onset as S

    at, off = S._score_cached(vocals, clips, SR)
    return S._summary(at, off)


def _decide(base: dict | None, cand: dict | None) -> dict:
    import stem_onset as S

    rows = [
        {
            'name': 'htdemucs_ft', 'role': 'baseline', 'license': 'MIT',
            'model': 'htdemucs_ft', 'shifts': 1, 'overlap': 0.1, 'ensemble': False,
            'note': 'тот же отрезок, что уже измерен', 'summary': base,
        },
        {
            'name': 'melband-roformer', 'role': 'raised', 'license': 'MIT',
            'model': CARD, 'shifts': None, 'overlap': None, 'ensemble': False,
            'note': 'Kimberley Jensen, отрезок', 'summary': cand,
        },
    ]
    spec = S.choose(rows)
    return {
        'chosen': spec.get('name'),
        'reason': spec.get('reason'),
        'bar_passed': spec.get('name') == 'melband-roformer',
    }


def render_md(payload: dict) -> str:
    lines = [
        '# Mel-Band RoFormer, ясность атаки на отрезках',
        '',
        'Веса Kimberley Jensen, карточка `KimberleyJSN/melbandroformer`. '
        'Полная песня не считалась. Порог тот же, что в `stem-onset.md`: '
        'медиана у уже доказанного слова не меньше +5 % к `htdemucs_ft` на тех же отрезках, '
        'и отношение к сдвигам ±0,25 с и ±0,40 с не хуже. '
        'Пока порог не взят, время строк не меняется. '
        'Если порог взят, атака доказательства всё равно не переезжает в этом файле: '
        'для переезда нужен новый случайный проход.',
        '',
        f"Лицензия в день счёта: `{payload.get('license', {}).get('license') or '—'}` "
        f"(sha `{payload.get('license', {}).get('sha') or '—'}`). "
        f"Бюджет {payload.get('budget_s')} с. {payload.get('note') or ''}",
        '',
        '| песня | статус | клипов | секунды RoFormer | выбрано | почему |',
        '|---|---|---:|---:|---|---|',
    ]
    for row in payload.get('songs') or []:
        lines.append(
            f"| {row.get('slug')} | {row.get('status')} | {row.get('clips') if row.get('clips') is not None else '—'} | "
            f"{row.get('elapsed_s') if row.get('elapsed_s') is not None else '—'} | "
            f"{row.get('chosen') or '—'} | {row.get('reason') or row.get('error') or '—'} |"
        )
    lines += [
        '',
        '| песня | кандидат | слов | медиана у слова | медиана контроля | отношение |',
        '|---|---|---:|---:|---:|---:|',
    ]
    for row in payload.get('songs') or []:
        for name, summary in (
            ('htdemucs_ft', row.get('baseline')),
            ('melband-roformer', row.get('roformer')),
        ):
            if not summary:
                lines.append(f"| {row.get('slug')} | {name} | — | — | — | — |")
                continue
            lines.append(
                f"| {row.get('slug')} | {name} | {summary.get('n')} | {summary.get('med_at')} | "
                f"{summary.get('med_off')} | {summary.get('ratio')} |"
            )
    lines.append('')
    return '\n'.join(lines)


def _write(payload: dict) -> None:
    out = ROOT / 'docs' / 'analysis' / 'bench'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'roformer-onset.json').write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (out / 'roformer-onset.md').write_text(render_md(payload), encoding='utf-8')
    print(render_md(payload), flush=True)


def _abort(payload: dict, songs: list[dict], why: str, probe_s: float | None) -> None:
    rows = []
    for song in songs:
        rows.append(_row(
            song['slug'], 'не влезло', clips=len(song['clips']),
            reason=why, probe_s=None if probe_s is None else round(probe_s, 1),
        ))
    payload['songs'] = rows
    payload['note'] = why
    _write(payload)


_DONE = {
    'порог взят', 'порог не взят', 'не влезло', 'лицензия не MIT',
    'нет отрезков', 'мало слов в окне', 'база без оценки',
}


def _already() -> bool:
    """A finished report is the measurement. Do not spend the budget twice."""
    if os.environ.get('ROFORMER_FORCE') == '1':
        return False
    path = ROOT / 'docs' / 'analysis' / 'bench' / 'roformer-onset.json'
    if not path.is_file():
        return False
    try:
        old = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    rows = old.get('songs') or []
    have = {row.get('slug') for row in rows if row.get('status') in _DONE}
    return set(SONGS) <= have


def measure() -> int:
    if _already():
        print('отчёт roformer-onset уже записан, повтор не считался', flush=True)
        return 0
    started = time.monotonic()
    payload = {
        'budget_s': budget_s(),
        'card': CARD,
        'weight': WEIGHT,
        'songs': [],
        'moved_times': False,
        'license': {},
        'model': {},
        'note': '',
    }
    try:
        payload['license'] = read_license()
    except Exception as exc:
        payload['license'] = {'ok': False, 'error': f'{exc.__class__.__name__}: {exc}'}
        payload['note'] = 'поле лицензии не прочитано, веса не качались'
        payload['songs'] = [_row(slug, 'лицензия не прочитана') for slug in SONGS]
        _write(payload)
        return 0
    if not payload['license'].get('ok'):
        payload['note'] = 'поле license не mit, веса не качались'
        payload['songs'] = [_row(slug, 'лицензия не MIT', license=payload['license'].get('license')) for slug in SONGS]
        _write(payload)
        return 0
    try:
        songs = [_prepare(slug) for slug in SONGS]
    except Exception as exc:
        payload['note'] = f'запись не подготовлена ({exc.__class__.__name__}: {exc})'
        payload['songs'] = [_row(slug, 'ошибка', error=payload['note']) for slug in SONGS]
        _write(payload)
        return 0
    total_clips = sum(len(song['clips']) for song in songs)
    if total_clips < 8:
        payload['note'] = 'отрезков меньше протокола'
        payload['songs'] = [_row(song['slug'], 'нет отрезков', clips=len(song['clips'])) for song in songs]
        _write(payload)
        return 0
    try:
        import torch

        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(4)
        vendor = _vendor()
        model, config, info = _load_model(vendor, device)
        payload['model'] = info
        payload['model']['device'] = device
    except Exception as exc:
        payload['note'] = f'модель не загрузилась ({exc.__class__.__name__}: {exc})'
        payload['songs'] = [_row(song['slug'], 'модель не загрузилась', error=payload['note'], clips=len(song['clips'])) for song in songs]
        _write(payload)
        return 0

    probe_song = next(song for song in songs if song['clips'])
    t0, t1, _times = probe_song['clips'][0]
    a = max(0, int(t0 * SR))
    b = min(probe_song['mix'].shape[1], int(t1 * SR))
    probe_started = time.monotonic()
    try:
        probe_vocal = demix_vocals(config, model, probe_song['mix'][:, a:b], device)
    except Exception as exc:
        payload['note'] = f'пробный отрезок не посчитан ({exc.__class__.__name__}: {exc})'
        payload['songs'] = [_row(song['slug'], 'ошибка отрезка', error=payload['note']) for song in songs]
        _write(payload)
        return 0
    probe_s = time.monotonic() - probe_started
    import stem_onset as S

    audio_s = sum(max(0.0, t1 - t0) for song in songs for t0, t1, _times in song['clips'])
    # The probe clip is already done. The estimate is the work still ahead.
    estimate = probe_s * max(total_clips - 1, 0) * 1.15 + audio_s * S.rtf_of(S.CANDIDATES[0])
    payload['probe_s'] = round(probe_s, 1)
    payload['estimate_s'] = round(estimate, 1)
    remaining = budget_s() - (time.monotonic() - started)
    if estimate > remaining:
        why = (
            f'оценка {estimate:.0f} с на {total_clips} отрезков не входит в остаток {remaining:.0f} с. '
            f'Один отрезок занял {probe_s:.0f} с. Полная песня не считалась.'
        )
        _abort(payload, songs, why, probe_s)
        return 0

    rows = []
    for song in songs:
        remaining = budget_s() - (time.monotonic() - started)
        clip_s = sum(max(0.0, t1 - t0) for t0, t1, _times in song['clips'])
        ahead = len(song['clips']) - (1 if song is probe_song else 0)
        song_estimate = probe_s * ahead * 1.15 + clip_s * S.rtf_of(S.CANDIDATES[0])
        if song_estimate > remaining:
            rows.append(_row(
                song['slug'], 'не влезло', clips=len(song['clips']),
                reason=f'оценка {song_estimate:.0f} с, остаток {remaining:.0f} с',
            ))
            continue
        try:
            reuse = probe_vocal if song is probe_song else None
            vocals, elapsed = _score_roformer(model, config, device, song, first_vocal=reuse)
            if song is probe_song:
                elapsed += probe_s
            cand = _roformer_summary(vocals, song['clips'])
            left = budget_s() - (time.monotonic() - started)
            base, base_info = _baseline(song, left)
            decision = _decide(base, cand)
            error = None
            status = 'порог взят' if decision['bar_passed'] else 'порог не взят'
            if cand is None:
                status = 'мало слов в окне'
                error = 'сводка RoFormer пустая'
            if base is None:
                status = 'база без оценки'
                error = base_info.get('error') or 'сводка htdemucs_ft пустая'
                decision = {'chosen': 'htdemucs_ft', 'reason': error, 'bar_passed': False}
            rows.append(_row(
                song['slug'], status, clips=len(song['clips']), elapsed_s=round(elapsed, 1),
                baseline=base, roformer=cand, chosen=decision['chosen'],
                reason=decision['reason'], error=error, bar_passed=decision['bar_passed'],
            ))
        except Exception as exc:
            rows.append(_row(
                song['slug'], 'ошибка', clips=len(song['clips']),
                error=f'{exc.__class__.__name__}: {exc}',
            ))
    payload['songs'] = rows
    payload['bar_passed'] = any(row.get('bar_passed') for row in rows)
    payload['moved_times'] = False
    if payload['bar_passed']:
        payload['note'] = 'порог взят хотя бы на одной песне. Время строк не менялось: нужен новый случайный проход.'
    else:
        payload['note'] = 'порог +5 % не взят. Время строк не менялось.'
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
            'budget_s': budget_s(), 'songs': [_row(slug, 'ошибка', error=str(exc)) for slug in SONGS],
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
