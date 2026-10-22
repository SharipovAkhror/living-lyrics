"""Local eyes: contact sheets of a video file, read by the owner's Antigravity CLI.

Antigravity does not watch a YouTube URL. If work/<slug>/video.* is missing, the
stage is skipped and vision.json is not written. Gemini's paid API is off unless
the process is started with --backend gemini-api, and even then it refuses to run
without GEMINI_API_KEY. GitHub Actions has no Antigravity login, so this stage
stays on the owner's machine.

Sheets are cached by the sha256 of the PNG. A repeat run does not spend the quota.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from audio import probe_duration
from paths import ROOT, SCHEMA_PATH, WORK
from taxonomy import load

MODEL = "gemini-3.8-flash-medium"
PAUSE_SEC = 8
CACHE = WORK / "vision-cache"
VIDEO_SUFFIXES = (".mp4", ".mov", ".webm", ".mkv", ".m4v")
CELL = 320
COLS = 4
ROWS = 4

PROMPT = """Открой локальный файл {name} в этой папке. Это контактный лист {cols} на {rows}.
Кадры идут слева направо, сверху вниз. Внизу каждого кадра подписано время в секундах.
Времена по порядку: {times}.
По каждому кадру верни один объект frames с тем же time_s.
instrument — как инструмент называется на кадре, или «не видно», если музыкального инструмента не разобрать.
playing = true только если видно, что на инструменте играют: руки на инструменте, смычок на струнах, молоточки, палочки, пальцы на отверстиях.
Рисунок, гравюра или инструмент в стойке без играющего — это visible=true и playing=false.
who — подпись имени на экране. Если подписи нет, пустая строка.
confidence — число от 0 до 1. Не выдумывай инструмент, которого не видно, и человека, которого не подписали.
note — короткая оговорка или пустая строка."""


def find_video(slug: str) -> Path | None:
    folder = ROOT / "work" / slug
    if not folder.is_dir():
        return None
    found = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES and p.name.startswith("video")]
    return sorted(found)[0] if found else None


def _sections(slug: str) -> list[float]:
    path = ROOT / "docs" / "analysis" / slug / "sections.suggested.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    times = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and "start" in item:
                times.append(float(item["start"]))
    return times


def choose_times(duration: float, section_starts: list[float]) -> list[float]:
    """Every 3–4 s, plus section boundaries, capped near 20 sheets."""
    hop = 3.0
    required = sorted(t for t in section_starts if 0 <= t < duration)
    while True:
        grid = [round(t, 3) for t in _frange(0.0, max(duration - 0.25, 0.0), hop)]
        times = _merge(grid, required)
        if len(times) <= 20 * COLS * ROWS or hop >= 4.0:
            break
        hop = round(hop + 0.5, 2)
    if len(times) > 20 * COLS * ROWS:
        budget = 20 * COLS * ROWS - len(required)
        grid = [t for t in times if t not in set(required)]
        if budget <= 0:
            times = required[: 20 * COLS * ROWS]
        else:
            step = max(1, len(grid) // budget)
            times = _merge(grid[::step][:budget], required)
    return times


def _frange(start: float, stop: float, step: float) -> list[float]:
    values = []
    t = start
    while t <= stop + 1e-6:
        values.append(t)
        t += step
    return values


def _merge(grid: list[float], required: list[float]) -> list[float]:
    tagged = [(t, False) for t in grid] + [(t, True) for t in required]
    tagged.sort(key=lambda item: (item[0], not item[1]))
    kept: list[float] = []
    for t, is_required in tagged:
        if kept and abs(t - kept[-1]) < 0.5 and not is_required:
            continue
        if kept and abs(t - kept[-1]) < 0.5 and is_required:
            kept[-1] = t
            continue
        kept.append(round(t, 3))
    return kept


def extract_frame(video: Path, t: float, dest: Path) -> None:
    from audio import ffmpeg_exe
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            ffmpeg_exe(), "-y", "-ss", f"{t:.3f}", "-i", str(video),
            "-frames:v", "1", "-vf", f"scale={CELL}:-2", str(dest),
        ],
        capture_output=True, check=False,
    )
    if proc.returncode != 0 or not dest.is_file():
        err = proc.stderr.decode("utf-8", errors="replace")[-400:]
        raise RuntimeError(f"кадр {t}: {err}")


def make_sheet(frames: list[tuple[float, Path]], dest: Path) -> None:
    from PIL import Image, ImageDraw
    cell_h = CELL + 36
    sheet = Image.new("RGB", (COLS * CELL, ROWS * cell_h), "white")
    draw = ImageDraw.Draw(sheet)
    for index, (t, path) in enumerate(frames):
        image = Image.open(path).convert("RGB")
        image.thumbnail((CELL - 8, CELL - 8))
        col, row = index % COLS, index // COLS
        x = col * CELL + (CELL - image.width) // 2
        y = row * cell_h + 4
        sheet.paste(image, (x, y))
        label = f"{t:.1f} с"
        draw.text((col * CELL + 8, row * cell_h + CELL + 8), label, fill=(20, 20, 20))
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, "PNG")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _parse_stdout(text: str) -> dict:
    decoder = json.JSONDecoder()
    found = None
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
        except json.JSONDecodeError:
            continue
        found = _unwrap(obj) or found
    if not found or "frames" not in found:
        raise ValueError("в ответе нет frames")
    return found


def _unwrap(obj):
    if isinstance(obj, dict) and isinstance(obj.get("frames"), list):
        return obj
    if isinstance(obj, dict):
        for value in obj.values():
            if isinstance(value, str) and value.strip().startswith("{"):
                try:
                    hit = _unwrap(json.loads(value))
                except json.JSONDecodeError:
                    hit = None
                if hit:
                    return hit
            hit = _unwrap(value)
            if hit:
                return hit
    if isinstance(obj, list):
        for item in obj:
            hit = _unwrap(item)
            if hit:
                return hit
    return None


def _agy_bin() -> str:
    found = shutil.which("agy")
    if found:
        return found
    fallback = Path(r"C:\Users\User\AppData\Local\agy\bin\agy.exe")
    if fallback.is_file():
        return str(fallback)
    raise SystemExit("agy не найден в PATH и нет C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe")


def ask_sheet(sheet: Path, times: list[float], backend: str = "agy") -> dict:
    digest = _sha256(sheet)
    cached = CACHE / f"{digest}.json"
    if cached.is_file():
        print(f"кэш {digest[:12]}")
        return json.loads(cached.read_text(encoding="utf-8"))
    prompt = PROMPT.format(
        name=sheet.name,
        cols=COLS,
        rows=ROWS,
        times=", ".join(f"{t:.1f}" for t in times),
    )
    if backend == "gemini-api":
        payload = _ask_gemini_api(sheet, prompt)
    elif backend == "agy":
        payload = _ask_agy(sheet, prompt)
    else:
        raise SystemExit(f"неизвестный backend: {backend}")
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


# Every agy run goes through ops/agents/agy_run.py: one folder, logged in the usage ledger.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'ops' / 'agents'))
import agy_run  # noqa: E402


def _ask_agy(sheet: Path, prompt: str) -> dict:
    last = ""
    for attempt in range(3):
        print(f"agy {sheet.name} попытка {attempt + 1}")
        code, out, _ = agy_run.run(sheet.parent, MODEL, "-", "300s", SCHEMA_PATH, prompt, f"instrument-id {sheet.parent.name}")
        last = out or f"agy_run exit {code}"
        if code == 0 and out.strip():
            try:
                parsed = _parse_stdout(out)
            except ValueError as exc:
                last = f"{exc}\n{last[-1500:]}"
            else:
                time.sleep(PAUSE_SEC)
                return parsed
        time.sleep(20 * (attempt + 1))
    log = WORK / "vision-last-error.txt"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(last[-8000:], encoding="utf-8")
    raise SystemExit(f"agy не вернул json. Хвост записан в {log}")


def _ask_gemini_api(sheet: Path, prompt: str) -> dict:
    """Off by default. Runs only when the caller passes --backend gemini-api."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise SystemExit("GEMINI_API_KEY не задан. Запасной путь выключен.")
    model = os.environ.get("GEMINI_API_MODEL", "gemini-3.8-flash")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    body = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/png", "data": _b64(sheet)}},
            ],
        }],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"Gemini API ответил {exc.code}. Ключ в текст ошибки не входит. {detail}") from exc
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    time.sleep(PAUSE_SEC)
    return _parse_stdout(text)


def _b64(path: Path) -> str:
    import base64
    return base64.b64encode(path.read_bytes()).decode("ascii")


def watch_slug(slug: str, backend: str = "agy") -> Path | None:
    video = find_video(slug)
    if video is None:
        print(f"{slug}: нет work/{slug}/video.* — стадия «глаза» пропущена, vision.json не пишу")
        return None
    duration = probe_duration(video)
    times = choose_times(duration, _sections(slug))
    work = WORK / "frames" / slug
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    frames = []
    for index, t in enumerate(times):
        dest = work / f"f{index:04d}.jpg"
        extract_frame(video, t, dest)
        frames.append((t, dest))
    sheets_dir = work / "sheets"
    all_frames = []
    for sheet_index in range(0, len(frames), COLS * ROWS):
        chunk = frames[sheet_index:sheet_index + COLS * ROWS]
        # A short last sheet is padded with nothing: the model is told only the real times.
        sheet = sheets_dir / f"sheet-{sheet_index // (COLS * ROWS):02d}.png"
        make_sheet(chunk, sheet)
        answer = ask_sheet(sheet, [t for t, _ in chunk], backend=backend)
        all_frames.extend(answer.get("frames", []))
    out = ROOT / "docs" / "analysis" / slug / "vision.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "slug": slug,
        "backend": "antigravity" if backend == "agy" else backend,
        "model": MODEL if backend == "agy" else os.environ.get("GEMINI_API_MODEL", "gemini-3.8-flash"),
        "video": str(video.relative_to(ROOT)).replace("\\", "/"),
        "duration": round(duration, 3),
        "frameCount": len(times),
        "sheetCount": (len(times) + COLS * ROWS - 1) // (COLS * ROWS),
        "frames": all_frames,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _append_report(slug, payload)
    print(f"{slug}: {out}")
    return out


def _append_report(slug: str, payload: dict) -> None:
    path = ROOT / "docs" / "analysis" / slug / "instruments.md"
    lines = [
        f"# Инструменты на кадре: {slug}",
        "",
        f"Видео `{payload['video']}`, модель `{payload['model']}`, листов {payload['sheetCount']}.",
        "Играющим считается только тот, у кого видны руки, смычок или молоточки. «Не видно» оставлено как есть.",
        "",
        "| время | видно | инструмент | играет | кто | уверенность |",
        "|---|---|---|---|---|---|",
    ]
    for frame in payload["frames"]:
        players = frame.get("players") or []
        if not players:
            lines.append(f"| {frame.get('time_s')} | {frame.get('visible')} | не видно | | | |")
            continue
        for player in players:
            lines.append(
                f"| {frame.get('time_s')} | {frame.get('visible')} | {player.get('instrument', '')} | "
                f"{player.get('playing')} | {player.get('who', '')} | {player.get('confidence', '')} |"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def render_engraving(svg: Path, dest: Path) -> None:
    """Rasterise a project engraving. The PNG carries no instrument name."""
    html = dest.with_suffix(".html")
    html.write_text(
        "<!doctype html><meta charset=\"utf-8\">"
        "<style>html,body{margin:0;background:#f4f1ea;color:#1c1a17}"
        "svg{width:400px;height:400px;display:block}</style>\n"
        + svg.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    browsers = [
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    ]
    uri = html.resolve().as_uri()
    for browser in browsers:
        if not browser.is_file():
            continue
        if dest.exists():
            dest.unlink()
        subprocess.run(
            [
                str(browser), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--force-device-scale-factor=1", "--default-background-color=FFFFFFFF",
                f"--screenshot={dest.resolve()}", "--window-size=400,400", uri,
            ],
            cwd=str(dest.parent), capture_output=True, timeout=90, check=False,
        )
        if not dest.is_file():
            alt = dest.parent / "screenshot.png"
            if alt.is_file():
                alt.replace(dest)
        if dest.is_file() and dest.stat().st_size > 2000:
            return
    raise RuntimeError(f"не удалось отрисовать {svg.name}")


ENGRAVING_IDS = (
    "oud", "daf", "ney", "violin", "piano", "qanun", "erhu", "kamancheh",
    "santur", "tanbur", "darbuka", "duduk", "harp", "cello", "guitar", "tar",
)


def vision_selftest(backend: str = "agy") -> Path:
    """One 4×4 sheet of catalog engravings, times burned in, names not burned in."""
    data = load()
    out_dir = WORK / "vision-selftest"
    cells = out_dir / "cells"
    cells.mkdir(parents=True, exist_ok=True)
    frames = []
    truth = []
    for index, key in enumerate(ENGRAVING_IDS):
        info = next(item for item in data["instruments"] if item.get("catalogKey") == key or item["id"] == key)
        # guitar catalog key belongs to guitar-flamenco; the file is guitar.svg.
        svg = ROOT / "src" / "instruments" / "svg" / f"{key}.svg"
        png = cells / f"cell-{index:02d}.png"
        render_engraving(svg, png)
        t = float(index * 3)
        frames.append((t, png))
        truth.append({"time_s": t, "id": info["id"], "catalogKey": key})
    sheet = out_dir / "sheet.png"
    make_sheet(frames, sheet)
    (out_dir / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    answer = ask_sheet(sheet, [t for t, _ in frames], backend=backend)
    (out_dir / "answer.json").write_text(json.dumps(answer, ensure_ascii=False, indent=2), encoding="utf-8")
    scored = score_engravings(truth, answer, data)
    (out_dir / "score.json").write_text(json.dumps(scored, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: scored[k] for k in ("named", "playingClaimed", "otherInstrument", "unseen")}, ensure_ascii=False))
    return out_dir / "score.json"


def score_engravings(truth: list[dict], answer: dict, data: dict) -> dict:
    from taxonomy import match_ids
    by_time = []
    for frame in answer.get("frames", []):
        try:
            by_time.append((float(frame.get("time_s")), frame))
        except (TypeError, ValueError):
            continue
    rows = []
    for item in truth:
        frame = _nearest(by_time, item["time_s"])
        players = (frame or {}).get("players") or []
        texts = [str(player.get("instrument", "")) for player in players]
        ids = []
        for text in texts:
            ids.extend(match_ids(text, data))
        named = item["id"] in ids
        playing = any(bool(player.get("playing")) for player in players)
        others = sorted({found for found in ids if found != item["id"]})
        unseen = (frame or {}).get("visible") is False or any(text.casefold().replace(" ", "") in {"невидно", "unknown", "none"} for text in texts)
        rows.append({
            "time_s": item["time_s"],
            "id": item["id"],
            "named": named,
            "playingClaimed": playing,
            "otherIds": others,
            "unseen": unseen and not named,
            "raw": texts,
        })
    return {
        "cells": len(rows),
        "named": sum(1 for row in rows if row["named"]),
        "playingClaimed": sum(1 for row in rows if row["playingClaimed"]),
        "otherInstrument": sum(1 for row in rows if row["otherIds"] and not row["named"]),
        "unseen": sum(1 for row in rows if row["unseen"]),
        "rows": rows,
        "note": "На гравюре нет рук и смычка в движении. Честный ответ называет инструмент и ставит playing=false.",
    }


def _nearest(frames: list[tuple[float, dict]], t: float) -> dict | None:
    if not frames:
        return None
    return min(frames, key=lambda item: abs(item[0] - t))[1]
