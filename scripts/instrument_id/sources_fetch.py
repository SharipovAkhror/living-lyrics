"""Download openly licensed instrument clips into work/ and write the git manifest.

Audio stays in work/instrument_id/extra/<id>/. The manifest is
scripts/instrument_id/sources/<id>.csv with url, license, author, recording, start, end.
A class needs at least 15 clips from at least 3 recordings. Anything short is listed
and is not copied into the training folder.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio import ffmpeg_exe, probe_duration
from paths import ROOT, WORK

UA = "LivingLyricsInstrumentId/1.0 (local research; instrument samples)"
ALLOWED = ("cc by", "cc by-sa", "cc0", "public domain", "cc by 2", "cc by-sa 2", "cc by 3", "cc by-sa 3", "cc by 4", "cc by-sa 4")
SKIP_TITLE = re.compile(
    r"(pronunciation|lingua libre|spoken wikipedia|^file:q\d+|article\.ogg|^file:[a-z]{2,3}-"
    r"|ll-q\d|librivox|audiobook|78rpm|schellak|oud\s*&\s*nieuw|nieuw|vliegveld|riool|majelis|hadits|junub"
    r"|kettle|whistle|paisaje)",
    re.I,
)
# Quoted phrases so a short word does not match a language sample or a place name.
SEARCHES = {
    "oud": ['"oud music"', '"oud solo"', '"playing the oud"'],
    "ney": ['"ney flute"', '"ney solo"', '"nay flute"'],
    "daf": ['"daf drum"', '"daf solo"', '"playing the daf"'],
    "bendir": ['"bendir"', '"bendir drum"'],
    "darbuka": ['"darbuka"', '"doumbek"'],
    "qanun": ['"qanun"', '"kanun music"'],
    "santur": ['"santur"', '"santoor"'],
    "tar": ['"persian tar"', '"azerbaijani tar"', '"tar instrument"'],
    "setar": ['"setar"', '"setar music"'],
    "tanbur": ['"tanbur"', '"tambur music"'],
    "kamancheh": ['"kamancheh"', '"kamancha"'],
    "baglama": ['"baglama"', '"bağlama"', '"saz music"'],
    "duduk": ['"armenian duduk"', '"duduk improvisation"', '"duduk music"', '"sound of duduk"'],
    "erhu": ['"erhu"'],
}
WORD = {
    "oud": r"\boud\b",
    "ney": r"\b(ney|nay)\b",
    "daf": r"\bdaf\b",
    "bendir": r"\bbendir\b",
    "darbuka": r"\b(darbuka|doumbek)\b",
    "qanun": r"\b(qanun|kanun)\b",
    "santur": r"\b(santur|santoor)\b",
    "tar": r"\btar\b",
    "setar": r"\bsetar\b",
    "tanbur": r"\b(tanbur|tambur)\b",
    "kamancheh": r"\b(kamancheh|kamancha)\b",
    "baglama": r"\b(baglama|bağlama|saz)\b",
    "duduk": r"\bduduk\b",
    "erhu": r"\berhu\b",
}
MIN_CLIPS = 15
MIN_RECORDINGS = 3
SHORT_NOTE = {
    "oud": "11 клипов, 2 исполнителя: Andy R. Jordan (две части одной пьесы) и открытые струны. В голову не входит.",
    "santur": "14 клипов, 2 исполнителя. Короткий и полный файл концертино — одна пьеса. В голову не входит.",
    "qanun": "5 клипов одной записи: канун вместе с пением, CC0. В голову не входит.",
    "darbuka": "4 клипа одного файла, CC BY-SA 4.0. В голову не входит.",
    "duduk": "5 клипов одной записи, CC BY-SA 4.0. В голову не входит.",
    "setar": "Демонстрация ладов одного автора не скачалась: Wikimedia ответила 429. В голову не входит.",
    "ney": "Отдельной записи с явной лицензией не нашлось.",
    "daf": "Отдельной записи с явной лицензией не нашлось.",
    "bendir": "Отдельной записи с явной лицензией не нашлось.",
    "tar": "Запрос с персидским и азербайджанским таром не дал файла с явной лицензией.",
    "tanbur": "Отдельной записи с явной лицензией не нашлось.",
    "kamancheh": "Отдельной записи с явной лицензией не нашлось.",
    "baglama": "Отдельной записи с явной лицензией не нашлось.",
}
MAX_CLIPS_PER_RECORDING = 5
CLIP_SEC = 2.0
HOP_SEC = 4.0
MAX_BYTES = 40_000_000


def _get(url: str) -> bytes:
    delay = 5
    for attempt in range(5):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=90) as handle:
                payload = handle.read()
            time.sleep(1.5)
            return payload
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(url)


def _search(query: str) -> list[dict]:
    found = []
    cont = {}
    for _ in range(2):
        params = {
            "action": "query", "format": "json", "generator": "search",
            "gsrnamespace": "6", "gsrlimit": "20", "gsrsearch": query,
            "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
        }
        params.update(cont)
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
        payload = json.loads(_get(url))
        pages = (payload.get("query") or {}).get("pages") or {}
        for page in pages.values():
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            license_name = html.unescape(re.sub("<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value") or "")).strip()
            artist = html.unescape(re.sub("<[^>]+>", "", (meta.get("Artist") or {}).get("value") or "")).strip()
            artist = re.sub(r"\s+", " ", artist)[:180]
            found.append({
                "title": page.get("title") or "",
                "url": info.get("url") or "",
                "mime": info.get("mime") or "",
                "size": int(info.get("size") or 0),
                "license": license_name,
                "author": artist or "не указан",
            })
        cont = payload.get("continue") or {}
        if not cont:
            break
    return found


def _license_ok(name: str) -> bool:
    text = name.lower().replace("–", "-")
    if "public domain mark" in text or "publicdomain/mark" in text:
        return False
    if re.search(r"\bnc\b|noncommercial|non-commercial|-nc\b|/nc\b", text):
        return False
    if re.search(r"\bnd\b|-nd\b|/nd\b|noderiv", text):
        return False
    return any(piece in text for piece in ("cc by", "cc-by", "cc0", "cc-zero", "public domain", "publicdomain/zero"))


def _performer_id(author: str, title: str) -> str:
    """One person is one recording. Parts, frets and short/full edits do not multiply the count."""
    text = re.sub(r"\s+", " ", author or "").strip()
    slug = ""
    if text.lower() not in {"", "не указан", "unknown", "none"}:
        slug = _recording_id(text)
    if not slug:
        slug = _recording_id(title)
    return slug or "recording"


def _recording_id(title: str) -> str:
    stem = unicodedata.normalize("NFKD", title)
    stem = "".join(ch for ch in stem if not unicodedata.combining(ch))
    stem = re.sub(r"^File:", "", stem, flags=re.I)
    stem = re.sub(r"\.(ogg|oga|mp3|wav|flac|opus)$", "", stem, flags=re.I)
    stem = re.sub(r"\b(long|short|wav|mp3)\b", "", stem, flags=re.I)
    stem = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return stem[:80]


def _candidates(instrument: str) -> list[dict]:
    seen = set()
    rows = []
    for query in SEARCHES[instrument]:
        for item in _search(query):
            if not item["url"] or item["url"] in seen:
                continue
            seen.add(item["url"])
            if SKIP_TITLE.search(item["title"]):
                continue
            if not re.search(WORD[instrument], item["title"], re.I):
                continue
            if instrument == "tar" and not re.search(r"(persian|azerbaijani|caucasus|tar instrument)", item["title"], re.I):
                continue
            if item["mime"] not in {"audio/mpeg", "audio/ogg", "application/ogg", "audio/wav", "audio/x-wav", "audio/flac"}:
                continue
            if not _license_ok(item["license"]):
                continue
            if item["size"] <= 0 or item["size"] > MAX_BYTES:
                continue
            # Prefer the smaller of wav/mp3 twins by recording id later.
            item["recording"] = _performer_id(item["author"], item["title"])
            rows.append(item)
    # One file per recording: smallest.
    best: dict[str, dict] = {}
    for item in rows:
        current = best.get(item["recording"])
        if current is None or item["size"] < current["size"]:
            best[item["recording"]] = item
    return list(best.values())


def _ia_license_ok(url: str) -> bool:
    text = (url or "").lower()
    if "creativecommons.org" not in text:
        return False
    if any(piece in text for piece in ("/nc", "-nc", "/nd", "-nd", "publicdomain/mark")):
        return False
    return "/licenses/by" in text or "publicdomain/zero" in text


def _ia_candidates(instrument: str) -> list[dict]:
    """Internet Archive items whose title names the instrument and whose license URL is an explicit CC license."""
    found = []
    seen = set()
    for phrase in SEARCHES[instrument]:
        query = (
            f"title:({phrase}) AND mediatype:audio AND "
            "(licenseurl:*creativecommons.org/licenses/by* OR licenseurl:*publicdomain/zero*) "
            "AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*"
        )
        params = urllib.parse.urlencode({
            "q": query,
            "fl[]": ["identifier", "title", "licenseurl", "creator"],
            "rows": 15,
            "page": 1,
            "output": "json",
        }, doseq=True)
        try:
            payload = json.loads(_get("https://archive.org/advancedsearch.php?" + params))
        except Exception as exc:
            print(f"  archive search {phrase}: {exc}", flush=True)
            continue
        for doc in (payload.get("response") or {}).get("docs") or []:
            title = str(doc.get("title") or "")
            identifier = str(doc.get("identifier") or "")
            if not identifier or identifier in seen:
                continue
            if SKIP_TITLE.search(title) or not re.search(WORD[instrument], title, re.I):
                continue
            if not _ia_license_ok(str(doc.get("licenseurl") or "")):
                continue
            seen.add(identifier)
            try:
                meta = json.loads(_get(f"https://archive.org/metadata/{urllib.parse.quote(identifier)}"))
            except Exception as exc:
                print(f"  archive meta {identifier}: {exc}", flush=True)
                continue
            files = []
            for item in meta.get("files") or []:
                name = str(item.get("name") or "")
                if not re.search(r"\.(mp3|ogg|wav|flac)$", name, re.I):
                    continue
                size = int(item.get("size") or 0)
                if size <= 0 or size > MAX_BYTES:
                    continue
                files.append((size, name))
            if not files:
                continue
            _size, name = sorted(files)[0]
            creator = doc.get("creator") or "не указан"
            if isinstance(creator, list):
                creator = ", ".join(str(part) for part in creator)
            found.append({
                "title": f"File:{title}",
                "url": "https://archive.org/download/" + identifier + "/" + urllib.parse.quote(name),
                "mime": "audio/mpeg",
                "size": _size,
                "license": str(doc.get("licenseurl")),
                "author": re.sub(r"\s+", " ", str(creator))[:180],
                "recording": _performer_id(str(creator), title),
            })
            if len(found) >= 8:
                return found
    return found


def _erhu_zenodo(manifest_root: Path) -> dict:
    """One Zenodo collection. Players are not labeled, so it is one recording and stays out of the head."""
    zip_path = WORK / "data" / "ErhuPT.zip"
    row = {"id": "erhu", "clips": 0, "recordings": 0, "enough": False, "note": "архив Zenodo не найден"}
    if not zip_path.is_file():
        return row
    import zipfile
    archive = zipfile.ZipFile(zip_path, metadata_encoding="utf-8")
    wavs = [name for name in archive.namelist() if name.startswith("train_data/") and name.lower().endswith(".wav") and "__MACOSX" not in name]
    picked = wavs[:5]
    manifest_rows = []
    dest = None
    raw_root = WORK / "sources-raw" / "erhu"
    raw_root.mkdir(parents=True, exist_ok=True)
    for name in picked:
        dest = raw_root / "probe.wav"
        dest.write_bytes(archive.read(name))
        try:
            duration = probe_duration(dest)
        except Exception:
            duration = 0.0
        end = min(CLIP_SEC, duration) if duration else 0.0
        if end < 0.4:
            continue
        manifest_rows.append({
            "url": "https://zenodo.org/records/4320991/files/ErhuPT.zip?download=1#" + urllib.parse.quote(name),
            "license": "CC BY 4.0",
            "author": "Zehao Wang, Jingru Li",
            "recording": "erhupt",
            "start": "0.000",
            "end": f"{end:.3f}",
            "source": "zenodo",
        })
    if dest_parent := raw_root:
        for wav in dest_parent.glob("*.wav"):
            wav.unlink()
    csv_path = manifest_root / "erhu.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["url", "license", "author", "recording", "start", "end", "source"])
        writer.writeheader()
        writer.writerows(manifest_rows)
    return {
        "id": "erhu",
        "clips": len(manifest_rows),
        "recordings": 1 if manifest_rows else 0,
        "enough": False,
        "note": "Zenodo 10.5281/zenodo.4320991, CC BY 4.0. Исполнители в файлах не размечены, это одна коллекция консерватории, поэтому класс в голову не входит.",
    }


def _clips(path: Path, duration: float) -> list[tuple[float, float]]:
    if duration < CLIP_SEC:
        return []
    clips = []
    start = max(0.0, (duration - CLIP_SEC) / 2) if duration < HOP_SEC + CLIP_SEC else 0.0
    if duration < HOP_SEC + CLIP_SEC:
        return [(round(start, 3), round(start + CLIP_SEC, 3))]
    t = 0.0
    while t + CLIP_SEC <= duration + 0.05 and len(clips) < MAX_CLIPS_PER_RECORDING:
        clips.append((round(t, 3), round(t + CLIP_SEC, 3)))
        t += HOP_SEC
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


def fetch(instruments: list[str] | None = None) -> None:
    wanted = instruments or list(SEARCHES)
    manifest_root = ROOT / "scripts" / "instrument_id" / "sources"
    manifest_root.mkdir(parents=True, exist_ok=True)
    summary = []
    for instrument in wanted:
        print(f"=== {instrument}", flush=True)
        if instrument == "erhu":
            summary.append(_erhu_zenodo(manifest_root))
            print(f"  эрху: {summary[-1]}", flush=True)
            continue
        try:
            files = _candidates(instrument)
        except Exception as exc:
            print(f"  commons: {exc}", flush=True)
            files = []
        try:
            files.extend(_ia_candidates(instrument))
        except Exception as exc:
            print(f"  archive: {exc}", flush=True)
        print(f"  записей с явной лицензией: {len(files)}", flush=True)
        audio_root = WORK / "extra" / instrument
        if audio_root.is_dir():
            for old in audio_root.glob("*.wav"):
                old.unlink()
        raw_root = WORK / "sources-raw" / instrument
        raw_root.mkdir(parents=True, exist_ok=True)
        manifest_rows = []
        recordings = set()
        for item in files:
            if len(manifest_rows) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS:
                break
            ext = Path(urllib.parse.urlparse(item["url"]).path).suffix.lower() or ".bin"
            raw = raw_root / f"{item['recording']}{ext}"
            if not raw.is_file() or raw.stat().st_size < 1000:
                try:
                    raw.write_bytes(_get(item["url"]))
                except Exception as exc:
                    print(f"  пропуск {item['title']}: {exc}", flush=True)
                    continue
            try:
                duration = probe_duration(raw)
            except Exception as exc:
                print(f"  нет длительности {item['title']}: {exc}", flush=True)
                continue
            clips = _clips(raw, duration)
            if not clips:
                continue
            made = 0
            for start, end in clips:
                if len(manifest_rows) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS:
                    break
                name = f"{item['recording']}-{start:.1f}.wav"
                dest = audio_root / name
                try:
                    _export_clip(raw, dest, start)
                except Exception as exc:
                    print(f"  клип {name}: {exc}", flush=True)
                    continue
                manifest_rows.append({
                    "url": item["url"],
                    "license": item["license"],
                    "author": item["author"],
                    "recording": item["recording"],
                    "start": f"{start:.3f}",
                    "end": f"{end:.3f}",
                    "source": "internet-archive" if "archive.org" in item["url"] else "commons",
                })
                recordings.add(item["recording"])
                made += 1
            print(f"  {item['recording']}: {duration:.1f} с, клипов {made}, {item['license']}", flush=True)
        ok = len(manifest_rows) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS
        csv_path = manifest_root / f"{instrument}.csv"
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["url", "license", "author", "recording", "start", "end", "source"])
            writer.writeheader()
            writer.writerows(manifest_rows)
        if not ok and audio_root.is_dir():
            for wav in audio_root.glob("*.wav"):
                wav.unlink()
        summary.append({
            "id": instrument,
            "clips": len(manifest_rows),
            "recordings": len(recordings),
            "enough": ok,
        })
        print(f"  итог клипов {len(manifest_rows)}, записей {len(recordings)}, в голову: {'да' if ok else 'нет'}", flush=True)
    # Classes already inside the trained head. Counts are files in the index, not a new manifest.
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
        ("voice", "уже в голове"),
    ):
        bucket = have.get(instrument) or {}
        summary.append({
            "id": instrument,
            "clips": sum(bucket.values()),
            "recordings": ", ".join(f"{name} {count}" for name, count in sorted(bucket.items())) or "0",
            "enough": sum(bucket.values()) >= MIN_CLIPS,
            "note": note,
        })
    summary.append({
        "id": "choir",
        "clips": sum((have.get("choir") or {}).values()),
        "recordings": 0,
        "enough": False,
        "note": "отдельного набора хора с явной лицензией нет. В голове есть голос, не хор.",
    })
    # Disk is the source of truth: a partial run must not drop classes fetched earlier.
    by_id = {row["id"]: row for row in summary}
    for csv_path in sorted(manifest_root.glob("*.csv")):
        with csv_path.open(encoding="utf-8", newline="") as handle:
            records = list(csv.DictReader(handle))
        recordings = {record.get("recording") or "" for record in records}
        recordings.discard("")
        enough = len(records) >= MIN_CLIPS and len(recordings) >= MIN_RECORDINGS
        row = by_id.get(csv_path.stem)
        if row is None:
            row = {"id": csv_path.stem}
            summary.append(row)
            by_id[csv_path.stem] = row
        row["clips"] = len(records)
        row["recordings"] = len(recordings)
        row["enough"] = enough
        if not enough:
            row["note"] = SHORT_NOTE.get(csv_path.stem) or row.get("note") or "меньше 15 клипов или меньше 3 исполнителей"
    report = ROOT / "docs" / "analysis" / "instrument-id-sources.json"
    report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    fetch(sys.argv[1:] or None)
