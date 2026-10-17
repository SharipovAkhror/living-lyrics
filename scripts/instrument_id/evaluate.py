"""Held-out metrics from the frozen probe. The test split does not choose the threshold."""

from __future__ import annotations

import csv
import json

import numpy as np

from dataset import read_index
from embed import EMB_PATH
from paths import CONFUSION_PATH, METRICS_PATH, WEIGHTS
from taxonomy import load
from train import _softmax

PACK = WEIGHTS / "probe.npz"
META = WEIGHTS / "meta.json"


def _prf(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int) -> list[dict]:
    rows = []
    for i in range(n_classes):
        tp = int(((y_pred == i) & (y_true == i)).sum())
        fp = int(((y_pred == i) & (y_true != i)).sum())
        fn = int(((y_pred != i) & (y_true == i)).sum())
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        rows.append({
            "index": i,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": int((y_true == i).sum()),
        })
    return rows


def evaluate() -> dict:
    data = load()
    meta = json.loads(META.read_text(encoding="utf-8"))
    pack = np.load(PACK)
    rows = read_index()
    blob = np.load(EMB_PATH, allow_pickle=False)
    if any(str(p) != row["path"] for p, row in zip(blob["paths"].tolist(), rows)):
        raise SystemExit("embeddings.npz не совпадает с индексом")
    kept = meta["classes"]
    index = {name: i for i, name in enumerate(kept)}
    pos = [i for i, row in enumerate(rows) if row["id"] in index and row["split"] == "test"]
    if not pos:
        raise SystemExit("в тесте нет строк")
    x = blob["features"][pos].astype(np.float64)
    xn = (x - pack["mu"]) / pack["sd"]
    logits = xn @ pack["W"].T + pack["b"]
    prob = _softmax(logits, float(meta["temperature"]))
    y = np.array([index[rows[i]["id"]] for i in pos], dtype=np.int64)
    pred = prob.argmax(axis=1)
    per = _prf(y, pred, len(kept))
    for row, instrument in zip(per, kept):
        row["id"] = instrument
        row["name"] = data["by_id"][instrument]["name"]
        del row["index"]
    supports = np.array([row["support"] for row in per])
    macro = float(np.mean([row["f1"] for row in per if row["support"] > 0]))
    tp = int((pred == y).sum())
    accuracy = tp / len(y)
    # micro over classes that occur or are predicted
    micro_tp = tp
    micro_fp = len(y) - tp
    micro_fn = micro_fp
    micro_p = micro_tp / (micro_tp + micro_fp) if micro_tp + micro_fp else 0.0
    micro_r = micro_tp / (micro_tp + micro_fn) if micro_tp + micro_fn else 0.0
    micro = 2 * micro_p * micro_r / (micro_p + micro_r) if micro_p + micro_r else 0.0

    tau = float(meta["threshold"])
    top = prob.max(axis=1)
    accepted = top >= tau
    acc_precision = float((pred[accepted] == y[accepted]).mean()) if accepted.any() else 0.0
    coverage = float(accepted.mean())

    tau95 = meta.get("threshold95")
    if tau95 is None:
        acc95, cov95 = None, None
    else:
        mask95 = top >= float(tau95)
        acc95 = float((pred[mask95] == y[mask95]).mean()) if mask95.any() else 0.0
        cov95 = float(mask95.mean())

    fam_ids = meta["families"]
    fam_index = {name: i for i, name in enumerate(fam_ids)}
    yf = np.array([fam_index[data["by_id"][kept[i]]["family"]] for i in y], dtype=np.int64)
    fam_logits = xn @ pack["Wf"].T + pack["bf"]
    fam_prob = _softmax(fam_logits, 1.0)
    fam_pred = fam_prob.argmax(axis=1)
    abstained = ~accepted
    if abstained.any():
        fam_correct = float((fam_pred[abstained] == yf[abstained]).mean())
        fam_n = int(abstained.sum())
    else:
        fam_correct, fam_n = None, 0

    bins = []
    edges = (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001)
    for lo, hi in zip(edges, edges[1:]):
        mask = (top >= lo) & (top < hi)
        n = int(mask.sum())
        bins.append({
            "lo": lo,
            "hi": min(hi, 1.0),
            "n": n,
            "accuracy": float((pred[mask] == y[mask]).mean()) if n else None,
        })

    by_source = {}
    sources = np.array([rows[i]["source"] for i in pos])
    for source in sorted(set(sources.tolist())):
        mask = sources == source
        by_source[source] = {
            "n": int(mask.sum()),
            "accuracy": float((pred[mask] == y[mask]).mean()),
            "acceptedPrecision": float((pred[mask & accepted] == y[mask & accepted]).mean()) if (mask & accepted).any() else None,
            "coverage": float(accepted[mask].mean()),
        }

    confusion = np.zeros((len(kept), len(kept)), dtype=np.int32)
    for truth, guess in zip(y, pred):
        confusion[int(truth), int(guess)] += 1
    CONFUSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONFUSION_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["истина\\предсказание", *kept])
        for instrument, row in zip(kept, confusion):
            writer.writerow([instrument, *row.tolist()])

    metrics = {
        "perClass": per,
        "macroF1": macro,
        "microF1": micro,
        "accuracy": accuracy,
        "testN": int(len(y)),
        "acceptedPrecision": acc_precision,
        "coverage": coverage,
        "testAcceptedPrecision95": acc95,
        "testCoverage95": cov95,
        "familyFallback": {"n": fam_n, "correct": fam_correct, "minProb": meta["familyFallbackMin"]},
        "bins": bins,
        "bySource": by_source,
        "meta": meta,
        "supportSum": int(supports.sum()),
    }
    METRICS_PATH.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"тест n={len(y)} точность {accuracy:.3f} макро-ф1 {macro:.3f} "
        f"принятая точность {acc_precision:.3f} покрытие {coverage:.3f}"
    )
    return metrics
