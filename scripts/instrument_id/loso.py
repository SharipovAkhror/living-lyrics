"""Leave-one-song-out on confirmed segments.

Training may use confirmed segments of other songs. The held-out song, and every
anchor, stays a test. The committed head does not include these songs: song audio
and the public embedding index are not on the same machine in the usual run.
This command writes the measured table only when both are present. Otherwise it
records why, and does not invent a score.
"""

from __future__ import annotations

import json
from pathlib import Path

from paths import ROOT, SONGS

OUT = ROOT / "docs" / "analysis" / "instrument-id-loso.json"


def _audio(slug: str) -> Path | None:
    folder = ROOT / "work" / slug
    for name in ("source.m4a", "source.wav", "source.flac"):
        candidate = folder / name
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    return None


def _confirmed(slug: str) -> list[dict]:
    path = ROOT / "docs" / "analysis" / slug / "confirmed.json"
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for segment in payload.get("segments") or []:
        sources = segment.get("sources") or []
        # Two sources. Anchors are not in this file.
        if len(sources) < 2 or not segment.get("id"):
            continue
        rows.append(segment)
    return rows


def evaluate() -> dict:
    from embed import EMB_PATH

    audio = {slug: _audio(slug) for slug in SONGS}
    confirmed = {slug: _confirmed(slug) for slug in SONGS}
    have_audio = [slug for slug, path in audio.items() if path is not None]
    have_rows = [slug for slug, rows in confirmed.items() if rows]
    payload: dict
    if not EMB_PATH.is_file() or not have_audio or not have_rows:
        payload = {
            "status": "not-run",
            "reason": (
                "Нужны сразу эмбеддинги публичного набора (work/instrument_id/embeddings.npz) "
                "и расшифрованная запись хотя бы одной песни с подтверждёнными двумя источниками отрезками. "
                "Локально есть эмбеддинги и нет ключа записи. На раннере есть запись и нет эмбеддингов. "
                "Число не подставлено."
            ),
            "embeddings": EMB_PATH.is_file(),
            "audio": have_audio,
            "confirmedSongs": have_rows,
            "confirmedCounts": {slug: len(rows) for slug, rows in confirmed.items()},
        }
    else:
        payload = _measure(have_audio, confirmed)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("status", "reason") if k in payload}, ensure_ascii=False))
    return payload


def _measure(have_audio: list[str], confirmed: dict[str, list[dict]]) -> dict:
    """Refit the probe without the held-out song's clips and score that song's confirmed rows."""
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    from audio import center_window, load_mono
    from dataset import read_index
    from embed import EMB_PATH, _embed_batch, load_encoder
    from predict import load_probe
    from taxonomy import load

    data = load()
    meta, _pack = load_probe()
    sample_rate = int(meta["sampleRate"])
    window_sec = float(meta["windowSec"])
    rows = read_index()
    blob = np.load(EMB_PATH, allow_pickle=False)
    if any(str(p) != row["path"] for p, row in zip(blob["paths"].tolist(), rows)):
        raise SystemExit("embeddings.npz не совпадает с индексом")
    public_x = blob["features"].astype(np.float64)
    public_y_id = [row["id"] for row in rows]
    public_split = [row["split"] for row in rows]
    torch, model, mel = load_encoder()

    song_feats: dict[str, list[tuple[str, np.ndarray]]] = {}
    for slug in have_audio:
        raw = load_mono(_audio(slug), sample_rate)
        collected = []
        for segment in confirmed[slug]:
            start = int(float(segment["start"]) * sample_rate)
            end = int(float(segment["end"]) * sample_rate)
            clip = raw[start:end]
            if clip.size < int(0.5 * sample_rate):
                continue
            batch = center_window(clip, sample_rate, window_sec)[None, :]
            feat = _embed_batch(torch, model, mel, batch)[0]
            collected.append((segment["id"], feat))
        song_feats[slug] = collected

    songs = []
    classes = list(meta["classes"])
    index = {name: i for i, name in enumerate(classes)}
    for held in SONGS:
        train_x = []
        train_y = []
        for row_x, row_id, split in zip(public_x, public_y_id, public_split):
            if split != "train" or row_id not in index:
                continue
            train_x.append(row_x)
            train_y.append(index[row_id])
        for slug, pairs in song_feats.items():
            if slug == held:
                continue
            for instrument, feat in pairs:
                if instrument not in index:
                    continue
                train_x.append(feat)
                train_y.append(index[instrument])
        test = song_feats.get(held) or []
        test = [(instrument, feat) for instrument, feat in test if instrument in index]
        if len(train_x) < 30 or not test:
            songs.append({"slug": held, "status": "no-test", "n": len(test)})
            continue
        x = np.stack(train_x)
        y = np.array(train_y)
        mu = x.mean(axis=0)
        sd = x.std(axis=0)
        sd[sd < 1e-6] = 1.0
        clf = LogisticRegression(
            C=1.0, class_weight="balanced", solver="lbfgs", max_iter=400, random_state=int(data["seed"]),
        )
        clf.fit((x - mu) / sd, y)
        xt = np.stack([feat for _, feat in test])
        pred = clf.predict((xt - mu) / sd)
        truth = [index[instrument] for instrument, _ in test]
        correct = int(sum(int(a == b) for a, b in zip(pred, truth)))
        songs.append({
            "slug": held,
            "status": "ok",
            "n": len(test),
            "correct": correct,
            "accuracy": correct / len(test),
            "otherSongsInTrain": [slug for slug in song_feats if slug != held and song_feats[slug]],
        })
    return {
        "status": "ok",
        "songs": songs,
        "note": "Якоря в обучение не входили. Подтверждённые отрезки удержанной песни в обучении не участвовали.",
    }


