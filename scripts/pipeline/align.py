"""Stage 5: word-level forced alignment of lyrics.json against the vocal stem.

    python3 scripts/pipeline/align.py <slug> [--section <id>] [--dry-run]

Engine: torchaudio MMS_FA (multilingual CTC aligner, 1100+ languages). Non-Latin words are
romanised with uroman first, because the aligner's vocabulary is Latin letters.
Each vocal section is aligned separately on its own window (±0.5 s), which keeps errors local.

Writes word "s"/"e" into lyrics.json, sets song.json timing = aligned, removes "timing-draft"
flags from aligned lines, and prints a report of words that need a human look.
"""
from __future__ import annotations

import re
import sys
import unicodedata

from common import load_json, save_json, song_dir, work_dir

ISO3 = {'ar': 'ara', 'fa': 'fas', 'az': 'aze', 'tr': 'tur', 'ota': 'ota', 'en': 'eng', 'la': 'lat', 'de': 'deu', 'gmh': 'gmh', 'es': 'spa', 'ur': 'urd', 'hi': 'hin', 'ru': 'rus', 'uz': 'uzb', 'fr': 'fra', 'it': 'ita'}
PAD = 0.5


def normalise(text: str) -> str:
    """Latin letters and apostrophe only, lower case — the MMS_FA dictionary."""
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in text if not unicodedata.combining(c)).lower()
    text = text.replace('ı', 'i').replace('ə', 'e').replace('ß', 'ss')
    return re.sub(r"[^a-z']", '', text)


def main(slug: str, only: str | None = None, dry: bool = False) -> None:
    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as bundle
    import uroman as ur

    roman = ur.Uroman()
    model = bundle.get_model(with_star=False)
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    sr = bundle.sample_rate

    wav, file_sr = torchaudio.load(str(work_dir(slug) / 'stems' / 'vocals.wav'))
    wav = torchaudio.functional.resample(wav.mean(0, keepdim=True), file_sr, sr)

    lyr_path = song_dir(slug) / 'lyrics.json'
    lyrics = load_json(lyr_path)
    report = []
    aligned_lines = 0

    for sec in lyrics['sections']:
        if sec['kind'] != 'vocal' or (only and sec['id'] != only):
            continue
        a = max(0.0, sec['start'] - PAD)
        b = sec['end'] + PAD
        clip = wav[:, int(a * sr): int(b * sr)]
        words, owners = [], []
        owned: set[int] = set()
        for line in sec['lines']:
            lang = ISO3.get(line['lang'], 'eng')
            for w in line['words']:
                r = w['w'] if line['script'] == 'Latn' else roman.romanize_string(w['w'], lcode=lang)
                n = normalise(r)
                if n:
                    words.append(n)
                    owners.append(w)
                    owned.add(id(w))
                else:
                    report.append(f"{line['id']}: «{w['w']}» не удалось романизовать — время будет интерполировано")
        if not words:
            continue
        with torch.inference_mode():
            emission, _ = model(clip)
            spans = aligner(emission[0], tokenizer(words))
        ratio = clip.size(1) / emission.size(1) / sr
        for w, span in zip(owners, spans):
            s = a + span[0].start * ratio
            e = a + span[-1].end * ratio
            score = sum(t.score for t in span) / len(span)
            if not dry:
                w['s'], w['e'] = round(s, 2), round(e, 2)
            if score < 0.25:
                report.append(f"{sec['id']}: «{w['w']}» низкая уверенность ({score:.2f}) около {s:.1f} с")
            if e - s < 0.08:
                report.append(f"{sec['id']}: «{w['w']}» слишком короткое ({(e - s) * 1000:.0f} мс) около {s:.1f} с")
            if e - s > 4:
                report.append(f"{sec['id']}: «{w['w']}» тянется {e - s:.1f} с — мелизм? проверьте")
        # Words that could not be romanised: place between neighbours.
        for line in sec['lines']:
            ws = line['words']
            for i, w in enumerate(ws):
                if id(w) in owned:
                    continue
                prev_e = ws[i - 1]['e'] if i else sec['start']
                nxt = next((x['s'] for x in ws[i + 1:] if id(x) in owned), prev_e + 0.4)
                w['s'], w['e'] = round(prev_e, 2), round(max(prev_e + 0.1, nxt), 2)
            if not dry:
                line['flags'] = [f for f in line.get('flags', []) if f != 'timing-draft']
                if not line['flags']:
                    line.pop('flags')
            aligned_lines += 1
        print(f"{sec['id']}: {len(words)} слов выровнено")

    if dry:
        print('dry run: lyrics.json не изменён')
    else:
        save_json(lyr_path, lyrics)
        song_path = song_dir(slug) / 'song.json'
        song = load_json(song_path)
        song['timing'] = {'status': 'aligned', 'method': 'mms-fa', 'notes': 'Автоматическое выравнивание; проверьте отмеченные места в редакторе.'}
        save_json(song_path, song)
    print(f'\nСтрок: {aligned_lines}. Требуют внимания: {len(report)}')
    for r in report:
        print('  ·', r)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    sec = sys.argv[sys.argv.index('--section') + 1] if '--section' in sys.argv else None
    main(args[0], sec, '--dry-run' in sys.argv)
