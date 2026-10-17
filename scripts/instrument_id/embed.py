"""Frozen EfficientAT mn10_as embeddings.

The encoder is cloned into work/ and its AudioSet weights download on first use
from the official GitHub release. Neither is committed. The probe trains on the
pooled convolutional features, not on the 527 AudioSet logits.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

from audio import center_window, load_mono
from dataset import read_index
from paths import CACHE, EFFICIENTAT, WORK
from taxonomy import load

EMB_PATH = WORK / "embeddings.npz"


def ensure_repo() -> Path:
    if not (EFFICIENTAT / "models" / "mn" / "model.py").is_file():
        EFFICIENTAT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.check_call([
            "git", "clone", "--depth", "1",
            "https://github.com/fschmid56/EfficientAT.git",
            str(EFFICIENTAT),
        ])
    return EFFICIENTAT


_ENCODER = None


def load_encoder():
    global _ENCODER
    if _ENCODER is not None:
        return _ENCODER
    repo = ensure_repo()
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    # helpers/utils.py opens metadata/class_labels_indices.csv relative to the cwd.
    previous = Path.cwd()
    os.chdir(repo)
    try:
        import torch
        from models.mn.model import get_model
        from models.preprocess import AugmentMelSTFT
        import models.mn.model as mn_model

        weights = CACHE / "efficientat"
        weights.mkdir(parents=True, exist_ok=True)
        mn_model.model_dir = str(weights)
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink):
            model = get_model(
                width_mult=1.0,
                pretrained_name="mn10_as",
                strides=(2, 2, 2, 2),
                head_type="mlp",
            )
        model.eval()
        mel = AugmentMelSTFT(
            n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024,
            freqm=0, timem=0, fmin=0.0, fmax=15000, fmin_aug_range=1, fmax_aug_range=1,
        )
        mel.eval()
    finally:
        os.chdir(previous)
    _ENCODER = (torch, model, mel)
    return _ENCODER


def _embed_batch(torch, model, mel, batch: np.ndarray):
    with torch.no_grad():
        wave = torch.from_numpy(batch)
        spec = mel(wave).unsqueeze(1)
        _logits, features = model(spec)
        if features.dim() == 1:
            features = features.unsqueeze(0)
        return features.detach().float().cpu().numpy()


def embed(batch_size: int = 16) -> Path:
    data = load()
    rows = read_index()
    sample_rate = int(data["sampleRate"])
    length = float(data["windowSec"])
    torch, model, mel = load_encoder()
    torch.set_num_threads(8)

    done: dict[str, np.ndarray] = {}
    if EMB_PATH.is_file():
        previous = np.load(EMB_PATH, allow_pickle=False)
        for path, feat in zip(previous["paths"].tolist(), previous["features"]):
            done[str(path)] = feat

    pending = [row for row in rows if row["path"] not in done]
    print(f"эмбеддинги: готово {len(done)}, осталось {len(pending)}")
    dim = None
    for start in range(0, len(pending), batch_size):
        chunk = pending[start:start + batch_size]
        windows = []
        for row in chunk:
            audio = load_mono(Path(row["path"]), sample_rate)
            windows.append(center_window(audio, sample_rate, length))
        batch = np.stack(windows)
        feats = _embed_batch(torch, model, mel, batch)
        dim = int(feats.shape[1])
        for row, feat in zip(chunk, feats):
            done[row["path"]] = feat
        print(f"  {min(start + batch_size, len(pending))}/{len(pending)}")

    ordered = [done[row["path"]] for row in rows]
    features = np.stack(ordered).astype(np.float32)
    np.savez_compressed(
        EMB_PATH,
        paths=np.array([row["path"] for row in rows]),
        ids=np.array([row["id"] for row in rows]),
        features=features,
    )
    meta = {"dim": int(features.shape[1]), "count": int(features.shape[0]), "model": "mn10_as"}
    (WORK / "embeddings-meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"признаки {features.shape} → {EMB_PATH}")
    return EMB_PATH
