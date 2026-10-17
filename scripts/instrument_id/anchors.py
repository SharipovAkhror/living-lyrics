"""Anchors: spans the song data already names, without asking the recognizer.

Instrumental sections in lyrics.json that name a catalogue key other than ensemble
are the test. The recognizer may say that class or abstain. An accepted different
class on the same span is a failure.
"""

from __future__ import annotations

import json
from pathlib import Path

from paths import ROOT, SONGS
from taxonomy import load


def _id_for_key(key: str, data: dict) -> str | None:
    for item in data["instruments"]:
        if item.get("catalogKey") == key or item["id"] == key:
            return item["id"]
    return None


def anchors_for(slug: str, data: dict | None = None) -> list[dict]:
    data = data or load()
    path = ROOT / "content" / "songs" / slug / "lyrics.json"
    lyrics = json.loads(path.read_text(encoding="utf-8"))
    found = []
    for section in lyrics.get("sections", []):
        if section.get("kind") != "instrumental":
            continue
        keys = [key for key in section.get("instruments") or [] if key != "ensemble"]
        if not keys:
            continue
        for key in keys:
            found.append({
                "section": section.get("id"),
                "start": float(section["start"]),
                "end": float(section["end"]),
                "catalogKey": key,
                "id": _id_for_key(key, data),
                "label": section.get("label") or "",
                "note": section.get("note") or "",
                "source": "content/songs/%s/lyrics.json" % slug,
            })
    return found


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def score_slug(slug: str, data: dict | None = None) -> dict:
    data = data or load()
    audio_path = ROOT / "docs" / "analysis" / slug / "instrument-id.json"
    fusion_path = ROOT / "docs" / "analysis" / slug / "fusion.json"
    audio = json.loads(audio_path.read_text(encoding="utf-8")) if audio_path.is_file() else None
    fusion = json.loads(fusion_path.read_text(encoding="utf-8")) if fusion_path.is_file() else None
    rows = []
    failures = 0
    for anchor in anchors_for(slug, data):
        said = []
        if audio:
            for source in audio.get("sources", {}).values():
                if source.get("stem") not in (None, "mix"):
                    continue
                for segment in source.get("segments", []):
                    if segment.get("kind") != "instrument" or not segment.get("id"):
                        continue
                    hit = _overlap(anchor["start"], anchor["end"], float(segment["start"]), float(segment["end"]))
                    if hit >= 1.0:
                        said.append(segment["id"])
        accepted_wrong = []
        accepted_right = []
        if fusion:
            for item in fusion.get("accepted", []):
                hit = _overlap(anchor["start"], anchor["end"], float(item["start"]), float(item["end"]))
                if hit < 1.0:
                    continue
                if anchor["id"] and item["id"] == anchor["id"]:
                    accepted_right.append(item["id"])
                else:
                    accepted_wrong.append(item["id"])
        if accepted_wrong:
            verdict = "fail"
            failures += 1
        elif accepted_right:
            verdict = "correct"
        else:
            verdict = "abstain"
        rows.append({
            **anchor,
            "said": sorted(set(said)),
            "acceptedRight": sorted(set(accepted_right)),
            "acceptedWrong": sorted(set(accepted_wrong)),
            "verdict": verdict,
        })
    return {"slug": slug, "failures": failures, "anchors": rows}


def write_anchors() -> Path:
    data = load()
    payload = {
        "songs": [score_slug(slug, data) for slug in SONGS],
        "note": (
            "Окно 23,7–62 с в I Have Come Alive, названное соло танбура, лежит внутри секции "
            "inst-tanbur 23,7–100,814 с. Отдельной границы 62 с в lyrics.json нет, поэтому якорь — вся секция."
        ),
    }
    path = ROOT / "docs" / "analysis" / "instrument-id-anchors.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(path)
    for song in payload["songs"]:
        print(f"{song['slug']}: якорей {len(song['anchors'])}, чужих принятых {song['failures']}")
    return path
