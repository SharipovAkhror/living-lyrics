"""Who is wrong when MMS and the second aligner disagree, and whether a borrowed model is usable.

    python3 scripts/pipeline/aligner_review.py --choose <slug> [<slug>…]

Runs after every song has been aligned and before the attack measurement. It reads
work/<slug>/align-report.json and the vocal stem.

On placed lines where the two starts differ by more than 0.10 s, it counts whose
start is closer to a strong attack (height at least 0.7). A gap of 0.01 s is a tie.

The second aligner's shift is the median of (second − MMS) on consonant-initial
words. Lines are split in report order, all words of a line staying in one half.
The shift is estimated on the first half and checked on the second. It is subtracted
only when both halves have at least 8 words, the training interquartile range is at
most 0.08 s, and the two medians differ by at most 0.03 s. A median under 0.02 s is
recorded and not applied. The same test is run for a borrowed Turkish clock on
Azerbaijani. The key is whisperx|<lang> or borrow-<model>|<lang>.

Azerbaijani may adopt the Turkish Common Voice model when, on the subtitle cues, it
is not worse than that model on Turkish: the share within 0.30 s is at least as high
and the median |Δ| is no larger, with at least 8 lines on each side. Latin is measured
with the Italian and Spanish Common Voice models and is not adopted: these recordings
have no Italian or Spanish singing to compare with.

Exit 2 when a song has no stem or no align report. Exit 0 when the table is written,
including when no shift is applied.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

import engines
import qa_sync as Q
from common import ROOT, load_audio, vocal_stem, work_dir

AGREE = 0.10
TIE = 0.01
MIN_WORDS = 8
IQR_MAX = 0.08
HOLD_MAX = 0.03
MIN_OFFSET = 0.02
NATIVE_MIN = 8
STRONG = 0.7


def consonant_initial(roman: str) -> bool:
    letters = [ch for ch in roman if ch.isalpha()]
    return bool(letters) and not Q._vowel_char(letters[0])


def line_is_consonant(words: list[dict]) -> bool:
    for word in words:
        roman = word.get('roman') or ''
        letters = [ch for ch in roman if ch.isalpha()]
        if letters:
            return not Q._vowel_char(letters[0])
    return False


def _median(vals: list[float]) -> float | None:
    if not vals:
        return None
    return float(np.median(vals))


def _iqr(vals: list[float]) -> float | None:
    if len(vals) < 4:
        return None
    return float(np.percentile(vals, 75) - np.percentile(vals, 25))


def _r(x: float | None, nd: int = 4) -> float | None:
    if x is None:
        return None
    return round(float(x), nd)


def _ru(x: float | None, nd: int = 3) -> str:
    if x is None:
        return '—'
    return f'{float(x):.{nd}f}'.replace('.', ',')


def nearer(ctc: float, other: float, peaks: np.ndarray) -> str:
    if len(peaks) == 0:
        return 'no_peak'
    d_mms = float(np.min(np.abs(peaks - ctc)))
    d_other = float(np.min(np.abs(peaks - other)))
    if abs(d_mms - d_other) <= TIE:
        return 'tie'
    return 'mms' if d_mms < d_other else 'second'


def _empty_counts() -> dict:
    return {'n': 0, 'mms': 0, 'second': 0, 'tie': 0, 'no_peak': 0}


def _add(counts: dict, label: str) -> None:
    counts['n'] += 1
    counts[label] += 1


def bias_decision(lines: list[dict], value_of) -> dict:
    """Estimate a shift on the first half of the consonant lines and check it on the second.

    `value_of(word, line)` is the other clock. The applied offset is the word-level
    median on the training half, because a CTC lag is a per-word onset. The line-level
    median (one number per consonant line) is reported beside it.
    """
    cons = [line for line in lines if line_is_consonant(line.get('words') or [])]
    mid = len(cons) // 2
    train_lines, hold_lines = cons[:mid], cons[mid:]

    def word_deltas(group: list[dict]) -> list[float]:
        out = []
        for line in group:
            for word in line.get('words') or []:
                if not consonant_initial(word.get('roman') or '') or word.get('ctc_s') is None:
                    continue
                other = value_of(word, line)
                if other is None:
                    continue
                out.append(float(other) - float(word['ctc_s']))
        return out

    def line_deltas(group: list[dict]) -> list[float]:
        out = []
        for line in group:
            deltas = word_deltas([line])
            if deltas:
                out.append(float(np.median(deltas)))
        return out

    train, hold = word_deltas(train_lines), word_deltas(hold_lines)
    mt, mh = _median(train), _median(hold)
    spread = _iqr(train)
    if len(train) < MIN_WORDS or len(hold) < MIN_WORDS:
        reason, applied, offset = 'too-few-words', False, None
    elif spread is None or spread > IQR_MAX + 1e-12:
        reason, applied, offset = 'wide-spread', False, None
    elif mt is None or mh is None or abs(mt - mh) > HOLD_MAX + 1e-12:
        reason, applied, offset = 'holdout-disagrees', False, None
    elif abs(mt) < MIN_OFFSET:
        reason, applied, offset = 'shift-under-0.02', False, 0.0
    else:
        reason, applied, offset = 'applied', True, float(mt)

    def agree(group: list[dict], off: float) -> tuple[float | None, int, int]:
        num = den = 0
        for line in group:
            for word in line.get('words') or []:
                if not word.get('roman') or word.get('ctc_s') is None:
                    continue
                other = value_of(word, line)
                if other is None:
                    continue
                den += 1
                if abs(float(other) - off - float(word['ctc_s'])) <= AGREE + 1e-12:
                    num += 1
        if den == 0:
            return None, 0, 0
        return num / den, num, den

    probe = 0.0 if mt is None else float(mt)
    before, before_n, before_d = agree(hold_lines, 0.0)
    after, after_n, after_d = agree(hold_lines, probe)
    return {
        'consonant_lines': len(cons),
        'train_lines': len(train_lines),
        'hold_lines': len(hold_lines),
        'train_words': len(train),
        'hold_words': len(hold),
        'median_train': _r(mt),
        'median_hold': _r(mh),
        'line_median_train': _r(_median(line_deltas(train_lines))),
        'line_median_hold': _r(_median(line_deltas(hold_lines))),
        'iqr_train': _r(spread),
        'offset': _r(offset),
        'applied': applied,
        'reason': reason,
        'hold_agree_before': _r(before),
        'hold_agree_before_n': [before_n, before_d],
        'hold_agree_if_train_offset': _r(after),
        'hold_agree_if_train_offset_n': [after_n, after_d],
    }


def cue_stats(deltas: list[float]) -> dict:
    n = len(deltas)
    if n == 0:
        return {'n': 0, 'within_0_30': 0, 'fraction': None, 'median': None}
    within = sum(1 for d in deltas if d <= 0.30 + 1e-9)
    return {
        'n': n,
        'within_0_30': within,
        'fraction': _r(within / n),
        'median': _r(float(np.median(deltas)), 4),
    }


def _borrow_start(line: dict, model_lang: str) -> float | None:
    """Line start: the first lettered word, or nothing if that word has no probe time."""
    for word in line.get('words') or []:
        if not word.get('roman'):
            continue
        borrowed = (word.get('borrow') or {}).get(model_lang)
        if borrowed is None:
            return None
        return float(borrowed)
    return None


def _second_of(word: dict, _line: dict):
    return None if word.get('second_s') is None else float(word['second_s'])


def _borrow_of(model_lang: str):
    def value(word: dict, _line: dict):
        borrowed = (word.get('borrow') or {}).get(model_lang)
        return None if borrowed is None else float(borrowed)
    return value


def _placed(report: dict) -> list[dict]:
    return [line for line in report.get('lines') or [] if line.get('status') == 'good']


def build_payload(slugs: list[str]) -> dict:
    import features as F

    songs = []
    for slug in slugs:
        report_path = work_dir(slug) / 'align-report.json'
        if not report_path.exists():
            raise SystemExit(f'{slug}: нет work/{slug}/align-report.json')
        audio, is_stem = vocal_stem(slug, None)
        if not is_stem:
            raise SystemExit(f'{slug}: нет вокального стема')
        report = json.loads(report_path.read_text(encoding='utf-8'))
        sig = Q.Signals(load_audio(audio, F.SR))
        peaks = Q.onset_peak_times(sig, min_height=STRONG)
        songs.append({'slug': slug, 'report': report, 'peaks': peaks})

    closer_words = _empty_counts()
    closer_lines = _empty_counts()
    by_lang: dict[str, dict] = {}
    by_song: dict[str, dict] = {}
    pooled: dict[str, list[dict]] = {}
    third_by_lang: dict[str, dict] = {}

    for song in songs:
        song_words = _empty_counts()
        song_lines = _empty_counts()
        for line in _placed(song['report']):
            lang = line.get('lang') or '?'
            bucket = by_lang.setdefault(lang, {'words': _empty_counts(), 'lines': _empty_counts()})
            words = line.get('words') or []
            first = next((w for w in words if w.get('roman') and w.get('ctc_s') is not None), None)
            if first is not None and first.get('second_s') is not None and abs(float(first['second_s']) - float(first['ctc_s'])) > AGREE:
                label = nearer(float(first['ctc_s']), float(first['second_s']), song['peaks'])
                for counts in (closer_lines, song_lines, bucket['lines']):
                    _add(counts, label)
            for word in words:
                if not word.get('roman') or word.get('ctc_s') is None:
                    continue
                third_bucket = third_by_lang.setdefault(lang, {'words': 0, 'third': 0, 'within_0_10': 0})
                third_bucket['words'] += 1
                if word.get('third_s') is not None:
                    third_bucket['third'] += 1
                    if abs(float(word['third_s']) - float(word['ctc_s'])) <= AGREE:
                        third_bucket['within_0_10'] += 1
                if word.get('second_s') is None:
                    continue
                if abs(float(word['second_s']) - float(word['ctc_s'])) <= AGREE:
                    continue
                label = nearer(float(word['ctc_s']), float(word['second_s']), song['peaks'])
                for counts in (closer_words, song_words, bucket['words']):
                    _add(counts, label)
            if any(w.get('second_s') is not None for w in words):
                pooled.setdefault(f"whisperx|{lang}", []).append(line)
            if lang == 'az':
                pooled.setdefault('borrow-tr|az', []).append(line)
        by_song[song['slug']] = {'words': song_words, 'lines': song_lines}

    groups = []
    bias: dict[str, float] = {}
    for key, lines in sorted(pooled.items()):
        if key.startswith('borrow-'):
            model_lang = key.split('|', 1)[0].split('-', 1)[1]
            decision = bias_decision(lines, _borrow_of(model_lang))
        else:
            decision = bias_decision(lines, _second_of)
        decision['key'] = key
        groups.append(decision)
        if decision['applied'] and decision['offset'] is not None:
            bias[key] = float(decision['offset'])

    def deltas_for(lang: str, model_lang: str) -> list[float]:
        out = []
        for song in songs:
            for line in song['report'].get('lines') or []:
                if (line.get('lang') or '?') != lang or line.get('cue_start') is None:
                    continue
                start = _borrow_start(line, model_lang)
                if start is None:
                    continue
                out.append(abs(start - float(line['cue_start'])))
        return out

    cards = {
        'tr': engines.BORROW_MODELS['tr'],
        'it': engines.BORROW_MODELS['it'],
        'es': engines.BORROW_MODELS['es'],
    }
    native = cue_stats(deltas_for('tr', 'tr'))
    az = cue_stats(deltas_for('az', 'tr'))
    la_it = cue_stats(deltas_for('la', 'it'))
    la_es = cue_stats(deltas_for('la', 'es'))
    adopt: dict[str, str] = {}
    az_reason = 'not-adopted'
    if native['n'] < NATIVE_MIN:
        az_reason = 'turkish-baseline-under-8'
    elif az['n'] < NATIVE_MIN:
        az_reason = 'azerbaijani-under-8'
    elif az['fraction'] is None or native['fraction'] is None or az['fraction'] + 1e-12 < native['fraction']:
        az_reason = 'worse-fraction'
    elif az['median'] is None or native['median'] is None or az['median'] > native['median'] + 1e-12:
        az_reason = 'worse-median'
    else:
        adopt['az'] = 'tr'
        az_reason = 'not-worse-on-both'
    if 'az' not in adopt:
        bias.pop('borrow-tr|az', None)

    borrow = {
        'letters': {
            'az-tr': 'ə→e, x→h, q→g. q в азербайджанском — [g], не [k].',
            'la-it': 'æ/œ→e, y/j→i, k→c, w→v, x→s.',
            'la-es': 'æ/œ→e, k→c, w→u, y→i. Латинское y — гласная.',
        },
        'tr_native': {**native, 'model': cards['tr']['id'], 'license': cards['tr']['license'], 'card': cards['tr']['card']},
        'az_tr': {**az, 'model': cards['tr']['id'], 'license': cards['tr']['license'], 'card': cards['tr']['card'], 'decision': az_reason},
        'la_it': {**la_it, 'model': cards['it']['id'], 'license': cards['it']['license'], 'card': cards['it']['card'],
                  'decision': 'not-adopted-no-native-singing'},
        'la_es': {**la_es, 'model': cards['es']['id'], 'license': cards['es']['license'], 'card': cards['es']['card'],
                  'decision': 'not-adopted-no-native-singing'},
    }
    return {
        'songs': list(slugs),
        'strong_height': STRONG,
        'agree_tol': AGREE,
        'closer': {'words': closer_words, 'lines': closer_lines, 'by_lang': by_lang, 'by_song': by_song},
        'third': third_by_lang,
        'groups': groups,
        'bias': bias,
        'adopt': adopt,
        'borrow': borrow,
    }


def _counts_row(name: str, kind: str, counts: dict) -> str:
    return (f"| {name} | {kind} | {counts['n']} | {counts['mms']} | {counts['second']} | "
            f"{counts['tie']} | {counts['no_peak']} |")


def render_md(payload: dict) -> str:
    lines = [
        '# Расхождения выравнивателей',
        '',
        'Поставленные строки, вокальный стем. Сильная атака — пик не ниже 0,7. '
        'Ничья — оба начала не дальше 0,01 с от одной и той же близости к пику. '
        'Сдвиг второго выравнивателя — медиана (его начало минус начало MMS) по словам на согласную. '
        'Строки делятся пополам в порядке отчёта: сдвиг считается на первой половине и проверяется на второй. '
        'Он вычитается, только если в каждой половине не меньше 8 таких слов, межквартильный размах первой не больше 0,08 с, '
        'а медианы половин расходятся не больше чем на 0,03 с. Медиана меньше 0,02 с не вычитается.',
        '',
        '## Кто ближе к сильной атаке',
        '',
        'Строка — первое слово с буквами, если оно разошлось с MMS больше чем на 0,10 с. '
        'Слово — каждое такое слово.',
        '',
        '| где | что | n | ближе MMS | ближе второй | ничья | пика нет |',
        '|---|---|---:|---:|---:|---:|---:|',
    ]
    closer = payload['closer']
    lines.append(_counts_row('все', 'строки', closer['lines']))
    lines.append(_counts_row('все', 'слова', closer['words']))
    for song, bucket in sorted((closer.get('by_song') or {}).items()):
        lines.append(_counts_row(song, 'строки', bucket['lines']))
        lines.append(_counts_row(song, 'слова', bucket['words']))
    for lang, bucket in sorted((closer.get('by_lang') or {}).items()):
        lines.append(_counts_row(lang, 'строки', bucket['lines']))
        lines.append(_counts_row(lang, 'слова', bucket['words']))
    lines += [
        '',
        '## Сдвиг модели',
        '',
        'Ключ `whisperx|<язык>` — второй выравниватель этой песни. `borrow-tr|az` — турецкая модель на азербайджанском. '
        'Согласие на второй половине — доля слов с буквами, у которых |второе − сдвиг − MMS| ≤ 0,10 с. '
        '«Если вычесть» показано и тогда, когда сдвиг не применён.',
        '',
        '| ключ | строк | слов, 1-я | слов, 2-я | медиана 1-й | медиана 2-й | размах | сдвиг | применён | согласие было | если вычесть |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|',
    ]
    for group in payload.get('groups') or []:
        lines.append(
            f"| {group['key']} | {group['consonant_lines']} | {group['train_words']} | {group['hold_words']} | "
            f"{_ru(group.get('median_train'), 3)} | {_ru(group.get('median_hold'), 3)} | {_ru(group.get('iqr_train'), 3)} | "
            f"{_ru(group.get('offset'), 3)} | {'да' if group.get('applied') else 'нет'} ({group.get('reason')}) | "
            f"{_ru(group.get('hold_agree_before'), 3)} | {_ru(group.get('hold_agree_if_train_offset'), 3)} |"
        )
    if not payload.get('groups'):
        lines.append('| — | 0 | 0 | 0 | — | — | — | — | нет | — | — |')
    third = payload.get('third') or {}
    lines += [
        '',
        '## Третий свидетель на поставленных словах',
        '',
        'stable-ts, известный текст, модель small. Согласие — |его начало − MMS| ≤ 0,10 с, без требования атаки. '
        'Это не случайный проход и не выбранное правило.',
        '',
        '| язык | слов | есть время | в пределах 0,10 с |',
        '|---|---:|---:|---:|',
    ]
    for lang, bucket in sorted(third.items()):
        lines.append(f"| {lang} | {bucket['words']} | {bucket['third']} | {bucket['within_0_10']} |")
    if not third:
        lines.append('| — | 0 | 0 | 0 |')
    borrow = payload['borrow']
    lines += [
        '',
        '## Чужие модели на репликах',
        '',
        'Окно — реплика, не фраза, которую уже поставил MMS. В знаменателе строки, где модель вернула начало первого слова с буквами. '
        'Азербайджанский берётся, только если он не хуже турецкого на обеих цифрах и турецких строк не меньше 8. '
        'Латынь не берётся: итальянского и испанского пения в этих записях нет, родной порог не из чего измерить.',
        '',
        f"Буквы. Азербайджанский в турецкую модель: {borrow['letters']['az-tr']} "
        f"Латынь в итальянскую: {borrow['letters']['la-it']} Латынь в испанскую: {borrow['letters']['la-es']}",
        '',
        '| проба | модель | лицензия | строк | в 0,30 с | доля | медиана |Δ| | решение |',
        '|---|---|---|---:|---:|---:|---:|---|',
    ]
    for key, label in (('tr_native', 'турецкий, своя модель'), ('az_tr', 'азербайджанский, турецкая'),
                       ('la_it', 'латынь, итальянская'), ('la_es', 'латынь, испанская')):
        row = borrow[key]
        lines.append(
            f"| {label} | `{row['model']}` | {row['license']} | {row['n']} | {row['within_0_30']} | "
            f"{_ru(row.get('fraction'), 3)} | {_ru(row.get('median'), 3)} | {row.get('decision') or 'база'} |"
        )
    adopted = payload.get('adopt') or {}
    lines += [
        '',
        'Принято: ' + (', '.join(f'{lang} → {model}' for lang, model in sorted(adopted.items())) if adopted else 'ничего') + '.',
        'Вычтенные сдвиги: ' + (', '.join(f'{key} {_ru(val, 3)} с' for key, val in sorted((payload.get('bias') or {}).items())) or 'нет') + '.',
        '',
    ]
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--choose', action='store_true')
    ap.add_argument('slugs', nargs='+')
    args = ap.parse_args(argv)
    if not args.choose:
        ap.error('нужен --choose')
    payload = build_payload(args.slugs)
    out_dir = ROOT / 'docs' / 'analysis' / 'bench'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'aligner-review.json').write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (out_dir / 'aligner-review.md').write_text(render_md(payload), encoding='utf-8')
    print(f"сдвиги: {payload['bias'] or 'нет'}; чужие модели: {payload['adopt'] or 'нет'}")
    missing = [slug for slug in args.slugs if slug not in (payload.get('songs') or [])]
    if missing:
        print('нет песен: ' + ', '.join(missing))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
