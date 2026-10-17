"""Download TinySOL and the IRMAS training zip, then write work/instrument_id/index.jsonl.

Only those two official Zenodo files are fetched. The IRMAS test parts are several
extra gigabytes and are not the split used here. Audio is not committed.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import tarfile
import urllib.request
import zipfile
from pathlib import Path

from paths import DATA, WORK
from taxonomy import load

TINY_URL = "https://zenodo.org/records/3685367/files/TinySOL.tar.gz?download=1"
IRMAS_URL = "https://zenodo.org/records/1290750/files/IRMAS-TrainingData.zip?download=1"

# Sizes and md5 were read from the Zenodo API on 2026-10-17.
FILES = (
    {
        "name": "TinySOL.tar.gz",
        "url": TINY_URL,
        "bytes": 1026917185,
        "md5": "36030a7fe389da86c3419e5ee48e3b7f",
        "license": "CC BY 4.0",
        "record": "https://doi.org/10.5281/zenodo.3685367",
    },
    {
        "name": "IRMAS-TrainingData.zip",
        "url": IRMAS_URL,
        "bytes": 3181049879,
        "md5": "4fd9f5ed5a18d8e2687e6360b5f60afe",
        "license": "CC BY-NC-SA 4.0",
        "record": "https://doi.org/10.5281/zenodo.1290750",
    },
)

# TinySOL "Instrument name in full" → taxonomy id. The archive is one studio.
TINY_NAMES = {
    "bass tuba": "tuba",
    "french horn": "french-horn",
    "trombone": "trombone",
    "trumpet in c": "trumpet",
    "accordion": "accordion",
    "contrabass": "double-bass",
    "violin": "violin",
    "viola": "viola",
    "violoncello": "cello",
    "cello": "cello",
    "bassoon": "bassoon",
    "clarinet in b-flat": "clarinet",
    "clarinet in bb": "clarinet",
    "flute": "flute",
    "oboe": "oboe",
    "alto saxophone": "saxophone",
}

# IRMAS training folder / filename prefix. Predominant instrument, not the polyphonic test set.
IRMAS_CODES = {
    "cel": "cello",
    "cla": "clarinet",
    "flu": "flute",
    "gac": "guitar-acoustic",
    "gel": "guitar-electric",
    "org": "organ",
    "pia": "piano",
    "sax": "saxophone",
    "tru": "trumpet",
    "vio": "violin",
    "voi": "voice",
}

INDEX_PATH = WORK / "index.jsonl"
STAMP_PATH = WORK / "download-stamp.json"


def _md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_one(spec: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    dest = DATA / spec["name"]
    if dest.is_file() and dest.stat().st_size == spec["bytes"]:
        print(f"уже на месте: {dest.name} ({spec['bytes']} байт)")
        return
    if dest.is_file() and dest.stat().st_size < spec["bytes"]:
        raise SystemExit(
            f"{dest.name} ещё не докачан ({dest.stat().st_size} из {spec['bytes']}). "
            "Не начинаю вторую загрузку поверх файла."
        )
    print(f"качаю {spec['url']}")
    urllib.request.urlretrieve(spec["url"], dest)
    if dest.stat().st_size != spec["bytes"]:
        raise SystemExit(f"размер {dest.name} = {dest.stat().st_size}, ждали {spec['bytes']}")


def download() -> None:
    for spec in FILES:
        _download_one(spec)
    stamp = {}
    for spec in FILES:
        dest = DATA / spec["name"]
        print(f"md5 {dest.name} …")
        got = _md5(dest)
        if got != spec["md5"]:
            raise SystemExit(f"md5 {dest.name}: {got}, на Zenodo {spec['md5']}")
        stamp[spec["name"]] = {"bytes": spec["bytes"], "md5": got, "license": spec["license"], "record": spec["record"]}
    STAMP_PATH.write_text(json.dumps(stamp, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"штамп {STAMP_PATH}")


def _safe_tar(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as handle:
        extract = getattr(tarfile, "data_filter", None)
        if extract:
            handle.extractall(dest, filter="data")
        else:
            handle.extractall(dest)


def _safe_zip(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as handle:
        for info in handle.infolist():
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                raise SystemExit(f"опасный путь в zip: {name}")
        handle.extractall(dest)


def extract() -> tuple[Path, Path]:
    tiny_root = DATA / "tinysol"
    irmas_root = DATA / "irmas"
    if not any(tiny_root.rglob("*.wav")):
        print("распаковка TinySOL")
        _safe_tar(DATA / "TinySOL.tar.gz", tiny_root)
    if not any(irmas_root.rglob("*.wav")):
        print("распаковка IRMAS")
        _safe_zip(DATA / "IRMAS-TrainingData.zip", irmas_root)
    return tiny_root, irmas_root


def _hash_split(group: str, seed: int) -> str:
    digest = hashlib.sha256(f"{seed}:{group}".encode("utf-8")).hexdigest()
    x = int(digest[:8], 16) / 0xFFFFFFFF
    if x < 0.60:
        return "train"
    if x < 0.80:
        return "val"
    return "test"


def _tiny_rows(root: Path) -> list[dict]:
    csv_path = next(root.rglob("TinySOL_metadata.csv"), None)
    if csv_path is None:
        raise SystemExit("в TinySOL нет TinySOL_metadata.csv — раскладку не выдумываю")
    base = csv_path.parent
    rows = []
    with csv_path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise SystemExit("пустой заголовок TinySOL_metadata.csv")
        fields = {name.casefold(): name for name in reader.fieldnames}
        path_key = next(fields[k] for k in fields if "path" in k)
        name_key = next(fields[k] for k in fields if "instrument" in k and "full" in k)
        fold_key = next(fields[k] for k in fields if k.startswith("fold"))
        pitch_key = next((fields[k] for k in fields if k == "pitch"), None)
        for record in reader:
            rel = record[path_key].strip().replace("\\", "/")
            wav = base / rel
            if not wav.is_file():
                hits = list(base.rglob(Path(rel).name))
                if len(hits) != 1:
                    raise SystemExit(f"нет файла TinySOL {rel} (совпадений {len(hits)})")
                wav = hits[0]
            instrument = TINY_NAMES.get(record[name_key].strip().casefold())
            if instrument is None:
                raise SystemExit(f"неизвестное имя TinySOL: {record[name_key]!r}")
            fold = int(float(record[fold_key]))
            if fold in (0, 1, 2):
                split = "train"
            elif fold == 3:
                split = "val"
            elif fold == 4:
                split = "test"
            else:
                raise SystemExit(f"fold TinySOL вне 0–4: {fold}")
            pitch = record[pitch_key].strip() if pitch_key else ""
            rows.append({
                "path": str(wav),
                "id": instrument,
                "group": f"tinysol:{instrument}:{pitch}:{fold}:{wav.stem}",
                "split": split,
                "source": "tinysol",
                "license": "CC BY 4.0",
                "optimistic": True,
                "note": "официальный fold TinySOL; исполнитель один и тот же, разбиение оптимистичное",
            })
    if len(rows) < 2000:
        raise SystemExit(f"TinySOL дал {len(rows)} строк, ждали около 2913")
    return rows


def _irmas_rows(root: Path, seed: int) -> list[dict]:
    import re
    pattern = re.compile(r"\[([a-z]{3})\]\[[^\]]+\](\d+)__\d+", re.IGNORECASE)
    wavs = [p for p in root.rglob("*.wav")]
    if not wavs:
        raise SystemExit("в распакованном IRMAS нет wav")
    rows = []
    unknown = []
    for wav in wavs:
        code = None
        excerpt = None
        match = pattern.search(wav.name)
        if match:
            code = match.group(1).lower()
            excerpt = match.group(2)
        else:
            for part in wav.parts:
                if part.lower() in IRMAS_CODES:
                    code = part.lower()
                    excerpt = wav.stem
                    break
        if code not in IRMAS_CODES:
            unknown.append(str(wav))
            continue
        instrument = IRMAS_CODES[code]
        group = f"irmas:{code}:{excerpt}"
        rows.append({
            "path": str(wav),
            "id": instrument,
            "group": group,
            "split": _hash_split(group, seed),
            "source": "irmas",
            "license": "CC BY-NC-SA 4.0",
            "optimistic": True,
            "note": "группа — номер отрывка в имени файла, не исполнитель; официальный тест IRMAS не скачивался",
        })
    if unknown:
        sample = "\n".join(unknown[:8])
        raise SystemExit(f"не разобрал {len(unknown)} файлов IRMAS, например:\n{sample}")
    if len(rows) < 1000:
        raise SystemExit(f"IRMAS дал {len(rows)} файлов — мало для обучающего набора")
    return rows


def _cap_irmas(rows: list[dict], cap: int, seed: int) -> list[dict]:
    """Keep whole excerpt-groups, in a seeded order, until the class reaches the file cap."""
    by_class: dict[str, dict[str, list[dict]]] = {}
    for row in rows:
        by_class.setdefault(row["id"], {}).setdefault(row["group"], []).append(row)
    kept = []
    for instrument, groups in by_class.items():
        order = sorted(groups)
        stable = int(hashlib.sha256(instrument.encode("utf-8")).hexdigest()[:8], 16)
        random.Random(seed + stable).shuffle(order)
        count = 0
        for group in order:
            members = groups[group]
            if count >= cap:
                break
            kept.extend(members)
            count += len(members)
    return kept


def _extra_rows(data: dict) -> list[dict]:
    root = WORK / "extra"
    if not root.is_dir():
        return []
    known = set(data["by_id"])
    rows = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        if folder.name not in known:
            raise SystemExit(f"extra/{folder.name} нет в labels.json")
        license_file = folder / "license.txt"
        license_name = license_file.read_text(encoding="utf-8").strip() if license_file.is_file() else "не записана"
        for wav in sorted(folder.rglob("*.wav")):
            rows.append({
                "path": str(wav),
                "id": folder.name,
                "group": f"extra:{folder.name}:{wav.stem}",
                "split": _hash_split(f"extra:{folder.name}:{wav.stem}", int(data["seed"])),
                "source": "extra",
                "license": license_name,
                "optimistic": False,
                "note": "пример владельца",
            })
    return rows


def prepare() -> Path:
    data = load()
    tiny_root, irmas_root = extract()
    rows = _tiny_rows(tiny_root)
    irmas = _irmas_rows(irmas_root, int(data["seed"]))
    before = len(irmas)
    irmas = _cap_irmas(irmas, int(data["irmasCapPerClass"]), int(data["seed"]))
    print(f"IRMAS: {before} файлов, после потолка {data['irmasCapPerClass']} на класс — {len(irmas)}")
    rows.extend(irmas)
    rows.extend(_extra_rows(data))
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with INDEX_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["id"]] = counts.get(row["id"], 0) + 1
    summary = ", ".join(f"{key}={counts[key]}" for key in sorted(counts))
    print(f"индекс {len(rows)} файлов → {INDEX_PATH}")
    print(summary)
    return INDEX_PATH


def read_index() -> list[dict]:
    if not INDEX_PATH.is_file():
        raise SystemExit("нет индекса. Сначала: python scripts/instrument_id/run.py prepare")
    rows = []
    for line in INDEX_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows
