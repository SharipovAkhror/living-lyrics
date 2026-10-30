"""Instrument presence and entrances from the concert video.

Rules (also docs/methodology/09-instruments.md, «Что попадает в данные песни»):

1. An instrument may appear in the song when the credits name it (by id or by family)
   and a close or medium shot shows it being played at confidence ≥ 0.8, or when the
   video shows it being played on at least three close or medium shots spaced ≥ 8 s
   apart at confidence ≥ 0.85. One shot is only a check. orchestra, choir and voice
   stay groups. A credit that only names the percussion group («ударные») does not
   license one frame, but two such shots at ≥ 0.85 are enough for a percussion-family
   instrument. Audio is reported where it agrees; it does not admit or reject.
   Frames listed in docs/analysis/<slug>/vision-review.json with verdict "wrong" are
   not counted, and neither is the same instrument within 8 s: that is one shot.

2. An instrumental section lists the admitted instruments that are seen in it.
   Order is the first clear frame. More than eight drawings: keep the seven most
   prominent (clear-frame count times mean confidence; ties break on mean confidence,
   then earlier time, then id) and fold the rest into ensemble. entries[].at is that
   frame, moved back to an attack on the matching stem when one falls within the
   previous 2 s. until is never set. A voice or choir section keeps that key first
   and gains entries for admitted instruments seen playing in it. Choir wins the key
   when more frames show the choir singing than a soloist. Applause and bows, with
   nobody playing, are an empty stage: label «Аплодисменты», no ensemble plate.
   A vocal section with words is left as lines.

3. A recognition id is drawn only with its own catalog engraving, or with the engraving
   of the one id named in aliasOf. Without one, the id stays out of instruments and is
   listed as a missing engraving.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from paths import ROOT, SONGS
from taxonomy import credit_targets, load, match_ids, plate_key

# Not tuned per song. Close/medium is the first word of the frame note.
CREDIT_CONF = 0.8
STABLE_CONF = 0.85
STABLE_SHOTS = 3
# A named percussion group lowers the bar from three shots to two. Still ≥ 0.85, still ≥ 8 s.
GROUP_SHOTS = 2
SHOT_GAP = 8.0
MAX_DRAWINGS = 8
# When more than eight drawings would be needed, this many stay themselves.
PROMINENT_KEEP = 7
ATTACK_LEAD = 2.0
# A 100 ms rise on the 0…1 stem envelope. About a clear note on `other` and a
# moderate hit on `drums` across these recordings; the same number for every song.
ATTACK_RISE = 0.15
ATTACK_HOPS = 2
GROUPS = frozenset({"orchestra", "choir", "voice", "ensemble"})
CLEAR_SHOTS = frozenset({"close", "medium"})
VOICE_KEYS = frozenset({"voice", "choir"})
LYRICS_FIELDS = ("instruments", "entries", "performers")


def shot_of(note: str) -> str:
    word = (note or "").strip().split(" ", 1)[0].lower().rstrip(".,:;")
    return word


def player_id(raw: str, data: dict) -> str | None:
    """Vision writes an id. A name is accepted only when it matches one class."""
    text = str(raw or "").strip()
    if text in data["by_id"]:
        return text
    found = match_ids(text, data)
    if len(found) == 1:
        return found[0]
    return None


def credited(instrument: str, credits: list[dict], data: dict) -> bool:
    """Credits name this id, or name its family. A group does not name a member."""
    info = data["by_id"].get(instrument)
    if not info:
        return False
    for hit in credits:
        if hit.get("id") == instrument:
            return True
        if hit.get("family") and hit["family"] == info["family"]:
            return True
    return False


def group_credited(instrument: str, credits: list[dict], data: dict) -> bool:
    """Credits name the percussion group, and this id belongs to that group.

    The group still does not license a single frame. Two clear shots do.
    An orchestra credit is not this path: it must not name a violin.
    """
    info = data["by_id"].get(instrument) or {}
    family = info.get("family")
    if family not in set(data.get("percussionFamilies") or []):
        return False
    return any(hit.get("group") == "percussion" for hit in credits)


def load_reviews(slug: str) -> list[dict]:
    """Frames a person checked and called wrong. Missing file means nothing is rejected."""
    raw = _load_json(ROOT / "docs" / "analysis" / slug / "vision-review.json")
    if not isinstance(raw, list):
        return []
    return [row for row in raw if isinstance(row, dict)]


def review_rejects(reviews: list[dict], instrument: str, time_s: float) -> bool:
    """A wrong frame voids that shot: the same instrument closer than 8 s is one plan."""
    for row in reviews:
        if str(row.get("verdict") or "") != "wrong":
            continue
        if str(row.get("instrument") or "") != instrument:
            continue
        try:
            mark = float(row.get("time_s"))
        except (TypeError, ValueError):
            continue
        if abs(mark - time_s) < SHOT_GAP - 1e-9:
            return True
    return False


def spaced(times: list[float], gap: float = SHOT_GAP) -> list[float]:
    kept: list[float] = []
    for t in sorted(times):
        if not kept or t - kept[-1] >= gap - 1e-9:
            kept.append(t)
    return kept


def read_credits(slug: str, data: dict | None = None) -> list[dict]:
    """Song credits as taxonomy hits. Same reading as fuse.read_credits."""
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


def catalog_names(list_ts: Path | None = None) -> dict[str, str]:
    """Catalog key → Russian name, lower case, as performers write it."""
    path = list_ts or (ROOT / "src" / "instruments" / "list.ts")
    text = path.read_text(encoding="utf-8")
    names = {}
    for key, name in re.findall(r"key:\s*'([^']+)',\s*name:\s*'([^']+)'", text):
        names[key] = name[:1].lower() + name[1:]
    return names


def stem_for(instrument: str, data: dict) -> str:
    """`drums` for percussion, `other` for strings and winds (and the rest of that stem)."""
    info = data["by_id"].get(instrument) or {}
    if info.get("family") in data.get("percussionFamilies", []):
        return "drums"
    return "other"


def attack_times(track: list[float], rate: float) -> list[float]:
    """Starts of clear rises. One number for every song, see ATTACK_RISE."""
    if rate <= 0 or len(track) <= ATTACK_HOPS + 1:
        return []
    times = []
    last = -1e9
    for i in range(ATTACK_HOPS, len(track) - 1):
        rise = track[i] - track[i - ATTACK_HOPS]
        prev = track[i - 1] - track[i - 1 - ATTACK_HOPS]
        nxt = track[i + 1] - track[i + 1 - ATTACK_HOPS]
        if rise >= ATTACK_RISE and rise >= prev and rise > nxt:
            t = (i - ATTACK_HOPS) / rate
            if t - last >= 0.15:
                times.append(t)
                last = t
    return times


def snap_at(frame_t: float, start: float, end: float, attacks: list[float]) -> float:
    """Frame time, or the latest attack in the 2 s before it, clamped into the section."""
    window = [t for t in attacks if frame_t - ATTACK_LEAD - 1e-9 <= t <= frame_t + 1e-9]
    chosen = window[-1] if window else frame_t
    at = max(start, chosen)
    limit = end - 0.01
    if at >= end:
        at = min(frame_t, limit)
    at = min(max(at, start), limit)
    return round(at + 0.0, 2)


def _load_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def collect_shots(vision: dict | None, data: dict, reviews: list[dict] | None = None) -> tuple[dict[str, list[dict]], list[str]]:
    """Close/medium frames where someone is playing. Groups stay out of the lists.

    A reviewed wrong frame is dropped here, so it cannot admit the instrument or open an entrance.
    """
    reviews = reviews or []
    by_id: dict[str, list[dict]] = {}
    unmatched: list[str] = []
    if not vision:
        return by_id, unmatched
    for frame in vision.get("frames") or []:
        shot = shot_of(str(frame.get("note") or ""))
        if shot not in CLEAR_SHOTS:
            continue
        t = float(frame.get("time_s") or 0)
        seen_here = set()
        for player in frame.get("players") or []:
            if not player.get("playing"):
                continue
            iid = player_id(str(player.get("instrument") or ""), data)
            if not iid:
                raw = str(player.get("instrument") or "").strip()
                if raw and raw not in unmatched:
                    unmatched.append(raw)
                continue
            if iid in GROUPS or iid in seen_here:
                continue
            if review_rejects(reviews, iid, t):
                continue
            seen_here.add(iid)
            by_id.setdefault(iid, []).append({
                "time": t,
                "shot": shot,
                "confidence": float(player.get("confidence") or 0),
                "note": str(frame.get("note") or ""),
            })
    for rows in by_id.values():
        rows.sort(key=lambda row: (row["time"], -row["confidence"]))
    return by_id, unmatched


def _audio_hits(audio: dict | None) -> list[dict]:
    hits = []
    if not audio:
        return hits
    for source in (audio.get("sources") or {}).values():
        for seg in source.get("segments") or []:
            if seg.get("kind") != "instrument" or not seg.get("id") or not seg.get("accepted"):
                continue
            hits.append({
                "id": seg["id"],
                "start": float(seg["start"]),
                "end": float(seg["end"]),
            })
    return hits


def audio_agrees(hits: list[dict], instrument: str, times: list[float], pad: float = 1.5) -> bool:
    for t in times:
        for hit in hits:
            if hit["id"] == instrument and hit["start"] - pad <= t <= hit["end"] + pad:
                return True
    return False


def decide_presence(shots: dict[str, list[dict]], credits: list[dict], audio_hits: list[dict], data: dict) -> tuple[list[dict], list[dict]]:
    present = []
    check = []
    for iid, rows in shots.items():
        clear80 = [row for row in rows if row["confidence"] >= CREDIT_CONF - 1e-9]
        clear85 = [row for row in rows if row["confidence"] >= STABLE_CONF - 1e-9]
        if not clear80 and not clear85:
            continue
        named = credited(iid, credits, data)
        grouped = group_credited(iid, credits, data)
        stable_times = spaced([row["time"] for row in clear85])
        stable = len(stable_times) >= STABLE_SHOTS
        by_credit = named and len(clear80) >= 1
        # The group does not lower the confidence bar. Two spaced ≥ 0.85 shots, not one 0.8 frame.
        by_group = (not named) and grouped and len(stable_times) >= GROUP_SHOTS
        info = data["by_id"][iid]
        record = {
            "id": iid,
            "name": info["name"],
            "catalogKey": plate_key(info, data),
            "family": info["family"],
            "credited": named,
            "grouped": grouped and by_group,
            "stable": stable,
            "shots80": len(spaced([row["time"] for row in clear80])),
            "shots85": len(stable_times),
            "frames80": len(clear80),
            "audio": audio_agrees(audio_hits, iid, [row["time"] for row in (clear85 or clear80)]),
            "rows": clear85 if (stable or by_group) and not by_credit else clear80,
        }
        if by_credit or by_group or stable:
            if by_credit and stable:
                reason = "титры и кадр, устойчиво по видео"
            elif by_credit:
                reason = "титры и кадр"
            elif by_group and stable:
                reason = "группа в титрах и два плана, устойчиво по видео"
            elif by_group:
                reason = "группа в титрах и два плана"
            else:
                reason = "устойчиво по видео"
            record["reason"] = reason
            present.append(record)
        else:
            if len(spaced([row["time"] for row in clear80])) <= 1:
                why = "один план"
            elif named:
                why = "титры есть, на чётком плане уверенность ниже 0,8"
            elif len(stable_times) == 0:
                why = "уверенность ниже 0,85, в титрах нет"
            else:
                why = f"планов с уверенностью ≥ 0,85: {len(stable_times)} из {STABLE_SHOTS}, в титрах нет"
            record["why"] = why
            check.append(record)
    present.sort(key=lambda item: item["id"])
    check.sort(key=lambda item: (-item["frames80"], item["id"]))
    return present, check


def section_at(sections: list[dict], t: float) -> dict | None:
    for section in sections:
        start = float(section["start"])
        end = float(section["end"])
        if start <= t < end or (t == end and section is sections[-1] and start <= t):
            return section
    return None


def is_voice_section(section: dict) -> bool:
    if section.get("kind") != "instrumental":
        return False
    keys = section.get("instruments") or []
    return bool(keys) and all(key in VOICE_KEYS for key in keys)


_APPLAUSE = re.compile(
    r"\b(applause|applaud\w*|clapping|claps?|ovation|thank\w*|bowing|bows)\b",
    re.IGNORECASE,
)
APPLAUSE_LABEL = "Аплодисменты"
APPLAUSE_NOTE = "Аплодисменты и поклоны, пения нет."
CHOIR_LABEL = "Хор"


def _playing_ids(frame: dict, data: dict) -> list[str]:
    found = []
    for player in frame.get("players") or []:
        if not player.get("playing"):
            continue
        raw = str(player.get("instrument") or "").strip()
        iid = player_id(raw, data) or raw
        if iid:
            found.append(iid)
    return found


def _section_frames(section: dict, frames: list[dict], last: bool) -> list[dict]:
    start = float(section["start"])
    end = float(section["end"])
    inside = []
    for frame in frames:
        t = float(frame.get("time_s") or 0)
        if start <= t < end or (last and t == end and start <= t):
            inside.append(frame)
    return inside


def is_applause(frames: list[dict], data: dict) -> bool:
    """Bows and clapping, not a performance.

    One applause frame is enough when nobody is playing at all (a dark hall after the bows
    is still the ending). If a group is marked playing, applause has to be the majority,
    and a named instrument or a soloist keeps the section as music.
    """
    if not frames:
        return False
    applause_n = 0
    anyone = False
    solo = False
    named = False
    for frame in frames:
        if _APPLAUSE.search(str(frame.get("note") or "")):
            applause_n += 1
        ids = _playing_ids(frame, data)
        if ids:
            anyone = True
        for iid in ids:
            if iid == "voice":
                solo = True
            elif iid not in GROUPS:
                named = True
    if solo or named or applause_n == 0:
        return False
    if not anyone:
        return True
    return applause_n * 2 > len(frames)


def _bar(item: dict) -> float:
    """Credit-backed instruments may use the 0.8 frame. Video-only ones stay at 0.85."""
    if item["credited"]:
        return CREDIT_CONF
    return STABLE_CONF


def solo_people(credits: list[dict], data: dict) -> dict[str, str]:
    """Catalog key → the one person the credits name for it."""
    people: dict[str, set[str]] = {}
    for hit in credits:
        iid = hit.get("id")
        person = (hit.get("person") or "").strip()
        if not iid or not person:
            continue
        info = data["by_id"].get(iid) or {}
        key = plate_key(info, data)
        if not key:
            continue
        people.setdefault(key, set()).add(person)
    return {key: next(iter(names)) for key, names in people.items() if len(names) == 1}


def performers_for(section: dict, keys: list[str], names: dict[str, str], solo: dict[str, str]) -> list[str]:
    existing = {}
    for line in section.get("performers") or []:
        match = re.search(r"\(([^)]+)\)\s*$", str(line).strip())
        if match:
            existing[match.group(1).strip().casefold()] = str(line).strip()
    out = []
    for key in keys:
        if key in ("ensemble", "voice", "choir"):
            continue
        label = names.get(key, "")
        if not label:
            continue
        kept = existing.get(label.casefold())
        if kept:
            out.append(kept)
            continue
        person = solo.get(key)
        if person:
            out.append(f"{person} ({label})")
    return out


def _first_rows(item: dict, start: float, end: float) -> list[dict]:
    bar = _bar(item)
    rows = [
        row for row in item["rows"]
        if row["confidence"] >= bar - 1e-9 and start <= row["time"] < end
    ]
    rows.sort(key=lambda row: (row["time"], -row["confidence"]))
    return rows


def _prominence(rows: list[dict]) -> float:
    """Clear frames in the section times their mean confidence."""
    if not rows:
        return 0.0
    return len(rows) * (sum(row["confidence"] for row in rows) / len(rows))


def _candidates(present: list[dict], start: float, end: float) -> list[dict]:
    found = []
    for item in present:
        rows = _first_rows(item, start, end)
        if not rows:
            continue
        found.append({"time": rows[0]["time"], "item": item, "rows": rows})
    found.sort(key=lambda row: (row["time"], row["item"]["id"]))
    return found


def _select_drawings(drawable: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep every drawing up to eight. Above that, the seven most prominent stay.

    Voice and choir are not in this list: they are the section, not one of the seven.
    Chosen rows stay in time order. Ties: higher mean confidence, then earlier, then id.
    """
    if len(drawable) <= MAX_DRAWINGS:
        return list(drawable), []
    ranked = sorted(drawable, key=lambda row: (
        -_prominence(row["rows"]),
        -(sum(item["confidence"] for item in row["rows"]) / len(row["rows"])),
        row["time"],
        row["item"]["id"],
    ))
    keep = {row["item"]["id"] for row in ranked[:PROMINENT_KEEP]}
    chosen = [row for row in drawable if row["item"]["id"] in keep]
    overflow = [row for row in drawable if row["item"]["id"] not in keep]
    return chosen, overflow


def _entry(key: str, at: float, frame: float, iid: str, rows: list[dict] | None = None) -> dict:
    return {
        "key": key,
        "at": at,
        "frame": round(frame, 2),
        "id": iid,
        "prominence": round(_prominence(rows), 2) if rows else None,
    }


def _build_entries(
    chosen: list[dict],
    overflow: list[dict],
    start: float,
    end: float,
    attacks: dict[str, list[float]],
    data: dict,
    identity: str | None,
) -> list[dict]:
    entries = []
    if identity in VOICE_KEYS:
        # The plate is already there when the section opens. An attack must not move it.
        entries.append(_entry(identity, round(start, 2), start, identity))
    for row in chosen:
        item = row["item"]
        stem = stem_for(item["id"], data)
        at = snap_at(row["time"], start, end, attacks.get(stem) or [])
        entries.append(_entry(item["catalogKey"], at, row["time"], item["id"], row["rows"]))
    if overflow:
        first = min(overflow, key=lambda row: (row["time"], row["item"]["id"]))
        stem = stem_for(first["item"]["id"], data)
        at = snap_at(first["time"], start, end, attacks.get(stem) or [])
        entries.append(_entry("ensemble", at, first["time"], "ensemble"))
    entries.sort(key=lambda entry: (entry["at"], 0 if entry["key"] in VOICE_KEYS else 1, entry["key"]))
    dedup = []
    seen = set()
    for entry in entries:
        if entry["key"] in seen:
            continue
        seen.add(entry["key"])
        dedup.append(entry)
    return dedup


def _singing_counts(frames: list[dict], data: dict) -> tuple[int, int]:
    choir = solo = 0
    for frame in frames:
        ids = _playing_ids(frame, data)
        if "choir" in ids:
            choir += 1
        if "voice" in ids:
            solo += 1
    return choir, solo


def plan_sections(
    sections: list[dict],
    present: list[dict],
    attacks: dict[str, list[float]],
    names: dict[str, str],
    solo: dict[str, str],
    data: dict,
    frames: list[dict] | None = None,
) -> list[dict]:
    frames = frames or []
    instrumental = [section for section in sections if section.get("kind") == "instrumental"]
    plans = []
    for section in instrumental:
        last = section is instrumental[-1]
        seen_frames = _section_frames(section, frames, last)
        start = float(section["start"])
        end = float(section["end"])
        base = {
            "id": section["id"],
            "start": start,
            "end": end,
            "label": section.get("label") or "",
            "before": list(section.get("instruments") or []),
        }
        choir_n, solo_n = _singing_counts(seen_frames, data)
        # A vocalise stays one after the first write, when instruments already follow voice or choir.
        # Applause is decided from the frames, so an empty list does not fall through to ensemble.
        identity = None
        lead = (base["before"] or [None])[0]
        if is_applause(seen_frames, data):
            identity = "applause"
        elif lead in VOICE_KEYS:
            identity = "choir" if choir_n > solo_n and choir_n > 0 else "voice"
        base["identity"] = identity
        base["choirFrames"] = choir_n
        base["soloFrames"] = solo_n
        if identity == "applause":
            plans.append({
                **base,
                "action": "applause",
                "label": APPLAUSE_LABEL,
                "note": APPLAUSE_NOTE,
                "instruments": [],
                "entries": [],
                "performers": [],
                "missing": [],
                "folded": [],
            })
            continue
        ranked = _candidates(present, start, end)
        drawable = [row for row in ranked if row["item"].get("catalogKey")]
        missing = [row for row in ranked if not row["item"].get("catalogKey")]
        missing_out = [{"id": row["item"]["id"], "time": row["time"]} for row in missing]
        if identity == "voice" and not drawable:
            plans.append({
                **base,
                "action": "voice",
                "seen": [{"id": row["item"]["id"], "time": row["time"]} for row in missing],
                "instruments": base["before"] or ["voice"],
                "entries": [],
                "performers": list(section.get("performers") or []),
                "missing": missing_out,
                "folded": [],
            })
            continue
        if not drawable and identity != "choir":
            plans.append({
                **base,
                "action": "unchanged",
                "missing": missing_out,
                "instruments": base["before"],
                "entries": list(section.get("entries") or []),
                "performers": list(section.get("performers") or []),
                "folded": [],
            })
            continue
        chosen, overflow = _select_drawings(drawable)
        dedup = _build_entries(chosen, overflow, start, end, attacks, data, identity if identity in VOICE_KEYS else None)
        # Voice or choir alone holds the plate for the whole section. No fake turn-taking.
        only_voice = bool(dedup) and all(entry["key"] in VOICE_KEYS for entry in dedup)
        if only_voice:
            dedup = []
        keys = [identity] if only_voice and identity in VOICE_KEYS else [entry["key"] for entry in dedup]
        if identity == "choir":
            label = CHOIR_LABEL
        else:
            label = base["label"]
        plans.append({
            **base,
            "action": "write",
            "label": label,
            "instruments": keys,
            "entries": [{"key": entry["key"], "at": entry["at"]} for entry in dedup],
            "entryFrames": {entry["key"]: entry["frame"] for entry in dedup},
            "prominence": {entry["id"]: entry["prominence"] for entry in dedup if entry["prominence"] is not None},
            "performers": performers_for(section, keys, names, solo),
            "folded": [row["item"]["id"] for row in overflow],
            "foldedProminence": {row["item"]["id"]: round(_prominence(row["rows"]), 2) for row in overflow},
            "missing": missing_out,
        })
    return plans


def plan(
    vision: dict | None,
    credits: list[dict],
    sections: list[dict],
    features: dict | None,
    audio: dict | None,
    names: dict[str, str] | None = None,
    data: dict | None = None,
    slug: str = "",
    reviews: list[dict] | None = None,
) -> dict:
    data = data or load()
    names = names if names is not None else catalog_names()
    reviews = reviews or []
    shots, unmatched = collect_shots(vision, data, reviews)
    audio_hits = _audio_hits(audio)
    present, check = decide_presence(shots, credits, audio_hits, data)
    attacks = {}
    if features and features.get("tracks") and features.get("rate"):
        rate = float(features["rate"])
        for stem in ("other", "drums"):
            track = features["tracks"].get(stem) or []
            attacks[stem] = attack_times(track, rate)
    vision_frames = list((vision or {}).get("frames") or [])
    section_plans = plan_sections(
        sections, present, attacks, names, solo_people(credits, data), data, vision_frames,
    )
    return {
        "slug": slug,
        "present": present,
        "check": check,
        "unmatched": unmatched,
        "sections": section_plans,
        "shots": shots,
        "reviews": reviews,
    }


def load_song(slug: str, data: dict | None = None) -> dict:
    data = data or load()
    lyrics = json.loads((ROOT / "content" / "songs" / slug / "lyrics.json").read_text(encoding="utf-8"))
    return plan(
        _load_json(ROOT / "docs" / "analysis" / slug / "vision.json"),
        read_credits(slug, data),
        lyrics["sections"],
        _load_json(ROOT / "public" / "audio" / slug / "features.json"),
        _load_json(ROOT / "docs" / "analysis" / slug / "instrument-id.json"),
        catalog_names(),
        data,
        slug,
        load_reviews(slug),
    )


def _fmt(t: float) -> str:
    return f"{t:.2f}".rstrip("0").rstrip(".")


def _where(sections: list[dict], times: list[float]) -> str:
    labels = []
    for t in times:
        section = section_at(sections, t)
        if not section:
            labels.append(_fmt(t))
            continue
        label = f"{section['id']} {_fmt(t)}"
        if label not in labels:
            labels.append(label)
    return "; ".join(labels[:8])


def missing_table(result: dict, lyrics_sections: list[dict]) -> list[dict]:
    """Admitted ids with no engraving: where they are seen, and how many shots."""
    rows = []
    for item in result["present"]:
        if item.get("catalogKey"):
            continue
        times = spaced([row["time"] for row in item["rows"] if row["confidence"] >= _bar(item) - 1e-9])
        rows.append({
            "id": item["id"],
            "name": item["name"],
            "shots": len(times),
            "where": _where(lyrics_sections, times),
        })
    return rows


def render_markdown(result: dict, lyrics_sections: list[dict]) -> str:
    slug = result["slug"]
    lines = [
        f"# Вступления по видео: {slug}",
        "",
        "Считает `python scripts/instrument_id/run.py entries`. "
        "Присутствие — титры и чёткий кадр, либо три разнесённых плана. "
        "Группа «ударные» в титрах снижает порог до двух планов с уверенностью не ниже 0,85. "
        "Один кадр сюда не попадает. Кадр из `vision-review.json` и тот же план (ближе 8 с) не считаются. "
        "Звук отмечен, где он совпал, и решение не меняет. "
        "`until` нет: склейка камеры — не уход инструмента. "
        "Если гравюр больше восьми, остаются семь самых заметных, остальные — ансамбль.",
        "",
        "## Присутствие",
        "",
        "| id | гравюра | решение | планов ≥ 0,85 | звук |",
        "|---|---|---|---|---|",
    ]
    for item in result["present"]:
        grav = f"`{item['catalogKey']}`" if item.get("catalogKey") else "нет"
        sound = "да" if item["audio"] else "нет"
        lines.append(f"| `{item['id']}` | {grav} | {item['reason']} | {item['shots85']} | {sound} |")
    if not result["present"]:
        lines.append("| — | — | никого | — | — |")
    lines += [
        "",
        "## Секции",
        "",
        "| секция | с | по | что записано |",
        "|---|---|---|---|",
    ]
    for section in result["sections"]:
        if section["action"] == "applause":
            written = "аплодисменты, гравюр нет"
        elif section["action"] == "voice":
            extra = ""
            if section.get("seen"):
                extra = "; без гравюры: " + ", ".join(
                    f"{row['id']} {_fmt(row['time'])}" for row in section["seen"][:6]
                )
            written = "голос, как было" + extra
        elif section["action"] == "unchanged":
            written = "как было: " + ", ".join(f"`{key}`" for key in section["instruments"])
            if section.get("missing"):
                written += "; без гравюры: " + ", ".join(row["id"] for row in section["missing"])
        else:
            frames = section.get("entryFrames") or {}
            keys_now = section.get("instruments") or []
            # Choir or voice alone has no timed entries: the plate holds for the whole section.
            if not section.get("entries") and keys_now and all(key in VOICE_KEYS for key in keys_now):
                bits = [f"`{key}`" for key in keys_now]
                written = ", ".join(bits) + ", на всю секцию"
                if section.get("performers"):
                    written += ". Исполнители: " + "; ".join(section["performers"])
                lines.append(f"| `{section['id']}` | {_fmt(section['start'])} | {_fmt(section['end'])} | {written} |")
                continue
            bits = []
            for entry in section["entries"]:
                frame = frames.get(entry["key"])
                bit = f"`{entry['key']}` {_fmt(entry['at'])}"
                if frame is not None and abs(frame - entry["at"]) >= 0.05:
                    bit += f" (кадр {_fmt(frame)})"
                bits.append(bit)
            written = ", ".join(bits)
            if section.get("folded"):
                ranks = section.get("foldedProminence") or {}
                bits_folded = []
                for iid in section["folded"]:
                    score = ranks.get(iid)
                    bits_folded.append(f"{iid} ({_fmt(score)})" if isinstance(score, (int, float)) else iid)
                written += "; свёрнуты в ансамбль: " + ", ".join(bits_folded)
            prominence = section.get("prominence") or {}
            if prominence:
                shown = ", ".join(f"{iid} {_fmt(score)}" for iid, score in prominence.items())
                written += f". Заметность: {shown}"
        if section.get("performers"):
            written += ". Исполнители: " + "; ".join(section["performers"])
        lines.append(f"| `{section['id']}` | {_fmt(section['start'])} | {_fmt(section['end'])} | {written} |")
    placed = set()
    for section in result["sections"]:
        if section["action"] == "write":
            placed.update(section["instruments"])
    unstaged = [item for item in result["present"] if item.get("catalogKey") and item["catalogKey"] not in placed]
    if unstaged:
        lines += [
            "",
            "## Приняты, в проигрыш не попали",
            "",
            "Инструмент принят в песню, гравюра есть, но чёткий кадр попал только в вокальную секцию "
            "со словами: в это время сцена показывает строки, не гравюру.",
            "",
            "| id | гравюра | планов ≥ 0,85 |",
            "|---|---|---|",
        ]
        for item in unstaged:
            lines.append(f"| `{item['id']}` | `{item['catalogKey']}` | {item['shots85']} |")
    lines += ["", "## Проверить", ""]
    if not result["check"]:
        lines.append("Одиночных и неустойчивых планов нет.")
    else:
        lines += [
            "| id | почему | планы |",
            "|---|---|---|",
        ]
        for item in result["check"]:
            times = spaced([row["time"] for row in item["rows"]])
            lines.append(f"| `{item['id']}` | {item['why']} | {_where(lyrics_sections, times)} |")
    lines += ["", "## Нужна гравюра", ""]
    missing = missing_table(result, lyrics_sections)
    if not missing:
        lines.append("У всего, что принято, гравюра есть.")
    else:
        lines += [
            "| id | где звучит | планов |",
            "|---|---|---|",
        ]
        for row in missing:
            lines.append(f"| `{row['id']}` | {row['where']} | {row['shots']} |")
    if result["unmatched"]:
        lines += ["", "## Кадр не сопоставлен", "", ", ".join(f"`{name}`" for name in result["unmatched"]), ""]
    reviews = [row for row in result.get("reviews") or [] if str(row.get("verdict") or "") == "wrong"]
    if reviews:
        lines += [
            "",
            "## Не засчитаны",
            "",
            "Кадр из `vision-review.json`. Тот же инструмент ближе чем на 8 с — тот же план, он тоже не считается.",
            "",
            "| с | инструмент | заметка |",
            "|---|---|---|",
        ]
        for row in reviews:
            lines.append(f"| {_fmt(float(row.get('time_s') or 0))} | `{row.get('instrument')}` | {row.get('note') or ''} |")
    lines.append("")
    return "\n".join(lines)


def write_report(result: dict, lyrics_sections: list[dict]) -> Path:
    folder = ROOT / "docs" / "analysis" / result["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    public = {
        "slug": result["slug"],
        "present": [
            {key: item[key] for key in ("id", "name", "catalogKey", "reason", "credited", "stable", "shots80", "shots85", "audio")}
            for item in result["present"]
        ],
        "check": [
            {"id": item["id"], "why": item["why"], "shots": item["shots85"], "frames": item["frames80"]}
            for item in result["check"]
        ],
        "missingEngraving": missing_table(result, lyrics_sections),
        "sections": [
            {
                "id": section["id"],
                "action": section["action"],
                "label": section.get("label"),
                "identity": section.get("identity"),
                "instruments": section["instruments"],
                "entries": section["entries"],
                "performers": section["performers"],
                "choirFrames": section.get("choirFrames"),
                "soloFrames": section.get("soloFrames"),
            }
            for section in result["sections"]
        ],
    }
    (folder / "entries.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path = folder / "entries.md"
    path.write_text(render_markdown(result, lyrics_sections), encoding="utf-8")
    return path


def _line_fingerprint(lyrics: dict) -> list:
    """Words and times. write_lyrics must not move these."""
    frozen = []
    for section in lyrics.get("sections") or []:
        frozen.append((section.get("id"), section.get("start"), section.get("end"), section.get("kind")))
        for line in section.get("lines") or []:
            words = tuple((word.get("w"), word.get("s"), word.get("e")) for word in line.get("words") or [])
            frozen.append((line.get("id"), line.get("lang"), words))
    return frozen


def write_lyrics(slug: str, result: dict) -> None:
    """Replace instruments, entries, performers, and a label or note the video corrected.

    Lines, words and times are compared before the file is written and left as they were.
    """
    path = ROOT / "content" / "songs" / slug / "lyrics.json"
    lyrics = json.loads(path.read_text(encoding="utf-8"))
    before = _line_fingerprint(lyrics)
    by_id = {section["id"]: section for section in result["sections"]}
    for section in lyrics["sections"]:
        plan_row = by_id.get(section["id"])
        if not plan_row or plan_row["action"] not in ("write", "applause"):
            continue
        if plan_row.get("label") and plan_row["label"] != section.get("label"):
            section["label"] = plan_row["label"]
        section["instruments"] = list(plan_row["instruments"])
        if plan_row["entries"]:
            section["entries"] = [{"key": entry["key"], "at": entry["at"]} for entry in plan_row["entries"]]
        else:
            section.pop("entries", None)
        if plan_row["performers"]:
            section["performers"] = list(plan_row["performers"])
        else:
            section.pop("performers", None)
        if plan_row["action"] == "applause":
            section["note"] = plan_row["note"]
    if _line_fingerprint(lyrics) != before:
        raise SystemExit(f"{slug}: запись задела строки или время, файл не тронут")
    text = json.dumps(lyrics, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def _frame(t: float, shot: str, instrument: str, confidence: float, playing: bool = True) -> dict:
    return {
        "time_s": t,
        "visible": True,
        "note": f"{shot} {instrument}",
        "players": [{"instrument": instrument, "playing": playing, "who": "", "confidence": confidence}],
    }


def _inst(section_id: str, start: float, end: float, keys: list[str] | None = None) -> dict:
    return {
        "id": section_id,
        "kind": "instrumental",
        "start": start,
        "end": end,
        "label": section_id,
        "instruments": keys or ["ensemble"],
    }


FAILURES: list[str] = []


def check(cond: bool, message: str) -> None:
    if not cond:
        FAILURES.append(message)
        print(f"FAIL {message}")
    else:
        print(f"ok {message}")


def _ids(result: dict) -> set[str]:
    return {item["id"] for item in result["present"]}


def _entry_keys(result: dict) -> list[tuple[str, str, float]]:
    found = []
    for section in result["sections"]:
        for entry in section["entries"]:
            found.append((section["id"], entry["key"], entry["at"]))
    return found


def test_rules() -> None:
    data = load()
    names = catalog_names()
    # One confident close-up is not presence and not an entrance.
    lone = plan(
        {"frames": [_frame(894, "close", "santur", 0.95)]},
        [],
        [_inst("break", 880, 910)],
        None,
        None,
        names,
        data,
    )
    check("santur" not in _ids(lone), "один кадр сантура не даёт присутствия")
    check(all(entry[1] != "santur" for entry in _entry_keys(lone)), "один кадр сантура не даёт вступления")
    check(any(item["id"] == "santur" and item["why"] == "один план" for item in lone["check"]), "один кадр сантура только проверить")

    bass = plan(
        {"frames": [_frame(191, "close", "double-bass", 0.95), _frame(192, "close", "double-bass", 0.95)]},
        [],
        [_inst("break", 180, 210)],
        None,
        None,
        names,
        data,
    )
    check("double-bass" not in _ids(bass), "кадры контрабаса на 191–192 не дают присутствия")
    check(all(entry[1] != "double-bass" for entry in _entry_keys(bass)), "кадры контрабаса на 191–192 не дают вступления")

    stable = plan(
        {"frames": [_frame(t, "close", "violin", 0.9) for t in (10, 20, 40)]},
        [],
        [_inst("break", 0, 60)],
        None,
        None,
        names,
        data,
    )
    check("violin" in _ids(stable), "три плана скрипки дают присутствие")
    check(any(entry[1] == "violin" for entry in _entry_keys(stable)), "три плана дают вступление")
    check(all("until" not in entry for section in stable["sections"] for entry in section["entries"]), "until не ставится")

    short = plan(
        {"frames": [_frame(t, "medium", "ney", 0.95) for t in (0, 7.9, 16)]},
        [],
        [_inst("break", 0, 30)],
        None,
        None,
        names,
        data,
    )
    check("ney" not in _ids(short), "планы ближе 8 с не считаются тремя")

    wide = plan(
        {"frames": [_frame(t, "wide", "oud", 0.99) for t in (0, 12, 24)]},
        [{"id": "oud", "family": None, "group": None, "person": "Ada", "role": "Уд"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("oud" not in _ids(wide), "общий план не принимается даже с титрами")

    credit = plan(
        {"frames": [_frame(12, "medium", "oud", 0.8)]},
        [{"id": "oud", "family": None, "group": None, "person": "Ada", "role": "Уд"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("oud" in _ids(credit) and any(entry[1] == "oud" for entry in _entry_keys(credit)), "титры и один чёткий план")
    check(credit["sections"][0]["performers"] == ["Ada (уд)"], f"один исполнитель из титров: {credit['sections'][0]['performers']}")

    low = plan(
        {"frames": [_frame(12, "medium", "oud", 0.75)]},
        [{"id": "oud", "family": None, "group": None, "person": "Ada"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("oud" not in _ids(low), "титры и план ниже 0,8 не принимаются")

    family = plan(
        {"frames": [_frame(12, "close", "guitar-classical", 0.9)]},
        [{"id": None, "family": "guitar", "group": None, "person": "Ada"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("guitar-classical" in _ids(family), "семья в титрах называет гитару")
    check(family["sections"][0]["action"] == "write", "классическая гитара получает свою гравюру")
    check(family["sections"][0]["instruments"] == ["guitar-classical"], f"ключ классической: {family['sections'][0]['instruments']}")
    check(not any(entry[1] == "guitar" for entry in _entry_keys(family)), "чужая гравюра фламенко не подставлена")

    acoustic = plan(
        {"frames": [_frame(12, "close", "guitar-acoustic", 0.9)]},
        [{"id": None, "family": "guitar", "group": None, "person": "Ada"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check(acoustic["sections"][0]["action"] == "write", "акустическая гитара — псевдоним пластины")
    check(
        acoustic["sections"][0]["instruments"] == ["guitar-classical"],
        f"псевдоним ведёт на классическую: {acoustic['sections'][0]['instruments']}",
    )
    check(not any(entry[1] == "guitar" for entry in _entry_keys(acoustic)), "псевдоним не берёт гравюру фламенко")

    group = plan(
        {"frames": [_frame(12, "close", "bendir", 0.95)]},
        [{"id": None, "family": None, "group": "percussion", "person": "Bo"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("bendir" not in _ids(group), "титры «ударные» не называют бендир по одному плану")
    group_two = plan(
        {"frames": [_frame(10, "close", "bendir", 0.9), _frame(30, "medium", "bendir", 0.91)]},
        [{"id": None, "family": None, "group": "percussion", "person": "Bo"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("bendir" in _ids(group_two), "титры «ударные» и два плана ≥ 0,85 называют бендир")
    group_close = plan(
        {"frames": [_frame(10, "close", "bendir", 0.95), _frame(16, "close", "bendir", 0.95)]},
        [{"id": None, "family": None, "group": "percussion", "person": "Bo"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("bendir" not in _ids(group_close), "два плана ближе 8 с остаются одним")
    group_low = plan(
        {"frames": [_frame(10, "close", "bendir", 0.8), _frame(30, "close", "bendir", 0.8)]},
        [{"id": None, "family": None, "group": "percussion", "person": "Bo"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("bendir" not in _ids(group_low), "группа в титрах не снижает порог уверенности до 0,8")
    orchestra = plan(
        {"frames": [_frame(12, "close", "violin", 0.95)]},
        [{"id": "orchestra", "family": None, "group": None, "person": "Оркестр"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("violin" not in _ids(orchestra), "титр оркестра не называет скрипку")

    many_frames = []
    for index, iid in enumerate(("violin", "ney", "oud", "qanun", "daf")):
        many_frames.extend(_frame(index * 10 + step, "close", iid, 0.95) for step in (0, 12, 24))
    capped = plan({"frames": many_frames}, [], [_inst("break", 0, 90)], None, None, names, data)
    written = next(section for section in capped["sections"] if section["action"] == "write")
    check(len(written["instruments"]) == 5 and "ensemble" not in written["instruments"] and not written["folded"], f"пять равных остаются собой: {written['instruments']}")

    nine_ids = ("violin", "ney", "oud", "qanun", "flute", "santur", "bendir", "darbuka", "daf")
    nine_frames = []
    for index, iid in enumerate(nine_ids):
        nine_frames.extend(_frame(index * 10 + step, "close", iid, 0.95) for step in (0, 12, 24))
    nine = plan({"frames": nine_frames}, [], [_inst("break", 0, 160)], None, None, names, data)
    nine_row = next(section for section in nine["sections"] if section["action"] == "write")
    check(
        len(nine_row["instruments"]) == 8 and nine_row["instruments"][-1] == "ensemble" and set(nine_row["folded"]) == {"darbuka", "daf"},
        f"девять равных — семь ранних и ансамбль: {nine_row['instruments']} / {nine_row['folded']}",
    )

    # A later instrument with more clear frames outranks the early ones.
    loud = []
    for index, iid in enumerate(("violin", "ney", "oud", "qanun", "flute", "santur", "bendir", "darbuka")):
        loud.extend(_frame(index * 10 + step, "close", iid, 0.86) for step in (0, 12, 24))
    loud.extend(_frame(t, "close", "daf", 0.95) for t in (90, 102, 114, 126, 138, 150))
    prominent = plan({"frames": loud}, [], [_inst("break", 0, 180)], None, None, names, data)
    picked = next(section for section in prominent["sections"] if section["action"] == "write")
    check(
        "daf" in picked["instruments"] and "ensemble" in picked["instruments"] and set(picked["folded"]) == {"bendir", "darbuka"} and len(picked["instruments"]) == 8,
        f"заметный поздний остаётся, два поздних слабых свёрнуты: {picked['instruments']} / {picked['folded']}",
    )
    check(picked["instruments"].index("daf") > picked["instruments"].index("violin"), "порядок вступлений всё равно по времени")

    voice = plan(
        {"frames": [_frame(t, "close", "violin", 0.95) for t in (5, 20, 40)]},
        [],
        [_inst("voice-1", 0, 30, ["voice"]), _inst("break", 30, 50), _inst("quiet", 60, 70, ["voice"])],
        None,
        None,
        names,
        data,
    )
    voice_row = next(section for section in voice["sections"] if section["id"] == "voice-1")
    check(
        voice_row["instruments"][0] == "voice" and "violin" in voice_row["instruments"],
        f"в секции голоса голос первый, скрипка вступает: {voice_row['instruments']}",
    )
    check(any(entry["key"] == "voice" and entry["at"] == 0 for entry in voice_row["entries"]), "голос выходит в начале секции")
    quiet = next(section for section in voice["sections"] if section["id"] == "quiet")
    check(quiet["action"] == "voice" and quiet["instruments"] == ["voice"] and quiet["entries"] == [], "голос без инструментов остаётся как есть")

    choir = plan(
        {"frames": [_frame(2, "wide", "choir", 0.9), _frame(8, "wide", "choir", 0.9), _frame(20, "close", "voice", 0.9)]},
        [],
        [_inst("voice-1", 0, 30, ["voice"])],
        None,
        None,
        names,
        data,
    )
    choir_row = choir["sections"][0]
    check(choir_row["instruments"] == ["choir"] and choir_row["label"] == "Хор", f"хор поёт чаще солиста: {choir_row['instruments']} {choir_row['label']}")

    applause = plan(
        {"frames": [{"time_s": 5, "note": "wide audience applauding", "visible": True, "players": []}]},
        [],
        [_inst("voice-end", 0, 20, ["voice"])],
        None,
        None,
        names,
        data,
    )
    applause_row = applause["sections"][0]
    check(
        applause_row["action"] == "applause" and applause_row["instruments"] == [] and applause_row["label"] == "Аплодисменты",
        f"аплодисменты без гравюры: {applause_row['action']} {applause_row['instruments']}",
    )
    clapping_inside = plan(
        {"frames": [
            _frame(2, "close", "ney", 0.95),
            _frame(14, "close", "ney", 0.95),
            _frame(26, "close", "ney", 0.95),
            {"time_s": 10, "note": "wide Sami Yusuf clapping", "visible": True, "players": [{"instrument": "voice", "playing": True, "confidence": 0.9}]},
        ]},
        [],
        [_inst("voice-9", 0, 40, ["voice"])],
        None,
        None,
        names,
        data,
    )
    mixed = clapping_inside["sections"][0]
    check(mixed["identity"] == "voice" and mixed["action"] != "applause", "один хлопок внутри пения не делает секцию аплодисментами")

    reviewed = [
        {"time_s": 894, "instrument": "santur", "verdict": "wrong", "note": "в кадре лица певиц"},
    ]
    with_review = plan(
        {"frames": [_frame(t, "close", "santur", 0.95) for t in (870, 894, 910)]},
        [],
        [_inst("break", 860, 930)],
        None,
        None,
        names,
        data,
        reviews=reviewed,
    )
    without_review = plan(
        {"frames": [_frame(t, "close", "santur", 0.95) for t in (870, 894, 910)]},
        [],
        [_inst("break", 860, 930)],
        None,
        None,
        names,
        data,
    )
    check("santur" not in _ids(with_review) and "santur" in _ids(without_review), "кадр из списка проверки не проходит, без списка три плана проходят")

    idle = plan(
        {"frames": [_frame(t, "close", "ney", 0.99, playing=False) for t in (0, 10, 20)]},
        [{"id": "ney", "family": None, "group": None, "person": "Ada"}],
        [_inst("break", 0, 30)],
        None,
        None,
        names,
        data,
    )
    check("ney" not in _ids(idle), "инструмент в руках, но не в игре, не считается")

    track = [0.0] * 80
    for i in range(40, 80):
        track[i] = 0.4
    attacks = attack_times(track, 20)
    # Rise starts at sample 38 (two hops before the local peak).
    snapped = snap_at(2.2, 0, 10, attacks)
    check(attacks and abs(snapped - attacks[-1]) < 1e-9 and snapped < 2.2, f"атака в пределах 2 с сдвигает вступление: {attacks} → {snapped}")
    stay = snap_at(2.2, 0, 10, [])
    check(stay == 2.2, "без атаки остаётся время кадра")
    clamped = snap_at(0.2, 1.0, 5, [0.0])
    check(clamped == 1.0, "атака до секции не выносит вступление за её начало")


def test_known_concert_frames() -> None:
    """The two frames the orchestrator checked. They are mistakes, and one frame is not enough."""
    data = load()
    names = catalog_names()
    karitas_vision = json.loads((ROOT / "docs" / "analysis" / "karitas" / "vision.json").read_text(encoding="utf-8"))
    karitas_lyrics = json.loads((ROOT / "content" / "songs" / "karitas" / "lyrics.json").read_text(encoding="utf-8"))
    santur_frames = [
        frame for frame in karitas_vision["frames"]
        if abs(float(frame["time_s"]) - 894) <= 0.05
        and any(player.get("instrument") == "santur" for player in frame.get("players") or [])
    ]
    check(len(santur_frames) == 1, f"кадр Karitas 894 с сантуром один: {len(santur_frames)}")
    lone = plan({"frames": santur_frames}, read_credits("karitas", data), karitas_lyrics["sections"], None, None, names, data, "karitas")
    check("santur" not in _ids(lone), "реальный кадр Karitas 894 не даёт сантуру присутствия")
    check(all(entry[1] != "santur" for entry in _entry_keys(lone)), "реальный кадр Karitas 894 не даёт вступления")

    one_vision = json.loads((ROOT / "docs" / "analysis" / "one" / "vision.json").read_text(encoding="utf-8"))
    one_lyrics = json.loads((ROOT / "content" / "songs" / "one" / "lyrics.json").read_text(encoding="utf-8"))
    bass_frames = [
        frame for frame in one_vision["frames"]
        if 190 <= float(frame["time_s"]) <= 192.5
        and any(player.get("instrument") == "double-bass" for player in frame.get("players") or [])
    ]
    check(len(bass_frames) >= 1, "кадр ONE около 191 с контрабасом есть")
    lone_bass = plan({"frames": bass_frames}, read_credits("one", data), one_lyrics["sections"], None, None, names, data, "one")
    check("double-bass" not in _ids(lone_bass), "кадры ONE 191–192 не дают контрабасу присутствия")
    check(
        all(not (entry[1] == "double-bass" and abs(entry[2] - 191) < 3) for entry in _entry_keys(lone_bass)),
        "кадры ONE 191–192 не дают вступления",
    )

    karitas_reviews = json.loads((ROOT / "docs" / "analysis" / "karitas" / "vision-review.json").read_text(encoding="utf-8"))
    check(
        any(row.get("instrument") == "santur" and abs(float(row.get("time_s")) - 894) < 0.05 and row.get("verdict") == "wrong" for row in karitas_reviews),
        "список проверки Karitas помечает сантур на 894",
    )
    padded = plan(
        {"frames": [_frame(t, "close", "santur", 0.95) for t in (870, 894, 910)]},
        [],
        [_inst("break", 860, 930)],
        None,
        None,
        names,
        data,
        reviews=karitas_reviews,
    )
    check("santur" not in _ids(padded), "файл vision-review.json не даёт сантуру присутствия")

    one_reviews = json.loads((ROOT / "docs" / "analysis" / "one" / "vision-review.json").read_text(encoding="utf-8"))
    check(
        any(row.get("instrument") == "double-bass" and abs(float(row.get("time_s")) - 191) < 0.05 and row.get("verdict") == "wrong" for row in one_reviews),
        "список проверки ONE помечает контрабас на 191",
    )
    padded_bass = plan(
        {"frames": [_frame(t, "close", "double-bass", 0.95) for t in (191, 192, 212, 484)]},
        read_credits("one", data),
        one_lyrics["sections"],
        None,
        None,
        names,
        data,
        reviews=one_reviews,
    )
    check("double-bass" not in _ids(padded_bass), "файл проверки снимает план 191–192, двух планов мало")

    full_k = load_song("karitas", data)
    check("santur" not in _ids(full_k), "во всей Karitas сантур не принят")
    check(all(entry[1] != "santur" for entry in _entry_keys(full_k)), "во всей Karitas нет вступления сантура")
    opening = next(section for section in full_k["sections"] if section["id"] == "voice-1")
    check(opening["instruments"][0] == "choir" and opening["label"] == "Хор", f"Karitas 2–37 с — хор: {opening['instruments'][:4]} {opening['label']}")
    full_o = load_song("one", data)
    check("double-bass" not in _ids(full_o), "во всей ONE контрабас не принят: после 191 с осталось два плана")
    check(
        all(not (entry[1] == "double-bass" and abs(entry[2] - 191) < 3) for entry in _entry_keys(full_o)),
        "во всей ONE нет вступления контрабаса у 191 с",
    )
    check(
        all("double-bass" not in section["instruments"] for section in full_o["sections"]),
        "контрабас не записан ни в одну секцию ONE",
    )
    alive = load_song("i-have-come-alive", data)
    check("bendir" in _ids(alive), "бендир I Have Come Alive принят по группе «ударные» и двум планам")
    voice_open = next(section for section in alive["sections"] if section["id"] == "voice-open")
    check(voice_open["instruments"][0] == "voice" and "tanbur" in voice_open["instruments"], f"танбур вступает в voice-open: {voice_open['instruments']}")


def selftest() -> None:
    FAILURES.clear()
    test_rules()
    test_known_concert_frames()
    if FAILURES:
        raise SystemExit(f"entries: проверок не прошло: {len(FAILURES)}")
    print("entries selftest ok")


def main(args) -> None:
    if getattr(args, "selftest", False) or (not getattr(args, "slug", None) and not getattr(args, "all", False)):
        selftest()
        if not getattr(args, "slug", None) and not getattr(args, "all", False):
            return
    slugs = list(SONGS) if getattr(args, "all", False) or not getattr(args, "slug", None) else [args.slug]
    for slug in slugs:
        # SONGS is the benchmark trio. A song folder is enough for this command.
        on_disk = (ROOT / "content" / "songs" / slug / "lyrics.json").is_file()
        if slug not in SONGS and not on_disk:
            raise SystemExit(f"неизвестная песня: {slug}")
        lyrics = json.loads((ROOT / "content" / "songs" / slug / "lyrics.json").read_text(encoding="utf-8"))
        result = load_song(slug)
        path = write_report(result, lyrics["sections"])
        if getattr(args, "write", False):
            write_lyrics(slug, result)
            print(f"{slug}: lyrics.json обновлён")
        print(f"{slug}: {path}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Вступления инструментов по видео концерта")
    parser.add_argument("slug", nargs="?")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    main(parser.parse_args())
