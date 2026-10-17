"""Checks that do not need the encoder: taxonomy, credits, threshold, fusion, sheets."""

from __future__ import annotations

import json

import numpy as np

from anchors import _boundary_bleed, labels_on_anchor
from fuse import fuse_payload
from paths import ROOT, SONGS
from predict import smooth
from taxonomy import catalog_keys_from_list_ts, credit_targets, load, match_ids
from train import _choose_tau
from watch import choose_times

FAILURES: list[str] = []


def check(cond: bool, message: str) -> None:
    if not cond:
        FAILURES.append(message)
        print(f"FAIL {message}")
    else:
        print(f"ok {message}")


def test_taxonomy() -> None:
    data = load()
    n = len(data["instruments"])
    check(80 <= n <= 150, f"классов {n} в диапазоне 80–150")
    check(len(data["families"]) >= 8, "семьи есть")
    ids = [item["id"] for item in data["instruments"]]
    check(len(ids) == len(set(ids)), "id уникальны")
    keys = [item["catalogKey"] for item in data["instruments"] if item.get("catalogKey")]
    check(len(keys) == len(set(keys)), "ключ каталога не повторяется")
    site = catalog_keys_from_list_ts(ROOT / "src" / "instruments" / "list.ts")
    check(set(keys) == set(site), f"ключи каталога совпали: сайт {sorted(set(site)-set(keys))} файл {sorted(set(keys)-set(site))}")
    flamenco = next(item for item in data["instruments"] if item["id"] == "guitar-flamenco")
    check(flamenco["catalogKey"] == "guitar", "гравюра guitar только у фламенко")
    for item in data["instruments"]:
        if item["id"] != "guitar-flamenco":
            check(item.get("catalogKey") != "guitar", f"{item['id']} не забирает гравюру фламенко")
    check(match_ids("гитара") == [], "голое слово гитара не называет класс")
    check(match_ids("тар") == ["tar"], "тар отдельным словом")
    check(match_ids("классическая гитара") == ["guitar-classical"], "классическая гитара")
    check("tar" not in match_ids("это гитара фламенко"), "тар не находится внутри гитары")


def test_credits() -> None:
    data = load()
    alive = []
    song = json.loads((ROOT / "content" / "songs" / "i-have-come-alive" / "song.json").read_text(encoding="utf-8"))
    for credit in song["credits"]:
        alive.extend(credit_targets(credit["role"], data))
    ids = {hit["id"] for hit in alive if hit["id"]}
    groups = {hit["group"] for hit in alive if hit["group"]}
    expected = {
        "voice", "tanbur", "ney", "kamancheh", "oud", "qanun", "balaban", "erhu", "daf",
        "sitar", "guitar-classical", "santur", "orchestral-percussion", "baglama", "dholak", "tabla",
    }
    check(expected <= ids, f"alive не хватает {sorted(expected - ids)}")
    check("guitar-flamenco" not in ids, "классическая гитара не стала фламенко")
    check("percussion" in groups, "ударные — группа, не выдуманный барабан")
    karitas = json.loads((ROOT / "content" / "songs" / "karitas" / "song.json").read_text(encoding="utf-8"))
    k_ids = {hit["id"] for credit in karitas["credits"] for hit in credit_targets(credit["role"], data) if hit["id"]}
    check(k_ids == {"choir", "orchestra"}, f"karitas credits {sorted(k_ids)}")
    one = json.loads((ROOT / "content" / "songs" / "one" / "song.json").read_text(encoding="utf-8"))
    o_ids = {hit["id"] for credit in one["credits"] for hit in credit_targets(credit["role"], data) if hit["id"]}
    check(o_ids == {"choir", "orchestra", "ensemble"}, f"one credits {sorted(o_ids)}")
    check(set(SONGS) == {"i-have-come-alive", "karitas", "one"}, "три песни")


def test_smooth_and_threshold() -> None:
    segments = smooth([None, "violin", "violin", "violin", None, None], [0, 0.5, 0.8, 0.7, 0, 0], 1.0, 2.0)
    check(len(segments) == 1 and segments[0]["start"] == 1.0 and segments[0]["end"] == 5.0, f"сглаживание {segments}")
    check(smooth(["violin", None, "violin"], [0.9, 0, 0.9], 1.0, 2.0) == [], "одиночные окна не начинают отрезок")
    rng = np.random.default_rng(17)
    y = np.array([0, 1, 0, 1] * 10)
    logits = np.zeros((len(y), 2))
    logits[np.arange(len(y)), y] = 4.0
    # Half of the confident rows are flipped into low confidence of the wrong class.
    logits[::2] = 0
    logits[::2, 1 - y[::2]] = 0.2
    prob = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)
    tau, precision, _coverage = _choose_tau(prob, y, 0.90)
    check(tau is not None and precision >= 0.90, f"порог {tau} точность {precision}")
    del rng


def _seg(instrument: str, confidence: float, start: float = 10.0, end: float = 14.0) -> dict:
    return {
        "sources": {"mix": {"stem": "mix", "segments": [{
            "kind": "instrument", "id": instrument, "start": start, "end": end,
            "confidence": confidence, "accepted": True,
        }]}}
    }


def _vision(instrument: str, confidence: float, playing: bool = True, t: float = 12.0) -> dict:
    return {"frames": [{"time_s": t, "visible": True, "note": "", "players": [{
        "instrument": instrument, "playing": playing, "who": "", "confidence": confidence,
    }]}]}


def test_fusion() -> None:
    data = load()
    meta = {"threshold": 0.90, "threshold95": 0.97}
    both = fuse_payload(_seg("violin", 0.96), _vision("скрипка", 0.9), [{"id": "violin"}], meta, data)
    check(both["accepted"] and both["accepted"][0]["decision"] == "accept", "звук и кадр и титры")
    loud = fuse_payload(_seg("flute", 0.99), None, [], meta, data)
    check(loud["accepted"] == [] and loud["check"] and loud["check"][0]["decision"] == "check", "один звук даже при 0,99 не принят")
    credited = fuse_payload(_seg("violin", 0.4), None, [{"id": "violin"}], meta, data)
    check(credited["accepted"] and credited["accepted"][0]["sources"] == ["audio", "credits"], "титры и звук дают время")
    unseen = fuse_payload(_seg("violin", 0.99), _vision("скрипка", 0.9), [], meta, data)
    check(unseen["accepted"] and unseen["accepted"][0]["review"] == "нет в титрах", "звук и кадр без титров")
    conflict = fuse_payload(_seg("violin", 0.99), _vision("най", 0.9), [], meta, data)
    kinds = {item["decision"] for item in conflict["intervals"]}
    check(kinds == {"check"} and conflict["accepted"] == [], f"скрипка против ная не принимается: {kinds}")
    tied = fuse_payload(_seg("violin", 0.99), _vision("най", 0.9), [{"id": "violin"}], meta, data)
    by_id = {item["id"]: item["decision"] for item in tied["intervals"]}
    check(by_id.get("violin") == "accept" and by_id.get("ney") == "check", f"титры берут скрипку, най только проверить: {by_id}")
    seen = fuse_payload(None, _vision("най", 0.9), [{"id": "ney"}], meta, data)
    check(seen["accepted"] and seen["accepted"][0]["sources"] == ["vision", "credits"], "кадр и титры")
    family = fuse_payload(_seg("flute", 0.99), None, [{"id": "orchestra", "family": "ensemble"}], meta, data)
    check(family["accepted"] == [], "семья оркестра не принимает флейту")
    drawing = fuse_payload(None, _vision("уд", 0.95, playing=False), [{"id": "oud"}], meta, data)
    check(drawing["intervals"] == [], "гравюра без игры не даёт интервал")
    times = choose_times(977.0, [0.0, 34.55, 269.15])
    check(len(times) <= 320, f"листов не больше 20, кадров {len(times)}")
    check(34.55 in times and 269.15 in times, "границы секций сохранены")


def test_job_glob() -> None:
    """GitHub path filter: * does not match a slash, so the main pipeline ignores this folder."""
    import re

    def matches(pattern: str, path: str) -> bool:
        regex = ""
        i = 0
        while i < len(pattern):
            if pattern.startswith("**", i):
                regex += ".*"
                i += 2
            elif pattern[i] == "*":
                regex += "[^/]*"
                i += 1
            elif pattern[i] == "?":
                regex += "[^/]"
                i += 1
            else:
                regex += re.escape(pattern[i])
                i += 1
        return re.fullmatch(regex, path) is not None

    check(matches("jobs/*.json", "jobs/alive.json"), "основной глоб ловит jobs/<slug>.json")
    check(not matches("jobs/*.json", "jobs/instrument-id/alive.json"), "основной глоб не ловит подпапку")
    check(matches("jobs/instrument-id/*.json", "jobs/instrument-id/alive.json"), "глоб задания узнаёт свой файл")


def test_anchor_listen() -> None:
    data = load()
    anchor = {"start": 23.7, "end": 100.8, "id": "tanbur", "catalogKey": "tanbur"}
    audio = {
        "audioPrimary": "stem",
        "sources": {
            "mix": {"stem": "mix", "segments": [{
                "kind": "instrument", "id": "flute", "start": 23.7, "end": 40.0, "confidence": 0.99,
            }]},
            "other": {"stem": "other", "segments": [{
                "kind": "instrument", "id": "guitar-acoustic", "start": 23.7, "end": 40.0, "confidence": 0.7,
            }]},
        },
    }
    said = labels_on_anchor(audio, anchor, data)
    check(said == ["guitar-acoustic"], f"якорь стема читает other, не смесь: {said}")
    audio["audioPrimary"] = "mix"
    said = labels_on_anchor(audio, anchor, data)
    check(said == ["flute"], f"якорь смеси читает смесь: {said}")
    check(_boundary_bleed(23.7, 100.814, 99.0, 167.0), "голос у края длинной секции не валит якорь")
    check(not _boundary_bleed(23.7, 100.814, 30.0, 80.0), "чужой класс внутри секции остаётся")
    check(not _boundary_bleed(172.0, 174.0, 171.0, 174.0), "короткий якорь, покрытый принятым классом, остаётся")


def main() -> None:
    test_taxonomy()
    test_credits()
    test_smooth_and_threshold()
    test_fusion()
    test_job_glob()
    test_anchor_listen()
    if FAILURES:
        raise SystemExit(f"проверок не прошло: {len(FAILURES)}")
    print("selftest ok")


if __name__ == "__main__":
    main()
