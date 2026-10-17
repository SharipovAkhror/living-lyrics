"""Where a known line actually sits in the vocal stem, compared with the current search.

Does not write lyrics.json or song.json. The current anchor and line passes are only observed,
so the table shows the window they would have searched and the placement they would have kept
or thrown away. Three other locators run on the same stem:

- Whisper large-v3 word times, language fixed, VAD off (singing is not speech);
- MMS forced alignment of that one line inside the Whisper span;
- one CTC pass of the whole vocal section, with a repeatable star between words and lines
  so a pause or a melisma is not soaked up by a letter. The star column is a flat log-score
  of 0, the same wildcard torchaudio uses for unknown audio. Draft s/e are not a window.

    python3 scripts/pipeline/diagnose_locate.py <slug>

Writes docs/analysis/<slug>/locate.md and locate.json. work/ is not committed.
"""
from __future__ import annotations

import difflib
import sys

import numpy as np

import align as A
import qa_sync as Q
import timing as T
from common import ROOT, dump_json, load_audio, load_json, song_dir, vocal_stem, work_dir
# English verse and refrains, plus the Turkish verse and chorus. The report asked for the
# English lines and the Turkish chorus; the verse is the same slice, so it is included.
DEFAULT_IDS = {f'english-{i}' for i in range(1, 16)} | {f'turkish-{i}' for i in range(1, 17)}


def align_stars(lp_letters: np.ndarray, units: list) -> list[dict] | None:
    """Same placement the pipeline writes. Kept so the locator table and the tests share it."""
    return A.align_stars(lp_letters, units)


def _sections(units: list) -> list[tuple[dict, list]]:
    groups: list[tuple[dict, list]] = []
    for u in units:
        if groups and groups[-1][0] is u.sec:
            groups[-1][1].append(u)
        else:
            groups.append((u.sec, [u]))
    return groups


def _status(method: str, res: dict | None, anchor_t: float, outside: bool) -> dict:
    """Same gates as align.py. `raw_s` is the line-pass start even when the gate discards it."""
    scores = []
    if res is not None:
        scores = [w['score'] for w in res['words'] if w is not None]
    score = float(np.mean(scores)) if scores else 0.0
    gap = float(res['gap']) if res is not None else 99.0
    agree = 0.0 if (res is None or outside) else abs(res['f0'] / A.FPS - anchor_t)
    if method == 'line' and score >= A.GOOD_SCORE and gap <= A.GOOD_GAP and agree <= A.GOOD_AGREE:
        status = 'good'
    elif res is not None and score >= A.KEEP_SCORE and agree <= A.KEEP_AGREE:
        status = 'weak'
    else:
        status = 'draft'
    raw = None if res is None else res['f0'] / A.FPS
    return {'score': round(score, 3), 'gap': round(gap, 3), 'agree': round(agree, 3),
            'status': status, 'raw_s': None if raw is None else round(raw, 2)}


def _pair(units: list, hyp: list[dict]) -> dict[str, dict]:
    """Order-preserving match of canonical words to Whisper words. Keys are line ids."""
    canon = []
    for u in units:
        for w in u.line['words']:
            key = A.normalise(w['w'])
            if key:
                canon.append((u.id, key))
    hy = []
    for w in hyp:
        key = A.normalise(w.get('w') or '')
        if key and w.get('s') is not None:
            hy.append({'w': w['w'], 's': float(w['s']), 'e': float(w['e']), 'key': key})
    link: dict[int, dict] = {}
    if canon and hy:
        sm = difflib.SequenceMatcher(a=[c[1] for c in canon], b=[h['key'] for h in hy], autojunk=False)
        for block in sm.get_matching_blocks():
            for k in range(block.size):
                link[block.a + k] = hy[block.b + k]
    by: dict[str, dict] = {}
    for i, (lid, _) in enumerate(canon):
        cell = by.setdefault(lid, {'n': 0, 'hit': []})
        cell['n'] += 1
        if i in link:
            cell['hit'].append(link[i])
    return by


def _whisper_slice(model, x: np.ndarray, lang: str, t0: float, t1: float) -> list[dict]:
    a, b = int(t0 * 16000), int(t1 * 16000)
    clip = np.ascontiguousarray(x[max(0, a):min(len(x), b)])
    if len(clip) < 16000:
        return []
    segments, _info = model.transcribe(
        clip, language=lang, word_timestamps=True, vad_filter=False,
        beam_size=5, condition_on_previous_text=False, temperature=0.0,
    )
    words = []
    for seg in segments:
        for w in seg.words or []:
            if w.start is None or w.end is None:
                continue
            words.append({'w': (w.word or '').strip(), 's': round(t0 + float(w.start), 3),
                          'e': round(t0 + float(w.end), 3), 'p': round(float(w.probability), 2)})
    return words


def _fmt(t) -> str:
    return '—' if t is None else f'{float(t):.2f}'


def _spans(selected: set[str], sections: list[tuple[dict, list]]) -> list[tuple[str, float, float]]:
    raw = []
    for sec, group in sections:
        if not any(u.id in selected for u in group):
            continue
        raw.append((group[0].line['lang'], float(sec['start']) - 4.0, float(sec['end']) + 4.0))
    raw.sort()
    merged: list[tuple[str, float, float]] = []
    for lang, a, b in raw:
        if merged and merged[-1][0] == lang and a <= merged[-1][2] + 15:
            merged[-1] = (lang, merged[-1][1], max(merged[-1][2], b))
        else:
            merged.append((lang, a, b))
    return merged


def _near(t, peaks: np.ndarray):
    if t is None or len(peaks) == 0:
        return None, None
    k = int(np.argmin(np.abs(peaks - float(t))))
    return round(float(peaks[k]), 2), round(float(peaks[k] - float(t)), 3)


def main(slug: str, only: set[str] | None = None) -> None:
    selected = only or set(DEFAULT_IDS)
    lyrics = load_json(song_dir(slug) / 'lyrics.json')
    audio, is_stem = vocal_stem(slug)
    if not is_stem:
        raise SystemExit(f'нет вокального стема: {audio}')
    x = load_audio(audio)
    duration = len(x) / 16000
    print(f'вокал {duration:.0f} с, считаю буквенные вероятности', flush=True)
    lp = A.emissions(slug, audio, x)
    vocab = A.vocabulary()
    rom = A.Romaniser()
    units = []
    for idx, (sec, line) in enumerate(T.vocal_lines(lyrics)):
        roman = [rom(w['w'], line['lang'], line['script']) for w in line['words']]
        units.append(A.Unit(idx, sec, line, roman, vocab))
    print('якоря и окна текущего поиска (наблюдение, времена не пишу)', flush=True)
    anchors = A.anchor_pass(lp, units, 'global')
    outside = {u.idx for u in units
               if not A.anchor_in_section(*anchors[u.idx], float(u.sec['start']), float(u.sec['end']))}
    passes = A.line_pass(lp, units, anchors, 6.0)
    by_idx = {u.idx: (u, p) for u, p in zip(units, passes)}

    sig = Q.Signals(x)
    peaks = Q.onset_peak_times(sig)
    sections = _sections(units)

    print('Whisper large-v3, словные времена, только на выбранных кусках', flush=True)
    from faster_whisper import WhisperModel

    model = WhisperModel('large-v3', device='cpu', compute_type='int8', cpu_threads=4)
    whisper_words: list[dict] = []
    for lang, a, b in _spans(selected, sections):
        a, b = max(0.0, a), min(duration, b)
        print(f'  whisper {lang} {a:.1f}–{b:.1f}', flush=True)
        got = _whisper_slice(model, x, lang, a, b)
        whisper_words.extend(got)
        print(f'    слов {len(got)}', flush=True)
    del model

    whisper_by_sec: dict[int, dict] = {}
    for sec, group in sections:
        if not any(u.id in selected for u in group):
            continue
        lo, hi = float(sec['start']) - 4.0, float(sec['end']) + 4.0
        scoped = [w for w in whisper_words if lo <= float(w['s']) <= hi]
        whisper_by_sec[id(sec)] = _pair(group, scoped)

    star_by_id: dict[str, dict] = {}
    for sec, group in sections:
        if not any(u.id in selected for u in group):
            continue
        placed = None
        used_pad = None
        origin = 0.0
        for pad in (0.0, 2.0):
            t0 = max(0, int((float(sec['start']) - pad) * A.FPS))
            t1 = min(len(lp), int((float(sec['end']) + pad) * A.FPS))
            placed = align_stars(lp[t0:t1], group)
            if placed is not None:
                used_pad = pad
                origin = t0 / A.FPS
                break
        print(f"секция {sec['id']}: {'не поместилась' if placed is None else f'звезда, запас {used_pad:.0f} с'}", flush=True)
        if placed is None:
            for u in group:
                star_by_id[u.id] = {'s': None, 'e': None, 'score': 0.0, 'pad': None}
            continue
        for u, rec in zip(group, placed):
            words = [w for w in rec['words'] if w is not None]
            s0 = None if not words else round(origin + words[0]['f0'] / A.FPS, 2)
            e0 = None if not words else round(origin + words[-1]['f1'] / A.FPS, 2)
            star_by_id[u.id] = {'s': s0, 'e': e0, 'score': round(rec['score'], 3), 'pad': used_pad}

    rows = []
    for u in units:
        if u.id not in selected:
            continue
        p = by_idx[u.idx][1]
        anc = anchors[u.idx]
        st = _status(p['method'], p['res'], anc[0], u.idx in outside)
        win = p['window']
        hyp = whisper_by_sec.get(id(u.sec), {}).get(u.id, {'n': 0, 'hit': []})
        hits = hyp['hit']
        wsp = None
        if hits:
            wsp = {'s': round(min(h['s'] for h in hits), 2), 'e': round(max(h['e'] for h in hits), 2),
                   'n': len(hits), 'of': hyp['n']}
        mms = {'s': None, 'score': None, 'gap': None}
        if wsp is not None and wsp['n'] >= max(1, hyp['n'] // 2):
            t0 = max(0, int((wsp['s'] - 0.4) * A.FPS))
            t1 = min(len(lp), int((wsp['e'] + 0.4) * A.FPS))
            res = A.align_window(lp, t0, t1, [u])
            if res is not None:
                mms = {'s': round(res[0]['f0'] / A.FPS, 2), 'score': round(float(np.mean(
                    [w['score'] for w in res[0]['words'] if w] or [0.0])), 3), 'gap': round(res[0]['gap'], 3)}
        voice_t = None if wsp is None else wsp['s']
        atk, atk_dt = _near(voice_t if voice_t is not None else st['raw_s'], peaks)
        covers = None
        if wsp is not None:
            covers = wsp['s'] >= win[0] - 0.3 and wsp['e'] <= win[1] + 0.3
        star = star_by_id.get(u.id, {'s': None, 'e': None, 'score': 0.0, 'pad': None})
        text = ' '.join(w['w'] for w in u.line['words'])
        rows.append({
            'id': u.id, 'text': text, 'section': u.sec['id'],
            'map': [round(float(u.sec['start']), 2), round(float(u.sec['end']), 2)],
            'window': [round(win[0], 2), round(win[1], 2)],
            'anchor': [round(anc[0], 2), round(anc[1], 2)], 'anchor_outside': u.idx in outside,
            'old': st, 'method': p['method'], 'whisper': wsp, 'window_covers_whisper': covers,
            'attack': atk, 'attack_dt': atk_dt, 'mms_window': mms, 'section_star': star,
        })
        print(f"{u.id}: окно {win[0]:.1f}–{win[1]:.1f} старый {st['status']} {_fmt(st['raw_s'])} "
              f"whisper {_fmt(None if wsp is None else wsp['s'])} секция {_fmt(star['s'])}", flush=True)

    _write(slug, rows, whisper_words)


def _write(slug: str, rows: list[dict], whisper_words: list[dict]) -> None:
    found_raw = [r for r in rows if r['old']['raw_s'] is not None and r['old']['score'] >= A.GOOD_SCORE]
    discarded = [r for r in found_raw if r['old']['status'] == 'draft']
    covered = [r for r in rows if r['window_covers_whisper'] is True]
    missed = [r for r in rows if r['window_covers_whisper'] is False]
    mms_ok = [r for r in rows if (r['mms_window']['score'] or 0) >= A.GOOD_SCORE]
    star_ok = [r for r in rows if (r['section_star']['score'] or 0) >= A.GOOD_SCORE and r['section_star']['s'] is not None]
    close = []
    for r in rows:
        if r['whisper'] and r['section_star']['s'] is not None:
            close.append(abs(r['section_star']['s'] - r['whisper']['s']))
    med = float(np.median(close)) if close else None

    lines = [
        f'# Где голос: {slug}',
        '',
        'Наблюдение. Времена в `lyrics.json` этот прогон не менял. Черновые `s`/`e` окном не были.',
        'Старый проход — тот, что уже в `align.py`: общий якорь, затем поиск строки в окне.',
        '«Сырое» начало — куда строку поставил этот поиск, даже если порог согласия с якорем её выбросил.',
        'Whisper — large-v3, словные времена, язык задан, VAD выключен, только вокальный стем.',
        'MMS в окне — та же строка, окно ровно вокруг фразы Whisper (±0,4 с).',
        'Секция — один CTC всей секции карты голоса, между словами повторяемая звёздочка (пауза и мелизм).',
        '',
        f'Строк в таблице: {len(rows)}. Сырой проход с оценкой ≥ 0,30: {len(found_raw)}, '
        f'из них порог согласия с якорем выбросил бы: {len(discarded)}. '
        f'Окно покрывает фразу Whisper: {len(covered)}, не покрывает: {len(missed)}. '
        f'MMS в окне Whisper уверен (оценка ≥ 0,30): {len(mms_ok)}. '
        f'Секция со звёздочкой уверена: {len(star_ok)}. '
        f'Медиана |начало секции − начало Whisper|: {"—" if med is None else f"{med:.2f} с"}.',
        '',
        '| строка | карта голоса | окно поиска | якорь | старый проход | whisper | окно его накрыло | атака | MMS в окне whisper | секция со ★ |',
        '|---|---|---|---|---|---|---|---|---|---|',
    ]
    for r in rows:
        w = r['whisper']
        whisper = '—' if w is None else f"{w['s']:.2f}–{w['e']:.2f} ({w['n']}/{w['of']})"
        cover = '—' if r['window_covers_whisper'] is None else ('да' if r['window_covers_whisper'] else 'нет')
        m = r['mms_window']
        mms = '—' if m['s'] is None else f"{m['s']:.2f} / {m['score']:.2f}"
        s = r['section_star']
        star = '—' if s['s'] is None else f"{s['s']:.2f}–{s['e']:.2f} / {s['score']:.2f}"
        if s.get('pad'):
            star += f" (+{s['pad']:.0f} с)"
        old = r['old']
        anc = 'вне, ' if r['anchor_outside'] else ''
        lines.append(
            f"| {r['id']} | {r['map'][0]:.2f}–{r['map'][1]:.2f} | {r['window'][0]:.2f}–{r['window'][1]:.2f} | "
            f"{anc}{r['anchor'][0]:.2f} | {old['status']} сырое {_fmt(old['raw_s'])} "
            f"оценка {old['score']:.2f} согласие {old['agree']:.2f} | {whisper} | {cover} | "
            f"{_fmt(r['attack'])} ({_fmt(r['attack_dt'])}) | {mms} | {star} |"
        )
    lines += ['', 'Текст строк — в `locate.json`. Слова Whisper — в `whisper-words.json`.', '']
    out = ROOT / 'docs' / 'analysis' / slug
    out.mkdir(parents=True, exist_ok=True)
    (out / 'locate.md').write_text('\n'.join(lines), encoding='utf-8')
    (out / 'locate.json').write_text(dump_json({'rows': rows}), encoding='utf-8')
    (out / 'whisper-words.json').write_text(dump_json(whisper_words), encoding='utf-8')
    work = work_dir(slug)
    (work / 'locate.json').write_text(dump_json({'rows': rows}), encoding='utf-8')
    print(f'→ {out / "locate.md"}', flush=True)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    only = None
    if '--lines' in sys.argv:
        only = {x for x in sys.argv[sys.argv.index('--lines') + 1].split(',') if x}
    main(args[0], only)
