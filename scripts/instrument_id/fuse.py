"""Fuse audio segments, vision frames and song-level credits.

An interval needs a time from audio or from a frame. Credits never invent a time.
Accept when two of the three sources agree, or one timed source is very confident
and the other timed source does not name a different instrument.
Credits do not contradict by silence: a missing credit line is not a veto.
"""

from __future__ import annotations

import json
from pathlib import Path

from paths import ROOT
from taxonomy import credit_targets, load, match_ids

VISION_HIGH = 0.85  # not calibrated on our concerts
VISION_PAD = 1.5


def read_credits(slug: str, data: dict | None = None) -> list[dict]:
    data = data or load()
    song = json.loads((ROOT / "content" / "songs" / slug / "song.json").read_text(encoding="utf-8"))
    found = []
    seen = set()
    for credit in song.get("credits", []):
        for hit in credit_targets(credit.get("role", ""), data):
            key = (hit["id"], hit["family"], hit["group"], credit.get("name"))
            if key in seen:
                continue
            seen.add(key)
            found.append({**hit, "role": credit.get("role", ""), "person": credit.get("name", "")})
    return found


def _credit_covers(instrument: str, credits: list[dict], data: dict) -> bool:
    info = data["by_id"][instrument]
    for hit in credits:
        if hit.get("id") == instrument:
            return True
        if hit.get("family") and hit["family"] == info["family"]:
            return True
        if hit.get("group") == "percussion" and info["family"] in data["percussionFamilies"]:
            return True
    return False


def _overlap(a0: float, a1: float, b0: float, b1: float) -> bool:
    return a0 <= b1 and b0 <= a1


def _audio_pieces(payload: dict | None) -> list[dict]:
    if not payload:
        return []
    pieces = []
    for source in payload.get("sources", {}).values():
        for segment in source.get("segments", []):
            if segment.get("kind") != "instrument" or not segment.get("id"):
                continue
            pieces.append({
                "start": float(segment["start"]),
                "end": float(segment["end"]),
                "id": segment["id"],
                "confidence": float(segment["confidence"]),
                "stem": source.get("stem", "mix"),
            })
    return pieces


def _vision_pieces(vision: dict | None, data: dict) -> list[dict]:
    if not vision:
        return []
    pieces = []
    for frame in vision.get("frames", []):
        t = float(frame.get("time_s", 0))
        if frame.get("visible") is False:
            continue
        for player in frame.get("players", []):
            if not player.get("playing"):
                continue
            ids = match_ids(str(player.get("instrument", "")), data)
            if len(ids) != 1:
                continue
            pieces.append({
                "start": t - VISION_PAD,
                "end": t + VISION_PAD,
                "time_s": t,
                "id": ids[0],
                "confidence": float(player.get("confidence") or 0),
                "who": player.get("who") or "",
            })
    return pieces


def _gather(pieces: list[dict]) -> list[dict]:
    """Merge same-id pieces that touch or overlap into one interval."""
    ordered = sorted(pieces, key=lambda item: (item["id"], item["start"]))
    merged = []
    for piece in ordered:
        if merged and merged[-1]["id"] == piece["id"] and piece["start"] <= merged[-1]["end"] + 1.0:
            merged[-1]["end"] = max(merged[-1]["end"], piece["end"])
            merged[-1]["parts"].append(piece)
        else:
            merged.append({
                "id": piece["id"],
                "start": piece["start"],
                "end": piece["end"],
                "parts": [piece],
            })
    return merged


def decide(interval: dict, audio: list[dict], vision: list[dict], credits: list[dict], meta: dict, data: dict) -> dict:
    instrument = interval["id"]
    audio_here = [p for p in audio if p["id"] == instrument and _overlap(interval["start"], interval["end"], p["start"], p["end"])]
    vision_here = [p for p in vision if p["id"] == instrument and _overlap(interval["start"], interval["end"], p["start"], p["end"])]
    audio_other = [p for p in audio if p["id"] != instrument and _overlap(interval["start"], interval["end"], p["start"], p["end"])]
    vision_other = [p for p in vision if p["id"] != instrument and _overlap(interval["start"], interval["end"], p["start"], p["end"])]
    audio_conf = max((p["confidence"] for p in audio_here), default=0.0)
    vision_conf = max((p["confidence"] for p in vision_here), default=0.0)
    credit_hit = _credit_covers(instrument, credits, data)
    sources = []
    if audio_here:
        sources.append("audio")
    if vision_here:
        sources.append("vision")
    if credit_hit:
        sources.append("credits")
    disagrees = []
    if vision_other and not vision_here:
        disagrees.append("vision")
    if audio_other and not audio_here:
        disagrees.append("audio")
    high_audio = meta.get("threshold95")
    high_is_95 = high_audio is not None
    if high_audio is None:
        high_audio = meta.get("threshold", 0.9)

    def _others_not_credited(others: list[dict]) -> bool:
        return not any(_credit_covers(piece["id"], credits, data) for piece in others)

    if disagrees:
        # Credits break a tie only when they name this side and not the other.
        if credit_hit and disagrees == ["vision"] and audio_here and _others_not_credited(vision_other):
            decision = "accept"
        elif credit_hit and disagrees == ["audio"] and vision_here and _others_not_credited(audio_other):
            decision = "accept"
        else:
            decision = "conflict"
    elif len(sources) >= 2:
        decision = "accept"
    elif sources == ["audio"] and audio_conf >= float(high_audio):
        decision = "accept-single"
    elif sources == ["vision"] and vision_conf >= VISION_HIGH:
        decision = "accept-single"
    else:
        decision = "reject"
    who = next((p["who"] for p in vision_here if p.get("who")), "")
    return {
        "id": instrument,
        "name": data["by_id"][instrument]["name"],
        "start": round(interval["start"], 3),
        "end": round(interval["end"], 3),
        "decision": decision,
        "sources": sources,
        "audioConfidence": round(audio_conf, 4),
        "visionConfidence": round(vision_conf, 4),
        "who": who,
        "conflict": decision == "conflict",
        "visionHighUncalibrated": VISION_HIGH,
        "audioHighIs95": high_is_95,
    }


def fuse_payload(audio_payload: dict | None, vision: dict | None, credits: list[dict], meta: dict, data: dict | None = None) -> dict:
    data = data or load()
    audio = _audio_pieces(audio_payload)
    frames = _vision_pieces(vision, data)
    intervals = _gather(audio + frames)
    decisions = [decide(item, audio, frames, credits, meta, data) for item in intervals]
    return {
        "intervals": decisions,
        "accepted": [item for item in decisions if item["decision"].startswith("accept")],
        "visionHigh": VISION_HIGH,
        "visionCalibrated": False,
    }


def song_sets(slug: str, audio_payload: dict | None, data: dict | None = None) -> dict:
    """Honest credit comparison. Description names are not the denominator."""
    data = data or load()
    credits = read_credits(slug, data)
    predicted = []
    if audio_payload:
        for source in audio_payload.get("sources", {}).values():
            for segment in source.get("segments", []):
                if segment.get("kind") == "instrument" and segment.get("accepted") and segment.get("id"):
                    predicted.append(segment["id"])
    predicted_ids = sorted(set(predicted))
    found_ids, missed_ids = [], []
    found_groups, missed_groups = [], []
    for hit in credits:
        if hit.get("id"):
            (found_ids if hit["id"] in predicted_ids else missed_ids).append(hit["id"])
        elif hit.get("group") or hit.get("family"):
            label = hit.get("group") or hit.get("family")
            ok = any(_credit_covers(name, [hit], data) for name in predicted_ids)
            (found_groups if ok else missed_groups).append(label)
    extras = [name for name in predicted_ids if not _credit_covers(name, credits, data)]
    described = data.get("descriptionNames", {}).get(slug, [])
    return {
        "credits": credits,
        "creditIds": sorted(set(found_ids + missed_ids)),
        "found": sorted(set(found_ids)),
        "missed": sorted(set(missed_ids) - set(found_ids)),
        "foundGroups": sorted(set(found_groups)),
        "missedGroups": sorted(set(missed_groups) - set(found_groups)),
        "predicted": predicted_ids,
        "extras": extras,
        "describedNotInCredits": described,
        "describedAlsoPredicted": [name for name in described if name in predicted_ids],
        "listened": audio_payload is not None and bool(audio_payload.get("sources")),
    }


def write_fusion(slug: str) -> Path | None:
    """Write fusion.json and a short report when a timed source exists. Credits alone do not."""
    data = load()
    audio_path = ROOT / "docs" / "analysis" / slug / "instrument-id.json"
    vision_path = ROOT / "docs" / "analysis" / slug / "vision.json"
    audio = json.loads(audio_path.read_text(encoding="utf-8")) if audio_path.is_file() else None
    vision = json.loads(vision_path.read_text(encoding="utf-8")) if vision_path.is_file() else None
    if audio is None and vision is None:
        print(f"{slug}: нет ни распознанного звука, ни vision.json — интервалы не пишу")
        return None
    meta_path = ROOT / "scripts" / "instrument_id" / "weights" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {
        "threshold": 0.9, "threshold95": None,
    }
    credits = read_credits(slug, data)
    fused = fuse_payload(audio, vision, credits, meta, data)
    out = ROOT / "docs" / "analysis" / slug / "fusion.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"slug": slug, **fused}, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        f"# Сведение источников: {slug}",
        "",
        "Интервал берётся из звука или из кадра. Строка титров сама по себе время не создаёт.",
        "Принято, если сходятся два источника из трёх, либо один источник с очень высокой уверенностью и без противоречия.",
        f"Порог очень высокой уверенности кадра — {VISION_HIGH}, он не калиброван на концертах этого сайта.",
        "",
        "| с | по | инструмент | решение | источники | звук | кадр | кто |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for item in fused["intervals"]:
        lines.append(
            f"| {item['start']} | {item['end']} | {item['name']} | {item['decision']} | "
            f"{', '.join(item['sources'])} | {item['audioConfidence']} | {item['visionConfidence']} | {item['who']} |"
        )
    if not fused["intervals"]:
        lines += ["", "Совпавших по времени отрезков нет."]
    lines += ["", f"Принято отрезков: {len(fused['accepted'])}.", ""]
    report = ROOT / "docs" / "analysis" / slug / "instruments.md"
    existing = report.read_text(encoding="utf-8") if report.is_file() else ""
    if "# Сведение источников" in existing:
        existing = existing.split("# Сведение источников")[0].rstrip()
    block = "\n".join(lines) + "\n"
    if existing.strip():
        report.write_text(existing.rstrip() + "\n\n" + block, encoding="utf-8")
    else:
        report.write_text(block, encoding="utf-8")
    print(f"{slug}: {out}")
    return out
