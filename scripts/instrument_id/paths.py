"""Repository paths for the instrument recognizer. Audio and caches stay under work/."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = Path(__file__).resolve().parent
WORK = ROOT / "work" / "instrument_id"
DATA = WORK / "data"
CACHE = WORK / "cache"
WEIGHTS = PKG / "weights"
LABELS_PATH = PKG / "labels.json"
SCHEMA_PATH = PKG / "schema" / "vision.json"
METRICS_PATH = ROOT / "docs" / "analysis" / "instrument-id-metrics.json"
EVAL_PATH = ROOT / "docs" / "analysis" / "instrument-id-eval.md"
CONFUSION_PATH = ROOT / "docs" / "analysis" / "instrument-id-confusion.csv"
TAXONOMY_PATH = ROOT / "docs" / "instruments" / "taxonomy.md"
SONGS = ("i-have-come-alive", "karitas", "one")
EFFICIENTAT = WORK / "third_party" / "EfficientAT"
