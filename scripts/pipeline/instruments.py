"""Who is playing, and when. Works for any recording, not for one catalogue of songs.

    python3 instruments.py <slug>
    python3 instruments.py --self-test

Reads the mix and the four htdemucs stems (drums, bass, other, vocals) and the section
times in content/songs/<slug>/lyrics.json. Writes a proposal, not lyrics.json:

    docs/analysis/<slug>-instruments.json
    docs/analysis/<slug>-instruments.md

The voice map already occupies docs/analysis/<slug>.md, so these files cannot live in a
directory of the same name.

Tagger: LAION CLAP `laion/clap-htsat-unfused` (Apache-2.0 on the model card) through
transformers. The music checkpoint `laion/larger_clap_music` is not used: its text
projection is near zero, so every prompt lands on one vector (pairwise cosine 0.9997
on a real mix) and the argmax is noise. Each catalogue key in src/instruments/list.ts
except `ensemble` has an English prompt. A second, general list (timpani, tabla, sitar, …)
is reported when it wins and is never written as a catalogue key. PANNs weights are not
loaded: the code repository has no LICENSE file and the Zenodo record only says Open.

Windows are 1–3 s. The open timeline (every prompt, for the markdown report) is active
only when its cosine is the closest, ahead of silence and ahead of the runner-up, for at
least two windows in a row. Softmax is reported but not used as a gate: with many prompts
it sits near 1/N.

Lyrics data is a second, closed pass over the same cosines: only instruments named in this
recording's credits (song.json roles, plus the heading «Закрытый набор этой записи» in
sources.md). A timed entrance needs a recording-relative cosine gap, three neighbouring
windows, and the credited key to be the closest prompt on that stem. The script still does
not edit lyrics.json.
"""
from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass

import numpy as np

from common import ROOT, load_audio, load_json, song_dir, work_dir
from features import FEATURE_RATE, perceptual_01

# Unfused HTS-AT + RoBERTa. The music checkpoint's published text projection does not
# separate prompts (see the module docstring), so it cannot time an entrance.
CLAP_ID = 'laion/clap-htsat-unfused'
CLAP_CARD = 'https://huggingface.co/laion/clap-htsat-unfused'
CLAP_SR = 48000
# A live text tower does not map every prompt onto one vector. Above this median
# pairwise cosine the checkpoint is dead and the report must not be written.
TEXT_COLLAPSE = 0.98
BACKGROUND = 'silence, room tone, or no distinct musical instrument'

# Window length is the task's 1–3 s. Hop may be shorter so entrances are not stuck to a grid.
WINDOW_S = float(os.environ.get('CLAP_WINDOW', '2.5'))
HOP_S = float(os.environ.get('CLAP_HOP', '2.0'))
DRUM_HOP_S = float(os.environ.get('CLAP_DRUM_HOP', '1.5'))
MIX_HOP_S = float(os.environ.get('CLAP_MIX_HOP', '3.0'))
ENERGY_FLOOR = 0.15
# Above this vocal-stem level the mix is the singer, so melodic labels on the mix are ignored.
VOCAL_MASK = 0.35
# Softmax over dozens of prompts is almost uniform when cosines differ by ~0.01, so the
# gate is the cosine itself: the winner must beat silence and the runner-up, and it must
# hold for two windows. These are method constants, not per-song knobs.
COSINE_EPS = 1e-4
MIN_WINDOWS = 2
BRIDGE_S = 2.0
BRIDGE_DRUM_S = 1.0
MIN_REGION_S = 1.5
MIN_DRUM_REGION_S = 1.0
# Closed-set gate for the data proposal. Method-wide: the same numbers on every recording.
# The recording can only raise the floor (its 75th-percentile gap). If even the 90th
# percentile stays under the floor, these prompts do not separate and no time is emitted.
CLOSED_MARGIN_FLOOR = 0.04
CLOSED_AGREE = 3
CLOSED_GAP_PERCENTILE = 75.0
CLOSED_SEPARATION_PERCENTILE = 90.0
CLOSED_HEADING = '## Закрытый набор этой записи'
# A credit that names drums without naming the drum. Not a darbuka, bendir or daf.
GENERIC_PERCUSSION = ('ударные', 'оркестровая перкуссия', 'перкуссия', 'percussion')
GROUP_ROLES = ('ансамбль', 'оркестр', 'orchestra', 'ensemble')
# Credit phrasing that is not the catalogue's display name.
ROLE_ALIASES = {
    'классическая гитара': 'guitar',
    'гитара': 'guitar',
}
# Singers stay in `voice`. They are not instrumental entrances.
NOT_INSTRUMENTS = ('voice', 'choir')
_ROLE_SPLIT = re.compile(r'[,;/+]|\s+и\s+', re.IGNORECASE)

# English prompts state the organological facts already in src/instruments/list.ts.
# `ensemble` is a drawing of several instruments, not a timbre, so it has no prompt.
CATALOG_PROMPTS = {
    'oud': 'the sound of an oud, a fretless pear-shaped lute plucked with a plectrum',
    'qanun': 'the sound of a qanun, a trapezoidal zither whose courses of strings are plucked with finger plectrums',
    'ney': 'the sound of a ney, an end-blown reed flute with a breathy tone',
    'daf': 'the sound of a daf, a large frame drum with metal rings jingling inside the frame',
    'bendir': 'the sound of a bendir, a frame drum with a buzzing snare and no metal jingles',
    'riq': 'the sound of a riq, a small tambourine with pairs of brass cymbals set in the frame',
    'darbuka': 'the sound of a darbuka, a goblet drum with a deep dum stroke and a sharp tek',
    'tombak': 'the sound of a tombak, an Iranian goblet drum played with the fingers',
    'santur': 'the sound of a santur, a trapezoidal hammered dulcimer struck with light mallets',
    'tanbur': 'the sound of a tanbur, a long-necked lute with a small body, plucked with the fingers',
    'baglama': 'the sound of a baglama, a Turkish long-necked lute with tied frets',
    'tar': 'the sound of a tar, a double-bowled lute with a skin face, plucked with a plectrum',
    'guitar': 'the sound of a nylon-string guitar, classical or flamenco, plucked with the fingers',
    'harp': 'the sound of a concert harp, many open strings plucked with the fingers',
    'kamancheh': 'the sound of a kamancheh, a spiked fiddle with a round body played with a bow',
    'erhu': 'the sound of an erhu, a two-string Chinese fiddle played with a bow',
    'violin': 'the sound of a violin played with a bow',
    'cello': 'the sound of a cello played with a bow',
    'double-bass': 'the sound of a double bass, the lowest bowed string instrument, bowed or plucked',
    'zurna': 'the sound of a zurna, a loud conical double-reed shawm',
    'duduk': 'the sound of a duduk, a soft cylindrical double-reed woodwind',
    'piano': 'the sound of a piano, hammers striking strings',
    'choir': 'the sound of a choir, several singers on each part',
    'voice': 'the sound of one person singing',
}

# Not in the drawing catalogue. Reported so a missing instrument can be named; never a lyrics key.
EXTRA_PROMPTS = {
    'timpani': 'the sound of orchestral timpani, large tuned kettle drums',
    'snare-drum': 'the sound of a snare drum with a rattling snare',
    'bass-drum': 'the sound of a large concert bass drum',
    'cymbals': 'the sound of orchestral cymbals',
    'tabla': 'the sound of tabla, a pair of small Indian hand drums',
    'dholak': 'the sound of a dholak, a two-headed barrel drum played with the hands',
    'tambourine': 'the sound of a small tambourine with jingles',
    'frame-drum': 'the sound of a plain frame drum with no rings and no snare',
    'sitar': 'the sound of a sitar, a long-necked lute with sympathetic strings buzzing',
    'balaban': 'the sound of a balaban, a soft cylindrical double-reed woodwind',
    'rabab': 'the sound of a rabab, a skin-faced lute played with a bow',
    'viola': 'the sound of a viola played with a bow',
    'western-flute': 'the sound of a silver concert flute, side-blown, not a reed flute',
    'clarinet': 'the sound of a clarinet',
    'saxophone': 'the sound of a saxophone',
    'trumpet': 'the sound of a trumpet',
    'accordion': 'the sound of an accordion',
    'organ': 'the sound of an organ',
    'synthesizer': 'the sound of a synthesizer',
    'string-section': 'the sound of an orchestral string section playing together',
    'electric-bass': 'the sound of an electric bass guitar',
}
EXTRA_NAMES = {
    'timpani': 'литавры', 'snare-drum': 'малый барабан', 'bass-drum': 'большой барабан',
    'cymbals': 'тарелки', 'tabla': 'табла', 'dholak': 'дхолак', 'tambourine': 'тамбурин',
    'frame-drum': 'рамочный барабан', 'sitar': 'ситар', 'balaban': 'балабан', 'rabab': 'рабаб',
    'viola': 'альт', 'western-flute': 'поперечная флейта', 'clarinet': 'кларнет',
    'saxophone': 'саксофон', 'trumpet': 'труба', 'accordion': 'аккордеон', 'organ': 'орган',
    'synthesizer': 'синтезатор', 'string-section': 'группа смычковых', 'electric-bass': 'бас-гитара',
}
EXTRA_PERCUSSION = {
    'timpani', 'snare-drum', 'bass-drum', 'cymbals', 'tabla', 'dholak', 'tambourine', 'frame-drum',
}
# Low instruments Demucs may put in the bass stem or leave in "other".
BASS_KEYS = {'double-bass', 'cello', 'electric-bass'}

MODELS = {
    'tagger': CLAP_ID,
    'tagger_license': 'Apache-2.0',
    'tagger_card': CLAP_CARD,
    'tagger_note': 'HTS-AT unfused, LAION-Audio-630K. laion/larger_clap_music was not loaded: '
                   'its text projection is near zero and every prompt collapses to one vector. '
                   'PANNs weights were not loaded: the code repository has no LICENSE file and the Zenodo record only says Open.',
    'stems': 'htdemucs',
    'stems_license': 'MIT',
    'envelopes': 'librosa',
    'envelopes_license': 'ISC',
}


@dataclass
class Region:
    start: float
    end: float
    confidence: float
    similarity: float
    margin: float
    stem: str

    def copy(self) -> 'Region':
        return Region(self.start, self.end, self.confidence, self.similarity, self.margin, self.stem)


def _window_bounds() -> None:
    if not 1.0 <= WINDOW_S <= 3.0:
        raise SystemExit(f'CLAP_WINDOW={WINDOW_S}: окно должно быть от 1 до 3 с')
    for name, hop in (('CLAP_HOP', HOP_S), ('CLAP_DRUM_HOP', DRUM_HOP_S), ('CLAP_MIX_HOP', MIX_HOP_S)):
        if not 0.5 <= hop <= 3.0:
            raise SystemExit(f'{name}={hop}: шаг должен быть от 0.5 до 3 с')


def load_catalog(path=None) -> list[tuple[str, str, str]]:
    path = path or (ROOT / 'src' / 'instruments' / 'list.ts')
    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        match = re.search(r"key: '([^']+)', name: '([^']*)'.*family: '([^']+)'", line)
        if match:
            rows.append((match.group(1), match.group(2), match.group(3)))
    if len(rows) < 10:
        raise SystemExit(f'не разобрал каталог инструментов: {path}')
    return rows


def check_prompts(rows: list[tuple[str, str, str]]) -> None:
    keys = {key for key, _, _ in rows}
    wanted = keys - {'ensemble'}
    missing = sorted(wanted - set(CATALOG_PROMPTS))
    extra = sorted(set(CATALOG_PROMPTS) - keys)
    if missing or extra:
        raise SystemExit(f'подсказки CLAP разъехались с каталогом: нет {missing or "-"}, лишние {extra or "-"}')
    overlap = set(EXTRA_PROMPTS) & keys
    if overlap:
        raise SystemExit(f'дополнительные метки совпали с каталогом: {sorted(overlap)}')


def candidate_keys(stem: str, rows: list[tuple[str, str, str]]) -> list[str]:
    families = {key: family for key, _, family in rows}
    catalog = [key for key, _, _ in rows]
    if stem == 'drums':
        keys = [key for key in catalog if families[key] == 'ударные']
        keys += [key for key in EXTRA_PROMPTS if key in EXTRA_PERCUSSION]
    elif stem == 'bass':
        keys = [key for key in ('double-bass', 'cello', 'piano') if key in families]
        keys += [key for key in EXTRA_PROMPTS if key in BASS_KEYS]
    elif stem == 'other':
        keys = [key for key in catalog if key != 'ensemble' and families[key] != 'ударные']
        keys += [key for key in EXTRA_PROMPTS if key not in EXTRA_PERCUSSION]
    elif stem == 'mix':
        keys = [key for key in catalog if key != 'ensemble']
        keys += list(EXTRA_PROMPTS)
    else:
        raise SystemExit(f'неизвестный стем {stem}')
    return keys


def homes(key: str, family: str) -> tuple[str, ...]:
    if family == 'ударные' or key in EXTRA_PERCUSSION:
        return ('drums',)
    if key in BASS_KEYS:
        return ('bass', 'other')
    if key == 'piano':
        return ('other', 'bass')
    if key in ('voice', 'choir'):
        return ('mix', 'other')
    return ('other', 'mix')


def prompt_of(key: str) -> str:
    if key in CATALOG_PROMPTS:
        return CATALOG_PROMPTS[key]
    if key in EXTRA_PROMPTS:
        return EXTRA_PROMPTS[key]
    raise SystemExit(f'нет подсказки для {key}')


def block_rms(samples: np.ndarray, sr: int, rate: int = FEATURE_RATE) -> np.ndarray:
    hop = max(1, sr // rate)
    n = len(samples) // hop
    if n <= 0:
        return np.zeros(1)
    frame = samples[:n * hop].reshape(n, hop).astype(np.float64)
    return np.sqrt((frame * frame).mean(axis=1) + 1e-12)


def env_at(env: np.ndarray, t: float, rate: int = FEATURE_RATE) -> float:
    if len(env) == 0:
        return 0.0
    i = int(np.clip(np.floor(t * rate), 0, len(env) - 1))
    return float(env[i])


def smooth(values: np.ndarray, width: int = 3) -> np.ndarray:
    if width <= 1 or len(values) == 0:
        return np.asarray(values, dtype=np.float64)
    kernel = np.ones(width) / width
    return np.convolve(np.asarray(values, dtype=np.float64), kernel, mode='same')


def centers_of(duration: float, hop: float) -> np.ndarray:
    if duration <= 0.05:
        return np.zeros(0)
    return np.arange(hop / 2.0, max(hop / 2.0, duration - 0.05) + 1e-6, hop)


def slice_window(samples: np.ndarray, sr: int, center: float, win_s: float, duration: float) -> np.ndarray | None:
    half = win_s / 2.0
    a = max(0.0, center - half)
    b = min(duration, center + half)
    if b - a < 1.0:
        return None
    clip = np.ascontiguousarray(samples[int(a * sr):int(b * sr)], dtype=np.float32)
    return clip if len(clip) else None


def _as_tensor(out):
    import torch

    if isinstance(out, torch.Tensor):
        return out
    for attr in ('pooler_output', 'text_embeds', 'audio_embeds', 'embeddings'):
        value = getattr(out, attr, None)
        if isinstance(value, torch.Tensor):
            return value
    raise RuntimeError(f'неожиданный выход CLAP: {type(out)}')


class Tagger:
    """CLAP text/audio cosine scores. The model is loaded once per recording."""

    def __init__(self) -> None:
        import torch
        from transformers import ClapModel, ClapProcessor

        torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '4')))
        self.torch = torch
        self.device = 'cpu'
        print(f'CLAP: {CLAP_ID}', flush=True)
        self.processor = ClapProcessor.from_pretrained(CLAP_ID)
        loaded = ClapModel.from_pretrained(CLAP_ID, output_loading_info=True)
        info = {}
        if isinstance(loaded, tuple):
            self.model, info = loaded
        else:
            self.model = loaded
        self.model = self.model.to(self.device).eval()
        missing = list(info.get('missing_keys', []))
        unexpected = list(info.get('unexpected_keys', []))
        print(f'CLAP weights missing {len(missing)} unexpected {len(unexpected)}', flush=True)
        if missing:
            print('  missing: ' + ', '.join(missing[:8]), flush=True)
        if unexpected:
            print('  unexpected: ' + ', '.join(unexpected[:8]), flush=True)
        proj = getattr(self.model, 'text_projection', None)
        for name in ('linear1', 'linear2'):
            layer = getattr(proj, name, None)
            weight = getattr(layer, 'weight', None)
            if weight is None:
                continue
            print(f'CLAP text projection {name} std {float(weight.detach().std()):.4f}', flush=True)
        self.text_pairs: dict | None = None
        # transformers 4.57 names the temperature logit_scale_a (audio→text). Older builds used logit_scale.
        scale = getattr(self.model, 'logit_scale_a', None)
        if scale is None:
            scale = getattr(self.model, 'logit_scale', None)
        if scale is None:
            raise RuntimeError('CLAP: у модели нет logit_scale_a')
        self.scale = float(scale.detach().exp().clamp(max=100).item())
        self._text: dict[tuple[str, ...], np.ndarray] = {}

    def _tensors(self, inputs, names: tuple[str, ...]) -> dict:
        """Move processor outputs onto the device. is_longer is a list of bools in some builds."""
        out = {}
        for name in names:
            if name not in inputs:
                continue
            value = inputs[name]
            if hasattr(value, 'to'):
                out[name] = value.to(self.device)
            else:
                out[name] = self.torch.as_tensor(value, device=self.device)
        return out

    def text(self, prompts: list[str]) -> np.ndarray:
        key = tuple(prompts)
        cached = self._text.get(key)
        if cached is not None:
            return cached
        inputs = self.processor(text=prompts, return_tensors='pt', padding=True)
        payload = self._tensors(inputs, ('input_ids', 'attention_mask'))
        with self.torch.inference_mode():
            emb = _as_tensor(self.model.get_text_features(**payload))
        emb = self.torch.nn.functional.normalize(emb, dim=-1).cpu().numpy()
        self._text[key] = emb
        if len(emb) > 1:
            pair = emb @ emb.T
            off = pair[~np.eye(len(emb), dtype=bool)]
            stats = {
                'median': round(float(np.median(off)), 4),
                'min': round(float(off.min()), 4),
                'max': round(float(off.max()), 4),
                'n': int(len(emb)),
            }
            self.text_pairs = stats
            print(f'  текст: попарный косинус медиана {stats["median"]:.4f} '
                  f'мин {stats["min"]:.4f} макс {stats["max"]:.4f}', flush=True)
            # A collapsed text tower makes every window pick the same label by noise.
            # Refuse the report rather than publish that label as an entrance.
            if stats['median'] >= TEXT_COLLAPSE:
                raise SystemExit(
                    f'CLAP: текстовые эмбеддинги совпали (попарный косинус медиана {stats["median"]}). '
                    f'Чекпойнт {CLAP_ID} не разделяет подсказки, отчёт инструментов не пишется.'
                )
        return emb

    def score(self, clips: list[np.ndarray], prompts: list[str]) -> tuple[np.ndarray, np.ndarray]:
        """Softmax probabilities and cosine similarities, shape (windows, prompts)."""
        if not clips:
            n = len(prompts)
            return np.zeros((0, n)), np.zeros((0, n))
        text = self.text(prompts)
        batch = max(1, int(os.environ.get('CLAP_BATCH', '4')))
        sims = []
        for start in range(0, len(clips), batch):
            piece = clips[start:start + batch]
            try:
                inputs = self.processor(audio=piece, sampling_rate=CLAP_SR, return_tensors='pt', padding=True)
            except TypeError:
                inputs = self.processor(audios=piece, sampling_rate=CLAP_SR, return_tensors='pt', padding=True)
            allowed = self._tensors(inputs, ('input_features', 'is_longer'))
            with self.torch.inference_mode():
                try:
                    emb = _as_tensor(self.model.get_audio_features(**allowed))
                except TypeError:
                    # Some transformers builds do not take is_longer on get_audio_features.
                    emb = _as_tensor(self.model.get_audio_features(input_features=allowed['input_features']))
            emb = self.torch.nn.functional.normalize(emb, dim=-1).cpu().numpy()
            sims.append(emb @ text.T)
            print(f'  окна {start + len(piece)}/{len(clips)}', flush=True)
        sim = np.concatenate(sims, axis=0)
        shifted = self.scale * sim
        shifted -= shifted.max(axis=1, keepdims=True)
        prob = np.exp(shifted)
        prob /= np.maximum(prob.sum(axis=1, keepdims=True), 1e-12)
        return prob, sim


def activation(probs: np.ndarray, sims: np.ndarray, column: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Boolean mask, smoothed probability and smoothed margin for one prompt column.

    The background prompt is the last column. A label is on only when it is the closest
    prompt, ahead of silence and ahead of the runner-up. Probability is kept for the
    report; with many prompts it sits near 1/N even when the cosine has a winner.
    """
    bg = probs.shape[1] - 1
    prob = smooth(probs[:, column])
    margin = smooth(sims[:, column] - sims[:, bg])
    others = np.delete(sims, bg, axis=1)
    rank = column if column < bg else column - 1
    if others.shape[1] <= 1:
        best = np.ones(len(sims), dtype=bool)
        ahead = np.ones(len(sims), dtype=bool)
    else:
        order = np.argsort(others, axis=1)
        best = order[:, -1] == rank
        runner_up = others[np.arange(len(others)), order[:, -2]]
        ahead = others[:, rank] >= runner_up + COSINE_EPS
    return best & ahead & (margin >= COSINE_EPS), prob, margin


def regions_from_mask(times: np.ndarray, mask: np.ndarray, hop: float, prob: np.ndarray,
                      margin: np.ndarray, sim: np.ndarray, stem: str, min_len: float, bridge: float,
                      min_windows: int = MIN_WINDOWS) -> list[Region]:
    idx = np.flatnonzero(mask)
    if len(idx) == 0:
        return []
    groups = [[int(idx[0])]]
    for i in idx[1:]:
        i = int(i)
        gap = float(times[i] - times[groups[-1][-1]] - hop)
        if gap <= bridge:
            groups[-1].append(i)
        else:
            groups.append([i])
    out = []
    for group in groups:
        t0 = float(times[group[0]] - hop / 2.0)
        t1 = float(times[group[-1]] + hop / 2.0)
        # One window is a coin flip when cosines are close. Two agreeing windows are a region.
        if len(group) < min_windows or t1 - t0 < min_len:
            continue
        out.append(Region(
            start=max(0.0, t0), end=t1,
            confidence=float(np.mean(prob[group])),
            similarity=float(np.mean(sim[group])),
            margin=float(np.mean(margin[group])),
            stem=stem,
        ))
    return out


def merge_regions(regions: list[Region], bridge: float) -> list[Region]:
    if not regions:
        return []
    ordered = sorted(regions, key=lambda r: (r.start, r.end))
    out = [ordered[0].copy()]
    for region in ordered[1:]:
        prev = out[-1]
        if region.start <= prev.end + bridge:
            prev.end = max(prev.end, region.end)
            if region.confidence > prev.confidence:
                prev.confidence = region.confidence
                prev.similarity = region.similarity
                prev.margin = region.margin
                if region.stem not in prev.stem.split('+'):
                    prev.stem = f'{region.stem}+{prev.stem}'
            elif region.stem not in prev.stem.split('+'):
                prev.stem = f'{prev.stem}+{region.stem}'
        else:
            out.append(region.copy())
    return out


def clip_entry(region: Region, start: float, end: float) -> dict | None:
    """The part of a region that falls inside a section, or None when the overlap is trivial."""
    overlap = min(region.end, end) - max(region.start, start)
    span = max(1e-6, end - start)
    need = min(0.8, max(0.4, 0.25 * span))
    if overlap < need:
        return None
    at = start if region.start < start - 0.05 else max(region.start, start)
    until = min(region.end, end)
    at = round(float(at), 2)
    until = round(float(until), 2)
    if at < start:
        at = start
    if until > end:
        until = end
    if at >= end or until <= at:
        return None
    return {
        'at': at,
        'until': until,
        'holds_to_section_end': until >= end - 0.3,
        'confidence': round(region.confidence, 3),
        'similarity': round(region.similarity, 3),
        'margin': round(region.margin, 3),
        'stem': region.stem,
    }


def density_word(per_s: float) -> str:
    if per_s < 0.15:
        return 'почти нет ударов'
    if per_s < 0.8:
        return 'редко'
    if per_s < 2.2:
        return 'умеренно'
    if per_s < 4.5:
        return 'плотно'
    return 'очень плотно'


def beat_regular(onsets: np.ndarray) -> bool | None:
    if len(onsets) < 6:
        return None
    gaps = np.diff(onsets)
    med = float(np.median(gaps))
    if med <= 1e-3:
        return None
    mad = float(np.median(np.abs(gaps - med)))
    return bool(mad / med < 0.25)


def diagnose(probs: np.ndarray, sims: np.ndarray, scored: np.ndarray) -> dict:
    if len(probs) == 0 or not np.any(scored):
        return {'windows': int(len(probs)), 'scored': int(np.count_nonzero(scored))}
    labels = probs[scored][:, :-1]
    sim = sims[scored][:, :-1]
    bg = sims[scored][:, -1]
    if labels.shape[1] == 0:
        return {'windows': int(len(probs)), 'scored': int(np.count_nonzero(scored))}
    top_i = labels.argmax(axis=1)
    rows = np.arange(len(labels))
    margin = sim[rows, top_i] - bg
    top = labels.max(axis=1)
    part = np.partition(sim, -2, axis=1) if sim.shape[1] > 1 else np.repeat(sim, 2, axis=1)
    gap = part[:, -1] - part[:, -2]

    def pct(values, q):
        return round(float(np.percentile(values, q)), 4)

    return {
        'windows': int(len(probs)),
        'scored': int(np.count_nonzero(scored)),
        'margin_p50': pct(margin, 50),
        'margin_p90': pct(margin, 90),
        'margin_max': round(float(np.max(margin)), 4),
        'gap_p50': pct(gap, 50),
        'gap_p90': pct(gap, 90),
        'sim_std': round(float(np.std(sim)), 4),
        'top_prob_p50': pct(top, 50),
        'top_prob_p90': pct(top, 90),
    }


def _fit(samples: np.ndarray, n: int) -> np.ndarray:
    if len(samples) == n:
        return samples
    if len(samples) > n:
        return samples[:n]
    return np.pad(samples, (0, n - len(samples)))


def score_stem(tagger: Tagger, samples: np.ndarray, sr: int, duration: float, env: np.ndarray,
               keys: list[str], hop: float, vocal_env: np.ndarray | None, stem: str) -> dict:
    grid = centers_of(duration, hop)
    prompts = [prompt_of(key) for key in keys] + [BACKGROUND]
    clips = []
    scored_i = []
    for i, t in enumerate(grid):
        if env_at(env, float(t)) < ENERGY_FLOOR:
            continue
        clip = slice_window(samples, sr, float(t), WINDOW_S, duration)
        if clip is None:
            continue
        clips.append(clip)
        scored_i.append(i)
    print(f'{stem}: окон {len(grid)}, громких {len(clips)}, подсказок {len(prompts) - 1}', flush=True)
    probs = np.zeros((len(grid), len(prompts)))
    sims = np.zeros((len(grid), len(prompts)))
    if clips:
        got_p, got_s = tagger.score(clips, prompts)
        print(f'  косинусы {stem}: std {float(got_s.std()):.4f} '
              f'min {float(got_s.min()):.4f} max {float(got_s.max()):.4f}', flush=True)
        show = int(np.argmax(got_s[:, :-1].max(axis=1) - got_s[:, -1]))
        order = np.argsort(got_s[show, :-1])[::-1][:5]
        named = ', '.join(f'{keys[int(col)]} {got_s[show, int(col)]:.4f}' for col in order)
        print(f'  окно с наибольшим отрывом, тишина {got_s[show, -1]:.4f}: {named}', flush=True)
        for row, i in enumerate(scored_i):
            probs[i] = got_p[row]
            sims[i] = got_s[row]
    scored = np.zeros(len(grid), dtype=bool)
    scored[scored_i] = True
    # Diagnose the model before the vocal mask, so a singer does not look like "no preference".
    diag = diagnose(probs, sims, scored)
    if vocal_env is not None:
        # The mix under a loud singer answers "voice". Drop other labels there.
        drop = np.array([env_at(vocal_env, float(t)) > VOCAL_MASK for t in grid])
        keep = {i for i, key in enumerate(keys) if key in ('voice', 'choir')}
        for col in range(len(keys)):
            if col not in keep:
                probs[drop, col] = 0.0
                sims[drop, col] = sims[drop, -1] - 1.0
    return {'times': grid, 'hop': hop, 'keys': keys, 'probs': probs, 'sims': sims, 'scored': scored,
            'diag': diag}


def collect_regions(scored: dict[str, dict], rows: list[tuple[str, str, str]]) -> dict[str, list[Region]]:
    families = {key: family for key, _, family in rows}
    found: dict[str, list[Region]] = {}
    taggable = [key for key, _, _ in rows if key != 'ensemble'] + list(EXTRA_PROMPTS)
    for key in taggable:
        family = families.get(key, '')
        parts: list[Region] = []
        percussive = family == 'ударные' or key in EXTRA_PERCUSSION
        for stem in homes(key, family):
            pack = scored[stem]
            if key not in pack['keys']:
                raise SystemExit(f'{key} запрошен со стема {stem}, а в его подсказках его нет')
            col = pack['keys'].index(key)
            mask, prob, margin = activation(pack['probs'], pack['sims'], col)
            sim = pack['sims'][:, col]
            parts += regions_from_mask(
                pack['times'], mask, pack['hop'], prob, margin, sim, stem,
                MIN_DRUM_REGION_S if percussive else MIN_REGION_S,
                BRIDGE_DRUM_S if percussive else BRIDGE_S,
            )
        merged = merge_regions(parts, BRIDGE_DRUM_S if percussive else BRIDGE_S)
        if merged:
            found[key] = merged
    return found


def project(found: dict[str, list[Region]], sections: list[dict], names: dict[str, str]) -> list[dict]:
    catalog = set(CATALOG_PROMPTS)
    out = []
    for section in sections:
        start, end = float(section['start']), float(section['end'])
        entries, extra, voices = [], [], []
        for key, regions in found.items():
            bucket = entries if key in catalog and key not in ('voice', 'choir') else (
                voices if key in ('voice', 'choir') else extra)
            for region in regions:
                clipped = clip_entry(region, start, end)
                if clipped is None:
                    continue
                clipped['key'] = key
                clipped['name'] = names.get(key, key)
                clipped['in_catalog'] = key in catalog
                bucket.append(clipped)
        for bucket in (entries, extra, voices):
            bucket.sort(key=lambda row: (row['at'], -row['confidence'], row['key']))
        out.append({
            'id': section['id'], 'kind': section['kind'], 'label': section.get('label', ''),
            'start': start, 'end': end,
            'entries': entries, 'uncatalogued': extra, 'voice': voices,
        })
    return out


def timeline(found: dict[str, list[Region]], names: dict[str, str]) -> list[dict]:
    catalog = set(CATALOG_PROMPTS)
    rows = []
    for key, regions in found.items():
        for region in regions:
            rows.append({
                'key': key,
                'name': names.get(key, key),
                'at': round(region.start, 2),
                'until': round(region.end, 2),
                'confidence': round(region.confidence, 3),
                'similarity': round(region.similarity, 3),
                'margin': round(region.margin, 3),
                'stem': region.stem,
                'in_catalog': key in catalog,
                'family_voice': key in ('voice', 'choir'),
            })
    rows.sort(key=lambda row: (row['at'], -row['confidence'], row['key']))
    return rows


def drum_onsets(samples: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    times = librosa.onset.onset_detect(y=samples, sr=sr, units='time')
    return np.asarray(times, dtype=np.float64)


def section_drums(onsets: np.ndarray, env: np.ndarray, sections: list[dict], found: dict[str, list[Region]],
                  names: dict[str, str]) -> list[dict]:
    rows = []
    for section in sections:
        start, end = float(section['start']), float(section['end'])
        span = max(1e-6, end - start)
        hits = onsets[(onsets >= start) & (onsets < end)]
        per_s = float(len(hits) / span)
        i0 = max(0, int(np.floor(start * FEATURE_RATE)))
        i1 = max(i0 + 1, int(np.ceil(end * FEATURE_RATE)))
        mean_env = float(np.mean(env[i0:min(i1, len(env))])) if len(env) else 0.0
        labels = []
        for key, regions in found.items():
            if key not in EXTRA_PERCUSSION and names.get('_family_' + key) != 'ударные':
                continue
            for region in regions:
                clipped = clip_entry(region, start, end)
                if clipped is None:
                    continue
                labels.append({'key': key, 'name': names.get(key, key), 'at': clipped['at'],
                               'until': clipped['until'], 'confidence': clipped['confidence'],
                               'in_catalog': key in CATALOG_PROMPTS})
        labels.sort(key=lambda row: -row['confidence'])
        regular = beat_regular(hits)
        rows.append({
            'id': section['id'], 'start': start, 'end': end,
            'hits': int(len(hits)), 'per_s': round(per_s, 2), 'density': density_word(per_s),
            'mean_level': round(mean_env, 3),
            'regular': regular,
            'labels': labels,
        })
    return rows


def _fold(text: str) -> str:
    return text.casefold().replace('ё', 'е').strip()


def _role_tokens(role: str) -> list[str]:
    return [piece.strip() for piece in _ROLE_SPLIT.split(role) if piece.strip()]


def _name_maps(rows: list[tuple[str, str, str]]) -> tuple[dict[str, str], dict[str, str]]:
    """Folded catalogue display name → key, and folded extra-label name → key."""
    catalog = {}
    for key, name, _family in rows:
        folded = _fold(name)
        if folded:
            catalog[folded] = key
    extra = {_fold(name): key for key, name in EXTRA_NAMES.items()}
    return catalog, extra


def build_closed_set(credits: list[dict], sources: str, rows: list[tuple[str, str, str]]) -> dict:
    """Instruments this recording's credits name, plus ensemble when the group is unnamed.

    song.json roles are matched to catalogue display names. sources.md is read only under
    the heading «Закрытый набор этой записи»: the rest of the file often quotes another
    concert or a page that was not opened, and those names must not become candidates.
    """
    catalog_names, extra_names = _name_maps(rows)
    russian = {key: name for key, name, _family in rows}
    keys: list[str] = []
    heading_unknown: list[str] = []
    ensemble = False
    generic = False
    uncatalogued: list[str] = []
    players: dict[str, list[str]] = {}
    singers: list[str] = []

    def add_key(key: str) -> None:
        nonlocal ensemble
        if key == 'ensemble':
            ensemble = True
            return
        if key in NOT_INSTRUMENTS:
            return
        if key not in keys:
            keys.append(key)

    def consider_token(token: str, raw: str, person: str | None) -> None:
        nonlocal generic, ensemble
        folded = _fold(token)
        if not folded:
            return
        if folded in GENERIC_PERCUSSION:
            generic = True
            ensemble = True
            return
        if folded in GROUP_ROLES:
            ensemble = True
            return
        # Heading bullets are catalogue keys (`ney`); credit roles are Russian names (`Най`).
        if folded in CATALOG_PROMPTS or folded == 'ensemble':
            add_key(folded)
            return
        key = ROLE_ALIASES.get(folded) or catalog_names.get(folded)
        if key == 'ensemble':
            ensemble = True
            return
        if key in NOT_INSTRUMENTS:
            if person and person not in singers:
                singers.append(person)
            return
        if key:
            add_key(key)
            if person:
                bucket = players.setdefault(key, [])
                if person not in bucket:
                    bucket.append(person)
            return
        extra = extra_names.get(folded)
        if extra:
            label = EXTRA_NAMES.get(extra, raw)
            if label not in uncatalogued:
                uncatalogued.append(label)
            return
        # A heading bullet that is neither a key nor a known name is a typo to surface.
        if person is None and folded not in heading_unknown:
            heading_unknown.append(raw.strip())

    # The explicit list leads. Credit roles then add anything the heading did not repeat.
    lines = sources.splitlines()
    start = next((i + 1 for i, line in enumerate(lines) if line.strip() == CLOSED_HEADING), None)
    if start is not None:
        for line in lines[start:]:
            if line.startswith('## '):
                break
            match = re.match(r'\s*[-*]\s+(\S+)', line)
            if match:
                consider_token(match.group(1), match.group(1), None)
    for credit in credits:
        role = str(credit.get('role', ''))
        person = str(credit.get('name', '')).strip()
        for token in _role_tokens(role):
            consider_token(token, token, person or None)

    if ensemble and 'ensemble' not in keys:
        keys.append('ensemble')
    performers = {}
    for key, names in players.items():
        if len(names) == 1:
            performers[key] = f'{names[0]} ({russian.get(key, key).lower()})'
    prompt_keys = [key for key in keys if key in CATALOG_PROMPTS]
    return {
        'keys': keys,
        'prompt_keys': prompt_keys,
        'ensemble': ensemble or ('ensemble' in keys),
        'generic_percussion': generic,
        'uncatalogued': uncatalogued,
        'performers': performers,
        'players': {key: names for key, names in players.items()},
        'heading_unknown': heading_unknown,
        'singers': singers,
    }


def closed_gaps_and_votes(sims: np.ndarray, scored: np.ndarray, closed_idx: list[int],
                          threshold: float | None) -> tuple[np.ndarray, np.ndarray]:
    """Per window: closed-set gap (nan if the window was quiet) and the voted column or -1.

    The vote requires the credited key to beat the closed runner-up by `threshold`, to beat
    silence by the method floor, and to be at least as close as every prompt outside the
    closed set. An uncredited timbre that scores higher vetoes the window: the best of a
    short list is not yet evidence that this instrument is the one sounding.
    """
    n = sims.shape[0]
    gaps = np.full(n, np.nan)
    vote = np.full(n, -1, dtype=int)
    if n == 0 or not closed_idx:
        return gaps, vote
    bg = sims.shape[1] - 1
    closed = np.asarray(closed_idx, dtype=int)
    block = sims[:, closed]
    rows = np.arange(n)
    if block.shape[1] == 1:
        top_local = np.zeros(n, dtype=int)
        top_vals = block[:, 0]
        second_vals = None
    else:
        order = np.argsort(block, axis=1)
        top_local = order[:, -1]
        second_vals = block[rows, order[:, -2]]
        top_vals = block[rows, top_local]
    silence = sims[:, bg]
    outside = np.ones(sims.shape[1], dtype=bool)
    outside[closed] = False
    outside[bg] = False
    outsider = sims[:, outside].max(axis=1) if outside.any() else np.full(n, -1.0)
    if second_vals is None:
        gap = np.minimum(top_vals - silence, top_vals - outsider)
    else:
        gap = top_vals - second_vals
    gaps = np.where(scored, gap, np.nan)
    if threshold is None:
        return gaps, vote
    ok = (scored & np.isfinite(gap) & (gap >= threshold)
          & (top_vals >= silence + CLOSED_MARGIN_FLOOR)
          & (top_vals >= outsider))
    vote = np.where(ok, closed[top_local], -1).astype(int)
    return gaps, vote


def calibrate_closed(gaps: list[np.ndarray]) -> dict:
    finite = np.concatenate([g[np.isfinite(g)] for g in gaps]) if gaps else np.zeros(0)
    windows = int(len(finite))
    if windows < CLOSED_AGREE:
        return {'separated': False, 'threshold': None, 'gap_p75': None, 'gap_p90': None, 'windows': windows}
    p75 = float(np.percentile(finite, CLOSED_GAP_PERCENTILE))
    p90 = float(np.percentile(finite, CLOSED_SEPARATION_PERCENTILE))
    separated = bool(p90 >= CLOSED_MARGIN_FLOOR)
    threshold = max(CLOSED_MARGIN_FLOOR, p75) if separated else None
    return {
        'separated': separated,
        'threshold': None if threshold is None else round(float(threshold), 4),
        'gap_p75': round(p75, 4),
        'gap_p90': round(p90, 4),
        'windows': windows,
    }


def bass_unnamed(env: np.ndarray, prompt_keys: list[str]) -> dict:
    """Low end with no credited bass instrument. A report note, never a lyrics entry."""
    named = bool(set(prompt_keys) & {'double-bass', 'cello', 'piano'})
    if len(env) == 0:
        fraction = 0.0
        longest_s = 0.0
    else:
        loud = env >= ENERGY_FLOOR
        fraction = float(np.mean(loud))
        longest = 0
        run = 0
        for on in loud:
            run = run + 1 if on else 0
            longest = max(longest, run)
        longest_s = longest / FEATURE_RATE
    present = (not named) and (fraction >= 0.05 or longest_s >= 3.0)
    note = ''
    if present:
        note = (f'Басовый стем громкий: доля кадров выше порога {fraction:.2f}, '
                f'самый длинный отрезок {longest_s:.1f} с. В титрах этой записи низкий инструмент не назван, '
                'поэтому в данные вступление не ставится.')
    return {
        'present': present,
        'named_bass': named,
        'loud_fraction': round(fraction, 3),
        'longest_s': round(longest_s, 2),
        'note': note,
    }


def data_proposal(packs: dict[str, dict], closed: dict, sections: list[dict],
                  names: dict[str, str], env_bass: np.ndarray) -> dict:
    """Timed entrances that clear the closed-set gate. Open-set regions are not copied here."""
    allowed = set(closed['prompt_keys'])
    gap_rows = []
    best: dict[str, float] = {}
    for pack in packs.values():
        closed_idx = [i for i, key in enumerate(pack['keys']) if key in allowed]
        # Gaps of every loud window calibrate the recording. The best gap kept for the
        # table is only a window the credited key actually won, including over outsiders.
        gaps, votes_at_floor = closed_gaps_and_votes(
            pack['sims'], pack['scored'], closed_idx, CLOSED_MARGIN_FLOOR)
        gap_rows.append(gaps)
        for key_i, key in enumerate(pack['keys']):
            if key not in allowed:
                continue
            mine = votes_at_floor == key_i
            if mine.any():
                value = float(np.max(gaps[mine]))
                if key not in best or value > best[key]:
                    best[key] = value
    cal = calibrate_closed(gap_rows)
    found: dict[str, list[Region]] = {}
    threshold = cal['threshold']
    if cal['separated'] and threshold is not None:
        for stem, pack in packs.items():
            closed_idx = [i for i, key in enumerate(pack['keys']) if key in allowed]
            gaps, votes = closed_gaps_and_votes(pack['sims'], pack['scored'], closed_idx, float(threshold))
            margin = np.where(np.isfinite(gaps), gaps, 0.0)
            for col, key in enumerate(pack['keys']):
                if key not in allowed:
                    continue
                mask = votes == col
                found.setdefault(key, []).extend(regions_from_mask(
                    pack['times'], mask, pack['hop'], margin, margin, pack['sims'][:, col],
                    stem, 1.0, 0.0, CLOSED_AGREE,
                ))
        for key, parts in list(found.items()):
            merged = merge_regions(parts, 0.0)
            if merged:
                found[key] = merged
            else:
                del found[key]
    flat = []
    by_section = []
    for section in sections:
        start, end = float(section['start']), float(section['end'])
        rows = []
        for key, regions in found.items():
            for region in regions:
                clipped = clip_entry(region, start, end)
                if clipped is None:
                    continue
                row = {
                    'key': key,
                    'name': names.get(key, key),
                    'at': clipped['at'],
                    'until': clipped['until'],
                    'holds_to_section_end': clipped['holds_to_section_end'],
                    'confidence': round(float(clipped['margin']), 3),
                    'similarity': clipped['similarity'],
                    'margin': round(float(clipped['margin']), 3),
                    'stem': clipped['stem'],
                }
                rows.append(row)
                flat.append({**row, 'section': section['id']})
        rows.sort(key=lambda row: (row['at'], row['key']))
        if rows:
            by_section.append({'id': section['id'], 'kind': section['kind'], 'entries': rows})
    flat.sort(key=lambda row: (row['at'], row['key']))
    return {
        'separated': cal['separated'],
        'threshold': cal['threshold'],
        'margin_floor': CLOSED_MARGIN_FLOOR,
        'agree_windows': CLOSED_AGREE,
        'gap_p75': cal['gap_p75'],
        'gap_p90': cal['gap_p90'],
        'windows': cal['windows'],
        'instruments': closed['keys'],
        'performers': closed['performers'],
        'uncatalogued': closed['uncatalogued'],
        'generic_percussion': closed['generic_percussion'],
        'heading_unknown': closed['heading_unknown'],
        'singers': closed['singers'],
        'best_gap': {key: round(value, 3) for key, value in sorted(best.items())},
        'entries': flat,
        'sections': by_section,
        'bass_unnamed': bass_unnamed(env_bass, closed['prompt_keys']),
    }


def _cell(value) -> str:
    return str(value).replace('|', '/').replace('\n', ' ')


def _span(row: dict) -> str:
    return f"{row['at']:.2f}–{row['until']:.2f}"


def _data_table(proposal: dict, names: dict[str, str]) -> str:
    """One row per credited instrument: a confident entrance, or no time."""
    by_key: dict[str, list[dict]] = {}
    for row in proposal['entries']:
        by_key.setdefault(row['key'], []).append(row)
    head = '| инструмент из титров | вступление | уверенность |\n|---|---|---|\n'
    body = []
    threshold = proposal.get('threshold')
    bar = 'запись не разделила эти подсказки' if not proposal['separated'] else f'порог записи {threshold}'
    for key in proposal['instruments']:
        name = names.get(key, key)
        rows = by_key.get(key, [])
        if key == 'ensemble' or key not in CATALOG_PROMPTS:
            when = 'без времени'
            conf = 'у ансамбля нет тембра, секунду скрипт не ставит'
        elif rows:
            when = '; '.join(f"{row['at']:.2f}–{row['until']:.2f}" for row in rows)
            conf = '; '.join(f"отрыв {row['confidence']:.2f}" for row in rows) + f' ({bar})'
        else:
            when = 'без времени'
            best = proposal.get('best_gap', {}).get(key)
            conf = bar if best is None else f'лучший отрыв {best:.2f}, {bar}'
        body.append(f'| {_cell(name)} | {when} | {_cell(conf)} |\n')
    return head + ''.join(body)


def render_md(slug: str, title: str, duration: float, line: list[dict], sections: list[dict],
              drums: list[dict], diag: dict, proposal: dict, names: dict[str, str]) -> str:
    def table(rows: list[dict]) -> str:
        if not rows:
            return 'Скрипт не выделил отдельный инструмент.\n'
        head = '| инструмент | когда, с | уверенность | сходство | стем | каталог |\n|---|---|---|---|---|---|\n'
        body = ''.join(
            f"| {_cell(row['name'])} | {_span(row)} | {row['confidence']:.2f} | {row['similarity']:.2f} "
            f"| {_cell(row['stem'])} | {'да' if row['in_catalog'] else 'нет'} |\n"
            for row in rows
        )
        return head + body

    diag_rows = ''.join(
        f"| {name} | {pack.get('scored', 0)}/{pack.get('windows', 0)} | {pack.get('margin_p50', '—')} "
        f"| {pack.get('margin_p90', '—')} | {pack.get('gap_p90', '—')} | {pack.get('top_prob_p90', '—')} |\n"
        for name, pack in diag.items()
    )
    credited = ', '.join(names.get(key, key) for key in proposal['instruments']) or '—'
    extra = ', '.join(proposal['uncatalogued']) or '—'
    unknown = ', '.join(proposal['heading_unknown']) or '—'
    performers = ', '.join(proposal['performers'].values()) or '—'
    bass = proposal['bass_unnamed']
    if bass.get('note'):
        bass_line = bass['note'] + '\n'
    elif bass.get('named_bass'):
        bass_line = 'В титрах назван низкий инструмент. Отдельной пометки о безымянном низе нет.\n'
    else:
        bass_line = 'Басовый стем не держит длинный громкий отрезок. Пометки о безымянном низе нет.\n'
    parts = [
        f'# {title}: инструменты по звуку\n',
        'Два слоя. Для данных — закрытый набор: инструменты, названные титрами этой записи, '
        'и только те вступления, которые прошли порог этой же записи. Агент переносит в `lyrics.json` '
        'только эту таблицу. Открытое распознавание ниже остаётся подсказкой человеку и в данные не идёт.\n',
        'Файл лежит рядом с картой голоса, а не в папке с тем же именем: `docs/analysis/'
        f'{slug}.md` уже занят.\n',
        f'Модель: `{CLAP_ID}` (Apache-2.0). Стемы: htdemucs (MIT). Огибающие: librosa (ISC). '
        f'Окно {WINDOW_S:.1f} с; шаг ударных {DRUM_HOP_S:.1f} с, остальных стемов {HOP_S:.1f} с, смеси {MIX_HOP_S:.1f} с. '
        'Пороги общие для метода. Уверенность закрытого набора — отрыв косинуса от второй подсказки этого набора, '
        'не вероятность softmax.\n',
        f'Длительность {duration:.2f} с.\n',
        '## Для данных\n',
        f'Закрытый набор: {credited}.\n',
        f'В титрах названо, в каталоге рисунков нет (в данные не пишется): {extra}.\n',
        f'Один исполнитель на инструмент: {performers}.\n',
        f'Неразобранные пункты закрытого списка: {unknown}.\n',
        ('Ударные в титрах названы обобщённо: в данные идёт ансамбль, без выдуманного барабана.\n'
         if proposal.get('generic_percussion') else ''),
        (f"Порог: отрыв не ниже {CLOSED_MARGIN_FLOOR}, и не ниже 75-го перцентиля отрывов этой записи "
         f"({proposal.get('gap_p75')}). 90-й перцентиль {proposal.get('gap_p90')}. "
         f"Соседних окон подряд: {CLOSED_AGREE}. "
         + ('Запись разделила подсказки закрытого набора.\n' if proposal['separated']
            else 'Запись не разделила подсказки закрытого набора: временных вступлений нет.\n')),
        _data_table(proposal, names),
        bass_line,
        '## Открытое распознавание\n',
        'Всё, что слышно, включая отсутствующее в титрах и в каталоге. Подсказка для человека. '
        'В `lyrics.json` эти строки не переносятся.\n',
        table(line),
        '## По секциям (открытое распознавание)\n',
    ]
    by_id = {row['id']: row for row in drums}
    for section in sections:
        drum = by_id.get(section['id'], {})
        rhythm = {True: 'интервалы ровные', False: 'интервалы неровные', None: 'про ровность сказать нельзя'}
        parts.append(
            f"### {section['id']} — {_cell(section['label'])} ({section['start']:.2f}–{section['end']:.2f} с)\n"
        )
        parts.append(
            f"Ударные: {drum.get('density', '—')}, {drum.get('per_s', 0):.2f} уд/с, "
            f"ударов {drum.get('hits', 0)}, уровень стема {drum.get('mean_level', 0):.2f}, "
            f"{rhythm.get(drum.get('regular'), 'про ровность сказать нельзя')}.\n"
        )
        if drum.get('labels'):
            named = ', '.join(f"{row['name']} ({row['confidence']:.2f})" for row in drum['labels'])
            parts.append(f'Какие ударные предложены: {named}.\n')
        parts.append('Инструменты секции:\n')
        parts.append(table(section['entries']))
        if section['uncatalogued']:
            parts.append('Слышно, но в каталоге рисунков этого нет:\n')
            parts.append(table(section['uncatalogued']))
        if section['voice']:
            parts.append('Голос на этом отрезке (в гравюры сопровождения не ставится):\n')
            parts.append(table(section['voice']))
    parts.append('## Насколько модель вообще различает подсказки\n')
    parts.append('| стем | окон с громкостью / всех | отрыв от тишины, медиана | отрыв, 90 % | отрыв от второго, 90 % | вероятность лидера, 90 % |\n')
    parts.append('|---|---|---|---|---|---|\n')
    parts.append(diag_rows or '| — | — | — | — | — |\n')
    parts.append('\nОтрыв — насколько ближайшая подсказка ближе тишины. Если медиана около нуля, '
                 'модель на этой записи почти не предпочитает ни один инструмент.\n')
    return '\n'.join(parts)


def analyze(slug: str) -> None:
    _window_bounds()
    started = time.perf_counter()
    rows = load_catalog()
    check_prompts(rows)
    names = {key: name for key, name, _ in rows}
    names.update(EXTRA_NAMES)
    for key, _, family in rows:
        names['_family_' + key] = family
    song = load_json(song_dir(slug) / 'song.json')
    lyrics = load_json(song_dir(slug) / 'lyrics.json')
    from common import find_source

    mix_path = find_source(slug)
    mix = load_audio(mix_path, CLAP_SR)
    duration = len(mix) / CLAP_SR
    stem_dir = work_dir(slug) / 'stems'
    stems = {}
    for name in ('drums', 'bass', 'other', 'vocals'):
        path = stem_dir / f'{name}.wav'
        if not path.is_file():
            raise SystemExit(f'нет стема {path} — сначала separate (htdemucs, четыре стема)')
        stems[name] = _fit(load_audio(path, CLAP_SR), len(mix))
    ref = float(np.percentile(block_rms(mix, CLAP_SR), 95))
    envs = {name: perceptual_01(block_rms(audio, CLAP_SR), ref) for name, audio in {'mix': mix, **stems}.items()}
    tagger = Tagger()
    packs = {
        'drums': score_stem(tagger, stems['drums'], CLAP_SR, duration, envs['drums'],
                            candidate_keys('drums', rows), DRUM_HOP_S, None, 'drums'),
        'bass': score_stem(tagger, stems['bass'], CLAP_SR, duration, envs['bass'],
                           candidate_keys('bass', rows), HOP_S, None, 'bass'),
        'other': score_stem(tagger, stems['other'], CLAP_SR, duration, envs['other'],
                            candidate_keys('other', rows), HOP_S, None, 'other'),
        'mix': score_stem(tagger, mix, CLAP_SR, duration, envs['mix'],
                          candidate_keys('mix', rows), MIX_HOP_S, envs['vocals'], 'mix'),
    }
    text_pairs = tagger.text_pairs
    del tagger
    found = collect_regions(packs, rows)
    sections = project(found, lyrics['sections'], names)
    sources_path = song_dir(slug) / 'sources.md'
    sources = sources_path.read_text(encoding='utf-8') if sources_path.is_file() else ''
    closed = build_closed_set(song.get('credits') or [], sources, rows)
    proposal = data_proposal(packs, closed, lyrics['sections'], names, envs['bass'])
    print(f"  закрытый набор: {closed['keys']}; порог {proposal['threshold']}; "
          f"вступлений {len(proposal['entries'])}; низ без имени {proposal['bass_unnamed']['present']}",
          flush=True)
    try:
        onsets = drum_onsets(stems['drums'], CLAP_SR)
    except Exception as exc:  # noqa: BLE001 — the names still stand if onset detection fails
        print(f'плотность ударов не посчитана ({exc})')
        onsets = np.zeros(0)
    drums = section_drums(onsets, envs['drums'], lyrics['sections'], found, names)
    line = timeline(found, names)
    n_bins = max(1, int(np.ceil(duration)))
    hits_per_s = np.zeros(n_bins, dtype=int)
    for t in onsets:
        i = int(t)
        if 0 <= i < n_bins:
            hits_per_s[i] += 1
    diag = {name: pack['diag'] for name, pack in packs.items()}
    for name, pack in diag.items():
        print(f"  диагностика {name}: {pack}", flush=True)
    payload = {
        'slug': slug,
        'title': song.get('title', slug),
        'duration': round(duration, 3),
        'models': MODELS,
        'window_s': WINDOW_S,
        'hop_s': {'drums': DRUM_HOP_S, 'bass': HOP_S, 'other': HOP_S, 'mix': MIX_HOP_S},
        'thresholds': {
            'energy_floor': ENERGY_FLOOR, 'vocal_mask': VOCAL_MASK,
            'cosine_eps': COSINE_EPS, 'min_windows': MIN_WINDOWS,
            'bridge_s': BRIDGE_S, 'bridge_drum_s': BRIDGE_DRUM_S,
            'min_region_s': MIN_REGION_S, 'min_drum_region_s': MIN_DRUM_REGION_S,
        },
        'prompts': {**CATALOG_PROMPTS, **EXTRA_PROMPTS, 'background': BACKGROUND},
        'diagnostics': {'text_pairs': text_pairs, 'stems': diag},
        'closed_set': {key: closed[key] for key in (
            'keys', 'prompt_keys', 'ensemble', 'generic_percussion', 'uncatalogued',
            'performers', 'players', 'heading_unknown', 'singers')},
        'data_proposal': proposal,
        'timeline': line,
        'sections': sections,
        'drums': {'onset_count': int(len(onsets)), 'hits_per_s': hits_per_s.tolist(), 'sections': drums},
        'path_note': f'docs/analysis/{slug}.md is the voice map, so this report is '
                     f'docs/analysis/{slug}-instruments.md and not a directory of the same name.',
    }
    from common import dump_json

    out_dir = ROOT / 'docs' / 'analysis'
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f'{slug}-instruments.json'
    md_path = out_dir / f'{slug}-instruments.md'
    json_path.write_text(dump_json(payload), encoding='utf-8')
    md_path.write_text(
        render_md(slug, payload['title'], duration, line, sections, drums, diag, proposal, names),
        encoding='utf-8')
    elapsed = time.perf_counter() - started
    catalog_n = sum(1 for row in line if row['in_catalog'] and not row['family_voice'])
    extra_n = sum(1 for row in line if not row['in_catalog'])
    print(f'INSTRUMENTS {slug} seconds={elapsed:.1f} catalog_regions={catalog_n} '
          f'uncatalogued_regions={extra_n} → {json_path.name}, {md_path.name}')


def _self_test() -> None:
    rows = load_catalog()
    check_prompts(rows)
    families = {key: family for key, _, family in rows}
    for key, _, family in rows:
        if key == 'ensemble':
            continue
        for stem in homes(key, family):
            assert key in candidate_keys(stem, rows), (key, stem)
    for key in EXTRA_PROMPTS:
        for stem in homes(key, ''):
            assert key in candidate_keys(stem, rows), (key, stem)
    times = np.array([1.0, 3.0, 5.0, 7.0])
    mask = np.array([True, False, False, True])
    prob = np.array([0.4, 0.0, 0.0, 0.5])
    got = regions_from_mask(times, mask, 2.0, prob, prob, prob, 'other', 1.5, 2.0)
    assert len(got) == 0, got  # a single window is not a region, and the 4 s gap does not bridge
    mask2 = np.array([False, True, True, False])
    got2 = regions_from_mask(times, mask2, 2.0, np.full(4, 0.3), np.full(4, 0.1), np.full(4, 0.2), 'drums', 1.0, 1.0)
    assert len(got2) == 1 and got2[0].start == 2.0 and got2[0].end == 6.0, got2
    merged = merge_regions([
        Region(0, 5, 0.2, 0.1, 0.05, 'bass'),
        Region(4, 9, 0.6, 0.2, 0.1, 'other'),
    ], 2.0)
    assert len(merged) == 1 and merged[0].end == 9 and merged[0].confidence == 0.6, merged
    early = Region(0, 20, 0.4, 0.2, 0.1, 'other')
    clipped = clip_entry(early, 10, 15)
    assert clipped and clipped['at'] == 10 and clipped['until'] == 15, clipped
    assert clip_entry(Region(0, 1, 0.4, 0.2, 0.1, 'other'), 10, 12) is None
    assert density_word(0.0) == 'почти нет ударов'
    assert density_word(3.0) == 'плотно'
    assert beat_regular(np.array([0, 0.5, 1.0, 1.5, 2.0, 2.5])) is True
    assert beat_regular(np.array([0, 0.2, 1.4, 1.5, 3.3, 3.35])) is False
    probs = np.zeros((6, 3))
    sims = np.zeros((6, 3))
    probs[2:5, 0] = 0.7
    sims[2:5, 0] = 0.3
    sims[:, 2] = 0.05
    mask_a, _, _ = activation(probs, sims, 0)
    assert mask_a[3] and not mask_a[0], mask_a
    # Closed set: a heading does not swallow a later roster, and a generic drum credit is ensemble.
    fixture_sources = (
        '## Закрытый набор этой записи\n'
        '- ney\n- violin\n- ensemble\n'
        '## Другой состав\n- piano\n- oud\n- double-bass\n'
    )
    fixture_credits = [
        {'role': 'Танбур', 'name': 'А'},
        {'role': 'Классическая гитара, танбур', 'name': 'Б'},
        {'role': 'Ударные', 'name': 'В'},
        {'role': 'Даф', 'name': 'Г'},
        {'role': 'Балабан', 'name': 'Д'},
        {'role': 'Хор', 'name': 'Е'},
    ]
    got = build_closed_set(fixture_credits, fixture_sources, rows)
    assert got['keys'][:3] == ['ney', 'violin', 'ensemble'] or got['keys'][:2] == ['ney', 'violin'], got['keys']
    assert 'piano' not in got['keys'] and 'double-bass' not in got['keys'] and 'oud' not in got['keys'], got
    assert 'tanbur' in got['keys'] and 'guitar' in got['keys'] and 'daf' in got['keys'], got
    assert 'darbuka' not in got['keys'] and 'bendir' not in got['keys'], got
    assert got['generic_percussion'] is True and got['keys'][-1] == 'ensemble', got
    assert 'балабан' in got['uncatalogued'], got
    assert 'tanbur' not in got['performers'], got['performers']
    assert got['performers']['guitar'].startswith('Б ('), got['performers']
    assert got['performers']['daf'].startswith('Г ('), got['performers']
    assert 'Е' in got['singers'], got
    # Credited key must be the closest prompt. A louder uncredited timbre vetoes the window.
    grid = np.zeros((6, 3))
    grid[:, 2] = 0.10
    grid[0:3, 0] = 0.50
    grid[0:3, 1] = 0.20
    grid[3:6, 0] = 0.20
    grid[3:6, 1] = 0.50
    scored = np.ones(6, dtype=bool)
    gaps, votes = closed_gaps_and_votes(grid, scored, [0], CLOSED_MARGIN_FLOOR)
    assert list(votes) == [0, 0, 0, -1, -1, -1], votes
    assert calibrate_closed([np.array([0.01, 0.02, 0.015])])['separated'] is False
    loud = np.array([0.2, 0.01, 0.01, 0.25])
    assert calibrate_closed([loud])['separated'] is True
    assert calibrate_closed([loud])['threshold'] >= CLOSED_MARGIN_FLOOR
    # These three recordings: the 2020 roster and the unopened snippet must stay out of the data set.
    expected = {
        'i-have-come-alive': {'tanbur', 'ney', 'kamancheh', 'oud', 'qanun', 'erhu', 'daf', 'guitar', 'santur', 'baglama', 'ensemble'},
        'one': {'ney', 'violin', 'qanun', 'santur', 'ensemble'},
        'karitas': {'erhu', 'oud', 'ney', 'violin', 'ensemble'},
    }
    banned = {'double-bass', 'cello', 'harp', 'piano', 'tar', 'darbuka', 'bendir', 'tombak', 'riq'}
    for slug, want in expected.items():
        song = load_json(song_dir(slug) / 'song.json')
        text = (song_dir(slug) / 'sources.md').read_text(encoding='utf-8')
        closed = build_closed_set(song.get('credits') or [], text, rows)
        assert set(closed['keys']) == want, (slug, closed['keys'])
        assert not (set(closed['keys']) & banned), (slug, closed['keys'])
        assert not closed['heading_unknown'], (slug, closed['heading_unknown'])
    ihca = build_closed_set(
        load_json(song_dir('i-have-come-alive') / 'song.json').get('credits') or [],
        (song_dir('i-have-come-alive') / 'sources.md').read_text(encoding='utf-8'), rows)
    assert 'tanbur' not in ihca['performers'] and 'kamancheh' not in ihca['performers'], ihca['performers']
    for key in ('ney', 'oud', 'qanun', 'erhu', 'daf', 'guitar', 'santur', 'baglama'):
        assert key in ihca['performers'], (key, ihca['performers'])
    assert ihca['performers']['ney'].startswith('Eyüpcan Açıkpazu'), ihca['performers']['ney']
    assert 'балабан' in ihca['uncatalogued'] and 'ситар' in ihca['uncatalogued'], ihca['uncatalogued']
    quiet_bass = bass_unnamed(np.zeros(100), ['ney'])
    assert quiet_bass['present'] is False, quiet_bass
    loud_bass = bass_unnamed(np.full(FEATURE_RATE * 5, 0.5), ['ney'])
    assert loud_bass['present'] is True and loud_bass['named_bass'] is False, loud_bass
    named_bass = bass_unnamed(np.full(FEATURE_RATE * 5, 0.5), ['double-bass'])
    assert named_bass['present'] is False and named_bass['named_bass'] is True, named_bass
    print('instruments self-test ok')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        _self_test()
    elif len(sys.argv) == 2 and not sys.argv[1].startswith('-'):
        analyze(sys.argv[1])
    else:
        raise SystemExit(__doc__)
