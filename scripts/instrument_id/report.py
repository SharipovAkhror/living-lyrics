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
    lines.append("| стем | отрезки инструментов |")
    lines.append("|---|---|")
    for name, source in payload.get("sources", {}).items():
        named = [seg["name"] for seg in source.get("segments", []) if seg.get("kind") == "instrument"]
        brief = ", ".join(named) if named else "принятых инструментов нет"
        lines.append(f"| {name} | {brief} |")
    lines.append("")
    lines.append(f"В титрах найдено: {', '.join(table['found']) or '—'}.")
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


def write_report() -> None:
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
    lines.extend(_vision_block())
    lines += [
        "## Чего модель по звуку не знает",
        "",
        "Уд, най, даф, канун, танбур, кяманча и остальные классы без примеров в голове не появляются. "
        "Путаница скрипки с кяманчой возможна и будет лишней относительно титров, а не доказательством класса. "
        "Кадр концерта — второй источник, и только если владелец положил файл видео.",
        "",
    ]
    EVAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVAL_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(EVAL_PATH)
