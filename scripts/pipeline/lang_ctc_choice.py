"""Admit a language CTC clock, a weak-pair agreement, and a 1-vs-2 overrule.

The clocks are already on the placed words (`langs`). This module only
decides which (song, language) may use them. Thresholds do not move:
word chance at most 15 %, line chance at most 5 %, agreement 0.10 s,
and at least 30 placed words for a language's own role. A short language
gets no role. Its clocks may still support an overrule, because that
member's line chance is the guard.

The pair stamp does not set `lang_role`. A language that already passes
on its own would hide the pair's chance. The overrule flag does not move
the attack test: it can only clear a single-clock refutation.
"""
from __future__ import annotations

import attack_chance as A
import lang_ctc
import qa_sync as Q

PHONE_ORDER = ('xlsr-53-espeak', 'lv-60-espeak')


def admits(chance: float | None, n: int, min_words: int = A.MIN_WORDS, limit: float = A.LIMIT) -> bool:
    """True when a slice is long enough and its shifted-label chance is inside the cap."""
    if int(n) < int(min_words) or chance is None:
        return False
    return float(chance) <= float(limit) + 1e-12


def _mode(modes: dict, song: str, lang: str) -> str:
    mode = (modes or {}).get((song, lang)) or (modes or {}).get((song, '*'))
    return mode if mode in ('one', 'two') else 'two'


def _rule(mode: str) -> dict:
    rules = A.witness_rules()
    return dict(rules[0] if mode == 'one' else rules[1])


def _records(song: dict, lang: str) -> list[dict]:
    out = []
    for line in song.get('lines') or []:
        if (line.get('lang') or '?') != lang:
            continue
        out.extend(line.get('words') or [])
    return out


def _models_of(records: list[dict]) -> list[str]:
    names = []
    for rec in records:
        for name, clock in (rec.get('langs') or {}).items():
            if clock is None or name in names:
                continue
            names.append(name)
    return names


def _phone_name(records: list[dict]) -> str | None:
    counts = {name: 0 for name in PHONE_ORDER}
    for rec in records:
        table = rec.get('phones') or {}
        for name in PHONE_ORDER:
            if table.get(name) is not None:
                counts[name] += 1
    best = None
    for name in PHONE_ORDER:
        if counts[name] <= 0:
            continue
        if best is None or counts[name] > counts[best]:
            best = name
    return best


def _agreement(records: list[dict], model: str) -> int:
    n = 0
    for rec in records:
        clock = (rec.get('langs') or {}).get(model)
        if clock is None:
            continue
        if abs(float(clock) - float(rec['t'])) <= A.SECOND_TOL + 1e-12:
            n += 1
    return n


def _stamp_lang(records: list[dict], model: str) -> list[dict]:
    out = []
    for rec in records:
        item = dict(rec)
        clock = (rec.get('langs') or {}).get(model)
        item['lang_clock'] = None if clock is None else float(clock)
        item['lang_role'] = 'or'
        item['pair'] = False
        out.append(item)
    return out


def _stamp_pair(records: list[dict], model: str, phone: str) -> tuple[list[dict], int]:
    out = []
    both = 0
    for rec in records:
        item = dict(rec)
        lang = (rec.get('langs') or {}).get(model)
        phon = (rec.get('phones') or {}).get(phone)
        item['lang_role'] = 'off'
        item['pair'] = False
        item['lang_clock'] = None if lang is None else float(lang)
        item.pop('phoneme_role', None)
        if lang is not None and phon is not None:
            item['phoneme'] = float(phon)
            item['pair'] = True
            both += 1
        out.append(item)
    return out, both


def _chance(records: list[dict], peaks, mode: str) -> float | None:
    if not records:
        return None
    return A._slice_chance(records, peaks, _rule(mode))


def _key(song: str, lang: str) -> str:
    return f'{song}|{lang}'


def plan(per_song: list[dict], modes: dict) -> dict:
    """Per-language word chance. Nothing is stamped on the live words."""
    lang_rows = []
    pair_rows = []
    lang_admitted = []
    pair_admitted = []
    lang_of = {}
    pair_phone = {}
    for song in per_song:
        peaks = song['sets'][(A.WITNESS_HEIGHT, False)]
        langs = sorted({(line.get('lang') or '?') for line in song.get('lines') or []})
        for lang in langs:
            recs = _records(song, lang)
            n = len(recs)
            models = _models_of(recs)
            mode = _mode(modes, song['slug'], lang)
            if not models:
                why = 'часов нет'
                if n < A.MIN_WORDS:
                    why = 'короче 30 слов, роль не дана'
                lang_rows.append({
                    'song': song['slug'], 'lang': lang, 'words': n, 'model': None,
                    'agreement': 0, 'word_chance': None, 'admitted': False, 'why': why,
                })
                continue
            best = None
            for model in models:
                agree = _agreement(recs, model)
                chance = _chance(_stamp_lang(recs, model), peaks, mode)
                rank = (agree, -(chance if chance is not None else 2.0), model)
                if best is None or rank > best[0]:
                    best = (rank, model, agree, chance)
            model, agree, chance = best[1], best[2], best[3]
            lang_of[_key(song['slug'], lang)] = model
            admitted = admits(chance, n)
            if n < A.MIN_WORDS:
                why = 'короче 30 слов, роль не дана'
            elif chance is None:
                why = 'проход слова не посчитан'
            elif not admitted:
                why = 'проход слова выше 15 %'
            else:
                why = 'допущено'
            row = {
                'song': song['slug'], 'lang': lang, 'words': n, 'model': model,
                'agreement': agree, 'word_chance': chance, 'admitted': admitted, 'why': why,
            }
            lang_rows.append(row)
            if admitted:
                lang_admitted.append(row)
            phone = _phone_name(recs)
            if phone is None:
                pair_rows.append({
                    'song': song['slug'], 'lang': lang, 'words': n, 'model': model,
                    'phone': None, 'both': 0, 'word_chance': None, 'admitted': False,
                    'why': 'нет фонемных часов',
                })
                continue
            stamped, both = _stamp_pair(recs, model, phone)
            pair_chance = _chance(stamped, peaks, mode) if both else None
            pair_ok = bool(both) and admits(pair_chance, n)
            if n < A.MIN_WORDS:
                pair_why = 'короче 30 слов, роль не дана'
            elif not both:
                pair_why = 'нет пары часов'
            elif pair_chance is None:
                pair_why = 'проход слова не посчитан'
            elif not pair_ok:
                pair_why = 'проход слова выше 15 %'
            else:
                pair_why = 'допущено'
            pair_row = {
                'song': song['slug'], 'lang': lang, 'words': n, 'model': model,
                'phone': phone, 'both': both, 'word_chance': pair_chance,
                'admitted': pair_ok, 'why': pair_why,
            }
            pair_rows.append(pair_row)
            pair_phone[_key(song['slug'], lang)] = phone
            if pair_ok:
                pair_admitted.append(pair_row)
    return {
        'pairs': lang_rows,
        'pair_rows': pair_rows,
        'lang_admitted': lang_admitted,
        'pair_admitted': pair_admitted,
        'lang_of': lang_of,
        'pair_phone': pair_phone,
        'absent': [dict(row) for row in lang_ctc.ABSENT],
        'mms_adapters': lang_ctc.MMS_REJECTION,
        'error': None,
    }


def _preferred_phone(word: dict, phone: str | None) -> float | None:
    table = word.get('phones') or {}
    if phone and table.get(phone) is not None:
        return float(table[phone])
    for name in PHONE_ORDER:
        if table.get(name) is not None:
            return float(table[name])
    return None


def _preferred_lang(word: dict, model: str | None) -> float | None:
    table = word.get('langs') or {}
    if model and table.get(model) is not None:
        return float(table[model])
    for _name, clock in table.items():
        if clock is not None:
            return float(clock)
    return None


def apply_lang(per_song: list[dict], admitted: list[dict]) -> int:
    """Role `or` only. A missing clock stays missing and does not prove the word."""
    want = {(row['song'], row['lang']): row['model'] for row in admitted}
    n = 0
    for song in per_song:
        for line in song.get('lines') or []:
            model = want.get((song.get('slug'), line.get('lang') or '?'))
            if not model:
                continue
            for word in line.get('words') or []:
                clock = _preferred_lang(word, model)
                if clock is None:
                    continue
                word['lang_clock'] = clock
                word['lang_role'] = 'or'
                n += 1
    return n


def apply_pair(per_song: list[dict], admitted: list[dict]) -> int:
    """Both clocks, and no language role. The pair must earn the word by itself."""
    want = {(row['song'], row['lang']): row for row in admitted}
    n = 0
    for song in per_song:
        for line in song.get('lines') or []:
            row = want.get((song.get('slug'), line.get('lang') or '?'))
            if not row:
                continue
            for word in line.get('words') or []:
                lang = _preferred_lang(word, row.get('model'))
                phone = _preferred_phone(word, row.get('phone'))
                if lang is None or phone is None:
                    continue
                word['lang_clock'] = lang
                if word.get('phoneme') is None:
                    word['phoneme'] = phone
                    word['_lang_ctc_phoneme'] = True
                word['pair'] = True
                word.pop('lang_role', None)
                n += 1
    return n


def _probe_word(word: dict, song: str, lang: str) -> dict:
    return {
        'ctc_s': float(word['t']),
        'second_s': word.get('second'),
        'third_s': word.get('third'),
        'second_kind': word.get('second_kind') or 'whisperx',
        'third_kind': word.get('third_kind') or 'stable-ts',
        'phoneme_s': word.get('phoneme'),
        'lang_s': word.get('lang_clock'),
        'song': song,
        'lang': lang,
    }


def apply_overrule(per_song: list[dict], report: dict, refute: dict | None) -> int:
    """Copy measured clocks and flag a word only when two supporters already agree.

    The flag is the switch. `word_refuted` still recomputes the geometry on
    the shifted label, so a flag earned at the true time does not survive a
    shift whose clocks are no longer near that label.
    """
    lang_of = (report or {}).get('lang_of') or {}
    pair_phone = (report or {}).get('pair_phone') or {}
    n = 0
    for song in per_song:
        slug = song.get('slug') or ''
        for line in song.get('lines') or []:
            lang = line.get('lang') or '?'
            model = lang_of.get(_key(slug, lang))
            phone_name = pair_phone.get(_key(slug, lang))
            for word in line.get('words') or []:
                phone = _preferred_phone(word, phone_name)
                lang_clock = _preferred_lang(word, model)
                if phone is not None and word.get('phoneme') is None:
                    word['phoneme'] = phone
                    word['_lang_ctc_phoneme'] = True
                if lang_clock is not None:
                    word['lang_clock'] = lang_clock
                probe = _probe_word(word, slug, lang)
                ignored = Q._refuter_ignored(probe, refute or {})
                if Q.overrule_ready(probe, float(word['t']), A.SECOND_TOL, ignored):
                    word['overrule'] = True
                    n += 1
    return n


def clear(per_song: list[dict]) -> None:
    """Drop every stamp this module wrote. A phoneme role it did not set stays."""
    for song in per_song:
        for line in (song.get('all_lines') or song.get('lines') or []):
            for word in line.get('words') or []:
                word.pop('lang_clock', None)
                word.pop('lang_role', None)
                word.pop('pair', None)
                word.pop('overrule', None)
                if word.pop('_lang_ctc_phoneme', None):
                    word.pop('phoneme', None)


def render_md(report: dict | None) -> str:
    """The bench note. Numbers are the ones this run measured."""
    report = report or {}
    lines = [
        '# Языковой CTC-свидетель',
        '',
        'Отдельная wav2vec2 на язык ставит известные слова в окне строки. '
        'Это не MMS и не второй выравниватель WhisperX. Часы слово не опровергают '
        'и строку не ставят. Пара песня/язык допускается, только если поставленных '
        'слов не меньше 30 и случайный проход слова на смещённых метках не выше 15 %. '
        'Проход строки объединения по-прежнему не выше 5 %. Пороги не сдвигались.',
        '',
        report.get('mms_adapters') or lang_ctc.MMS_REJECTION,
        '',
    ]
    if report.get('error'):
        lines.append(f"Замер выбора не собрался: {report['error']}.")
        lines.append('')
    lines.append('## Нет модели')
    lines.append('')
    absent = report.get('absent') or [dict(row) for row in lang_ctc.ABSENT]
    for row in absent:
        lines.append(f"- {row.get('lang')}: {row.get('reason')}")
    lines.append('')
    lines.append('## Роль «или» по языку')
    lines.append('')
    lines.append('| песня | язык | слов | модель | в 0,10 с | проход слова | решение |')
    lines.append('|---|---|---:|---|---:|---:|---|')
    for row in report.get('pairs') or []:
        chance = row.get('word_chance')
        chance_s = '—' if chance is None else f'{float(chance):.3f}'.replace('.', ',')
        lines.append(
            f"| {row.get('song')} | {row.get('lang')} | {row.get('words')} | "
            f"{row.get('model') or '—'} | {row.get('agreement') or 0} | {chance_s} | {row.get('why')} |"
        )
    if not report.get('pairs'):
        lines.append('| — | — | — | — | — | — | часов нет |')
    lines.append('')
    lines.append('## Согласие двух слабых часов')
    lines.append('')
    lines.append(
        'Слово доказано, когда атака внутри допуска группы, фонемные часы и языковые '
        'часы каждый не дальше 0,10 с от начала постановщика и не дальше 0,10 с друг от друга. '
        'Роль языка при этом не включается. Нет фонемных часов — пары нет.'
    )
    lines.append('')
    lines.append('| песня | язык | слов | фонема | обоих часов | проход слова | решение |')
    lines.append('|---|---|---:|---|---:|---:|---|')
    for row in report.get('pair_rows') or []:
        chance = row.get('word_chance')
        chance_s = '—' if chance is None else f'{float(chance):.3f}'.replace('.', ',')
        lines.append(
            f"| {row.get('song')} | {row.get('lang')} | {row.get('words')} | "
            f"{row.get('phone') or '—'} | {row.get('both') or 0} | {chance_s} | {row.get('why')} |"
        )
    if not report.get('pair_rows'):
        lines.append('| — | — | — | — | — | — | не измерялось |')
    lines.append('')
    lines.append('## Один против двух')
    lines.append('')
    lines.append(
        'Опровержение единственным свидетелем снимается только на строке, которой '
        'объединение это записало, и только когда ещё хотя бы два независимых часа '
        '(второй, третий, фонема, язык) лежат не дальше 0,10 с от начала постановщика '
        'и хотя бы одна их пара — не дальше 0,10 с друг от друга. Час из списка снятых '
        'видов свидетелем не считается. Два часа, согласные далеко от постановщика, '
        'опровергают по-прежнему. Снятие не меняет проход слова: на смещённой метке '
        'часы остаются на прежнем месте и согласие обычно распадается. Если проход '
        'строки этого правила выше 5 %, строки добавляются по одной, пока предел держится.'
    )
    lines.append('')
    return '\n'.join(lines)
