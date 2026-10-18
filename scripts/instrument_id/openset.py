"""Open-set scores on frozen embeddings, measured by leave-class-out.

A class is removed from training entirely. Its clips are the unknown sound.
The threshold is chosen on a validation slice, then frozen for the held-out slice.
Three scores are compared: maximum softmax, diagonal Mahalanobis distance to the
nearest class, and the distance to the 5th nearest training embedding.
"""

from __future__ import annotations

import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import NearestNeighbors

from dataset import read_index
from embed import EMB_PATH
from paths import ROOT, WEIGHTS
from taxonomy import load

OUT = ROOT / "docs" / "analysis" / "instrument-id-openset.json"
ID_COVERAGE = 0.80
OOD_REJECT = 0.90


def _pack(rows: list[dict], features: np.ndarray, classes: list[str]):
    index = {name: i for i, name in enumerate(classes)}
    keep = [i for i, row in enumerate(rows) if row["id"] in index]
    y = np.array([index[rows[i]["id"]] for i in keep], dtype=np.int64)
    split = np.array([rows[i]["split"] for i in keep])
    group = np.array([rows[i]["group"] for i in keep])
    ids = np.array([rows[i]["id"] for i in keep])
    return features[keep].astype(np.float64), y, split, group, ids


def _softmax_scores(x_train, y_train, x_query) -> np.ndarray:
    clf = LogisticRegression(
        C=1.0, class_weight="balanced", solver="lbfgs", max_iter=200,
    )
    clf.fit(x_train, y_train)
    prob = clf.predict_proba(x_query)
    # Columns follow clf.classes_, which may skip a missing label.
    return prob.max(axis=1)


def _mahalanobis(x_train, y_train, x_query) -> np.ndarray:
    """Min diagonal Mahalanobis distance to a class mean. Higher is more unknown."""
    dim = x_train.shape[1]
    means = []
    residual = np.zeros(dim, dtype=np.float64)
    count = 0
    for label in np.unique(y_train):
        block = x_train[y_train == label]
        mean = block.mean(axis=0)
        means.append(mean)
        residual += ((block - mean) ** 2).sum(axis=0)
        count += block.shape[0]
    var = residual / max(count, 1)
    var[var < 1e-6] = 1e-6
    means = np.stack(means)
    # (query, class, dim)
    diff = x_query[:, None, :] - means[None, :, :]
    dist = ((diff ** 2) / var).sum(axis=2)
    return dist.min(axis=1)


def _knn(x_train, x_query, k: int = 5) -> np.ndarray:
    k = min(k, len(x_train))
    nn = NearestNeighbors(n_neighbors=k, algorithm="auto")
    nn.fit(x_train)
    dist, _ = nn.kneighbors(x_query, return_distance=True)
    return dist[:, -1]


def _operating_point(id_val, ood_val, id_test, ood_test, higher_is_id: bool) -> dict:
    """Pick a threshold on val. Report it on test. Goal: ID coverage >= 80% and OOD rejection >= 90%."""
    pool = np.concatenate([id_val, ood_val]) if len(ood_val) else id_val
    if len(pool) == 0 or len(id_val) == 0:
        return {"goal": False, "idCoverage": None, "oodRejection": None, "oodAcceptedAsOther": None, "threshold": None}
    candidates = np.unique(np.quantile(pool, np.linspace(0, 1, 101)))
    best = None
    for tau in candidates:
        if higher_is_id:
            id_cov = float((id_val >= tau).mean())
            ood_rej = float((ood_val < tau).mean()) if len(ood_val) else 0.0
        else:
            id_cov = float((id_val <= tau).mean())
            ood_rej = float((ood_val > tau).mean()) if len(ood_val) else 0.0
        meets = id_cov >= ID_COVERAGE - 1e-9 and ood_rej >= OOD_REJECT - 1e-9
        # Prefer a point that meets the goal, then the highest ID coverage, then the highest rejection.
        rank = (1 if meets else 0, id_cov if meets else -abs(id_cov - ID_COVERAGE), ood_rej)
        if best is None or rank > best[0]:
            best = (rank, float(tau), meets)
    tau = best[1]
    if higher_is_id:
        id_cov = float((id_test >= tau).mean()) if len(id_test) else None
        ood_rej = float((ood_test < tau).mean()) if len(ood_test) else None
    else:
        id_cov = float((id_test <= tau).mean()) if len(id_test) else None
        ood_rej = float((ood_test > tau).mean()) if len(ood_test) else None
    accepted = None if ood_rej is None else 1.0 - ood_rej
    return {
        "goal": bool(best[2] and id_cov is not None and ood_rej is not None and id_cov >= ID_COVERAGE - 1e-9 and ood_rej >= OOD_REJECT - 1e-9),
        "threshold": tau,
        "idCoverage": id_cov,
        "oodRejection": ood_rej,
        "oodAcceptedAsOther": accepted,
        "valMetGoal": bool(best[2]),
    }


def _split_ood(groups: np.ndarray) -> np.ndarray:
    """True = validation half of recording groups. Stable, not a python hash."""
    import hashlib
    keep = np.zeros(len(groups), dtype=bool)
    for group in set(groups.tolist()):
        digest = hashlib.sha256(f"ood:{group}".encode("utf-8")).hexdigest()
        keep[groups == group] = int(digest[:2], 16) < 128
    if keep.all() or not keep.any():
        keep = np.zeros(len(groups), dtype=bool)
        keep[: max(1, len(groups) // 2)] = True
    return keep


def evaluate() -> dict:
    data = load()
    rows = read_index()
    blob = np.load(EMB_PATH, allow_pickle=False)
    if any(str(p) != row["path"] for p, row in zip(blob["paths"].tolist(), rows)):
        raise SystemExit("embeddings.npz не совпадает с индексом")
    meta_path = WEIGHTS / "meta.json"
    if meta_path.is_file():
        # The shipped head. A class that failed the held-out recording is not here,
        # even when its clip count cleared minExamples.
        classes = list(json.loads(meta_path.read_text(encoding="utf-8"))["classes"])
    else:
        counts: dict[str, int] = {}
        for row in rows:
            if row["split"] == "train":
                counts[row["id"]] = counts.get(row["id"], 0) + 1
        minimum = int(data["minExamples"])
        classes = [item["id"] for item in data["instruments"] if counts.get(item["id"], 0) >= minimum]
    x, y, split, group, ids = _pack(rows, blob["features"], classes)
    per_class = []
    methods = ("softmax", "mahalanobis", "knn")
    totals = {name: [] for name in methods}
    for held in classes:
        held_i = classes.index(held)
        train = (split == "train") & (y != held_i)
        if train.sum() < 30 or len(set(y[train].tolist())) < 2:
            continue
        id_val = (split == "val") & (y != held_i)
        id_test = (split == "test") & (y != held_i)
        ood = y == held_i
        if ood.sum() < 8 or id_val.sum() < 8 or id_test.sum() < 8:
            continue
        mu = x[train].mean(axis=0)
        sd = x[train].std(axis=0)
        sd[sd < 1e-6] = 1.0
        def norm(mask):
            return (x[mask] - mu) / sd
        xt = norm(train)
        yt = y[train]
        print(f"leave-class-out {held}: train {len(xt)} id-test {int(id_test.sum())} ood {int(ood.sum())}", flush=True)
        softmax_all = np.zeros(len(x), dtype=np.float64)
        # Score only the rows we need.
        need = id_val | id_test | ood
        softmax_need = _softmax_scores(xt, yt, norm(need))
        softmax_all[need] = softmax_need
        maha_all = np.zeros(len(x), dtype=np.float64)
        maha_all[need] = _mahalanobis(xt, yt, norm(need))
        knn_all = np.zeros(len(x), dtype=np.float64)
        knn_all[need] = _knn(xt, norm(need))
        ood_val_mask = np.zeros(len(x), dtype=bool)
        ood_idx = np.flatnonzero(ood)
        half = _split_ood(group[ood])
        ood_val_mask[ood_idx[half]] = True
        ood_test_mask = ood & ~ood_val_mask
        scores = {
            "softmax": (softmax_all, True),
            "mahalanobis": (maha_all, False),
            "knn": (knn_all, False),
        }
        row = {"id": held, "name": data["by_id"][held]["name"], "oodN": int(ood.sum()), "idTestN": int(id_test.sum())}
        for name, (score, higher) in scores.items():
            point = _operating_point(score[id_val], score[ood_val_mask], score[id_test], score[ood_test_mask], higher)
            row[name] = point
            totals[name].append(point)
        per_class.append(row)
    summary = {}
    for name, points in totals.items():
        met = [p for p in points if p.get("goal")]
        rej = [p["oodRejection"] for p in points if p.get("oodRejection") is not None]
        cov = [p["idCoverage"] for p in points if p.get("idCoverage") is not None]
        summary[name] = {
            "classes": len(points),
            "goalMet": len(met),
            "meanOodRejection": float(np.mean(rej)) if rej else None,
            "meanIdCoverage": float(np.mean(cov)) if cov else None,
        }
    ranked = sorted(summary, key=lambda name: (summary[name]["goalMet"], summary[name]["meanOodRejection"] or 0), reverse=True)
    chosen = ranked[0] if ranked else None
    payload = {
        "goal": {"oodRejection": OOD_REJECT, "idCoverage": ID_COVERAGE},
        "chosen": chosen,
        "summary": summary,
        "perClass": per_class,
        "note": (
            "Порог выбирается на проверке: половина групп выкинутого класса и проверка своих классов. "
            "В таблице — отложенная половина групп и тест своих классов. "
            "Цель выполнена по классу, только если обе доли держатся на этой отложенной части."
        ),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"выбран способ: {chosen}")
    if chosen:
        _fit_deployed(chosen, x, y, split, classes)
    return payload


def _fit_deployed(method: str, x: np.ndarray, y: np.ndarray, split: np.ndarray, classes: list[str]) -> None:
    """Fit the chosen score on the full training split and store it next to the probe."""
    train = split == "train"
    val = split == "val"
    mu = x[train].mean(axis=0)
    sd = x[train].std(axis=0)
    sd[sd < 1e-6] = 1.0
    xt = (x[train] - mu) / sd
    xv = (x[val] - mu) / sd
    if method == "softmax":
        score_val = _softmax_scores(xt, y[train], xv)
        higher = True
    elif method == "knn":
        score_val = _knn(xt, xv)
        higher = False
    else:
        score_val = _mahalanobis(xt, y[train], xv)
        higher = False
    # Threshold that keeps about 80% of validation clips. It does not look at held-out classes.
    if higher:
        tau = float(np.quantile(score_val, 1 - ID_COVERAGE))
    else:
        tau = float(np.quantile(score_val, ID_COVERAGE))
    pack_path = WEIGHTS / "probe.npz"
    meta_path = WEIGHTS / "meta.json"
    if not pack_path.is_file():
        return
    pack = np.load(pack_path)
    arrays = {key: pack[key] for key in pack.files}
    # Class means in the probe's own standardized space are not these; store raw-space moments
    # of the open-set feature, which predict.py standardizes with os_mu / os_sd.
    means = []
    dim = xt.shape[1]
    residual = np.zeros(dim)
    count = 0
    order = []
    for label in range(len(classes)):
        block = xt[y[train] == label]
        if len(block) == 0:
            continue
        order.append(classes[label])
        mean = block.mean(axis=0)
        means.append(mean)
        residual += ((block - mean) ** 2).sum(axis=0)
        count += len(block)
    var = residual / max(count, 1)
    var[var < 1e-6] = 1e-6
    arrays.update({
        "os_mu": mu.astype(np.float32),
        "os_sd": sd.astype(np.float32),
        "os_mean": np.stack(means).astype(np.float32),
        "os_var": var.astype(np.float32),
        "os_train": xt.astype(np.float32) if method == "knn" else np.zeros((1, dim), dtype=np.float32),
    })
    np.savez_compressed(pack_path, **arrays)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["openSet"] = {
        "method": method,
        "threshold": tau,
        "higherIsIn": higher,
        "idValCoverageTarget": ID_COVERAGE,
        "classes": order,
        "knnK": 5,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"открытое множество {method}, порог {tau:.4f}")
