"""Assemble docs/analysis/instrument-id-eval.md from files that were actually produced."""

from __future__ import annotations

import json

from fuse import song_sets
from paths import CONFUSION_PATH, EVAL_PATH, METRICS_PATH, ROOT, SONGS, WORK


def _pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f} %"


def _song_block(slug: str) -> list[str]:
    path = ROOT / "docs" / "analysis" / slug / "instrument-id.json"
    lines = [f"### {slug}", ""]
    if not path.is_file():
        lines.append(
            "Слушание не запускалось: нет `work/" + slug + "/source.m4a`. "
            "Локально ключа `AUDIO_KEY` нет, расшифровку не выдумываю. "
            "Команда на машине, где файл уже расшифрован: `python scripts/instrument_id/run.py songs`."
        )
        lines.append("")
        return lines
    payload = json.loads(path.read_text(encoding="utf-8"))
    table = song_sets(slug, payload)
    lines.append(f"Модель: `{payload.get('model')}`. Некоммерческие веса: {'да' if payload.get('noncommercial') else 'нет'}. Титры в модель не подавались.")
    lines.append("")
    lines.append("| стем | что сказал звук |")
    lines.append("|---|---|")
    for name, source in payload.get("sources", {}).items():
        named = [seg["name"] for seg in source.get("segments", []) if seg.get("kind") == "instrument"]
        brief = ", ".join(named) if named else "инструмент не назван"
        lines.append(f"| {name} | {brief} |")
    lines.append("")
    fusion_path = ROOT / "docs" / "analysis" / slug / "fusion.json"
    if fusion_path.is_file():
        fused = json.loads(fusion_path.read_text(encoding="utf-8"))
        accepted = [f"{item['name']} {item['start']}–{item['end']}" + (f" ({item['review']})" if item.get("review") else "") for item in fused.get("accepted", [])]
        check = sorted({item["name"] for item in fused.get("check", [])})
        lines.append("Принято (не одним звуком): " + (", ".join(accepted) if accepted else "ничего") + ".")
        lines.append("Проверить, в решения не входит: " + (", ".join(check) if check else "ничего") + ".")
        lines.append(f"Принятых одним звуком: {len(fused.get('audioAloneAccepted') or [])}.")
        lines.append("")
    lines.append(f"В титрах найдено по словам модели, ещё до сведения: {', '.join(table['found']) or '—'}.")
    lines.append(f"В титрах не найдено: {', '.join(table['missed']) or '—'}.")
    if table["foundGroups"] or table["missedGroups"]:
        lines.append(f"Группы титров найдены: {', '.join(table['foundGroups']) or '—'}; не найдены: {', '.join(table['missedGroups']) or '—'}.")
    lines.append(f"Лишние относительно титров: {', '.join(table['extras']) or '—'}.")
    described = table["describedNotInCredits"]
    if described:
        lines.append(
            "В отзыве, но не в credits (в знаменатель не входит): "
            + ", ".join(described)
            + ". Из них модель назвала: "
            + (", ".join(table["describedAlsoPredicted"]) or "ничего")
            + "."
        )
    vision = ROOT / "docs" / "analysis" / slug / "vision.json"
    if vision.is_file():
        lines.append(f"Кадры: `{vision.relative_to(ROOT).as_posix()}`.")
    else:
        lines.append("Файла видео нет, `vision.json` не написан.")
    lines.append("")
    return lines


def _kept_vision(existing: str) -> list[str] | None:
    """The runner has no local contact sheet. Keep the self-test already written into the report."""
    marker = "## Глаза"
    if marker not in existing:
        return None
    rest = existing.split(marker, 1)[1]
    next_heading = rest.find("\n## ")
    body = rest if next_heading < 0 else rest[:next_heading]
    return [marker + body.rstrip(), ""]


def _vision_block() -> list[str]:
    score_path = WORK / "vision-selftest" / "score.json"
    lines = ["## Глаза", ""]
    lines.append(
        "Концертного файла `work/<slug>/video.*` нет, поэтому `docs/analysis/<slug>/vision.json` для трёх песен не заполнялся. "
        "Проверка глаз — один контактный лист из 16 гравюр каталога: время вписано в кадр, имя инструмента в кадр не вписано."
    )
    lines.append("")
    if not score_path.is_file():
        lines.append("Лист ещё не отправлялся в Antigravity. Команда: `python scripts/instrument_id/run.py vision-selftest`.")
        lines.append("")
        return lines
    score = json.loads(score_path.read_text(encoding="utf-8"))
    lines.append(
        f"Кадров {score['cells']}. Модель назвала нарисованный инструмент в {score['named']}. "
        f"Сказала, что на нём играют, в {score['playingClaimed']}. "
        f"Назвала другой инструмент вместо этого в {score['otherInstrument']}. "
        f"Не разобрала кадр в {score['unseen']}."
    )
    lines.append(score.get("note", ""))
    lines.append("")
    lines.append("| время | класс | назван | «играет» | другие | как ответила |")
    lines.append("|---|---|---|---|---|---|")
    for row in score.get("rows", []):
        lines.append(
            f"| {row['time_s']} | {row['id']} | {'да' if row['named'] else 'нет'} | "
            f"{'да' if row['playingClaimed'] else 'нет'} | {', '.join(row['otherIds']) or '—'} | {', '.join(row['raw']) or '—'} |"
        )
    lines.append("")
    return lines


def _openset_block() -> list[str]:
    path = ROOT / "docs" / "analysis" / "instrument-id-openset.json"
    if not path.is_file():
        return ["## Открытое множество", "", "Leave-class-out ещё не считался.", ""]
    payload = json.loads(path.read_text(encoding="utf-8"))
    lines = [
        "## Открытое множество",
        "",
        "Класс убирается из обучения целиком. Порог выбирается на проверке и замораживается на отложенных группах этого класса.",
        "Цель: отвергнуть не меньше 90 % чужих клипов и оставить не меньше 80 % покрытия на своих.",
        f"Выбранный по среднему отвержению способ: `{payload.get('chosen') or '—'}`. "
        "Таблица — заново обученная голова на каждом выкинутом классе. "
        + (
            "Ни один способ не дал порог, на котором цель держится."
            if not any(row.get("goalMet") for row in payload.get("summary", {}).values())
            else "Способ с наибольшим числом классов, где цель взята, записан в веса."
        ),
        "",
        "| способ | классов, где цель взята | среднее отвержение чужих | среднее покрытие своих |",
        "|---|---|---|---|",
    ]
    for name, row in payload.get("summary", {}).items():
        lines.append(
            f"| {name} | {row['goalMet']} / {row['classes']} | {_pct(row['meanOodRejection'])} | {_pct(row['meanIdCoverage'])} |"
        )
    lines += [
        "",
        "| класс | softmax: отвергнут, покрытие своих | махаланобис | knn |",
        "|---|---|---|---|",
    ]
    for row in payload.get("perClass", []):
        def cell(method: str, row=row) -> str:
            point = row.get(method) or {}
            return f"{_pct(point.get('oodRejection'))}, {_pct(point.get('idCoverage'))}"
        lines.append(f"| {row['name']} | {cell('softmax')} | {cell('mahalanobis')} | {cell('knn')} |")
    lines.append("")
    lines.append(payload.get("note") or "")
    lines.append("")
    return lines


def _anchor_block() -> list[str]:
    path = ROOT / "docs" / "analysis" / "instrument-id-anchors.json"
    if not path.is_file():
        return ["## Якоря", "", "Якоря ещё не собраны.", ""]
    payload = json.loads(path.read_text(encoding="utf-8"))
    lines = [
        "## Якоря",
        "",
        "Отрезок берётся из инструментальной секции `lyrics.json`, где назван ключ каталога, кроме голого ансамбля. Это тест, не обучение.",
        "Провал — только чужой класс в принятых решениях. Отказ и список «проверить» провалом не считаются.",
        "",
    ]
    for song in payload.get("songs", []):
        lines.append(f"### {song['slug']}")
        lines.append("")
        lines.append(f"Чужих принятых: {song['failures']}.")
        lines.append("")
        lines.append("| с | по | якорь | вердикт | что сказал звук |")
        lines.append("|---|---|---|---|---|")
        for row in song.get("anchors", []):
            said = ", ".join(row.get("said") or []) or "—"
            lines.append(
                f"| {row['start']} | {row['end']} | {row['catalogKey']} | {row['verdict']} | {said} |"
            )
        lines.append("")
    return lines


def _sources_block() -> list[str]:
    path = ROOT / "docs" / "analysis" / "instrument-id-sources.json"
    lines = ["## Наши инструменты", ""]
    if not path.is_file():
        lines.append("Манифест источников ещё не собран.")
        lines.append("")
        return lines
    rows = json.loads(path.read_text(encoding="utf-8"))
    lines.append("Цель на класс: не меньше 15 клипов из 3 разных записей. Чего не набралось, в голову не входит.")
    lines.append("")
    lines.append("| класс | клипов | записей | в голове |")
    lines.append("|---|---|---|---|")
    for row in rows:
        lines.append(
            f"| {row['id']} | {row.get('clips', '—')} | {row.get('recordings', '—')} | "
            f"{'да' if row.get('enough') else 'нет'} |"
        )
    lines.append("")
    for row in rows:
        note = (row.get("note") or "").strip()
        if note and not row.get("enough"):
            lines.append(f"- {row['id']}: {note}")
    if any((row.get("note") or "").strip() and not row.get("enough") for row in rows):
        lines.append("")
    return lines


def _stems_block() -> list[str]:
    path = ROOT / "docs" / "analysis" / "instrument-id-stems.json"
    lines = ["## Стем или смесь", ""]
    if not path.is_file():
        lines.append("Сравнение на якорях ещё не запускалось.")
        lines.append("")
        return lines
    payload = json.loads(path.read_text(encoding="utf-8"))
    published = payload.get("published") or "mix"
    lines.append(
        f"Выбор сравнения: `{payload.get('choice')}`. В решение пошло: `{published}`. {payload.get('note') or ''}"
    )
    lines.append("")
    lines.append("| песня | статус | лучше | чужих якорей, смесь | чужих якорей, стем |")
    lines.append("|---|---|---|---|---|")
    for song in payload.get("songs", []):
        wrong = song.get("wrongAnchors") or {}
        lines.append(
            f"| {song.get('slug')} | {song.get('status')} | {song.get('better') or '—'} | "
            f"{wrong.get('mix', '—')} | {wrong.get('stem', '—')} |"
        )
    lines.append("")
    return lines


def _loso_block() -> list[str]:
    path = ROOT / "docs" / "analysis" / "instrument-id-loso.json"
    lines = ["## Leave-one-song-out", ""]
    if not path.is_file():
        lines.append("Прогон не записан.")
        lines.append("")
        return lines
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("status") != "ok":
        lines.append(payload.get("reason") or "Не считалось.")
        lines.append("")
        return lines
    lines.append(payload.get("note") or "")
    lines.append("")
    for song in payload.get("songs", []):
        lines.append(f"- {song['slug']}: {song.get('status')}, клипов {song.get('n')}, верно {song.get('correct', '—')}.")
    lines.append("")
    return lines


def write_report() -> None:
    existing = EVAL_PATH.read_text(encoding="utf-8") if EVAL_PATH.is_file() else ""
    lines = [
        "# Своё распознавание инструментов",
        "",
        "Отчёт собран из файлов прогона. Числа, которых нет в `instrument-id-metrics.json`, сюда не подставляются.",
        "",
    ]
    if not METRICS_PATH.is_file():
        lines.append("Обучение ещё не записано. После `python scripts/instrument_id/run.py all` этот файл заполнится метриками теста.")
        lines.append("")
    else:
        metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        meta = metrics["meta"]
        lines += [
            "## Что обучено",
            "",
            f"Энкодер `{meta['embedding']}`, размер признака {meta['featureDim']}, окно {meta['windowSec']} с, шаг на песне {meta['hopSec']} с.",
            f"Классов в голове: {len(meta['classes'])}. Мало примеров и поэтому вне головы: {', '.join(meta['fewExamples']) or 'нет'}.",
            f"Обучение / проверка / тест: {meta['counts']['train']} / {meta['counts']['val']} / {meta['counts']['test']}.",
            meta["split"],
            "",
            f"Веса некоммерческие: да. {meta['noncommercialReason']}",
            "Записи датасетов в git не входят. В репозитории только линейная голова `scripts/instrument_id/weights/probe.npz`.",
            "Голова без IRMAS основной не стала: голос, фортепиано и гитара взяты только из IRMAS. "
            "Без них якорь голоса нельзя закрыть верным классом. Условие NC-SA записано в `scripts/instrument_id/weights/LICENSE.md`.",
            "",
            "## Порог отказа",
            "",
            f"Температура {meta['temperature']}. Порог на проверке {meta['threshold']:.2f}. "
            f"Точность принятых на проверке {_pct(meta['valAcceptedPrecision'])}, покрытие {_pct(meta['valCoverage'])}. "
            + ("Порог под точность 90 % нашёлся." if meta["thresholdReached"] else "Точность 90 % на проверке не достигнута, в отчёте лучший из посчитанных порогов."),
            "",
        ]
        if meta.get("threshold95") is None:
            lines.append("Порог под точность 95 % на проверке не найден. Очень высокая уверенность одного звукового источника тогда равна порогу 90 %, и это сказано в решении сведения.")
        else:
            lines.append(
                f"Порог под точность 95 %: {meta['threshold95']:.2f} "
                f"(на проверке {_pct(meta.get('valAcceptedPrecision95'))}, покрытие {_pct(meta.get('valCoverage95'))})."
            )
        lines += [
            "",
            f"На тесте, порог заморожен: точность без отказа {_pct(metrics['accuracy'])}, макро-ф1 {_pct(metrics['macroF1'])}. "
            f"Для одного верного класса на клип микро-ф1 совпадает с точностью ({_pct(metrics['microF1'])}). "
            f"Точность принятых {_pct(metrics['acceptedPrecision'])}, покрытие {_pct(metrics['coverage'])}, клипов {metrics['testN']}.",
            "",
            "### По классам, без отказа",
            "",
            "| класс | точность | полнота | ф1 | опора |",
            "|---|---|---|---|---|",
        ]
        for row in metrics["perClass"]:
            if row["support"] == 0:
                continue
            lines.append(
                f"| {row['name']} | {_pct(row['precision'])} | {_pct(row['recall'])} | {_pct(row['f1'])} | {row['support']} |"
            )
        lines += ["", "### По источникам теста", ""]
        for source, row in metrics["bySource"].items():
            lines.append(
                f"- {source}: клипов {row['n']}, точность {_pct(row['accuracy'])}, "
                f"принятая точность {_pct(row['acceptedPrecision'])}, покрытие {_pct(row['coverage'])}."
            )
        fam = metrics["familyFallback"]
        lines += [
            "",
            "### Семья, когда инструмент не принят",
            "",
            f"Таких клипов {fam['n']}. Доля, где семья верна: {_pct(fam['correct'])}. "
            f"Порог семьи {fam['minProb']} — это не калибровка на 90 %.",
            "",
            "### Уверенность и точность на тесте",
            "",
            "| от | до | клипов | точность |",
            "|---|---|---|---|",
        ]
        for bin_row in metrics["bins"]:
            lines.append(f"| {bin_row['lo']:.1f} | {bin_row['hi']:.1f} | {bin_row['n']} | {_pct(bin_row['accuracy'])} |")
        lines += [
            "",
            f"Матрица ошибок (строка — истина, столбец — ответ, без отказа): `{CONFUSION_PATH.relative_to(ROOT).as_posix()}`.",
            "",
        ]
    lines += ["## Три песни без подсказки титрами", ""]
    lines.append("Знаменатель — только `credits` в `song.json`. Имена из отзыва, которых нет в credits, стоят отдельной фразой.")
    lines.append("")
    for slug in SONGS:
        lines.extend(_song_block(slug))
    if (WORK / "vision-selftest" / "score.json").is_file():
        lines.extend(_vision_block())
    else:
        kept = _kept_vision(existing)
        lines.extend(kept if kept is not None else _vision_block())
    lines.extend(_openset_block())
    lines.extend(_anchor_block())
    lines.extend(_sources_block())
    lines.extend(_stems_block())
    lines.extend(_loso_block())
    lines += [
        "## Чего модель по звуку не знает",
        "",
        "Класс без 15 клипов из 3 записей в голову не входит. "
        "Чужой звук закрытая голова может уверенно назвать ближайшим знакомым классом: порог softmax это не лечит. "
        "Такой ответ не становится решением, если его не подтвердил второй источник. "
        "Кадр концерта — второй источник, и только если владелец положил файл видео.",
        "",
    ]
    EVAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVAL_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(EVAL_PATH)
