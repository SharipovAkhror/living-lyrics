"""Linear probe on frozen embeddings, then a temperature and an abstention threshold.

The threshold is the lowest one on the validation split whose accepted top-1
precision is at least 0.90 (and at least 20 accepted clips). It is frozen
before the test split is touched.

An extra class, whose test split is one recording held out of training, also
has to clear heldOutRecording in labels.json on that recording. The bar is
measured while the class is still in the probe, then the shipped head is fit
without the classes that missed it. TinySOL and IRMAS are not gated: their
split does not hold out a performer.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from dataset import read_index
from embed import EMB_PATH
from paths import WEIGHTS, WORK
from taxonomy import load

TEMPERATURES = (0.5, 0.7, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0)
TAUS = tuple(round(x, 2) for x in np.arange(0.50, 1.00, 0.01))


def _softmax(logits: np.ndarray, temperature: float) -> np.ndarray:
    scaled = logits / temperature
    scaled = scaled - scaled.max(axis=1, keepdims=True)
    exp = np.exp(scaled)
    return exp / exp.sum(axis=1, keepdims=True)


def _fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    best_t, best_nll = 1.0, float("inf")
    for temperature in TEMPERATURES:
        prob = _softmax(logits, temperature)
        picked = prob[np.arange(len(y)), y]
        nll = float(-np.log(np.clip(picked, 1e-12, 1)).mean())
        if nll < best_nll:
            best_t, best_nll = temperature, nll
    return best_t


def _choose_tau(prob: np.ndarray, y: np.ndarray, target: float) -> tuple[float | None, float, float]:
    """Lowest tau with precision >= target and at least 20 accepts. Also returns that precision and coverage."""
    top = prob.max(axis=1)
    pred = prob.argmax(axis=1)
    chosen = None
    chosen_precision = 0.0
    chosen_coverage = 0.0
    best_precision = -1.0
    best_tau = TAUS[0]
    best_coverage = 0.0
    for tau in TAUS:
        mask = top >= tau
        n = int(mask.sum())
        if n == 0:
            continue
        precision = float((pred[mask] == y[mask]).mean())
        coverage = n / len(y)
        if precision > best_precision or (precision == best_precision and coverage > best_coverage):
            best_precision = precision
            best_tau = tau
            best_coverage = coverage
        if chosen is None and precision >= target and n >= 20:
            chosen = tau
            chosen_precision = precision
            chosen_coverage = coverage
    if chosen is None:
        return None, best_precision, best_coverage if best_precision >= 0 else 0.0
    return chosen, chosen_precision, chosen_coverage


def _pack_labels(rows: list[dict], ids: list[str]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    index = {name: i for i, name in enumerate(ids)}
    y, split_train, split_val, split_test = [], [], [], []
    keep_pos = []
    for i, row in enumerate(rows):
        if row["id"] not in index:
            continue
        keep_pos.append(i)
        y.append(index[row["id"]])
        if row["split"] == "train":
            split_train.append(len(y) - 1)
        elif row["split"] == "val":
            split_val.append(len(y) - 1)
        else:
            split_test.append(len(y) - 1)
    return (
        np.array(keep_pos, dtype=np.int64),
        np.array(y, dtype=np.int64),
        np.array(split_train, dtype=np.int64),
        np.array(split_val, dtype=np.int64),
        np.array(split_test, dtype=np.int64),
    )


def _one_prf(y_true: np.ndarray, y_pred: np.ndarray, label: int) -> tuple[float, float, int]:
    tp = int(((y_pred == label) & (y_true == label)).sum())
    fp = int(((y_pred == label) & (y_true != label)).sum())
    fn = int(((y_pred != label) & (y_true == label)).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return precision, recall, int((y_true == label).sum())


def _is_gated_extra(rows: list[dict], class_id: str) -> bool:
    """True when every clip of the class is an extra manifest row, not TinySOL or IRMAS."""
    own = [row for row in rows if row["id"] == class_id]
    if not own:
        return False
    return all(row.get("source") not in ("tinysol", "irmas") and not row.get("optimistic") for row in own)


def _fit_classifier(features: np.ndarray, rows: list[dict], kept: list[str], seed: int) -> dict:
    from sklearn.linear_model import LogisticRegression

    pos, y, tr, va, te = _pack_labels(rows, kept)
    if len(tr) < 2:
        raise SystemExit("в обучении меньше двух строк")
    x = features[pos]
    mu = x[tr].mean(axis=0)
    sd = x[tr].std(axis=0) + 1e-6
    xn = (x - mu) / sd
    clf = LogisticRegression(
        C=1.0, class_weight="balanced", max_iter=500, solver="lbfgs", random_state=seed,
    )
    clf.fit(xn[tr], y[tr])
    logits = xn @ clf.coef_.T + clf.intercept_
    return {
        "pos": pos, "y": y, "tr": tr, "va": va, "te": te,
        "mu": mu, "sd": sd, "xn": xn, "clf": clf, "logits": logits,
    }


def _held_out_scores(rows: list[dict], kept: list[str], bundle: dict, data: dict) -> list[dict]:
    bar = data["heldOutRecording"]
    te = bundle["te"]
    pred = bundle["logits"][te].argmax(axis=1)
    y_te = bundle["y"][te]
    scored = []
    for class_id in kept:
        if not _is_gated_extra(rows, class_id):
            continue
        precision, recall, support = _one_prf(y_te, pred, kept.index(class_id))
        recordings = sorted({
            row["group"].rsplit(":", 1)[-1]
            for row in rows
            if row["id"] == class_id and row["split"] == "test"
        })
        passed = (
            support >= int(bar["minSupport"])
            and precision + 1e-9 >= float(bar["minPrecision"])
            and recall + 1e-9 >= float(bar["minRecall"])
        )
        scored.append({
            "id": class_id,
            "name": data["by_id"][class_id]["name"],
            "precision": precision,
            "recall": recall,
            "support": support,
            "recordings": recordings,
            "passed": passed,
        })
        print(
            f"чужая запись {class_id}: точность {precision:.3f} полнота {recall:.3f} "
            f"опора {support} запись {', '.join(recordings) or '—'} "
            f"{'в голове' if passed else 'вне головы'}"
        )
    return scored


def _freeze_threshold(logits: np.ndarray, y: np.ndarray, va: np.ndarray):
    temperature = _fit_temperature(logits[va], y[va])
    prob = _softmax(logits, temperature)
    tau, prec, cov = _choose_tau(prob[va], y[va], 0.90)
    reached = tau is not None
    if tau is None:
        top = prob[va].max(axis=1)
        pred = prob[va].argmax(axis=1)
        best = (0.0, 0.99, 0.0)
        for candidate in TAUS:
            mask = top >= candidate
            if int(mask.sum()) < 20:
                continue
            precision = float((pred[mask] == y[va][mask]).mean())
            coverage = float(mask.mean())
            if precision > best[0]:
                best = (precision, candidate, coverage)
        tau = best[1]
        prec = best[0]
        cov = best[2]
    tau95, prec95, cov95 = _choose_tau(prob[va], y[va], 0.95)
    return temperature, float(tau), prec, cov, reached, tau95, prec95, cov95


def train() -> dict:
    from sklearn.linear_model import LogisticRegression

    data = load()
    if "heldOutRecording" not in data:
        raise SystemExit("в labels.json нет heldOutRecording")
    rows = read_index()
    blob = np.load(EMB_PATH, allow_pickle=False)
    if len(blob["paths"]) != len(rows) or any(str(p) != row["path"] for p, row in zip(blob["paths"].tolist(), rows)):
        raise SystemExit("embeddings.npz не совпадает с индексом. Запустите embed ещё раз.")
    features = blob["features"].astype(np.float64)
    counts: dict[str, int] = {}
    for row in rows:
        if row["split"] == "train":
            counts[row["id"]] = counts.get(row["id"], 0) + 1
    minimum = int(data["minExamples"])
    counted = [item["id"] for item in data["instruments"] if counts.get(item["id"], 0) >= minimum]
    few = sorted(set(counts) - set(counted))
    if len(counted) < 2:
        raise SystemExit(f"в голове {len(counted)} классов — мало")
    seed = int(data["seed"])
    measured = _fit_classifier(features, rows, counted, seed)
    held = _held_out_scores(rows, counted, measured, data)
    rejected = {row["id"] for row in held if not row["passed"]}
    kept = [class_id for class_id in counted if class_id not in rejected]
    if len(kept) < 2:
        raise SystemExit(f"после чужой записи в голове {len(kept)} классов — мало")
    bundle = measured if kept == counted else _fit_classifier(features, rows, kept, seed)
    pos, y, tr, va, te = bundle["pos"], bundle["y"], bundle["tr"], bundle["va"], bundle["te"]
    mu, sd, xn, clf, logits = bundle["mu"], bundle["sd"], bundle["xn"], bundle["clf"], bundle["logits"]

    fam_ids = []
    for instrument in kept:
        fam = data["by_id"][instrument]["family"]
        if fam not in fam_ids:
            fam_ids.append(fam)
    fam_index = {name: i for i, name in enumerate(fam_ids)}
    yf = np.array([fam_index[data["by_id"][kept[label]]["family"]] for label in y], dtype=np.int64)
    fam = LogisticRegression(
        C=1.0, class_weight="balanced", max_iter=500, solver="lbfgs", random_state=seed,
    )
    fam.fit(xn[tr], yf[tr])
    fam_logits = xn @ fam.coef_.T + fam.intercept_

    temperature, tau, prec, cov, reached, tau95, prec95, cov95 = _freeze_threshold(logits, y, va)

    groups = {}
    for row, label_index in zip((rows[i] for i in pos), range(len(y))):
        groups.setdefault(row["split"], set()).add(row["group"])
    leaked = groups.get("train", set()) & groups.get("test", set())
    if leaked:
        raise SystemExit(f"утечка групп train/test: {len(leaked)}")

    WEIGHTS.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        WEIGHTS / "probe.npz",
        W=clf.coef_.astype(np.float32),
        b=clf.intercept_.astype(np.float32),
        mu=mu.astype(np.float32),
        sd=sd.astype(np.float32),
        Wf=fam.coef_.astype(np.float32),
        bf=fam.intercept_.astype(np.float32),
    )
    meta = {
        "trainedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "embedding": data["embedding"],
        "featureDim": int(features.shape[1]),
        "windowSec": data["windowSec"],
        "hopSec": data["hopSec"],
        "sampleRate": data["sampleRate"],
        "classes": kept,
        "families": fam_ids,
        "temperature": temperature,
        "threshold": float(tau),
        "thresholdReached": reached,
        "valAcceptedPrecision": prec,
        "valCoverage": cov,
        "threshold95": None if tau95 is None else float(tau95),
        "valAcceptedPrecision95": None if tau95 is None else prec95,
        "valCoverage95": None if tau95 is None else cov95,
        "familyFallbackMin": 0.70,
        "fewExamples": few,
        "heldOutRecording": {
            "minPrecision": float(data["heldOutRecording"]["minPrecision"]),
            "minRecall": float(data["heldOutRecording"]["minRecall"]),
            "minSupport": int(data["heldOutRecording"]["minSupport"]),
        },
        "heldOut": held,
        "noncommercial": True,
        "noncommercialReason": "IRMAS на Zenodo помечен CC BY-NC-SA 4.0. Веса обучены и на этих записях.",
        "licenses": [
            {"source": "tinysol", "license": "CC BY 4.0", "record": "https://doi.org/10.5281/zenodo.3685367"},
            {"source": "irmas", "license": "CC BY-NC-SA 4.0", "record": "https://doi.org/10.5281/zenodo.1290750"},
            {"source": "encoder", "license": "MIT", "record": "https://github.com/fschmid56/EfficientAT"},
        ],
        "irmasCapPerClass": data["irmasCapPerClass"],
        "seed": data["seed"],
        "counts": {
            "train": int(len(tr)),
            "val": int(len(va)),
            "test": int(len(te)),
        },
        "split": (
            "TinySOL: официальные fold 0–2 обучение, 3 проверка, 4 тест. "
            "IRMAS: группа — номер отрывка в имени файла, 60/20/20 по sha256, потолок файлов на класс. "
            "Официальный тест IRMAS не скачивался. Оба разбиения оптимистичны: исполнитель не удержан. "
            "Дополнительные клипы: запись целиком в одной доле. В тест уходит самая крупная запись, "
            "после которой в обучении остаётся не меньше 15; при равенстве берётся Commons. "
            "Свой класс входит в голову, только если на этой чужой записи точность не ниже 0,8 "
            "и полнота не ниже 0,3 при опоре не меньше 8 окон. Порог измерен, пока класс ещё в голове, "
            "затем голова переобучена без тех, кто не прошёл. TinySOL и IRMAS этим порогом не режутся."
        ),
    }
    (WEIGHTS / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    # Keep the matrices the evaluator needs. They are derived, not audio.
    np.savez_compressed(
        WORK / "probe-split.npz",
        y=y.astype(np.int16),
        yf=yf.astype(np.int16),
        split=np.array([rows[i]["split"] for i in pos]),
        source=np.array([rows[i]["source"] for i in pos]),
        logits=logits.astype(np.float32),
        fam_logits=fam_logits.astype(np.float32),
    )
    print(
        f"порог {meta['threshold']:.2f}, точность на проверке {prec:.3f}, покрытие {cov:.3f}, "
        f"порог 0,90 {'достигнут' if reached else 'не достигнут'}"
    )
    return meta
