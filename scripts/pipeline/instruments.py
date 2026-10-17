"""Who is playing, and when. Works for any recording, not for one catalogue of songs.

    python3 instruments.py <slug>
    python3 instruments.py --self-test

Reads the mix and the four htdemucs stems (drums, bass, other, vocals) and the section
times in content/songs/<slug>/lyrics.json. Writes a proposal, not lyrics.json:

    docs/analysis/<slug>-instruments.json
    docs/analysis/<slug>-instruments.md

The voice map already occupies docs/analysis/<slug>.md, so these files cannot live in a
directory of the same name.

Tagger: LAION CLAP `laion/larger_clap_music` (Apache-2.0), the music checkpoint published
as music_audioset_epoch_15_esc_90.14, through transformers. Each catalogue key in
src/instruments/list.ts except `ensemble` has an English prompt. A second, general list
(timpani, tabla, sitar, …) is reported when it wins and is never written as a catalogue key.
PANNs weights are not loaded: the code repository has no LICENSE file and the Zenodo record
only says Open.

Windows are 1–3 s. A label is active only when it is one of the two closest prompts, ahead of
silence, and above a probability floor that scales with the number of prompts. Thresholds are
constants of the method, not of a song. The agent confirms the proposal against the credits
before anything is written into lyrics.json.
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

CLAP_ID = 'laion/larger_clap_music'
CLAP_CARD = 'https://huggingface.co/laion/larger_clap_music'
CLAP_SR = 48000
BACKGROUND = 'silence, room tone, or no distinct musical instrument'

# Window length is the task's 1–3 s. Hop may be shorter so entrances are not stuck to a grid.
WINDOW_S = float(os.environ.get('CLAP_WINDOW', '2.5'))
HOP_S = float(os.environ.get('CLAP_HOP', '2.0'))
DRUM_HOP_S = float(os.environ.get('CLAP_DRUM_HOP', '1.5'))
MIX_HOP_S = float(os.environ.get('CLAP_MIX_HOP', '3.0'))
ENERGY_FLOOR = 0.15
# Above this vocal-stem level the mix is the singer, so melodic labels on the mix are ignored.
VOCAL_MASK = 0.35
# Probability must beat this floor and a multiple of the uniform prior 1/N.
ON_FLOOR = 0.15
ON_FACTOR = 2.0
OFF_FLOOR = 0.08
OFF_FACTOR = 1.3
MIN_MARGIN = 0.0
BRIDGE_S = 2.0
BRIDGE_DRUM_S = 1.0
MIN_REGION_S = 1.5
MIN_DRUM_REGION_S = 1.0

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
    'tagger_note': 'Music checkpoint corresponding to music_audioset_epoch_15_esc_90.14.pt. '
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


def hysteresis(values: np.ndarray, on: float, off: float) -> np.ndarray:
    state = False
    out = np.zeros(len(values), dtype=bool)
    for i, value in enumerate(values):
        state = value >= (off if state else on)
        out[i] = state
    return out


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
        self.model = ClapModel.from_pretrained(CLAP_ID).to(self.device).eval()
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
                inputs = self.processor(audios=piece, sampling_rate=CLAP_SR, return_tensors='pt', padding=True)
            except TypeError:
                inputs = self.processor(audio=piece, sampling_rate=CLAP_SR, return_tensors='pt', padding=True)
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

    The background prompt is the last column. A label must be among the two closest
    non-silence prompts, beat silence by MIN_MARGIN, and clear the probability floor.
    """
    n_labels = probs.shape[1]
    bg = n_labels - 1
    prob = smooth(probs[:, column])
    margin = smooth(sims[:, column] - sims[:, bg])
    on = max(ON_FLOOR, ON_FACTOR / max(n_labels, 1))
    off = min(on * 0.75, max(OFF_FLOOR, OFF_FACTOR / max(n_labels, 1)))
    state = hysteresis(prob, on, off)
    others = np.delete(probs, bg, axis=1)
    rank = column if column < bg else column - 1
    if others.shape[1] <= 1:
        in_top = np.ones(len(probs), dtype=bool)
    else:
        top2 = np.argsort(others, axis=1)[:, -2:]
        in_top = np.any(top2 == rank, axis=1)
    return state & (margin >= MIN_MARGIN) & in_top, prob, margin


def regions_from_mask(times: np.ndarray, mask: np.ndarray, hop: float, prob: np.ndarray,
                      margin: np.ndarray, sim: np.ndarray, stem: str, min_len: float, bridge: float) -> list[Region]:
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
        if t1 - t0 < min_len:
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

    def pct(values, q):
        return round(float(np.percentile(values, q)), 3)

    return {
        'windows': int(len(probs)),
        'scored': int(np.count_nonzero(scored)),
        'margin_p50': pct(margin, 50),
        'margin_p90': pct(margin, 90),
        'margin_max': round(float(np.max(margin)), 3),
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


def _cell(value) -> str:
    return str(value).replace('|', '/').replace('\n', ' ')


def _span(row: dict) -> str:
    return f"{row['at']:.2f}–{row['until']:.2f}"


def render_md(slug: str, title: str, duration: float, line: list[dict], sections: list[dict],
              drums: list[dict], diag: dict) -> str:
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
        f"| {pack.get('margin_p90', '—')} | {pack.get('top_prob_p90', '—')} |\n"
        for name, pack in diag.items()
    )
    parts = [
        f'# {title}: инструменты по звуку\n',
        'Предложение скрипта. В `lyrics.json` его переносит агент после сверки с титрами. '
        'Файл лежит рядом с картой голоса, а не в папке с тем же именем: `docs/analysis/'
        f'{slug}.md` уже занят.\n',
        f'Модель: `{CLAP_ID}` (Apache-2.0). Стемы: htdemucs (MIT). Огибающие: librosa (ISC). '
        f'Окно {WINDOW_S:.1f} с; шаг ударных {DRUM_HOP_S:.1f} с, остальных стемов {HOP_S:.1f} с, смеси {MIX_HOP_S:.1f} с. '
        'Пороги общие для любой записи. Уверенность — средняя вероятность подсказки на окнах отрезка '
        'после сглаживания, не калиброванная доля истины. Сходство — косинус CLAP.\n',
        f'Длительность {duration:.2f} с.\n',
        '## Вся запись\n',
        table(line),
        '## По секциям\n',
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
    parts.append('| стем | окон с громкостью / всех | отрыв от тишины, медиана | отрыв, 90 % | вероятность лидера, 90 % |\n')
    parts.append('|---|---|---|---|---|\n')
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
    del tagger
    found = collect_regions(packs, rows)
    sections = project(found, lyrics['sections'], names)
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
            'on_floor': ON_FLOOR, 'on_factor': ON_FACTOR, 'min_margin': MIN_MARGIN,
            'bridge_s': BRIDGE_S, 'bridge_drum_s': BRIDGE_DRUM_S,
            'min_region_s': MIN_REGION_S, 'min_drum_region_s': MIN_DRUM_REGION_S,
        },
        'prompts': {**CATALOG_PROMPTS, **EXTRA_PROMPTS, 'background': BACKGROUND},
        'diagnostics': diag,
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
    md_path.write_text(render_md(slug, payload['title'], duration, line, sections, drums, diag), encoding='utf-8')
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
    assert len(got) == 2, got  # gap of 4 s is not bridged by 2 s
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
    print('instruments self-test ok')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--self-test':
        _self_test()
    elif len(sys.argv) == 2 and not sys.argv[1].startswith('-'):
        analyze(sys.argv[1])
    else:
        raise SystemExit(__doc__)
