"""Windowed inference. Credits are not an input.

A label becomes a segment only after two accepted windows in a row, and the
segment ends after two windows that are not that label. A stem drops classes
outside its heuristic list instead of renaming them.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.neighbors import NearestNeighbors

from audio import load_mono, window
from paths import ROOT, SONGS, WEIGHTS
from taxonomy import load
from train import _softmax

STEMS = ("vocals", "drums", "bass", "other")


def load_probe() -> tuple[dict, dict]:
    meta_path = WEIGHTS / "meta.json"
    pack_path = WEIGHTS / "probe.npz"
    if not meta_path.is_file() or not pack_path.is_file():
        raise SystemExit("нет весов. Сначала: python scripts/instrument_id/run.py train")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    pack = np.load(pack_path)
    arrays = {key: pack[key] for key in pack.files}
    return meta, arrays


def _starts(n_samples: int, sample_rate: int, window_sec: float, hop_sec: float) -> list[float]:
    win = int(round(window_sec * sample_rate))
    step = int(round(hop_sec * sample_rate))
    if n_samples <= win:
        return [0.0]
    starts = []
    pos = 0
    while pos + win <= n_samples:
        starts.append(pos / sample_rate)
        pos += step
    end = n_samples / sample_rate
    if starts and end - (starts[-1] + window_sec) > 0.25:
        starts.append(max(0.0, end - window_sec))
    return starts


def _allowed(instrument: str, stem: str, data: dict) -> bool:
    if stem == "mix":
        return True
    family = data["by_id"][instrument]["family"]
    if stem == "drums":
        return family in data["percussionFamilies"] or instrument == "drum-machine"
    if stem == "vocals":
        return family == "voice"
    if stem == "bass":
        return instrument in data["bassIds"]
    if stem == "other":
        return family not in data["percussionFamilies"] and family != "voice" and instrument != "drum-machine"
    return True


def smooth(labels: list[str | None], confidences: list[float], hop: float, window_sec: float, need: int = 2) -> list[dict]:
    """Start on `need` agreeing windows. End after `need` windows that are not the label."""
    segments = []
    i = 0
    n = len(labels)
    while i < n:
        label = labels[i]
        if label is None or i + need - 1 >= n or any(labels[i + k] != label for k in range(need)):
            i += 1
            continue
        last = i + need - 1
        misses = 0
        j = last + 1
        while j < n:
            if labels[j] == label:
                last = j
                misses = 0
            else:
                misses += 1
                if misses >= need:
                    break
            j += 1
        agreed = [confidences[k] for k in range(i, last + 1) if labels[k] == label]
        segments.append({
            "start": round(i * hop, 3),
            "end": round(last * hop + window_sec, 3),
            "label": label,
            "confidence": round(float(max(agreed)), 4),
        })
        i = last + 1
    return segments


def _in_distribution(feats: np.ndarray, prob: np.ndarray, meta: dict, pack: dict) -> np.ndarray:
    """True when the window is close to a trained class. Missing score means no extra gate."""
    spec = meta.get("openSet")
    if not spec or "os_mu" not in pack:
        return np.ones(len(feats), dtype=bool)
    z = (feats.astype(np.float64) - np.asarray(pack["os_mu"], dtype=np.float64)) / np.asarray(pack["os_sd"], dtype=np.float64)
    method = spec["method"]
    if method == "softmax":
        score = prob.max(axis=1)
    elif method == "knn":
        train = np.asarray(pack["os_train"], dtype=np.float64)
        if train.shape[0] < 2:
            return np.ones(len(feats), dtype=bool)
        nn = NearestNeighbors(n_neighbors=min(int(spec.get("knnK", 5)), len(train)))
        nn.fit(train)
        dist, _ = nn.kneighbors(z, return_distance=True)
        score = dist[:, -1]
    else:
        diff = z[:, None, :] - np.asarray(pack["os_mean"], dtype=np.float64)[None, :, :]
        var = np.asarray(pack["os_var"], dtype=np.float64)
        score = ((diff ** 2) / var).sum(axis=2).min(axis=1)
    tau = float(spec["threshold"])
    if spec.get("higherIsIn"):
        return score >= tau
    return score <= tau


def _embed_windows(audio: np.ndarray, starts: list[float], sample_rate: int, window_sec: float, batch_size: int = 16) -> np.ndarray:
    from embed import _embed_batch, load_encoder

    torch, model, mel = load_encoder()
    torch.set_num_threads(8)
    feats = []
    for start in range(0, len(starts), batch_size):
        chunk = [
            window(audio, sample_rate, t, window_sec)
            for t in starts[start:start + batch_size]
        ]
        feats.append(_embed_batch(torch, model, mel, np.stack(chunk)))
    return np.concatenate(feats, axis=0)


def recognize_array(audio: np.ndarray, stem: str, meta: dict | None = None, pack: dict | None = None, data: dict | None = None) -> dict:
    data = data or load()
    if meta is None or pack is None:
        meta, pack = load_probe()
    sample_rate = int(meta["sampleRate"])
    window_sec = float(meta["windowSec"])
    hop = float(meta["hopSec"])
    starts = _starts(audio.size, sample_rate, window_sec, hop)
    feats = _embed_windows(audio, starts, sample_rate, window_sec)
    xn = (feats.astype(np.float64) - pack["mu"]) / pack["sd"]
    prob = _softmax(xn @ pack["W"].T + pack["b"], float(meta["temperature"]))
    known = _in_distribution(feats, prob, meta, pack)
    fam_prob = _softmax(xn @ pack["Wf"].T + pack["bf"], 1.0)
    classes = meta["classes"]
    families = meta["families"]
    tau = float(meta["threshold"])
    fam_min = float(meta["familyFallbackMin"])
    labels: list[str | None] = []
    kinds: list[str | None] = []
    confidences: list[float] = []
    for row, fam_row, is_known in zip(prob, fam_prob, known):
        guess = int(row.argmax())
        instrument = classes[guess]
        confidence = float(row[guess])
        if not is_known:
            labels.append(None)
            kinds.append(None)
            confidences.append(confidence)
            continue
        if confidence >= tau and _allowed(instrument, stem, data):
            labels.append(instrument)
            kinds.append("instrument")
            confidences.append(confidence)
            continue
        fam_guess = int(fam_row.argmax())
        fam_conf = float(fam_row[fam_guess])
        family = families[fam_guess]
        # A family fallback still has to be legal on this stem.
        family_ok = stem == "mix" or _allowed_family(family, stem, data)
        if fam_conf >= fam_min and family_ok:
            labels.append("family:" + family)
            kinds.append("family")
            confidences.append(fam_conf)
        else:
            labels.append(None)
            kinds.append(None)
            confidences.append(confidence)
    raw = smooth(labels, confidences, hop, window_sec)
    segments = []
    for piece in raw:
        label = piece["label"]
        if label.startswith("family:"):
            family = label.split(":", 1)[1]
            name = data["family_by_id"][family]["abstain"]
            segments.append({
                "start": piece["start"],
                "end": piece["end"],
                "id": None,
                "family": family,
                "name": name,
                "kind": "family",
                "confidence": piece["confidence"],
                "accepted": False,
            })
        else:
            info = data["by_id"][label]
            segments.append({
                "start": piece["start"],
                "end": piece["end"],
                "id": label,
                "family": info["family"],
                "name": info["name"],
                "catalogKey": info.get("catalogKey"),
                "kind": "instrument",
                "confidence": piece["confidence"],
                "accepted": True,
            })
    return {"stem": stem, "windows": len(starts), "segments": segments}


def _allowed_family(family: str, stem: str, data: dict) -> bool:
    if stem == "drums":
        return family in data["percussionFamilies"]
    if stem == "vocals":
        return family == "voice"
    if stem == "bass":
        return family in {"bowed", "brass", "reed", "guitar"}
    if stem == "other":
        return family not in data["percussionFamilies"] and family != "voice"
    return True


def recognize_file(path: Path, stem: str = "mix", meta: dict | None = None, pack: dict | None = None) -> dict:
    """Public entry a later instruments.py can call. It does not read credits or vision."""
    data = load()
    if meta is None or pack is None:
        meta, pack = load_probe()
    audio = load_mono(path, int(meta["sampleRate"]))
    result = recognize_array(audio, stem, meta, pack, data)
    result["audio"] = str(path)
    result["noncommercial"] = bool(meta["noncommercial"])
    result["model"] = meta["embedding"] + "-linear-probe"
    return result


def _mix_path(slug: str) -> Path | None:
    folder = ROOT / "work" / slug
    for name in ("source.m4a", "source.wav", "source.flac"):
        candidate = folder / name
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    return None


def _stem_paths(slug: str) -> dict[str, Path]:
    folder = ROOT / "work" / slug / "stems"
    found = {}
    for name in STEMS:
        candidate = folder / f"{name}.wav"
        if candidate.is_file() and candidate.stat().st_size > 0:
            found[name] = candidate
    return found


def predict_slug(slug: str, primary: str = "mix") -> Path | None:
    """Write one listen. `stem` keeps the four Demucs stems and drops the mix."""
    mix = _mix_path(slug)
    stems = _stem_paths(slug)
    out = ROOT / "docs" / "analysis" / slug / "instrument-id.json"
    if primary == "stem" and not stems:
        print(f"{slug}: нет work/{slug}/stems — предсказание стема не пишу")
        return None
    if primary != "stem" and mix is None:
        print(f"{slug}: нет work/{slug}/source.m4a — предсказание смеси не пишу")
        return None
    meta, pack = load_probe()
    payload = {
        "slug": slug,
        "model": meta["embedding"] + "-linear-probe",
        "noncommercial": meta["noncommercial"],
        "noncommercialReason": meta["noncommercialReason"],
        "creditsUsed": False,
        "audioPrimary": primary,
        "threshold": meta["threshold"],
        "threshold95": meta["threshold95"],
        "thresholdReached": meta["thresholdReached"],
        "sources": {},
    }
    if primary == "stem":
        for name, path in stems.items():
            payload["sources"][name] = recognize_file(path, name, meta, pack)
    else:
        payload["sources"]["mix"] = recognize_file(mix, "mix", meta, pack)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{slug}: {out}")
    return out


def predict_songs(primary: str = "mix") -> list[str]:
    missing = []
    for slug in SONGS:
        if predict_slug(slug, primary) is None:
            missing.append(slug)
    return missing
