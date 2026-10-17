"""Choose the MMS line-score threshold from official subtitle cues.

    python3 scripts/pipeline/calibrate_score.py <slug> --collect
    python3 scripts/pipeline/calibrate_score.py --choose

--collect writes work/<slug>/score-rows.json (not committed): one row per vocal
line, with the letter-mean score, the mean and the minimum of the word scores,
|start − cue|, and the structural checks. --choose reads every collected song
and writes docs/analysis/bench/calibration.json and calibration.md.

The threshold is the score alone, across every cued line of the songs collected
together. It maximises lines whose |start − cue| rounds to at most 0.30 s, while
the share of accepted lines further than 0.70 s stays at most 2 % (false × 50 ≤
accepted). A line is placed only when the score also clears that threshold, the
structural checks pass, and |start − cue| rounds to at most 0.30 s. The gap to
another label is recorded and is not a gate. Without the file, align.py falls
back to the letter mean at 0.30: that fallback is for tests, not for singing.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

NEAR = 0.30
FALSE_AT = 0.70
# 1/50 is 2 % and passes; 1/49 does not. Integer comparison, no float edge.
FALSE_NUM = 50
SHORT = 0.06          # two inter-word start gaps in a row shorter than this fail
EATEN = 0.02          # one CTC frame: two starts this close ate a word
END_SLACK = 0.05      # the last letter may pass the next cue by one or two frames
METRICS = ('letter', 'word_mean', 'word_min')
FALLBACK_METRIC = 'letter'
FALLBACK_THRESHOLD = 0.30


def structural(starts: list[float | None], ends: list[float | None], next_cue: float | None) -> tuple[bool, str]:
    """Score-free checks on the lettered words of one line, in order.

    `starts` and `ends` are seconds. None is a lettered word the path did not
    place. The last word is not given a duration: under the star the letter is
    one frame and the hold sits on the star, so a short CTC spike is not an
    eaten word. A short run is two consecutive gaps between starts. The line
    end is the last letter's end, and it may not run past the next cue.
    """
    if not starts:
        return False, 'empty'
    if any(s is None or e is None for s, e in zip(starts, ends)):
        return False, 'eaten'
    placed = [float(s) for s in starts if s is not None]
    for a, b in zip(placed, placed[1:]):
        if b < a:
            return False, 'order'
        if b - a < EATEN:
            return False, 'eaten'
    run = 0
    for a, b in zip(placed, placed[1:]):
        if b - a < SHORT:
            run += 1
            if run >= 2:
                return False, 'short'
        else:
            run = 0
    if next_cue is not None and ends and ends[-1] is not None and float(ends[-1]) > float(next_cue) + END_SLACK:
        return False, 'past-next'
    return True, 'ok'


def _cued(rows: list[dict], metric: str, threshold: float) -> list[dict]:
    """Rows the score accepts: a number for this metric and a numeric cue delta."""
    out = []
    for row in rows:
        value = row.get(metric)
        delta = row.get('delta')
        if value is None or delta is None:
            continue
        if float(value) + 1e-12 >= threshold:
            out.append(row)
    return out


def _counts(accepted: list[dict]) -> dict:
    near = false_n = mid = structure_fail = placed = 0
    for row in accepted:
        delta = float(row['delta'])
        close = round(delta, 3) <= NEAR
        if close:
            near += 1
        elif delta > FALSE_AT:
            false_n += 1
        else:
            mid += 1
        if not row.get('structure_ok'):
            structure_fail += 1
        if row.get('structure_ok') and close:
            placed += 1
    n = len(accepted)
    return {
        'accepted': n, 'near': near, 'mid': mid, 'false': false_n,
        'false_share': None if n == 0 else round(false_n / n, 4),
        'structure_fail': structure_fail, 'placed': placed,
        'cap_ok': n > 0 and false_n * FALSE_NUM <= n,
    }


def _candidates(rows: list[dict], metric: str) -> list[float]:
    vals = []
    seen = set()
    for row in rows:
        value = row.get(metric)
        if value is None or row.get('delta') is None:
            continue
        key = round(float(value), 6)
        if key in seen:
            continue
        seen.add(key)
        vals.append(float(value))
    return vals


def choose_threshold(rows: list[dict]) -> dict:
    """Best metric and threshold. Pure: no audio, no files.

    Rank among thresholds that meet the 2 % cap: more lines within 0.30 s,
    then fewer false lines, then a higher threshold, then the letter mean.
    If none meet the cap, the same rank is taken on the lowest false share
    and `cap_met` is false. A row with no cue delta is never accepted.
    """
    per_metric = []
    feasible = []
    fallback = []
    for index, metric in enumerate(METRICS):
        best_ok = None
        best_any = None
        for threshold in _candidates(rows, metric):
            counts = _counts(_cued(rows, metric, threshold))
            if counts['accepted'] == 0:
                continue
            point = {**counts, 'metric': metric, 'threshold': round(threshold, 6)}
            rank_ok = (counts['near'], -counts['false'], threshold, -index)
            rate = counts['false'] / counts['accepted']
            rank_any = (-rate, counts['near'], -counts['false'], threshold, -index)
            if counts['cap_ok'] and (best_ok is None or rank_ok > best_ok[0]):
                best_ok = (rank_ok, point)
            if best_any is None or rank_any > best_any[0]:
                best_any = (rank_any, point)
        chosen = best_ok[1] if best_ok else (best_any[1] if best_any else None)
        if chosen is None:
            continue
        chosen = dict(chosen)
        chosen['cap_met'] = bool(best_ok)
        per_metric.append(chosen)
        if best_ok:
            feasible.append((best_ok[0], chosen))
        if best_any:
            fallback.append((best_any[0], {**best_any[1], 'cap_met': False}))
    if feasible:
        winner = max(feasible, key=lambda item: item[0])[1]
        cap_met = True
    elif fallback:
        winner = max(fallback, key=lambda item: item[0])[1]
        cap_met = False
    else:
        winner = {
            'metric': FALLBACK_METRIC, 'threshold': FALLBACK_THRESHOLD, 'cap_met': False,
            'accepted': 0, 'near': 0, 'mid': 0, 'false': 0, 'false_share': None,
            'structure_fail': 0, 'placed': 0, 'cap_ok': False,
        }
        cap_met = False
    winner = dict(winner)
    winner['cap_met'] = cap_met
    by_lang: dict[str, dict] = {}
    if winner['accepted']:
        for row in _cued(rows, winner['metric'], float(winner['threshold'])):
            lang = str(row.get('lang') or '?')
            bucket = by_lang.setdefault(lang, {'cued_accepted': 0, 'near': 0, 'placed': 0, 'false': 0})
            bucket['cued_accepted'] += 1
            delta = float(row['delta'])
            close = round(delta, 3) <= NEAR
            if close:
                bucket['near'] += 1
            if delta > FALSE_AT:
                bucket['false'] += 1
            if row.get('structure_ok') and close:
                bucket['placed'] += 1
    cued = sum(1 for row in rows if row.get('delta') is not None)
    return {
        'metric': winner['metric'],
        'threshold': winner['threshold'],
        'cap_met': winner['cap_met'],
        'accepted': winner['accepted'],
        'near': winner['near'],
        'mid': winner['mid'],
        'false': winner['false'],
        'false_share': winner['false_share'],
        'structure_fail': winner['structure_fail'],
        'placed': winner['placed'],
        'rows': len(rows),
        'cued': cued,
        'by_metric': per_metric,
        'by_lang': by_lang,
    }


def _ru(x: float | None, nd: int = 3) -> str:
    if x is None:
        return '—'
    return f'{x:.{nd}f}'.replace('.', ',')


def render_md(result: dict) -> str:
    """Russian calibration table. The numbers are the ones --choose just measured."""
    cap = 'уложился в 2 %' if result.get('cap_met') else 'в 2 % не уложился: взят порог с наименьшей долей ложных'
    lines = [
        '# Калибровка отбора строки',
        '',
        'Порог выбран по всем строкам с репликой, которые собрал `--collect`, сразу по трём песням. '
        'Принята строка, у которой оценка не ниже порога и есть |начало − реплика|. '
        'Цель — максимум принятых с |Δ| ≤ 0,3 с. Доля принятых с |Δ| > 0,7 с не выше 2 %: '
        'ложных × 50 ≤ принятых. 1 из 50 проходит, 1 из 49 нет. '
        'Строка поставлена, только если сверх этого прошли структурные проверки и |Δ| ≤ 0,3 с. '
        'Разрыв с другой меткой записан в строке и в отбор не входит.',
        '',
        f"Выбрана оценка `{result['metric']}`, порог {_ru(result['threshold'])}. Ограничение {cap}.",
        '',
        '| оценка | порог | принято | ≤ 0,3 с | между | > 0,7 с | доля ложных | структура не прошла | поставлено |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for row in result.get('by_metric') or []:
        mark = ' ←' if row['metric'] == result['metric'] and abs(float(row['threshold']) - float(result['threshold'])) < 1e-9 else ''
        lines.append(
            f"| {row['metric']}{mark} | {_ru(row['threshold'])} | {row['accepted']} | {row['near']} | {row['mid']} | "
            f"{row['false']} | {_ru(row['false_share'], 4)} | {row['structure_fail']} | {row['placed']} |"
        )
    lines += [
        '',
        f"Строк в сборе: {result.get('rows', 0)}. Из них с репликой и началом: {result.get('cued', 0)}.",
        '',
        'Оценки: `letter` — средняя вероятность букв (уже нормирована на длину); '
        '`word_mean` — среднее по словам; `word_min` — самое слабое слово. '
        'Отдельной нормировки сверх средней по буквам нет: это та же величина.',
        '',
        'Структурные проверки, независимо от оценки: слова по порядку; нет съеденного слова '
        '(пропуск или два начала ближе 0,02 с); нет двух подряд промежутков между началами короче 0,06 с; '
        'конец последней буквы не позже начала следующей реплики больше чем на 0,05 с. '
        'Последнее слово на короткость не проверяется: звезда держит мелизм, всплеск буквы — один кадр.',
        '',
        '| язык | принято по оценке | ≤ 0,3 с | > 0,7 с | поставлено |',
        '|---|---:|---:|---:|---:|',
    ]
    for lang, bucket in sorted((result.get('by_lang') or {}).items()):
        lines.append(
            f"| {lang} | {bucket['cued_accepted']} | {bucket['near']} | {bucket['false']} | {bucket['placed']} |"
        )
    if not result.get('by_lang'):
        lines.append('| — | 0 | 0 | 0 | 0 |')
    lines.append('')
    return '\n'.join(lines)


def load_gate(root: Path | None = None) -> tuple[str, float]:
    """Metric and threshold from calibration.json, or the test fallback."""
    from common import ROOT

    base = root or ROOT
    path = base / 'docs' / 'analysis' / 'bench' / 'calibration.json'
    if not path.is_file():
        return FALLBACK_METRIC, FALLBACK_THRESHOLD
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        metric = str(data.get('metric') or FALLBACK_METRIC)
        threshold = float(data['threshold'])
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return FALLBACK_METRIC, FALLBACK_THRESHOLD
    if metric not in METRICS:
        metric = FALLBACK_METRIC
    return metric, threshold


def _metric_values(res: dict | None, roman: list[str], words: list) -> tuple[float | None, float | None, float | None, int]:
    """Letter mean, word mean, word min, and how many letter posteriors the line used."""
    if res is None:
        return None, None, None, 0
    letter = res.get('score')
    word_scores = []
    for rm, word in zip(roman, words):
        if rm and word is not None and word.get('score') is not None:
            word_scores.append(float(word['score']))
    return (
        None if letter is None else float(letter),
        float(sum(word_scores) / len(word_scores)) if word_scores else None,
        min(word_scores) if word_scores else None,
        int(res.get('n') or 0),
    )


def collect(slug: str) -> Path:
    """One MMS pass in the cue window. Writes score rows and reuses the emission cache."""
    import align as A
    import features as F
    import timing as T
    from common import load_audio, load_json, song_dir, vocal_stem, work_dir

    lyrics = load_json(song_dir(slug) / 'lyrics.json')
    audio, _is_stem = vocal_stem(slug, None)
    x = load_audio(audio, F.SR)
    duration = len(x) / F.SR
    lp = A.emissions(slug, audio, x)
    vocab = A.vocabulary()
    rom = A.Romaniser()
    units = []
    for idx, (sec, line) in enumerate(T.vocal_lines(lyrics)):
        roman = [rom(w['w'], line['lang'], line['script']) for w in line['words']]
        units.append(A.Unit(idx, sec, line, roman, vocab))
    cues = A.load_cues(slug)
    passes = A.cue_pass(lp, units, cues, duration)
    rows = []
    for i, (u, p) in enumerate(zip(units, passes)):
        res = p['res']
        words = res['words'] if res else [None] * len(u.roman)
        letter, word_mean, word_min, n_letters = _metric_values(res, u.roman, words)
        raw = [None if w is None else w['f0'] / A.FPS for w in words]
        cue = cues.get(u.id)
        cue_start = None if cue is None else float(cue['start'])
        delta = A.line_drift(raw, u.roman, cue_start)
        starts: list[float | None] = []
        ends: list[float | None] = []
        for rm, w in zip(u.roman, words):
            if not rm:
                continue
            if w is None:
                starts.append(None)
                ends.append(None)
            else:
                starts.append(w['f0'] / A.FPS)
                ends.append(w['f1'] / A.FPS)
        next_cue = None
        for nxt in units[i + 1:]:
            nxt_cue = cues.get(nxt.id)
            if nxt_cue is not None:
                next_cue = float(nxt_cue['start'])
                break
        ok, why = structural(starts, ends, next_cue)
        rows.append({
            'id': u.id, 'lang': u.line['lang'], 'slug': slug,
            'letter': None if letter is None else round(letter, 6),
            'word_mean': None if word_mean is None else round(word_mean, 6),
            'word_min': None if word_min is None else round(word_min, 6),
            'n_letters': n_letters,
            'gap': None if res is None or res.get('gap') is None else round(float(res['gap']), 4),
            'delta': None if delta is None else round(float(delta), 4),
            'structure_ok': ok, 'structure': why,
            'cue': None if cue_start is None else round(cue_start, 3),
        })
    path = work_dir(slug) / 'score-rows.json'
    path.write_text(json.dumps({'slug': slug, 'rows': rows}, ensure_ascii=False, indent=1), encoding='utf-8')
    placed_guess = sum(1 for row in rows if row['delta'] is not None and row['structure_ok'] and round(row['delta'], 3) <= NEAR)
    print(f'{slug}: строк {len(rows)}, с репликой {sum(1 for row in rows if row["delta"] is not None)}, '
          f'структура и |Δ| ≤ 0,3 с (ещё без порога оценки) {placed_guess}', flush=True)
    return path


def choose(paths: list[Path] | None = None) -> dict:
    """Read collected rows and write the bench table."""
    from common import ROOT

    if paths is None:
        paths = sorted(ROOT.glob('work/*/score-rows.json'))
    rows: list[dict] = []
    used = []
    for path in paths:
        data = json.loads(path.read_text(encoding='utf-8'))
        part = data['rows'] if isinstance(data, dict) else data
        rows.extend(part)
        used.append(str(path))
    if not rows:
        raise SystemExit('нет work/*/score-rows.json: сначала calibrate --collect')
    result = choose_threshold(rows)
    result['sources'] = used
    out_dir = ROOT / 'docs' / 'analysis' / 'bench'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'calibration.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    (out_dir / 'calibration.md').write_text(render_md(result), encoding='utf-8')
    share = result['false_share']
    print(f"порог {result['metric']} ≥ {result['threshold']}: ≤0,3 с {result['near']}, "
          f"ложных {result['false']} из {result['accepted']} ({share}), поставлено {result['placed']}, "
          f"ограничение {'да' if result['cap_met'] else 'нет'}", flush=True)
    print(f'→ {out_dir / "calibration.md"}')
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('slug', nargs='?')
    ap.add_argument('--collect', action='store_true')
    ap.add_argument('--choose', action='store_true')
    args = ap.parse_args()
    if args.choose:
        choose()
        return 0
    if args.collect:
        if not args.slug:
            raise SystemExit('нужен slug')
        collect(args.slug)
        return 0
    raise SystemExit('укажите --collect или --choose')


if __name__ == '__main__':
    sys.exit(main())
