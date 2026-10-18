"""Taxonomy: labels.json is the machine list. This module loads it and matches names.

Matching is by consecutive tokens, longest name first, so «тар» does not fire inside «гитара»
and «классическая гитара» wins over the bare family word «гитара».
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from paths import LABELS_PATH, TAXONOMY_PATH

_TOKEN = re.compile(r"[0-9A-Za-z\u00c0-\u024f\u0400-\u04ff\u0600-\u06ff\u0530-\u058f]+", re.UNICODE)


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold().replace("ё", "е")
    return text.replace("â", "a").replace("ğ", "g").replace("ş", "s").replace("ı", "i")


def tokenize(text: str) -> list[str]:
    return [fold(tok) for tok in _TOKEN.findall(text)]


@lru_cache(maxsize=1)
def load(path: str | None = None) -> dict:
    raw = Path(path or LABELS_PATH).read_text(encoding="utf-8")
    data = json.loads(raw)
    data["by_id"] = {item["id"]: item for item in data["instruments"]}
    data["family_by_id"] = {item["id"]: item for item in data["families"]}
    return data


def _phrases(data: dict) -> list[dict]:
    rows = []
    for item in data["instruments"]:
        for name in item["names"]:
            tokens = tokenize(name)
            if tokens:
                rows.append({"tokens": tokens, "id": item["id"], "family": None, "group": None, "chars": len(name)})
    for extra in data.get("extraPhrases", []):
        tokens = tokenize(extra["phrase"])
        if tokens:
            rows.append({
                "tokens": tokens,
                "id": extra.get("id"),
                "family": extra.get("family"),
                "group": extra.get("group"),
                "chars": len(extra["phrase"]),
            })
    return rows


def _best(text: str, rows: list[dict]) -> list[dict]:
    tokens = tokenize(text)
    hits = []
    for row in rows:
        need = row["tokens"]
        width = len(need)
        if width == 0 or width > len(tokens):
            continue
        for i in range(len(tokens) - width + 1):
            if tokens[i:i + width] == need:
                hits.append(row)
                break
    if not hits:
        return []
    best = max((len(row["tokens"]), row["chars"]) for row in hits)
    return [row for row in hits if (len(row["tokens"]), row["chars"]) == best]


def match_ids(text: str, data: dict | None = None) -> list[str]:
    """Instrument ids named by text. Empty when nothing in the taxonomy is named."""
    data = data or load()
    found = []
    for row in _best(text, _phrases(data)):
        if row["id"] and row["id"] not in found:
            found.append(row["id"])
    return found


def match_credit(part: str, data: dict | None = None) -> dict | None:
    """One comma-separated credit role. Longest phrase wins. None if it names no instrument."""
    data = data or load()
    hits = _best(part, _phrases(data))
    if not hits:
        return None
    row = hits[0]
    return {"id": row["id"], "family": row["family"], "group": row["group"], "part": part.strip()}


def credit_targets(role: str, data: dict | None = None) -> list[dict]:
    data = data or load()
    out = []
    seen = set()
    for part in re.split(r"[,;/]| и ", role):
        hit = match_credit(part, data)
        if not hit:
            continue
        key = (hit["id"], hit["family"], hit["group"])
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
    return out


def catalog_keys_from_list_ts(list_ts: Path) -> list[str]:
    text = list_ts.read_text(encoding="utf-8")
    return re.findall(r"key:\s*'([^']+)'", text)


def drawing_gaps(data: dict | None = None) -> list[dict]:
    data = data or load()
    return [item for item in data["instruments"] if not item.get("catalogKey")]


def write_doc(path: Path | None = None) -> Path:
    data = load()
    path = path or TAXONOMY_PATH
    bar = data["heldOutRecording"]
    families = {item["id"]: item for item in data["families"]}
    lines = [
        "# Таксономия инструментов",
        "",
        "Машинный список — `scripts/instrument_id/labels.json`. Этот файл собран из него",
        "(`python scripts/instrument_id/taxonomy.py --write-doc`) и расходится с ним только если его забыли пересобрать.",
        "",
        f"Классов: {len(data['instruments'])}. Семейств: {len(data['families'])}.",
        "В голову распознавания попадает класс, у которого в обучающей выборке не меньше",
        f"{data['minExamples']} примеров. Свой класс из манифеста дополнительно проверяется на записи,",
        f"которой не было в обучении: точность не ниже {str(bar['minPrecision']).replace('.', ',')}, "
        f"полнота не ниже {str(bar['minRecall']).replace('.', ',')}, опора не меньше {bar['minSupport']} окон.",
        "Классы TinySOL и IRMAS этой проверкой не режутся. Остальные остаются в таксономии: модель по ним молчит",
        "или, если уверена семья, отдаёт имя семьи («лютня», «смычковые», «рамочный барабан»), а не чужой инструмент.",
        "",
        "Ключ каталога сайта (`src/instruments/list.ts`) стоит только там, где гравюра изображает именно этот класс.",
        "Гравюра `guitar` — гитара фламенко, поэтому она связана с `guitar-flamenco`.",
        "Акустическая, электрическая и классическая гитара ключ каталога не получают.",
        "",
        "## Семьи",
        "",
        "| id | как говорить, если инструмент не назван | семья на сайте |",
        "|---|---|---|",
    ]
    for fam in data["families"]:
        site = fam["siteFamily"] or "— нет в каталоге —"
        lines.append(f"| `{fam['id']}` | {fam['abstain']} | {site} |")
    lines += [
        "",
        "Семьи сайта крупнее наших. «Струнные щипковые» собирают лютни, цитры, арфы и гитары.",
        "«Духовые» собирают флейты, язычковые и медь. «Ударные» собирают рамочные, кубкообразные,",
        "ручные барабаны и оркестровую перкуссию. В отказ модель говорит узким именем из средней колонки,",
        "не именем сайта.",
        "",
        "## Инструменты",
        "",
        "| id | имя | семья | гравюра |",
        "|---|---|---|---|",
    ]
    for item in data["instruments"]:
        grav = f"`{item['catalogKey']}`" if item.get("catalogKey") else "нет"
        lines.append(f"| `{item['id']}` | {item['name']} | {families[item['family']]['name']} | {grav} |")
    gaps = drawing_gaps(data)
    lines += [
        "",
        "## Где гравюры нет",
        "",
        f"Без рисунка в каталоге: {len(gaps)} классов. Их можно узнать по звуку или по кадру, но на сцену",
        "поставить нечего, пока гравюру не добавят обычным путём из `docs/methodology/09-instruments.md`.",
        "",
    ]
    by_fam: dict[str, list[str]] = {}
    for item in gaps:
        by_fam.setdefault(item["family"], []).append(item["name"])
    for fam_id, names in by_fam.items():
        lines.append(f"- {families[fam_id]['name']}: {', '.join(names)}.")
    lines += [
        "",
        "Какие классы с гравюрой уже в голове, а какие молчат, пока нет 15 клипов из 3 записей",
        "или пока чужая запись не держит порог, написано в разделе «Наши инструменты»",
        "файла `docs/analysis/instrument-id-eval.md`.",
        "Голос в обучающем IRMAS есть. Ансамбль отдельным классом головы не является.",
        "",
        "## Как добавить инструмент",
        "",
        "1. Дописать объект в `labels.json`: `id`, `name`, `family` из списка семей, `catalogKey` или `null`, `names` (как класс называют в титрах и на кадре).",
        "2. Собрать примеры без ключа, как в `docs/methodology/09-instruments.md`: манифест `scripts/instrument_id/sources/<id>.csv`, звук только в `work/instrument_id/extra/<id>/`. Класс без 15 клипов из 3 записей в голову не входит. Свой класс, который на чужой записи не держит порог `heldOutRecording`, тоже не входит.",
        "3. Переобучить одной командой из `docs/methodology/09-instruments.md` и прочитать новый отчёт.",
        "4. Пересобрать эту страницу: `python scripts/instrument_id/taxonomy.py --write-doc`.",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


if __name__ == "__main__":
    import sys
    if "--write-doc" in sys.argv:
        print(write_doc())
    else:
        data = load()
        print(f"{len(data['instruments'])} instruments, {len(data['families'])} families")
