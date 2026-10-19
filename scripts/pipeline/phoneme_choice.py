"""Admit a phoneme witness per song and language, and measure a choir feature.

The witness is not a placer and it does not refute a word. A pair is admitted
only when that role's word chance stays at or under 15 % and the joint
assignment keeps every placer's line chance at or under 5 % at one K.
Thresholds are the ones attack_chance already uses. They are not moved.

Official measure_primary_tables after apply() is the judge. This search only
proposes a stamp. The caller drops it when the official count does not rise.
"""
from __future__ import annotations

import itertools

import numpy as np

import attack_chance as A
import placement as P
import qa_sync as Q

ROLES = ('off', 'or', 'only')
VARIANTS = ('base', 'envelope', 'vowel', 'both')
# 3**12 assignments. Above that the search is one greedy pass and the official
# remeasure still has to beat the unstamped baseline.
MAX_EXACT = 3 ** 12


def allowed_roles(chances: dict) -> list[str]:
    """`off` is always allowed. Another role needs its own word chance at or under 15 %."""
    out = ['off']
    for role in ('or', 'only'):
        chance = chances.get(role)
        if chance is not None and float(chance) <= A.LIMIT + 1e-12:
            out.append(role)
    return out


def counts_ok(proved: int, refuted: bool, n: int, share: float) -> bool:
    """Same gate as qa_sync.line_word_ok: no refutation, at least two proved words, share K."""
    if refuted or n < 2 or proved < 2:
        return False
    return Q.share_met(int(proved), int(n), float(share))


def choir_ok(words: int, word_chance: float | None, line_chance: float | None,
             proved: int, base_proved: int, solo_same: bool) -> bool:
    """Envelope or vowel-nucleus evidence for the choir, or neither.

    The choir sample needs at least 30 placed words. Its word chance stays at
    or under 15 %, its line chance at or under 5 %, proved lines strictly rise
    against the same roles without the feature, and solo lines at that K do
    not change.
    """
    if int(words) < A.MIN_WORDS:
        return False
    if word_chance is None or float(word_chance) > A.LIMIT + 1e-12:
        return False
    if line_chance is None or float(line_chance) > A.LINE_LIMIT + 1e-12:
        return False
    if int(proved) <= int(base_proved):
        return False
    return bool(solo_same)


def _rule(mode: str) -> dict:
    return {
        'tol': 0.10,
        'choir_tol': 0.20,
        'agree_tol': A.SECOND_TOL,
        'peak_height': A.WITNESS_HEIGHT,
        'require_rise': False,
        'require_second': False,
        'witnesses': mode if mode in ('one', 'two') else 'two',
    }


def _legacy_mode(modes: dict, song: str, lang: str) -> str:
    mode = modes.get((song, lang)) or modes.get((song, '*'))
    return mode if mode in ('one', 'two') else 'two'


def _k_index(k) -> int | None:
    if k is None:
        return None
    for i, share in enumerate(A.LINE_SHARES):
        if abs(float(share) - float(k)) < 1e-9:
            return i
    return None


def _role_for(assignment: dict, line: dict) -> str:
    song, lang = line['song'], line['lang']
    if line.get('long'):
        role = assignment.get((song, lang), 'off')
    else:
        role = assignment.get((song, '*'), 'off')
    return role if role in ROLES else 'off'


def _matrix(cells: list[tuple[int, bool, int]]) -> np.ndarray:
    out = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
    for probe, (proved, refuted, n) in enumerate(cells):
        for ki, share in enumerate(A.LINE_SHARES):
            out[ki, probe] = counts_ok(proved, refuted, n, share)
    return out


def _tables(assignment: dict, line_rows: list[dict], variant: str) -> dict[str, list[dict]]:
    members: dict[str, list[tuple[dict, str]]] = {name: [] for name in A.PRIMARY_FAMILIES}
    for line in line_rows:
        family = line.get('family') or 'mms'
        if family not in members:
            continue
        members[family].append((line, _role_for(assignment, line)))
    tables = {}
    for name in A.PRIMARY_FAMILIES:
        rows = []
        group = members[name]
        c = len(group)
        for ki, share in enumerate(A.LINE_SHARES):
            if c == 0:
                rows.append({
                    'k': share, 'chance': None, 'proved': 0, 'candidates': 0,
                    'by_song': {}, 'shifts': {},
                })
                continue
            true = 0
            by_song: dict[str, int] = {}
            probe_hits = [0] * 8
            for line, role in group:
                bits = line['pass'][variant][role]
                if bits[ki, 0]:
                    true += 1
                    by_song[line['song']] = by_song.get(line['song'], 0) + 1
                probe_hits = [probe_hits[p] + int(bits[ki, p]) for p in range(8)]
            rates = {}
            for i, mag in enumerate(A.SHIFTS):
                hits = probe_hits[1 + 2 * i] + probe_hits[2 + 2 * i]
                rates[f'{mag:.2f}'] = hits / (2 * c)
            rates['shuffle'] = probe_hits[7] / c
            rows.append({
                'k': share,
                'chance': max(rates.values()) if rates else None,
                'proved': true,
                'candidates': c,
                'by_song': by_song,
                'shifts': rates,
            })
        tables[name] = rows
    return tables


def _score(assignment: dict, line_rows: list[dict], variant: str) -> dict:
    return A.choose_with_primaries(_tables(assignment, line_rows, variant))


def _assignments(pair_roles: dict) -> tuple[list[dict], str]:
    fixed = {}
    search: list[tuple] = []
    for key, roles in pair_roles.items():
        clean = [role for role in roles if role in ROLES]
        if 'off' not in clean:
            clean = ['off', *clean]
        # Keep the listed order, drop duplicates.
        ordered = []
        for role in clean:
            if role not in ordered:
                ordered.append(role)
        if len(ordered) <= 1:
            fixed[key] = 'off'
        else:
            search.append((key, ordered))
    width = 1
    for _key, roles in search:
        width *= len(roles)
    if width > MAX_EXACT:
        return _greedy_space(fixed, search), 'greedy'
    out = []
    if not search:
        out.append(dict(fixed))
        return out, 'exact'
    keys = [key for key, _roles in search]
    lists = [roles for _key, roles in search]
    for combo in itertools.product(*lists):
        assignment = dict(fixed)
        assignment.update(zip(keys, combo))
        out.append(assignment)
    return out, 'exact'


def _greedy_space(fixed: dict, search: list[tuple]) -> list[dict]:
    """Not used as the assignment list. The caller runs the greedy pass itself.

    Returning only the all-off start lets a too-wide product fail closed to the
    baseline when the caller does not pass line rows into a special path.
    `search_assignments` is what `select` actually iterates. This helper is the
    exact-product path's companion and is unused for the greedy flag: select()
    branches on the flag before iterating.
    """
    return [dict(fixed)]


def _better(rank: tuple, best: tuple | None) -> bool:
    return best is None or rank > best


def _rank(picked: dict, assignment: dict) -> tuple:
    proved = int(picked.get('proved') or 0)
    chance = 1.0 if picked.get('chance') is None else float(picked['chance'])
    admissions = sum(1 for role in assignment.values() if role != 'off')
    return (proved, -chance, -admissions)


def _solo_ids(assignment: dict, line_rows: list[dict], variant: str, k) -> list | None:
    ki = _k_index(k)
    if ki is None:
        return None
    ids = []
    for line in line_rows:
        if line.get('group') != 'solo':
            continue
        role = _role_for(assignment, line)
        if line['pass'][variant][role][ki, 0]:
            ids.append(line.get('id'))
    return ids


def _group_line_chance(assignment: dict, line_rows: list[dict], variant: str, group: str) -> float | None:
    """Worst placer's line chance on this group alone. None when the group has no candidate line."""
    worst = None
    any_line = False
    for name in A.PRIMARY_FAMILIES:
        rows = [line for line in line_rows if line.get('family') == name and line.get('group') == group]
        if not rows:
            continue
        any_line = True
        rates = []
        c = len(rows)
        for i, _mag in enumerate(A.SHIFTS):
            hits = 0
            for line in rows:
                role = _role_for(assignment, line)
                bits = line['pass'][variant][role]
                # The chance is the max over K as well as over shifts: a line that
                # passes a shift at a loose K still counts. Use the loosest K,
                # which only adds passes, matching the worst rate the grid can show.
                hits += int(bits[0, 1 + 2 * i]) + int(bits[0, 2 + 2 * i])
            rates.append(hits / (2 * c))
        shuffle_hits = 0
        for line in rows:
            role = _role_for(assignment, line)
            shuffle_hits += int(line['pass'][variant][role][0, 7])
        rates.append(shuffle_hits / c)
        chance = max(rates) if rates else None
        if chance is not None and (worst is None or chance > worst):
            worst = chance
    if not any_line:
        return None
    return worst


def select(pair_roles: dict, line_rows: list[dict], variant: str = 'base') -> dict:
    """Best role assignment for one attack/clock variant.

    More proved lines win. A tie goes to the lower line chance, then to fewer
    admitted pairs. An assignment whose line chance is over 5 % is not chosen.
    The all-off assignment stays available, so a witness that only adds false
    passes is left off.
    """
    assignments, how = _assignments(pair_roles)
    best = None
    best_rank = None
    if how == 'greedy':
        return _select_greedy(pair_roles, line_rows, variant)
    for assignment in assignments:
        picked = _score(assignment, line_rows, variant)
        if not picked.get('within_limit'):
            continue
        rank = _rank(picked, assignment)
        if _better(rank, best_rank):
            best_rank = rank
            best = (assignment, picked)
    if best is None:
        assignment = {key: 'off' for key in pair_roles}
        picked = _score(assignment, line_rows, variant)
        return _public_select(assignment, picked, 'exact', False)
    return _public_select(best[0], best[1], 'exact', True)


def _select_greedy(pair_roles: dict, line_rows: list[dict], variant: str) -> dict:
    """One pass: each pair tries `or` and `only` and keeps a step that still fits and proves more."""
    assignment = {key: 'off' for key in pair_roles}
    picked = _score(assignment, line_rows, variant)
    if not picked.get('within_limit'):
        return _public_select(assignment, picked, 'greedy', False)
    for key, roles in pair_roles.items():
        current = _rank(picked, assignment)
        for role in roles:
            if role == 'off':
                continue
            trial = dict(assignment)
            trial[key] = role
            got = _score(trial, line_rows, variant)
            if not got.get('within_limit'):
                continue
            rank = _rank(got, trial)
            if rank > current:
                assignment = trial
                picked = got
                current = rank
    return _public_select(assignment, picked, 'greedy', True)


def _public_select(assignment: dict, picked: dict, how: str, within: bool) -> dict:
    return {
        'assignment': {key: assignment.get(key, 'off') for key in assignment},
        'k': picked.get('k'),
        'chance': picked.get('chance'),
        'proved': int(picked.get('proved') or 0),
        'within_limit': bool(within and picked.get('within_limit')),
        'admissions': sum(1 for role in assignment.values() if role != 'off'),
        'search': how,
        'picked': picked,
    }


def _moved(words: list[dict], shift: float, shuffle: bool) -> list[dict]:
    moved = []
    if shuffle:
        rotated = words[1:] + words[:1]
        for word, donor in zip(words, rotated):
            item = dict(word)
            item['t'] = float(donor['t'])
            moved.append(item)
    else:
        for word in words:
            item = dict(word)
            item['t'] = float(word['t']) + float(shift)
            moved.append(item)
    return moved


def _stamp(moved: list[dict], role: str, model: str | None, vowel: bool) -> None:
    for item in moved:
        item.pop('phoneme', None)
        item.pop('phoneme_role', None)
        if role not in ('or', 'only') or not model:
            continue
        table = item.get('vowels') if vowel else item.get('phones')
        clock = (table or {}).get(model)
        item['phoneme'] = None if clock is None else float(clock)
        item['phoneme_role'] = role


def _cell(words: list[dict], peaks: np.ndarray, group: str, mode: str, refute: dict,
          prev, role: str, model: str | None, vowel: bool, shift: float, shuffle: bool):
    moved = _moved(words, shift, shuffle)
    _stamp(moved, role, model, vowel)
    proved, flags = A._probe_parts(moved, peaks, group, mode, refute, prev)
    n_proved = sum(1 for word in proved if word.get('path') != 'fail')
    return n_proved, any(flags), len(proved)


def _probes():
    rows = [(0.0, False)]
    for mag in A.SHIFTS:
        rows.append((mag, False))
        rows.append((-mag, False))
    rows.append((0.0, True))
    return rows


def _line_model(pair_by: dict, song: str, lang: str, long: bool) -> str | None:
    src = pair_by.get((song, lang)) if long else pair_by.get((song, '*'))
    if not src:
        return None
    return src.get('model')


def _build_rows(per_song: list[dict], pair_by: dict, long: set, modes: dict, refute: dict) -> list[dict]:
    rows = []
    probes = _probes()
    cut = A._refute_cut(float(refute.get('both_far', 0.20)), float(refute.get('only_far', 0.30)))
    for song in per_song:
        spectral = song['sets'][(A.WITNESS_HEIGHT, False)]
        envelope = song.get('envelope_peaks')
        if envelope is None:
            envelope = np.zeros(0)
        incoming = []
        prev = None
        for line in song['all_lines']:
            incoming.append(prev)
            if line.get('words'):
                prev = float(line['words'][-1]['t'])
        for i, line in enumerate(song['all_lines']):
            if not A._line_candidate(line):
                continue
            is_long = (song['slug'], line.get('lang') or '?') in long
            model = _line_model(pair_by, song['slug'], line.get('lang') or '?', is_long)
            mode = _legacy_mode(modes, song['slug'], line.get('lang') or '?')
            group = line.get('group') or 'solo'
            choir = group == 'choir'
            pass_bits = {}
            for variant in VARIANTS:
                if not choir and variant != 'base':
                    pass_bits[variant] = pass_bits['base']
                    continue
                peaks = envelope if choir and variant in ('envelope', 'both') else spectral
                vowel = choir and variant in ('vowel', 'both')
                pass_bits[variant] = {}
                for role in ROLES:
                    cells = [
                        _cell(line['words'], peaks, group, mode, cut, incoming[i],
                              role, model, vowel, shift, shuffle)
                        for shift, shuffle in probes
                    ]
                    # Role off does not read the clock. Reuse it across variants
                    # only when the peaks are the spectral ones. Envelope changes it.
                    pass_bits[variant][role] = _matrix(cells)
            rows.append({
                'id': line.get('id'),
                'song': song['slug'],
                'lang': line.get('lang') or '?',
                'group': group,
                'family': P.primary_family(line.get('placed_by')) or 'mms',
                'long': is_long,
                'pass': pass_bits,
            })
    return rows


def _word_chance(records: list[dict], peaks: np.ndarray, mode: str, role: str,
                 model: str | None) -> float | None:
    if not records:
        return None
    stamped = []
    for rec in records:
        item = dict(rec)
        if role in ('or', 'only') and model:
            clock = (rec.get('phones') or {}).get(model)
            item['phoneme'] = None if clock is None else float(clock)
            item['phoneme_role'] = role
        stamped.append(item)
    return A._slice_chance(stamped, peaks, _rule(mode))


def _agreement(records: list[dict], model: str) -> int:
    n = 0
    for rec in records:
        clock = (rec.get('phones') or {}).get(model)
        if clock is None:
            continue
        if abs(float(clock) - float(rec['t'])) <= A.SECOND_TOL + 1e-12:
            n += 1
    return n


def _models_of(per_song: list[dict]) -> list[str]:
    names = []
    for song in per_song:
        for line in song['lines']:
            for word in line['words']:
                for name in (word.get('phones') or {}):
                    if name not in names:
                        names.append(name)
    return names


def _records(song: dict, lang: str | None) -> list[dict]:
    out = []
    for line in song['lines']:
        if lang is not None and (line.get('lang') or '?') != lang:
            continue
        out.extend(line['words'])
    return out


def _pick_models(per_song: list[dict], modes: dict) -> tuple[list[dict], set]:
    """One finished model per pair, by how many words it places within 0.10 s.

    A model whose `or` and `only` chances are both over 15 % is not eligible.
    Languages under 30 words are not pairs: they inherit the song row later.
    """
    names = _models_of(per_song)
    pairs = []
    long: set = set()
    for song in per_song:
        peaks = song['sets'][(A.WITNESS_HEIGHT, False)]
        langs = sorted({(line.get('lang') or '?') for line in song['lines']})
        slices = [('*', _records(song, None))]
        for lang in langs:
            slices.append((lang, _records(song, lang)))
        for lang, recs in slices:
            n = len(recs)
            if lang != '*' and n < A.MIN_WORDS:
                continue
            if lang != '*':
                long.add((song['slug'], lang))
            mode = _legacy_mode(modes, song['slug'], lang if lang != '*' else '*')
            best = None
            considered = []
            for model in names:
                chances = {
                    'only': _word_chance(recs, peaks, mode, 'only', model),
                    'or': _word_chance(recs, peaks, mode, 'or', model),
                }
                agree = _agreement(recs, model)
                roles = allowed_roles(chances)
                considered.append({
                    'model': model, 'agreement': agree,
                    'only_chance': chances['only'], 'or_chance': chances['or'],
                    'allowed': roles,
                })
                if roles == ['off']:
                    continue
                rank = (agree, model)
                if best is None or rank > best[0]:
                    best = (rank, model, chances, roles, agree)
            chosen = None if best is None else best[1]
            chances = {'only': None, 'or': None} if best is None else best[2]
            roles = ['off'] if best is None else best[3]
            pairs.append({
                'song': song['slug'],
                'lang': lang,
                'words': n,
                'model': chosen,
                'role': 'off',
                'word_chance': None,
                'agreement': 0 if best is None else best[4],
                'only_chance': chances.get('only'),
                'or_chance': chances.get('or'),
                'allowed': roles,
                'considered': considered,
            })
    return pairs, long


def _pair_roles(pairs: list[dict]) -> dict:
    return {(row['song'], row['lang']): list(row.get('allowed') or ['off']) for row in pairs}


def _apply_assignment(pairs: list[dict], assignment: dict) -> None:
    for row in pairs:
        role = assignment.get((row['song'], row['lang']), 'off')
        if role not in (row.get('allowed') or ['off']):
            role = 'off'
        row['role'] = role
        if role == 'only':
            row['word_chance'] = row.get('only_chance')
        elif role == 'or':
            row['word_chance'] = row.get('or_chance')
        else:
            row['word_chance'] = None


def _pooled_word_chance(buckets: list[tuple]) -> float | None:
    """buckets are (records, peaks, mode). Records already carry phoneme_role and phoneme."""
    if not any(recs for recs, _peaks, _mode in buckets):
        return None
    rates = []
    for mag in A.SHIFTS:
        hits = n = 0
        for recs, peaks, mode in buckets:
            if not recs:
                continue
            for sign in (mag, -mag):
                h, c = A.hit_count(recs, peaks, sign, _rule(mode))
                hits += h
                n += c
        if n:
            rates.append(hits / n)
    hits = n = 0
    for recs, peaks, mode in buckets:
        shuffled = A.shuffled_records(A._records_to_lines(recs))
        if not shuffled:
            continue
        h, c = A.hit_count(shuffled, peaks, 0.0, _rule(mode))
        hits += h
        n += c
    if n:
        rates.append(hits / n)
    if not rates:
        return None
    return float(max(rates))


def _choir_word_chance(per_song: list[dict], assignment: dict, long: set, variant: str,
                       modes: dict, pair_by: dict) -> tuple[int, float | None]:
    buckets = []
    words = 0
    for song in per_song:
        spectral = song['sets'][(A.WITNESS_HEIGHT, False)]
        envelope = song.get('envelope_peaks')
        if envelope is None:
            envelope = np.zeros(0)
        by_mode: dict[str, list[dict]] = {}
        for line in song['lines']:
            if line.get('group') != 'choir':
                continue
            lang = line.get('lang') or '?'
            is_long = (song['slug'], lang) in long
            role = assignment.get((song['slug'], lang), 'off') if is_long else assignment.get((song['slug'], '*'), 'off')
            model = _line_model(pair_by, song['slug'], lang, is_long)
            vowel = variant in ('vowel', 'both')
            mode = _legacy_mode(modes, song['slug'], lang)
            for word in line['words']:
                item = dict(word)
                if role in ('or', 'only') and model:
                    table = item.get('vowels') if vowel else item.get('phones')
                    clock = (table or {}).get(model)
                    item['phoneme'] = None if clock is None else float(clock)
                    item['phoneme_role'] = role
                by_mode.setdefault(mode, []).append(item)
                words += 1
        peaks = envelope if variant in ('envelope', 'both') else spectral
        for mode, recs in by_mode.items():
            buckets.append((recs, peaks, mode))
    return words, _pooled_word_chance(buckets)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return round(float(np.median(np.asarray(values, dtype=float))), 3)


def describe(per_song: list[dict]) -> dict:
    """Solo versus choir, before any feature is admitted. Numbers only.

    Peak gaps are measured inside each recording's own line spans. Spans from
    another song are a different clock and are not mixed in.
    """
    duration = {'solo': [], 'choir': []}
    gaps = {group: {'spectral': [], 'envelope': []} for group in ('solo', 'choir')}
    for song in per_song:
        spans = {'solo': [], 'choir': []}
        for line in song['lines']:
            group = line.get('group')
            if group not in duration:
                continue
            for word in line['words']:
                if word.get('ctc_e') is None:
                    continue
                duration[group].append(float(word['ctc_e']) - float(word['t']))
            span = line.get('span')
            if span:
                spans[group].append(span)
        spectral = song['sets'][(A.WITNESS_HEIGHT, False)]
        envelope = song.get('envelope_peaks')
        if envelope is None:
            envelope = np.zeros(0)
        for group in ('solo', 'choir'):
            gaps[group]['spectral'].extend(A.intervals_in_spans(spectral, spans[group]))
            gaps[group]['envelope'].extend(A.intervals_in_spans(envelope, spans[group]))
    phones = {}
    for model in _models_of(per_song):
        phones[model] = {
            group: {'words': 0, 'with_clock': 0, 'within_0_10': 0}
            for group in ('solo', 'choir')
        }
    for song in per_song:
        for line in song['lines']:
            group = line.get('group')
            if group not in ('solo', 'choir'):
                continue
            for word in line['words']:
                for model, bucket in phones.items():
                    cell = bucket[group]
                    cell['words'] += 1
                    clock = (word.get('phones') or {}).get(model)
                    if clock is None:
                        continue
                    cell['with_clock'] += 1
                    if abs(float(clock) - float(word['t'])) <= A.SECOND_TOL + 1e-12:
                        cell['within_0_10'] += 1
    for model, groups in phones.items():
        for cell in groups.values():
            n = cell['with_clock']
            cell['share'] = None if n == 0 else round(cell['within_0_10'] / n, 3)
    return {
        'duration_median': {group: _median(duration[group]) for group in ('solo', 'choir')},
        'spectral_gap_median': {group: _median(gaps.get(group, {}).get('spectral') or []) for group in ('solo', 'choir')},
        'envelope_gap_median': {group: _median(gaps.get(group, {}).get('envelope') or []) for group in ('solo', 'choir')},
        'phones': phones,
    }


def _variant_flags(variant: str) -> tuple[str, str]:
    attack = 'envelope' if variant in ('envelope', 'both') else 'spectral'
    clock = 'vowel' if variant in ('vowel', 'both') else 'phone'
    return attack, clock


def choose(per_song: list[dict], modes: dict, refute: dict) -> dict:
    """Propose roles and an optional choir feature. Does not stamp words."""
    pairs, long = _pick_models(per_song, modes)
    pair_by = {(row['song'], row['lang']): row for row in pairs}
    roles = _pair_roles(pairs)
    print('фонемный свидетель: считаю пробы строк', flush=True)
    line_rows = _build_rows(per_song, pair_by, long, modes, refute)
    base = select(roles, line_rows, 'base')
    _apply_assignment(pairs, base['assignment'])
    choir_cache: dict = {}

    def word_chance(assignment: dict, variant: str) -> tuple[int, float | None]:
        key_roles = []
        seen = set()
        for line in line_rows:
            if line.get('group') != 'choir':
                continue
            ident = (line['song'], line['lang'] if line.get('long') else '*')
            if ident in seen:
                continue
            seen.add(ident)
            key_roles.append((ident[0], ident[1], assignment.get(ident, 'off')))
        key = (variant, tuple(sorted(key_roles)))
        if key not in choir_cache:
            choir_cache[key] = _choir_word_chance(per_song, assignment, long, variant, modes, pair_by)
        return choir_cache[key]

    adopted = None
    best_choir = None
    best_rank = None
    selected = {'base': base}
    for variant in ('envelope', 'vowel', 'both'):
        got = select(roles, line_rows, variant)
        selected[variant] = got
        if not got.get('within_limit'):
            continue
        assignment = got['assignment']
        base_same = _score(assignment, line_rows, 'base')
        solo_a = _solo_ids(assignment, line_rows, variant, got.get('k'))
        solo_b = _solo_ids(assignment, line_rows, 'base', got.get('k'))
        solo_same = solo_a is not None and solo_a == solo_b
        line_chance = _group_line_chance(assignment, line_rows, variant, 'choir')
        # Word chance is the costly check. Skip it when the cheap gates already fail.
        if int(got['proved']) <= int(base_same.get('proved') or 0) or not solo_same:
            continue
        if line_chance is None or float(line_chance) > A.LINE_LIMIT + 1e-12:
            continue
        n_words, chance = word_chance(assignment, variant)
        if not choir_ok(n_words, chance, line_chance, got['proved'], int(base_same.get('proved') or 0), solo_same):
            continue
        rank = _rank(got['picked'], assignment)
        if _better(rank, best_rank):
            best_rank = rank
            best_choir = (variant, got, n_words, chance, line_chance, int(base_same.get('proved') or 0))
    if best_choir is not None:
        adopted = best_choir
        _apply_assignment(pairs, best_choir[1]['assignment'])
    attack, clock = ('spectral', 'phone') if adopted is None else _variant_flags(adopted[0])
    admitted = any(row.get('role') in ('or', 'only') for row in pairs) or adopted is not None
    chosen_select = base if adopted is None else adopted[1]
    chorus = {
        'adopted': adopted is not None,
        'variant': None if adopted is None else adopted[0],
        'words': 0 if adopted is None else adopted[2],
        'word_chance': None if adopted is None else adopted[3],
        'line_chance': None if adopted is None else adopted[4],
        'proved': None if adopted is None else adopted[1]['proved'],
        'base_proved': None if adopted is None else adopted[5],
        'why': 'принят' if adopted is not None else 'ни один признак не уложился в те же пороги',
        'describe': describe(per_song),
    }
    # Choir word count even when the feature is rejected, so the report can say why.
    if adopted is None:
        n_words, _chance = _choir_word_chance(per_song, {key: 'off' for key in roles}, long, 'base', modes, pair_by)
        chorus['words'] = n_words
        chorus['variants'] = _variant_report(
            roles, line_rows, per_song, long, modes, pair_by, word_chance, selected)
    public_pairs = []
    for row in pairs:
        public_pairs.append({
            'song': row['song'], 'lang': row['lang'], 'words': row['words'],
            'model': row.get('model'), 'role': row.get('role') or 'off',
            'word_chance': row.get('word_chance'), 'agreement': row.get('agreement') or 0,
            'only_chance': row.get('only_chance'), 'or_chance': row.get('or_chance'),
            'allowed': list(row.get('allowed') or ['off']),
        })
    return {
        'admitted': admitted,
        'kept': False,
        'rejected_reason': None,
        'pairs': public_pairs,
        'long': [[song, lang] for song, lang in sorted(long)],
        'k': chosen_select.get('k'),
        'chance': chosen_select.get('chance'),
        'proved': chosen_select.get('proved'),
        'search': chosen_select.get('search'),
        'choir_attack': attack,
        'choir_clock': clock,
        'chorus': chorus,
    }


def _variant_report(roles, line_rows, per_song, long, modes, pair_by, word_chance,
                    selected: dict | None = None) -> list[dict]:
    """One row per choir candidate that was measured, including those the gate refused."""
    selected = selected or {}
    rows = []
    for variant in ('envelope', 'vowel', 'both'):
        got = selected.get(variant)
        if got is None:
            got = select(roles, line_rows, variant)
        assignment = got['assignment']
        base_same = _score(assignment, line_rows, 'base')
        solo_a = _solo_ids(assignment, line_rows, variant, got.get('k'))
        solo_b = _solo_ids(assignment, line_rows, 'base', got.get('k'))
        n_words, chance = word_chance(assignment, variant)
        line_chance = _group_line_chance(assignment, line_rows, variant, 'choir')
        solo_same = solo_a is not None and solo_a == solo_b
        ok = choir_ok(n_words, chance, line_chance, int(got.get('proved') or 0),
                      int(base_same.get('proved') or 0), solo_same) and bool(got.get('within_limit'))
        rows.append({
            'variant': variant,
            'within_limit': bool(got.get('within_limit')),
            'proved': int(got.get('proved') or 0),
            'base_proved': int(base_same.get('proved') or 0),
            'chance': got.get('chance'),
            'words': n_words,
            'word_chance': chance,
            'line_chance': line_chance,
            'solo_same': solo_same,
            'ok': ok,
        })
    return rows


def _lookup(decision: dict, song: str, lang: str) -> tuple[str, str | None]:
    long = {(row[0], row[1]) for row in decision.get('long') or []}
    pairs = {(row['song'], row['lang']): row for row in decision.get('pairs') or []}
    src = pairs.get((song, lang)) if (song, lang) in long else pairs.get((song, '*'))
    if not src:
        return 'off', None
    role = src.get('role') if src.get('role') in ('or', 'only') else 'off'
    model = src.get('model') if isinstance(src.get('model'), str) else None
    return role, model


def apply(per_song: list[dict], decision: dict) -> None:
    """Stamp the proposed clocks. Solo lines never read the vowel clock or the envelope."""
    vowel = decision.get('choir_clock') == 'vowel'
    envelope = decision.get('choir_attack') == 'envelope'
    for song in per_song:
        song['use_choir_envelope'] = envelope
        for line in song.get('all_lines') or []:
            role, model = _lookup(decision, song['slug'], line.get('lang') or '?')
            use_vowel = vowel and line.get('group') == 'choir'
            for word in line.get('words') or []:
                word.pop('phoneme', None)
                word.pop('phoneme_role', None)
                if role not in ('or', 'only') or not model:
                    continue
                table = word.get('vowels') if use_vowel else word.get('phones')
                clock = (table or {}).get(model)
                word['phoneme'] = None if clock is None else float(clock)
                word['phoneme_role'] = role


def clear(per_song: list[dict]) -> None:
    for song in per_song:
        song['use_choir_envelope'] = False
        for line in song.get('all_lines') or []:
            for word in line.get('words') or []:
                word.pop('phoneme', None)
                word.pop('phoneme_role', None)


def _ru(value, nd: int = 3) -> str:
    if value is None:
        return '—'
    return f'{float(value):.{nd}f}'.replace('.', ',')


def render_choice(decision: dict) -> str:
    decision = decision or {}
    lines = [
        '# Фонемный свидетель',
        '',
        'Часы ставит wav2vec2, обученный на фонемах IPA, по тексту строки через espeak-ng. '
        'Это не MMS и не Whisper. Постановщиком свидетель не становится и слово не опровергает. '
        'Роль «или» добавляет фонемное начало к часам, которые язык уже требует. '
        'Роль «только он» доказывает слово сильной атакой и одним фонемным началом; '
        'прежние часы по-прежнему могут слово опровергнуть. '
        'Пара допускается, только если проход слова этой роли не выше 15 % и общее K '
        'держит проход строки каждого постановщика не выше 5 %. Пороги не сдвигались.',
        '',
        'Адаптеры facebook/mms-1b-all делят акустический контур с постановщиком MMS и не измерялись. '
        'Две фонемные модели одному языку вместе не отдаются: у пары одна, та, у которой больше слов '
        'в пределах 0,10 с среди моделей с допустимым проходом.',
        '',
        f"Перебор: {decision.get('search') or '—'}. "
        f"По перебору доказано строк {decision.get('proved') if decision.get('proved') is not None else '—'}, "
        f"K {_ru(decision.get('k'), 2)}, проход строки {_ru(decision.get('chance'))}. "
        f"Официально оставлен: {'да' if decision.get('kept') else 'нет'}.",
        '',
    ]
    if decision.get('baseline_proved') is not None:
        lines.append(
            f"Официальный пересчёт: {decision.get('official_proved')} строк против "
            f"{decision.get('baseline_proved')} без этого свидетеля, "
            f"проход строки {_ru(decision.get('official_chance'))}."
        )
        lines.append('')
    if decision.get('rejected_reason'):
        lines.append(f"Не оставлен: {decision['rejected_reason']}.")
        lines.append('')
    lines += [
        '| песня | язык | слов | модель | согласий в 0,10 с | или | только | роль | проход роли |',
        '|---|---|---:|---|---:|---:|---:|---|---:|',
    ]
    for row in decision.get('pairs') or []:
        role = {'or': 'или', 'only': 'только'}.get(row.get('role') or '', 'нет')
        lines.append(
            f"| {row.get('song')} | {row.get('lang')} | {row.get('words', 0)} | {row.get('model') or '—'} | "
            f"{row.get('agreement', 0)} | {_ru(row.get('or_chance'))} | {_ru(row.get('only_chance'))} | "
            f"{role} | {_ru(row.get('word_chance'))} |"
        )
    if not decision.get('pairs'):
        lines.append('| — | — | 0 | — | 0 | — | — | нет | — |')
    lines += [
        '',
        'Язык короче 30 поставленных слов своей роли не получает: он берёт роль песни (`*`). '
        'Если у песни роль «нет», короткий язык тоже без фонемного свидетеля.',
        '',
    ]
    return '\n'.join(lines)


def render_chorus(chorus: dict) -> str:
    chorus = chorus or {}
    desc = chorus.get('describe') or {}
    lines = [
        '# Хор',
        '',
        'Хор сравнивается с соло на тех же записях. Длительность слова — конец CTC минус начало, до притяжения. '
        'Промежуток атак — медиана расстояния между пиками внутри строк этой группы. '
        'Спектральная атака — прежняя кривая. Огибающая — пики подъёма уровня на той же силе 0,7. '
        'Гласное ядро — первое гласное фонемного пути, вместо начала первого фонема, и только у хоровых строк.',
        '',
        'Признак берётся, только если поставленных слов хора не меньше 30, проход слова не выше 15 %, '
        'проход строки не выше 5 %, доказанных строк становится строго больше и соло на том же K не меняется. '
        'Иначе признак не входит в правило.',
        '',
        f"Принят: {'да' if chorus.get('adopted') else 'нет'}. {chorus.get('why') or ''}",
        '',
        '| | соло | хор |',
        '|---|---:|---:|',
        f"| медиана длины слова, с | {_ru((desc.get('duration_median') or {}).get('solo'))} | {_ru((desc.get('duration_median') or {}).get('choir'))} |",
        f"| медиана промежутка спектральных атак, с | {_ru((desc.get('spectral_gap_median') or {}).get('solo'))} | {_ru((desc.get('spectral_gap_median') or {}).get('choir'))} |",
        f"| медиана промежутка огибающей, с | {_ru((desc.get('envelope_gap_median') or {}).get('solo'))} | {_ru((desc.get('envelope_gap_median') or {}).get('choir'))} |",
        '',
        '| модель | группа | слов | с часами | в 0,10 с | доля |',
        '|---|---|---:|---:|---:|---:|',
    ]
    phones = desc.get('phones') or {}
    if not phones:
        lines.append('| — | — | 0 | 0 | 0 | — |')
    for model, groups in phones.items():
        for group in ('solo', 'choir'):
            cell = groups.get(group) or {}
            lines.append(
                f"| {model} | {group} | {cell.get('words', 0)} | {cell.get('with_clock', 0)} | "
                f"{cell.get('within_0_10', 0)} | {_ru(cell.get('share'))} |"
            )
    lines += [
        '',
        f"Слов хора в замере: {chorus.get('words', 0)}.",
        '',
        '| признак | в пределе | доказано | без признака | проход строки | проход слова | соло то же | прошёл |',
        '|---|---|---:|---:|---:|---:|---|---|',
    ]
    for row in chorus.get('variants') or []:
        lines.append(
            f"| {row.get('variant')} | {'да' if row.get('within_limit') else 'нет'} | {row.get('proved', 0)} | "
            f"{row.get('base_proved', 0)} | {_ru(row.get('line_chance'))} | {_ru(row.get('word_chance'))} | "
            f"{'да' if row.get('solo_same') else 'нет'} | {'да' if row.get('ok') else 'нет'} |"
        )
    if not chorus.get('variants'):
        lines.append('| — | — | — | — | — | — | — | — |')
    if chorus.get('error'):
        lines += ['', f"Замер хора не собран: {chorus['error']}.", '']
    lines.append('')
    return '\n'.join(lines)
