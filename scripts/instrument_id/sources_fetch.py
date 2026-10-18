"""Download openly licensed instrument clips into work/ and write the git manifest.

Audio stays in work/instrument_id/extra/<id>/. The manifest is
scripts/instrument_id/sources/<id>.csv. A row with a non-empty flag is kept for
the report and is not a training example. A class needs at least 15 accepted
clips from at least 3 recordings. The file title is not a label: the Commons
file page is read again at download time.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio import ffmpeg_exe, probe_duration
from paths import ROOT, WORK

UA = "LivingLyricsInstrumentId/1.0 (https://github.com/SharipovAkhror/living-lyrics; instrument samples)"
MIN_CLIPS = 15
MIN_RECORDINGS = 3
CLIP_SEC = 2.0
HOP_SEC = 3.0
HOP_TIGHT = 2.0
MAX_CLIPS_PER_RECORDING = 6
MAX_CLIPS_TIGHT = 8
MAX_BYTES = 40_000_000
FIELDS = ["url", "license", "author", "recording", "start", "end", "source", "file", "flag"]
ERHU_API = "https://zenodo.org/api/records/4320991"
# title, recording id. One person keeps one recording id across pieces.
CATALOG: dict[str, list[tuple[str, str]]] = {
    "oud": [
        ("File:Oud music by Andy R. Jordan 1V2 long.mp3", "andy-r-jordan"),
        ("File:OUD.ogg", "houssem-bettaibi"),
        ("File:Oud open Strings.ogg", "user-bottomline"),
    ],
    "duduk": [
        ("File:Sound of Armenian Duduk.ogg", "ilya-mazia"),
        ("File:Duduk Music.wav", "ikuzusotnek"),
        ("File:SERGO.TEL - April - duduk-improvisation2.ogg", "sergo-tel"),
    ],
    "erhu": [
        ("File:二泉映月.ogg", "zhang-peijian"),
        ("File:江河水.ogg", "zhang-peijian"),
        ("File:Dances With Erhu (Antti Luode).mp3", "antti-luode"),
    ],
    "choir": [
        ('File:Advanced Choirs - "Ask the Moon" (Dec. 2009).ogg', "childrenschorussa"),
        ('File:Advanced Choirs - "Riu, Riu Chiu" (Nov. 2012).ogg', "childrenschorussa"),
        ("File:7.Mnogaia Leta.ogg", "plovdiv-sveta-troitsa"),
        ("File:Byrd 4-Part Mass - Kyrie.ogg", "ensemble-morales"),
        ("File:Harmonica sings Tourdion.flac", "harmonica"),
        ("File:Hoerprobe Kantorei St. Michael (Jena).ogg", "kantorei-st-michael"),
    ],
    "darbuka": [
        ("File:Darbuka.ogg", "cassa342"),
        ("File:Wahda Ejemplo.ogg", "derbake"),
        ("File:Zaffa Ejemplo.ogg", "derbake"),
        ("File:Saidi Ejemplo.ogg", "derbake"),
        ("File:Maksum Ejemplo.ogg", "derbake"),
        ("File:Baladi Ejemplo.ogg", "derbake"),
    ],
    "bendir": [
        ("File:Raksan (90 bpm).ogg", "anomyq"),
        ("File:Aksak (60 bpm).ogg", "anomyq"),
        ("File:Evfer (60 bpm).ogg", "anomyq"),
        ("File:Frenkçin (150 bpm).ogg", "anomyq"),
    ],
    "qanun": [
        ("File:ArabicQanunSample.ogg", "ariel-qassis"),
        ("File:TurkishKanunSample.ogg", "ariel-qassis"),
    ],
    "santur": [
        ("File:Turkish santur.ogv", "lizikus"),
        ("File:Ey Iran (Santoor).ogg", "iran-persian"),
    ],
    "setar": [
        ("File:Segah-Setar.ogg", "leyth"),
        ("File:Setar 1st string tuned to C, open string note.ogg", "jacqke"),
        ("File:Setar 1st string tuned to C, 5th fret E.ogg", "jacqke"),
        ("File:Setar 1st string tuned to C, 12th fret A.ogg", "jacqke"),
    ],
}
# Classes with no accepted file after the 2026-10-18 pass. The note is the reason.
EMPTY_NOTE = {
    "ney": "Поиск Commons «ney solo» и «nay taksim» не дал аудио с явной свободной лицензией. PCMIR без входа не открылся.",
    "daf": "Отдельного соло дафа с явной свободной лицензией не нашлось. Церемония зикра — голос, не соло.",
    "tar": "Запросы «persian tar», «azerbaijani tar» и «tar solo» не дали файла с явной свободной лицензией.",
    "tanbur": "На Commons лежат чумбуш и смычковый яйлы-танбур Озана Ярмана. Это не длинношейный танбур каталога, в манифест не входят.",
    "kamancheh": "Поиск не дал соло с явной лицензией. Карточка Hugging Face на 40 файлов лицензии не указывает.",
    "baglama": "Husseyni Saz Semayissi в описании — кеменче и уд, не саз. Другое найденное — MIDI и произношения.",
}
CORE = [
    "oud", "ney", "daf", "bendir", "darbuka", "qanun", "santur", "tar", "setar",
    "tanbur", "kamancheh", "baglama", "duduk", "erhu", "choir",
]
CHOIR_BLOCK = re.compile(r"orchestra|organ|vimeo|youtube|\balbum\b|midi|high hu|高胡", re.I)
GAOHU = re.compile(r"高胡|gaohu", re.I)


def _pause_for(exc: urllib.error.HTTPError, delay: float) -> float:
    if exc.code != 429:
        return delay
    retry = (exc.headers.get("Retry-After") or "").strip()
    if re.fullmatch(r"\d+", retry):
        return float(retry)
    return delay


def _get(url: str, timeout: int = 180) -> bytes:
    delay = 5.0
    last: Exception | None = None
    for attempt in range(6):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as handle:
                payload = handle.read()
            time.sleep(1.2)
            return payload
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429 and attempt < 5:
                pause = _pause_for(exc, delay)
                print(f"  429, пауза {pause:.0f} с", flush=True)
                time.sleep(pause)
                delay = min(delay * 2, 120)
                continue
            raise
        except Exception as exc:
            last = exc
            if attempt == 5:
                break
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise RuntimeError(f"{url}: {last}")


def _strip(value: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _license_ok(name: str) -> bool:
    text = name.lower().replace("–", "-").replace("—", "-")
    if "public domain mark" in text or "publicdomain/mark" in text:
        return False
    if re.search(r"\bnc\b|noncommercial|non-commercial|-nc\b|/nc\b", text):
        return False
    if re.search(r"\bnd\b|-nd\b|/nd\b|noderiv", text):
        return False
    if "copyrighted free use" in text:
        return False
    return any(piece in text for piece in (
        "cc by", "cc-by", "cc0", "cc-zero", "public domain", "publicdomain/zero",
        "fal", "free art",
    ))


def _lookup(titles: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for start in range(0, len(titles), 20):
        chunk = titles[start:start + 20]
        params = {
            "action": "query", "format": "json", "titles": "|".join(chunk),
            "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
        }
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
        payload = json.loads(_get(url))
        pages = (payload.get("query") or {}).get("pages") or {}
        for page in pages.values():
            title = page.get("title") or ""
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            found[title] = {
                "title": title,
                "missing": "missing" in page or not info.get("url"),
                "url": info.get("url") or "",
                "mime": info.get("mime") or "",
                "size": int(info.get("size") or 0),
                "license": _strip((meta.get("LicenseShortName") or {}).get("value") or ""),
                "author": _strip((meta.get("Artist") or {}).get("value") or "")[:180] or "не указан",
                "description": _strip((meta.get("ImageDescription") or {}).get("value") or "")[:400],
            }
    return found


def _allowed_page(instrument: str, page: dict) -> str:
    """Return a skip reason, or an empty string when the page may be downloaded."""
    if page.get("missing"):
        return "нет файла"
    if not _license_ok(page.get("license") or ""):
        return f"лицензия {page.get('license') or 'не указана'}"
    size = int(page.get("size") or 0)
    if size <= 0 or size > MAX_BYTES:
        return f"размер {size}"
    mime = page.get("mime") or ""
    if not (mime.startswith("audio/") or mime in {"application/ogg", "video/ogg", "application/flac"}):
        return f"mime {mime}"
    text = f"{page.get('title') or ''} {page.get('description') or ''}"
    if instrument == "erhu" and GAOHU.search(text):
        return "в описании гаоху"
    if instrument == "bendir" and "bendir" not in text.lower():
        return "описание не называет бендир"
    if instrument == "choir" and CHOIR_BLOCK.search(text):
        return "описание: орган, оркестр или чужой источник"
    if instrument == "darbuka" and re.search(r"\b(davul|riq|mazhar|tabl)\b", text, re.I):
        return "другой барабан"
    return ""


def _clips(duration: float, hop: float, cap: int) -> list[tuple[float, float]]:
    if duration < CLIP_SEC:
        return []
    if duration < hop + CLIP_SEC:
        start = max(0.0, (duration - CLIP_SEC) / 2)
        return [(round(start, 3), round(start + CLIP_SEC, 3))]
    clips = []
    t = 0.0
    while t + CLIP_SEC <= duration + 0.05 and len(clips) < cap:
        clips.append((round(t, 3), round(t + CLIP_SEC, 3)))
        t += hop
    return clips


def _export_clip(src: Path, dest: Path, start: float) -> None:
    import subprocess
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [ffmpeg_exe(), "-y", "-v", "error", "-ss", str(start), "-t", str(CLIP_SEC), "-i", str(src),
         "-ac", "1", "-ar", "32000", str(dest)],
        capture_output=True,
    )
    if proc.returncode != 0 or not dest.is_file():
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[-300:])


def _cache_raw(url: str, dest: Path, timeout: int = 180) -> bool:
    if dest.is_file() and dest.stat().st_size > 1000:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        dest.write_bytes(_get(url, timeout=timeout))
    except Exception as exc:
        print(f"  не скачалось {dest.name}: {exc}", flush=True)
        if dest.is_file():
            dest.unlink()
        return False
    return dest.is_file() and dest.stat().st_size > 1000


def _rows_from_raw(instrument: str, page: dict, recording: str, raw: Path, hop: float, cap: int,
                   per_recording: dict[str, int]) -> list[dict]:
    try:
        duration = probe_duration(raw)
    except Exception as exc:
        print(f"  нет длительности {page['title']}: {exc}", flush=True)
        return []
    room = cap - per_recording.get(recording, 0)
    if room <= 0:
        print(f"  {recording}: потолок клипов, {page['title']}", flush=True)
        return []
    spans = _clips(duration, hop, room)
    if not spans:
        print(f"  короче 2 с: {page['title']} ({duration:.2f})", flush=True)
        return []
    digest = hashlib.sha256(page["title"].encode("utf-8")).hexdigest()[:8]
    audio_root = WORK / "extra" / instrument
    rows = []
    for start, end in spans:
        name = f"{recording}-{digest}-{start:.1f}.wav"
        try:
            _export_clip(raw, audio_root / name, start)
        except Exception as exc:
            print(f"  клип {name}: {exc}", flush=True)
            continue
        rows.append({
            "url": page["url"],
            "license": page["license"],
            "author": page["author"],
            "recording": recording,
            "start": f"{start:.3f}",
            "end": f"{end:.3f}",
            "source": "commons",
            "file": name,
            "flag": "",
        })
    per_recording[recording] = per_recording.get(recording, 0) + len(rows)
    print(f"  {recording}: {duration:.1f} с, клипов {len(rows)}, {page['license']}", flush=True)
    return rows


def _commons(instrument: str) -> list[dict]:
    spec = CATALOG.get(instrument) or []
    if not spec:
        return []
    pages = _lookup([title for title, _recording in spec])
    raw_root = WORK / "sources-raw" / instrument
    rows: list[dict] = []
    per_recording: dict[str, int] = {}
    downloaded: list[tuple[dict, str, Path]] = []
    for title, recording in spec:
        page = pages.get(title)
        if page is None:
            print(f"  нет карточки {title}", flush=True)
            continue
        reason = _allowed_page(instrument, page)
        if reason:
            print(f"  пропуск {title}: {reason}", flush=True)
            continue
        ext = Path(urllib.parse.urlparse(page["url"]).path).suffix.lower() or ".bin"
        digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:8]
        raw = raw_root / f"{digest}{ext}"
        if not _cache_raw(page["url"], raw):
            continue
        downloaded.append((page, recording, raw))
        rows.extend(_rows_from_raw(instrument, page, recording, raw, HOP_SEC, MAX_CLIPS_PER_RECORDING, per_recording))
    recordings = {row["recording"] for row in rows}
    if len(rows) < MIN_CLIPS and len(recordings) >= MIN_RECORDINGS:
        print("  добор шагом 2 с, не больше 8 клипов с записи", flush=True)
        per_recording = {}
        rows = []
        audio_root = WORK / "extra" / instrument
        if audio_root.is_dir():
            for wav in audio_root.glob("*.wav"):
                wav.unlink()
        for page, recording, raw in downloaded:
            rows.extend(_rows_from_raw(instrument, page, recording, raw, HOP_TIGHT, MAX_CLIPS_TIGHT, per_recording))
    return rows


SFZ_NOTES = (
    "Samples/sus/erhu_d5_sus_rr1.wav",
    "Samples/sus/erhu_a5_sus_rr1.wav",
    "Samples/sus/erhu_e5_sus_rr1.wav",
    "Samples/sus/erhu_g5_sus_rr1.wav",
    "Samples/sus/erhu_c6_sus_rr1.wav",
    "Samples/sus/erhu_f5_sus_rr1.wav",
)


def _erhu_sfz() -> list[dict]:
    """CC0 close-miked notes. The readme names no player, so this is one recording."""
    rows = []
    raw_root = WORK / "sources-raw" / "erhu"
    raw_root.mkdir(parents=True, exist_ok=True)
    for path in SFZ_NOTES:
        if len(rows) >= MAX_CLIPS_PER_RECORDING:
            break
        url = "https://raw.githubusercontent.com/sfzinstruments/aliexpress-erhu/main/" + path
        dest = raw_root / Path(path).name
        if not _cache_raw(url, dest):
            continue
        try:
            duration = probe_duration(dest)
        except Exception as exc:
            print(f"  sfz {dest.name}: {exc}", flush=True)
            continue
        if duration < CLIP_SEC:
            print(f"  sfz короче 2 с: {dest.name}", flush=True)
            continue
        file_name = f"aliexpress-erhu-{dest.stem}-0.0.wav"
        try:
            _export_clip(dest, WORK / "extra" / "erhu" / file_name, 0.0)
        except Exception as exc:
            print(f"  sfz клип {dest.name}: {exc}", flush=True)
            continue
        rows.append({
            "url": url,
            "license": "CC0 1.0",
            "author": "не указан (readme.txt: скрипач, дешёвый эрху)",
            "recording": "aliexpress-erhu",
            "start": "0.000",
            "end": f"{CLIP_SEC:.3f}",
            "source": "github",
            "file": file_name,
            "flag": "",
        })
    print(f"  aliexpress-erhu: клипов {len(rows)}, CC0", flush=True)
    return rows


def _erhu_zenodo() -> list[dict]:
    """Unlabeled players stay one recording. Short technique bursts under 2 s are skipped."""
    zip_path = WORK / "data" / "ErhuPT.zip"
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    meta = json.loads(_get(ERHU_API))
    files = ((meta.get("files") or []) if isinstance(meta, dict) else [])
    chosen = next((item for item in files if str(item.get("key") or "").endswith("ErhuPT.zip")), None)
    if chosen is None:
        print("  ErhuPT.zip нет в записи Zenodo", flush=True)
        return []
    links = chosen.get("links") or {}
    url = links.get("self") or ""
    expect = int(chosen.get("size") or 0)
    checksum = str(chosen.get("checksum") or "")
    if not zip_path.is_file() or (expect and zip_path.stat().st_size != expect):
        if not url:
            print("  у ErhuPT нет прямой ссылки", flush=True)
            return []
        print(f"  качаю ErhuPT, {expect} байт", flush=True)
        if not _cache_raw(url, zip_path, timeout=600):
            return []
    if expect and zip_path.stat().st_size != expect:
        print(f"  размер ErhuPT {zip_path.stat().st_size}, ждали {expect}", flush=True)
        return []
    if checksum.startswith("md5:"):
        digest = hashlib.md5(zip_path.read_bytes()).hexdigest()
        if digest != checksum.split(":", 1)[1]:
            print(f"  md5 ErhuPT не сошёлся: {digest}", flush=True)
            return []
    archive = zipfile.ZipFile(zip_path)
    names = [
        name for name in archive.namelist()
        if name.lower().endswith(".wav") and "train_data" in name.replace("\\", "/") and "__MACOSX" not in name
    ]
    by_dir: dict[str, list[str]] = {}
    for name in names:
        by_dir.setdefault(str(Path(name).parent), []).append(name)
    raw_root = WORK / "sources-raw" / "erhu"
    raw_root.mkdir(parents=True, exist_ok=True)
    rows = []
    for folder in sorted(by_dir):
        if len(rows) >= MAX_CLIPS_PER_RECORDING:
            break
        name = sorted(by_dir[folder])[0]
        dest = raw_root / "probe.wav"
        dest.write_bytes(archive.read(name))
        try:
            duration = probe_duration(dest)
        except Exception:
            continue
        if duration < CLIP_SEC:
            continue
        digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]
        file_name = f"erhupt-{digest}-0.0.wav"
        try:
            _export_clip(dest, WORK / "extra" / "erhu" / file_name, 0.0)
        except Exception as exc:
            print(f"  эрху {name}: {exc}", flush=True)
            continue
        rows.append({
            "url": "https://zenodo.org/records/4320991/files/ErhuPT.zip?download=1#" + urllib.parse.quote(name),
            "license": "CC BY 4.0",
            "author": "Zehao Wang, Jingru Li",
            "recording": "erhupt",
            "start": "0.000",
            "end": f"{min(CLIP_SEC, duration):.3f}",
            "source": "zenodo",
            "file": file_name,
            "flag": "",
        })
    if (raw_root / "probe.wav").is_file():
        (raw_root / "probe.wav").unlink()
    print(f"  erhupt: клипов {len(rows)} из разных папок техник", flush=True)
    return rows


def _write_csv(instrument: str, rows: list[dict]) -> None:
    path = ROOT / "scripts" / "instrument_id" / "sources" / f"{instrument}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    keep = {row["file"] for row in rows}
    audio_root = WORK / "extra" / instrument
    if audio_root.is_dir():
        for wav in audio_root.glob("*.wav"):
            if wav.name not in keep:
                wav.unlink()


def _accepted(rows: list[dict]) -> list[dict]:
    return [row for row in rows if not (row.get("flag") or "").strip()]


def _note(instrument: str, rows: list[dict]) -> str:
    accepted = _accepted(rows)
    recordings = {row["recording"] for row in accepted}
    flagged = len(rows) - len(accepted)
    if len(accepted) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS:
        if instrument == "oud":
            return "Третья запись — открытые струны уда (User:Bottomline), два клипа. Остальные клипы — Andy R. Jordan и Houssem bettaibi."
        if instrument == "erhu":
            return "Zhang Peijian — один человек. ErhuPT — исполнители в файлах не подписаны. Третья группа — CC0-ноты дешёвого эрху, имя скрипача в readme не указано. Сведение Antti Luode в голову не входит."
        if instrument == "choir":
            return "Kantorei St. Michael помечена review и в счёт не входит. Четыре хора: Childrenschorussa, храм «Света Троица» в Пловдиве, Ensemble Morales, Harmonica."
        return ""
    base = EMPTY_NOTE.get(instrument) or ""
    detail = f"Принятых клипов {len(accepted)}, записей {len(recordings)}"
    if flagged:
        detail += f", с флагом {flagged}"
    if instrument == "erhu" and accepted:
        detail += ". Исполнители ErhuPT в файлах не подписаны, это одна группа."
    if instrument == "oud" and "user-bottomline" in recordings:
        detail += ". Открытые струны — один короткий клип, не третья пьеса."
    if instrument == "santur":
        detail += ". Концертино с оркестром не брали. Ey Iran помечен как голос, ролик Lizikus — как шум, не как соло сантура."
    if instrument == "darbuka":
        detail += ". Давул, рик и мазхар не метили как дарбуку."
    if instrument == "bendir":
        detail += ". Все узулы — один автор, Anomyq."
    if instrument == "qanun":
        detail += ". Оба образца — Ariel Qassis. Запись с пением не брали."
    if instrument == "setar":
        detail += ". Jacqke — один демонстратор ладов."
    return (base + " " + detail).strip()


def summarize() -> list[dict]:
    """Recount manifests. Western counts stay as they were until this machine has an index."""
    manifest_root = ROOT / "scripts" / "instrument_id" / "sources"
    previous: dict[str, dict] = {}
    report_path = ROOT / "docs" / "analysis" / "instrument-id-sources.json"
    if report_path.is_file():
        for row in json.loads(report_path.read_text(encoding="utf-8")):
            previous[row.get("id") or ""] = row
    summary = []
    seen = set()
    for instrument in CORE:
        csv_path = manifest_root / f"{instrument}.csv"
        records = []
        if csv_path.is_file():
            with csv_path.open(encoding="utf-8", newline="") as handle:
                records = list(csv.DictReader(handle))
        accepted = _accepted(records)
        recordings = {row.get("recording") or "" for row in accepted}
        recordings.discard("")
        enough = len(accepted) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS
        row = {
            "id": instrument,
            "clips": len(accepted),
            "recordings": len(recordings),
            "enough": enough,
        }
        note = _note(instrument, records)
        if note:
            row["note"] = note
        summary.append(row)
        seen.add(instrument)
    index_path = WORK / "index.jsonl"
    have: dict[str, dict[str, int]] = {}
    if index_path.is_file():
        for line in index_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            bucket = have.setdefault(record["id"], {})
            bucket[record.get("source") or "?"] = bucket.get(record.get("source") or "?", 0) + 1
    for instrument, note in (
        ("violin", "уже в голове"),
        ("cello", "уже в голове"),
        ("piano", "уже в голове"),
        ("guitar-acoustic", "уже в голове. Это не гравюра фламенко."),
        ("voice", "уже в голове из IRMAS, отдельный набор не собирали. Веса некоммерческие из-за CC BY-NC-SA 4.0."),
    ):
        if index_path.is_file():
            bucket = have.get(instrument) or {}
            summary.append({
                "id": instrument,
                "clips": sum(bucket.values()),
                "recordings": ", ".join(f"{name} {count}" for name, count in sorted(bucket.items())) or "0",
                "enough": sum(bucket.values()) >= MIN_CLIPS,
                "note": note,
            })
        elif instrument in previous:
            summary.append(previous[instrument])
        seen.add(instrument)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(report_path)
    return summary


def fetch(instruments: list[str] | None = None) -> None:
    wanted = instruments or CORE
    for instrument in wanted:
        print(f"=== {instrument}", flush=True)
        if instrument not in CATALOG and instrument != "erhu":
            _write_csv(instrument, [])
            print("  файлов с явной лицензией нет", flush=True)
            continue
        rows = _commons(instrument) if instrument in CATALOG else []
        if instrument == "erhu":
            try:
                rows.extend(_erhu_zenodo())
            except Exception as exc:
                print(f"  zenodo: {exc}", flush=True)
            try:
                rows.extend(_erhu_sfz())
            except Exception as exc:
                print(f"  sfz: {exc}", flush=True)
        _write_csv(instrument, rows)
        accepted = _accepted(rows)
        recordings = {row["recording"] for row in accepted}
        ok = len(accepted) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS
        print(f"  итог клипов {len(accepted)}, записей {len(recordings)}, в голову: {'да' if ok else 'нет'}", flush=True)
    summarize()


if __name__ == "__main__":
    fetch(sys.argv[1:] or None)
