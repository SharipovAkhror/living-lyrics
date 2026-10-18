"""Instrument presence and entrances from the concert video.

Rules (also docs/methodology/09-instruments.md, «Что попадает в данные песни»):

1. An instrument may appear in the song when the credits name it (by id or by family)
   and a close or medium shot shows it being played at confidence ≥ 0.8, or when the
   video shows it being played on at least three close or medium shots spaced ≥ 8 s
   apart at confidence ≥ 0.85. One shot is only a check. orchestra, choir and voice
   stay groups. Audio is reported where it agrees; it does not admit or reject.

2. An instrumental section lists the admitted instruments that are seen in it, in the
   order of the first clear frame, at most four drawings. The rest fold into ensemble
   (there is no orchestra engraving). entries[].at is that frame, moved back to an
   attack on the matching stem when one falls within the previous 2 s. until is never
   set: a camera cut is not the instrument leaving. A section that is only voice or
   choir is left as it is.

3. A recognition id is drawn only with its own catalog engraving. Without one, the id
   stays out of instruments and is listed as a missing engraving.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from paths import ROOT, SONGS
from taxonomy import credit_targets, load, match_ids

# Not tuned per song. Close/medium is the first word of the frame note.
CREDIT_CONF = 0.8
STABLE_CONF = 0.85
STABLE_SHOTS = 3
SHOT_GAP = 8.0
MAX_DRAWINGS = 4
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


def collect_shots(vision: dict | None, data: dict) -> tuple[dict[str, list[dict]], list[str]]:
    """Close/medium frames where someone is playing. Groups stay out of the lists."""
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
        stable_times = spaced([row["time"] for row in clear85])
        stable = len(stable_times) >= STABLE_SHOTS
        by_credit = named and len(clear80) >= 1
        info = data["by_id"][iid]
        record = {
            "id": iid,
            "name": info["name"],
            "catalogKey": info.get("catalogKey"),
            "family": info["family"],
            "credited": named,
            "stable": stable,
            "shots80": len(spaced([row["time"] for row in clear80])),
            "shots85": len(stable_times),
            "frames80": len(clear80),
            "audio": audio_agrees(audio_hits, iid, [row["time"] for row in (clear85 or clear80)]),
            "rows": clear85 if stable and not by_credit else clear80,
        }
        if by_credit or stable:
            record["reason"] = "титры и кадр" if by_credit and not stable else (
                "титры и кадр, устойчиво по видео" if by_credit else "устойчиво по видео"
            )
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
        key = info.get("catalogKey")
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


def plan_sections(
    sections: list[dict],
    present: list[dict],
    attacks: dict[str, list[float]],
    names: dict[str, str],
    solo: dict[str, str],
    data: dict,
) -> list[dict]:
    plans = []
    for section in sections:
        if section.get("kind") != "instrumental":
            continue
        base = {
            "id": section["id"],
            "start": float(section["start"]),
            "end": float(section["end"]),
            "label": section.get("label") or "",
            "before": list(section.get("instruments") or []),
        }
        if is_voice_section(section):
            seen = []
            for item in present:
                rows = _first_rows(item, base["start"], base["end"])
                if rows:
                    seen.append({"id": item["id"], "time": rows[0]["time"], "catalogKey": item.get("catalogKey")})
            plans.append({**base, "action": "voice", "seen": seen, "instruments": base["before"], "entries": [], "performers": list(section.get("performers") or [])})
            continue
        ranked = []
        for item in present:
            rows = _first_rows(item, base["start"], base["end"])
            if not rows:
                continue
            ranked.append((rows[0]["time"], item, rows[0]))
        ranked.sort(key=lambda triple: (triple[0], triple[1]["id"]))
        drawable = [(t, item, row) for t, item, row in ranked if item.get("catalogKey")]
        missing = [(t, item, row) for t, item, row in ranked if not item.get("catalogKey")]
        if not drawable:
            plans.append({
                **base,
                "action": "unchanged",
                "missing": [{"id": item["id"], "time": t} for t, item, _row in missing],
                "instruments": base["before"],
                "entries": list(section.get("entries") or []),
                "performers": list(section.get("performers") or []),
            })
            continue
        overflow = []
        chosen = drawable
        if len(drawable) > MAX_DRAWINGS:
            chosen = drawable[: MAX_DRAWINGS - 1]
            overflow = drawable[MAX_DRAWINGS - 1 :]
        entries = []
        for t, item, row in chosen:
            key = item["catalogKey"]
            stem = stem_for(item["id"], data)
            at = snap_at(t, base["start"], base["end"], attacks.get(stem) or [])
            entries.append({"key": key, "at": at, "frame": round(t, 2), "id": item["id"]})
        if overflow:
            t, item, _row = overflow[0]
            stem = stem_for(item["id"], data)
            at = snap_at(t, base["start"], base["end"], attacks.get(stem) or [])
            entries.append({"key": "ensemble", "at": at, "frame": round(t, 2), "id": "ensemble"})
        entries.sort(key=lambda entry: (entry["at"], entry["frame"], entry["key"]))
        # One drawing per key: the first time it is admitted.
        dedup = []
        seen_keys = set()
        for entry in entries:
            if entry["key"] in seen_keys:
                continue
            seen_keys.add(entry["key"])
            dedup.append(entry)
        keys = [entry["key"] for entry in dedup]
        performers = performers_for(section, keys, names, solo)
        plans.append({
            **base,
            "action": "write",
            "instruments": keys,
            "entries": [{"key": entry["key"], "at": entry["at"]} for entry in dedup],
            "entryFrames": {entry["key"]: entry["frame"] for entry in dedup},
            "performers": performers,
            "folded": [item["id"] for _t, item, _row in overflow],
            "missing": [{"id": item["id"], "time": t} for t, item, _row in missing],
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
) -> dict:
    data = data or load()
    names = names if names is not None else catalog_names()
    shots, unmatched = collect_shots(vision, data)
    audio_hits = _audio_hits(audio)
    present, check = decide_presence(shots, credits, audio_hits, data)
    attacks = {}
    if features and features.get("tracks") and features.get("rate"):
        rate = float(features["rate"])
        for stem in ("other", "drums"):
            track = features["tracks"].get(stem) or []
            attacks[stem] = attack_times(track, rate)
    section_plans = plan_sections(sections, present, attacks, names, solo_people(credits, data), data)
    return {
        "slug": slug,
        "present": present,
        "check": check,
        "unmatched": unmatched,
        "sections": section_plans,
        "shots": shots,
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
        "Один кадр сюда не попадает. Звук отмечен, где он совпал, и решение не меняет. "
        "`until` нет: склейка камеры — не уход инструмента.",
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
        if section["action"] == "voice":
            extra = ""
            if section["seen"]:
                extra = "; в кадре, секцию не менял: " + ", ".join(
                    f"{row['id']} {_fmt(row['time'])}" for row in section["seen"][:6]
                )
            written = "голос или хор, как было" + extra
        elif section["action"] == "unchanged":
            written = "как было: " + ", ".join(f"`{key}`" for key in section["instruments"])
            if section.get("missing"):
                written += "; без гравюры: " + ", ".join(row["id"] for row in section["missing"])
        else:
            frames = section.get("entryFrames") or {}
            bits = []
            for entry in section["entries"]:
                frame = frames.get(entry["key"])
                bit = f"`{entry['key']}` {_fmt(entry['at'])}"
                if frame is not None and abs(frame - entry["at"]) >= 0.05:
                    bit += f" (кадр {_fmt(frame)})"
                bits.append(bit)
            written = ", ".join(bits)
            if section.get("folded"):
                written += "; свёрнуты в ансамбль: " + ", ".join(section["folded"])
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
            "Инструмент принят в песню, гравюра есть, но чёткий кадр не попал ни в один проигрыш "
            "(только вокал или секция голоса, которую правило не переписывает).",
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
                "instruments": section["instruments"],
                "entries": section["entries"],
                "performers": section["performers"],
            }
            for section in result["sections"]
        ],
    }
    (folder / "entries.json").write_text(json.dumps(public, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path = folder / "entries.md"
    path.write_text(render_markdown(result, lyrics_sections), encoding="utf-8")
    return path


def write_lyrics(slug: str, result: dict) -> None:
    """Replace only instruments, entries and performers. Anything else is a bug."""
    path = ROOT / "content" / "songs" / slug / "lyrics.json"
    lyrics = json.loads(path.read_text(encoding="utf-8"))
    by_id = {section["id"]: section for section in result["sections"]}
    for section in lyrics["sections"]:
        plan_row = by_id.get(section["id"])
        if not plan_row or plan_row["action"] != "write":
            continue
        section["instruments"] = list(plan_row["instruments"])
        section["entries"] = [{"key": entry["key"], "at": entry["at"]} for entry in plan_row["entries"]]
        if plan_row["performers"]:
            section["performers"] = list(plan_row["performers"])
        else:
            section.pop("performers", None)
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
    check(family["sections"][0]["action"] == "unchanged", "классическая гитара не рисуется гравюрой фламенко")
    check(not any(entry[1] == "guitar" for entry in _entry_keys(family)), "чужая гравюра не подставлена")

    group = plan(
        {"frames": [_frame(12, "close", "bendir", 0.95)]},
        [{"id": None, "family": None, "group": "percussion", "person": "Bo"}],
        [_inst("break", 0, 40)],
        None,
        None,
        names,
        data,
    )
    check("bendir" not in _ids(group), "титры «ударные» не называют бендир")
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
    check(len(written["instruments"]) == 4 and written["instruments"][-1] == "ensemble", f"не больше четырёх, хвост — ансамбль: {written['instruments']}")
    check("daf" in written["folded"], "пятый инструмент свёрнут, не нарисован шестым")

    voice = plan(
        {"frames": [_frame(t, "close", "violin", 0.95) for t in (5, 20, 40)]},
        [],
        [_inst("voice-1", 0, 30, ["voice"]), _inst("break", 30, 50)],
        None,
        None,
        names,
        data,
    )
    voice_row = next(section for section in voice["sections"] if section["id"] == "voice-1")
    check(voice_row["action"] == "voice" and voice_row["instruments"] == ["voice"] and voice_row["entries"] == [], "секция голоса остаётся как есть")

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

    full_k = load_song("karitas", data)
    check("santur" not in _ids(full_k), "во всей Karitas сантур не принят")
    check(all(entry[1] != "santur" for entry in _entry_keys(full_k)), "во всей Karitas нет вступления сантура")
    full_o = load_song("one", data)
    check(
        all(not (entry[1] == "double-bass" and abs(entry[2] - 191) < 3) for entry in _entry_keys(full_o)),
        "во всей ONE нет вступления контрабаса у 191 с",
    )
    check(
        all("double-bass" not in section["instruments"] for section in full_o["sections"]),
        "контрабас не записан ни в одну секцию ONE",
    )


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
        if slug not in SONGS:
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
