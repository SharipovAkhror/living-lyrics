"""Choose the largest stable-ts Whisper model that finishes, and describe refutations.

Nothing here loads a model. align.py runs each model and passes the clock in.
The ladder always runs small and medium. large-v3-turbo and large-v3 run only
when a conservative estimate still fits the remaining budget. The largest model
that finished is the witness. Agreement numbers are the report, not the choice.

A refuted word is described by where it sits and whether both witnesses moved
the same way. That description does not change the refutation cutoffs.
"""
from __future__ import annotations

import time

MODELS = ('small', 'medium', 'large-v3-turbo', 'large-v3')
BUDGET_S = 70 * 60
UNPLACED_BUDGET_S = 15 * 60
# Encoder-bound: turbo is not much cheaper than large-v3. Factors are against medium.
FACTOR_AFTER_MEDIUM = {'large-v3-turbo': 2.2, 'large-v3': 2.8}
TURBO_TO_LARGE = 1.35
ESTIMATE_SLACK_S = 60.0
DEADLINE_FACTOR = 1.4
DEADLINE_GUARD_S = 20.0
AGREE_S = 0.10
CUE_NEAR_S = 0.30
MIN_WORDS = 8
WORKING_SHARE = 0.5

_VOWELS = set('aeiouyæøəɨüöáéíóúàèìòùâêîôûäëïöüýÿ')


def should_start(estimate_s: float | None, remaining_s: float) -> bool:
    """True when the estimate plus a minute still fits in what is left."""
    if estimate_s is None:
        return False
    return float(estimate_s) + ESTIMATE_SLACK_S <= float(remaining_s) + 1e-9


def estimate_for(name: str, medium_s: float | None, turbo_s: float | None) -> float | None:
    """Seconds the next model is expected to take, from a model that finished."""
    if name == 'large-v3' and turbo_s is not None:
        return float(turbo_s) * TURBO_TO_LARGE
    factor = FACTOR_AFTER_MEDIUM.get(name)
    if factor is None or medium_s is None:
        return None
    return float(medium_s) * factor


def ladder(run_model, budget_s: float = BUDGET_S, clock=None) -> tuple[str | None, list[dict]]:
    """Run models in size order. Return the largest name that finished, and every row.

    `run_model(name, deadline) -> info`. `deadline` is None or an absolute time on
    `clock`. small has no deadline. medium's deadline is the budget. A larger model
    whose estimate does not fit is recorded with reason `budget` and the next one
    is still considered. An unfinished model stops the ladder: a bigger one is not
    started. The caller discards a partial result; this function only reads `complete`.
    """
    clock = clock or time.monotonic
    t0 = float(clock())
    rows: list[dict] = []
    completed: list[str] = []
    medium_s = None
    turbo_s = None

    def remaining() -> float:
        return float(budget_s) - (float(clock()) - t0)

    def take(name: str, deadline) -> dict:
        info = dict(run_model(name, deadline) or {})
        info.setdefault('model', name)
        info.setdefault('ran', bool(info.get('complete')))
        info.setdefault('complete', False)
        info.setdefault('elapsed_s', 0.0)
        info.setdefault('reason', None)
        rows.append(info)
        if info.get('complete'):
            completed.append(name)
        return info

    take('small', None)
    medium = take('medium', t0 + float(budget_s))
    if not medium.get('complete'):
        return (completed[-1] if completed else None), rows
    medium_s = float(medium.get('elapsed_s') or 0.0)

    for name in ('large-v3-turbo', 'large-v3'):
        est = estimate_for(name, medium_s, turbo_s)
        left = remaining()
        if not should_start(est, left):
            rows.append({
                'model': name, 'ran': False, 'complete': False, 'elapsed_s': 0.0,
                'estimate_s': None if est is None else round(float(est), 1),
                'reason': 'budget', 'lines': 0, 'placed': 0, 'error': None, 'stopped': False,
            })
            continue
        slice_s = min(float(est) * DEADLINE_FACTOR, max(0.0, left - DEADLINE_GUARD_S))
        if slice_s < 1.0:
            rows.append({
                'model': name, 'ran': False, 'complete': False, 'elapsed_s': 0.0,
                'estimate_s': round(float(est), 1), 'reason': 'budget',
                'lines': 0, 'placed': 0, 'error': None, 'stopped': False,
            })
            continue
        info = take(name, float(clock()) + slice_s)
        info['estimate_s'] = round(float(est), 1)
        if not info.get('complete'):
            break
        if name == 'large-v3-turbo':
            turbo_s = float(info.get('elapsed_s') or 0.0)
    return (completed[-1] if completed else None), rows


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(float(v) for v in values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _reading(words: int, within: int, median: float | None) -> str:
    """A label for the table. It does not choose the model or the proof rule."""
    if words < MIN_WORDS or median is None:
        return 'мало слов'
    share = within / words if words else 0.0
    if share + 1e-12 >= WORKING_SHARE and median <= AGREE_S + 1e-12:
        return 'рабочий'
    return 'не рабочий'


def agreement(lines: list[dict]) -> dict:
    """Word and cue agreement of one finished model, by language.

    Each line is `{lang, deltas, cue_delta}`. `deltas` are |stable − MMS| on
    lettered words where both clocks exist. `cue_delta` is |first stable start − cue|
    or None. Within 0.10 s and within 0.30 s are rounded to 3 decimals first.
    """
    buckets: dict[str, dict] = {}
    for line in lines:
        lang = str(line.get('lang') or '?')
        bucket = buckets.setdefault(lang, {'deltas': [], 'cues': [], 'lines': 0})
        bucket['lines'] += 1
        for delta in line.get('deltas') or []:
            bucket['deltas'].append(float(delta))
        if line.get('cue_delta') is not None:
            bucket['cues'].append(float(line['cue_delta']))
    by_lang = {}
    for lang in sorted(buckets):
        bucket = buckets[lang]
        deltas = bucket['deltas']
        cues = bucket['cues']
        within = sum(1 for delta in deltas if round(delta, 3) <= AGREE_S)
        cue_within = sum(1 for delta in cues if round(delta, 3) <= CUE_NEAR_S)
        median = _median(deltas)
        cue_median = _median(cues)
        words = len(deltas)
        cue_n = len(cues)
        by_lang[lang] = {
            'words': words,
            'within': within,
            'share': None if words == 0 else round(within / words, 4),
            'median': None if median is None else round(median, 3),
            'lines': bucket['lines'],
            'cue_n': cue_n,
            'cue_within': cue_within,
            'cue_share': None if cue_n == 0 else round(cue_within / cue_n, 4),
            'cue_median': None if cue_median is None else round(cue_median, 3),
            'reading': _reading(words, within, median),
        }
    return {'by_lang': by_lang}


def _letters(roman: str | None) -> str:
    return ''.join(ch for ch in (roman or '').lower() if ch.isalpha())


def _vowel(ch: str) -> bool:
    return ch in _VOWELS


def after_kind(span, roman: str | None) -> str:
    """What the previous lettered word was, for a refuted word that follows it."""
    if span is None:
        return 'нет'
    span = float(span)
    letters = _letters(roman)
    all_vowel = bool(letters) and all(_vowel(ch) for ch in letters)
    if span >= 0.80 or (all_vowel and span >= 0.40):
        return 'мелизм'
    if letters and _vowel(letters[0]) and span >= 0.40:
        return 'долгая гласная'
    return 'нет'


def position_kind(index, n) -> str:
    try:
        index = int(index)
        n = int(n)
    except (TypeError, ValueError):
        return '—'
    if n <= 1:
        return 'единственное'
    if index <= 0:
        return 'первое'
    if index >= n - 1:
        return 'последнее'
    return 'середина'


def shared_shift(d2, d3) -> float | None:
    """Mean of the two witness-minus-placer deltas when they share a sign and 0.10 s.

    Positive means both witnesses are later than the placer. Zero or opposite
    signs are not a shared shift.
    """
    if d2 is None or d3 is None:
        return None
    a, b = float(d2), float(d3)
    if a == 0.0 or b == 0.0 or (a > 0) != (b > 0):
        return None
    if abs(a - b) > 0.10 + 1e-9:
        return None
    return round((a + b) / 2.0, 3)


def side_label(why: str | None, second_kind, third_kind, has_second: bool, has_third: bool) -> str:
    if why == 'witnesses-agree-elsewhere':
        left = second_kind or 'второй'
        right = third_kind or 'stable-ts'
        return f'оба ({left}, {right})'
    if has_second and not has_third:
        return str(second_kind or 'второй')
    if has_third and not has_second:
        return str(third_kind or 'stable-ts')
    return '—'


def annotate(row: dict) -> dict:
    """Add position, what came before, and the shared shift. The cutoffs stay put."""
    out = dict(row)
    out['position'] = position_kind(row.get('i'), row.get('n'))
    out['after'] = after_kind(row.get('prev_span'), row.get('prev_roman'))
    out['shared'] = shared_shift(row.get('d2'), row.get('d3'))
    out['side'] = side_label(
        row.get('why'), row.get('second_kind'), row.get('third_kind'),
        row.get('second') is not None, row.get('third') is not None)
    return out


def conclusion(rows: list[dict]) -> str:
    """One sentence. A shared later shift after a melisma is reported; the rule is not changed.

    The bar is 60 % of both-witness refutations sharing a later shift, and 40 %
    of those sitting after a melisma or a long vowel. Integer comparison.
    """
    both = [row for row in rows if row.get('why') == 'witnesses-agree-elsewhere']
    if not both:
        return 'Общей причины по этим строкам не видно.'
    later = [row for row in both if row.get('shared') is not None and float(row['shared']) > 0]
    if len(later) * 1000 < len(both) * 600:
        return 'Общей причины по этим строкам не видно.'
    after = [row for row in later if row.get('after') in ('мелизм', 'долгая гласная')]
    if len(after) * 1000 < len(later) * 400:
        return 'Общей причины по этим строкам не видно.'
    return (
        'Оба речевых свидетеля ставят начало слова после мелизма предыдущего: '
        f'у {len(later)} из {len(both)} опровержений, где свидетели согласны, сдвиг позже постановщика, '
        f'и у {len(after)} из этих {len(later)} слово стоит после мелизма или долгой гласной.'
    )


def _ru(value, nd: int = 3) -> str:
    if value is None:
        return '—'
    return f'{float(value):.{nd}f}'.replace('.', ',')


def clock(value) -> str:
    """m:ss,xx from seconds, for a listening table."""
    if value is None:
        return '—'
    t = max(0.0, float(value))
    minutes = int(t // 60)
    seconds = t - 60 * minutes
    return f'{minutes}:{seconds:05.2f}'.replace('.', ',')


_WHY_RU = {
    'witnesses-agree-elsewhere': 'оба свидетеля в стороне',
    'witness-attack': 'один свидетель с атакой',
}


def render_refutation(rows: list[dict], both_far: float | None = None, only_far: float | None = None) -> str:
    """Listening table. Cutoffs are printed, not chosen here."""
    text = conclusion(rows)
    both_n = sum(1 for row in rows if row.get('why') == 'witnesses-agree-elsewhere')
    attack_n = sum(1 for row in rows if row.get('why') == 'witness-attack')
    lines = [
        '# Опровергнутые слова',
        '',
        'Слово опровергнуто по прежним порогам: оба свидетеля согласны не дальше 0,10 с и оба дальше '
        f'{_ru(both_far, 2)} с от постановщика, либо единственный свидетель дальше {_ru(only_far, 2)} с '
        'и сильная атака у него, а не у постановщика. Этот список пороги не меняет.',
        '',
        text,
        '',
        f'Опровергнуто {len(rows)}: оба свидетеля в стороне — {both_n}, единственный с атакой — {attack_n}.',
        '',
        '| песня | строка | время | слово | место | после | почему | кто в стороне | постановщик | второй, с | stable-ts, с | общий сдвиг |',
        '|---|---|---:|---|---|---|---|---|---|---:|---:|---:|',
    ]
    if not rows:
        lines.append('| — | — | — | — | — | — | — | — | — | — | — | — |')
    for row in rows:
        lines.append(
            f"| {row.get('song') or '—'} | {row.get('id') or '—'} | {clock(row.get('time'))} | "
            f"{row.get('w') or '—'} | {row.get('position') or '—'} | {row.get('after') or '—'} | "
            f"{_WHY_RU.get(row.get('why'), row.get('why') or '—')} | {row.get('side') or '—'} | "
            f"{row.get('placed_by') or '—'} | {_ru(row.get('second'), 3)} | {_ru(row.get('third'), 3)} | "
            f"{_ru(row.get('shared'), 3)} |"
        )
    lines.append('')
    return '\n'.join(lines)


def _lang_table(stats: dict | None) -> list[str]:
    by = (stats or {}).get('by_lang') or {}
    lines = [
        '| язык | слов | ≤ 0,10 | доля | медиана | строк | реплик | реплика ≤ 0,30 | медиана реплики | чтение |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ]
    if not by:
        lines.append('| — | 0 | 0 | — | — | 0 | 0 | 0 | — | — |')
        return lines
    for lang in sorted(by):
        row = by[lang]
        lines.append(
            f"| {lang} | {row.get('words', 0)} | {row.get('within', 0)} | {_ru(row.get('share'), 3)} | "
            f"{_ru(row.get('median'), 3)} | {row.get('lines', 0)} | {row.get('cue_n', 0)} | "
            f"{row.get('cue_within', 0)} | {_ru(row.get('cue_median'), 3)} | {row.get('reading') or '—'} |"
        )
    return lines


def render_witness(songs: list[dict]) -> str:
    """Model comparison. `songs` items are `{slug, model, rows}` from the align summary."""
    lines = [
        '# Свидетель Whisper',
        '',
        'stable-ts выравнивает известный текст. На раннере сравниваются модели Whisper `small`, `medium`, '
        '`large-v3-turbo` и `large-v3`, только по окнам строк, которые к этому моменту уже поставил MMS '
        '(первое окно, другое окно или ft). Берётся наибольшая модель, которая целиком уложилась в 70 минут. '
        'Согласие — доля слов, где |stable-ts − MMS| округляется не дальше 0,10 с. Реплика — |начало строки '
        'stable-ts − реплика|. «Рабочий» значит не меньше 8 слов, доля не ниже половины и медиана не выше 0,10 с. '
        'Это чтение таблицы. Модель оно не выбирает, и пределы 15 % и 5 % из-за него не двигаются.',
        '',
    ]
    focus = ('az', 'la', 'de')
    for song in songs:
        lines.append(f"## {song.get('slug')}")
        lines.append('')
        if song.get('missing'):
            lines.append('Отчёта выравнивания нет.')
            lines.append('')
            continue
        chosen = song.get('model') or '—'
        lines.append(f'Выбрана модель `{chosen}`.')
        lines.append('')
        lines.append('| модель | целиком | секунд | оценка | строк | поставлено | причина |')
        lines.append('|---|---|---:|---:|---:|---:|---|')
        rows = song.get('rows') or []
        if not rows:
            lines.append('| — | нет | — | — | 0 | 0 | нет замера |')
        for row in rows:
            reason = row.get('reason') or row.get('error') or ''
            if row.get('stopped') and not reason:
                reason = 'время'
            lines.append(
                f"| {row.get('model')} | {'да' if row.get('complete') else 'нет'} | "
                f"{_ru(row.get('elapsed_s'), 1)} | {_ru(row.get('estimate_s'), 1)} | "
                f"{row.get('lines', 0)} | {row.get('placed', 0)} | {reason or '—'} |"
            )
        lines.append('')
        for row in rows:
            if not row.get('complete'):
                continue
            lines.append(f"### {row.get('model')}")
            lines.append('')
            lines.append('Согласие с постановщиком MMS (первое окно, другое окно или ft).')
            lines.append('')
            lines.extend(_lang_table(row.get('stats')))
            lines.append('')
            extra = row.get('unplaced') or {}
            if extra:
                lines.append(
                    f"Та же модель на ещё не поставленных строках: целиком {'да' if extra.get('complete') else 'нет'}, "
                    f"{_ru(extra.get('elapsed_s'), 1)} с, поставлено {extra.get('placed', 0)} из {extra.get('lines', 0)}."
                    + (f" Причина: {extra.get('error') or extra.get('reason')}." if (extra.get('error') or extra.get('reason')) and not extra.get('complete') else '')
                )
                lines.append('')
        chosen_row = next((row for row in rows if row.get('model') == song.get('model') and row.get('complete')), None)
        stats = (chosen_row or {}).get('stats') or {}
        bits = []
        for lang in focus:
            item = (stats.get('by_lang') or {}).get(lang)
            if not item:
                bits.append(f'{lang}: нет слов')
            else:
                bits.append(
                    f"{lang}: {item.get('reading')}, {item.get('within', 0)}/{item.get('words', 0)}, "
                    f"медиана {_ru(item.get('median'), 3)} с"
                )
        lines.append('Азербайджанский, латынь и немецкий на выбранной модели: ' + '; '.join(bits) + '.')
        lines.append('')
    lines.append('')
    return '\n'.join(lines)
