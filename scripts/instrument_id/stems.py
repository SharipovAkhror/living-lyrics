"""Compare the mix with Demucs stems on the anchor spans.

The full song is not separated. Each anchor is cut to at most 20 seconds and split
with the same htdemucs command the pipeline uses. Melodic anchors are read on
`other`, percussion on `drums`, voice on `vocals`. A wrong accepted class is an
error. This file does not edit pipeline.yml.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from anchors import anchors_for
from audio import ffmpeg_exe, load_mono
from paths import ROOT, SONGS
from predict import recognize_array, load_probe
from taxonomy import load

CAP_SEC = 20.0


def _source(slug: str) -> Path | None:
    folder = ROOT / "work" / slug
    for name in ("source.m4a", "source.wav", "source.flac"):
        candidate = folder / name
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    return None


def _cut(src: Path, dest: Path, start: float, end: float) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    length = min(CAP_SEC, max(0.5, end - start))
    proc = subprocess.run(
        [ffmpeg_exe(), "-y", "-v", "error", "-ss", str(start), "-t", str(length), "-i", str(src), str(dest)],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[-300:])


def _separate_many(wavs: list[Path], out_dir: Path) -> dict[str, dict[str, Path]]:
    """One demucs process for every cut, so the model is loaded once."""
    if not wavs:
        return {}
    out_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [sys.executable, "-m", "demucs", "-n", "htdemucs", "-o", str(out_dir), *[str(path) for path in wavs]],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[-400:])
    found: dict[str, dict[str, Path]] = {}
    for wav in wavs:
        track = out_dir / "htdemucs" / wav.stem
        stems = {}
        for name in ("vocals", "drums", "bass", "other"):
            produced = track / f"{name}.wav"
            if produced.is_file():
                stems[name] = produced
        found[wav.stem] = stems
    return found


def _stem_for(catalog_key: str, data: dict) -> str:
    for item in data["instruments"]:
        if item.get("catalogKey") == catalog_key or item["id"] == catalog_key:
            family = item["family"]
            if family == "voice":
                return "vocals"
            if family in data["percussionFamilies"]:
                return "drums"
            return "other"
    return "other"


def _said(audio, sample_rate: int, stem: str, meta, pack, data) -> list[str]:
    result = recognize_array(audio, stem, meta, pack, data)
    return sorted({seg["id"] for seg in result["segments"] if seg.get("kind") == "instrument" and seg.get("id")})


def compare() -> dict:
    data = load()
    songs = []
    demucs_ok = shutil.which("python") is not None
    try:
        import demucs  # noqa: F401
    except Exception:
        demucs_ok = False
    for slug in SONGS:
        src = _source(slug)
        row = {"slug": slug, "anchors": [], "status": "no-audio" if src is None else "ok"}
        if src is None or not demucs_ok:
            if src is not None and not demucs_ok:
                row["status"] = "no-demucs"
            songs.append(row)
            continue
        meta, pack = load_probe()
        sample_rate = int(meta["sampleRate"])
        cuts = []
        anchors = anchors_for(slug, data)
        try:
            for index, anchor in enumerate(anchors):
                cut = ROOT / "work" / slug / "anchor-cuts" / f"{index}.wav"
                _cut(src, cut, anchor["start"], anchor["end"])
                cuts.append(cut)
            separated = _separate_many(cuts, ROOT / "work" / slug / "anchor-demucs")
        except Exception as exc:
            songs.append({"slug": slug, "status": "error", "error": str(exc)[:400], "anchors": []})
            continue
        errors = {"mix": 0, "stem": 0}
        for index, anchor in enumerate(anchors):
            cut = cuts[index]
            audio = load_mono(cut, sample_rate)
            mix_said = _said(audio, sample_rate, "mix", meta, pack, data)
            stem_name = _stem_for(anchor["catalogKey"], data)
            stems = separated.get(cut.stem, {})
            stem_audio = load_mono(stems[stem_name], sample_rate) if stem_name in stems else None
            stem_said = _said(stem_audio, sample_rate, stem_name, meta, pack, data) if stem_audio is not None else []
            truth = anchor.get("id")
            mix_wrong = [name for name in mix_said if name != truth]
            stem_wrong = [name for name in stem_said if name != truth]
            if mix_wrong:
                errors["mix"] += 1
            if stem_wrong:
                errors["stem"] += 1
            row["anchors"].append({
                "section": anchor["section"],
                "catalogKey": anchor["catalogKey"],
                "stem": stem_name,
                "mixSaid": mix_said,
                "stemSaid": stem_said,
                "mixWrong": mix_wrong,
                "stemWrong": stem_wrong,
            })
        row["wrongAnchors"] = errors
        row["better"] = "stem" if errors["stem"] < errors["mix"] else "mix"
        songs.append(row)
    counted = [song for song in songs if song.get("wrongAnchors")]
    missing = [song["slug"] for song in songs if song.get("status") != "ok"]
    # A tie on one song does not block a stem that is nowhere worse and better in total.
    # A song with no audio blocks promotion: the check is unfinished.
    if missing or not counted:
        choice = "mix" if missing else "not-run"
        extra = ""
        if missing:
            extra = " Стем не становится основным: нет сравнения у " + ", ".join(missing) + "."
    else:
        worse = any(song["wrongAnchors"]["stem"] > song["wrongAnchors"]["mix"] for song in counted)
        total_stem = sum(song["wrongAnchors"]["stem"] for song in counted)
        total_mix = sum(song["wrongAnchors"]["mix"] for song in counted)
        if not worse and total_stem < total_mix:
            choice = "stem"
            extra = (
                " Стем ни на одной песне не хуже и в сумме называет чужой класс реже. "
                "Задание тогда разделяет песню целиком и в решение идут стемы."
            )
        else:
            choice = "mix"
            extra = " Смесь остаётся основной: стем не лучше в сумме или хуже хотя бы на одной песне."
    payload = {
        "choice": choice,
        "songs": songs,
        "note": "Сравнение только на вырезанных якорях, не дольше 20 с." + extra,
    }
    path = ROOT / "docs" / "analysis" / "instrument-id-stems.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"choice": choice, "songs": [{k: s.get(k) for k in ("slug", "status", "better", "wrongAnchors")} for s in songs]}, ensure_ascii=False))
    return payload


def mark_published(primary: str) -> None:
    """Record which listen the decision files were rewritten from."""
    path = ROOT / "docs" / "analysis" / "instrument-id-stems.json"
    if not path.is_file():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["published"] = primary
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"published {primary}")
