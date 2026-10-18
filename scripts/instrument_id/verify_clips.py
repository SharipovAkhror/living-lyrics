"""Spectral spot-check for extra clips. Writes features; does not decide a flag by itself.

A filename is not a label. This script measures each cached clip so a later pass can
flag voice-on-top, noise, or a too-quiet file. Spectrograms land in work/ and stay
out of git.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audio import load_mono
from paths import ROOT, WORK

SR = 32000


def _features(audio: np.ndarray) -> dict:
    if audio.size < SR:
        audio = np.pad(audio, (0, SR - audio.size))
    frame = 1024
    hop = 256
    rms_frames = []
    flats = []
    cents = []
    for start in range(0, audio.size - frame, hop):
        chunk = audio[start:start + frame].astype(np.float64)
        rms_frames.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-12)))
        spec = np.abs(np.fft.rfft(chunk * np.hanning(frame))) + 1e-12
        geo = float(np.exp(np.mean(np.log(spec))))
        arith = float(np.mean(spec))
        flats.append(geo / arith)
        freqs = np.fft.rfftfreq(frame, 1 / SR)
        cents.append(float(np.sum(freqs * spec) / np.sum(spec)))
    rms = np.asarray(rms_frames) if rms_frames else np.array([0.0])
    # Envelope of 3–8 Hz against the whole modulation spectrum.
    env = rms - np.mean(rms)
    spec_e = np.abs(np.fft.rfft(env * np.hanning(env.size)))
    rate = (SR / hop) / 2
    freqs_e = np.linspace(0, rate, spec_e.size)
    band = (freqs_e >= 3) & (freqs_e <= 8)
    mod = float(np.sum(spec_e[band]) / (np.sum(spec_e) + 1e-12))
    # Harmonicity: peak autocorrelation away from the zero lag, in the pitch range.
    corr = np.correlate(audio[: SR], audio[: SR], mode="full")
    corr = corr[corr.size // 2:]
    lo = int(SR / 2000)
    hi = int(SR / 70)
    peak = float(np.max(corr[lo:hi]) / (corr[0] + 1e-12)) if hi > lo else 0.0
    return {
        "seconds": round(audio.size / SR, 3),
        "rms": round(float(np.mean(rms)), 5),
        "silence": round(float(np.mean(rms < 0.01)), 3),
        "flatness": round(float(np.mean(flats)) if flats else 0.0, 4),
        "centroid": round(float(np.mean(cents)) if cents else 0.0, 1),
        "modulation": round(mod, 3),
        "harmonicity": round(peak, 3),
    }


def _spectrogram(audio: np.ndarray, dest: Path) -> None:
    frame = 1024
    hop = 256
    cols = []
    for start in range(0, max(1, audio.size - frame), hop):
        chunk = audio[start:start + frame]
        if chunk.size < frame:
            break
        spec = np.abs(np.fft.rfft(chunk.astype(np.float64) * np.hanning(frame)))
        # Up to 8 kHz.
        hi = int(8000 / (SR / frame))
        cols.append(np.log1p(spec[:hi]))
    if not cols:
        return
    grid = np.stack(cols, axis=1)
    grid = grid / (np.percentile(grid, 99) + 1e-9)
    grid = np.clip(grid, 0, 1)
    image = (255 * (1 - grid[::-1])).astype(np.uint8)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(image, mode="L").resize((480, 240)).save(dest)


def main() -> None:
    root = WORK / "extra"
    rows = []
    if not root.is_dir():
        raise SystemExit("нет work/instrument_id/extra")
    manifest = Path(__file__).resolve().parent / "sources"
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        meta = {}
        csv_path = manifest / f"{folder.name}.csv"
        if csv_path.is_file():
            import csv
            with csv_path.open(encoding="utf-8", newline="") as handle:
                for record in csv.DictReader(handle):
                    if record.get("file"):
                        meta[record["file"]] = record
        seen_recording = set()
        for wav in sorted(folder.glob("*.wav")):
            audio = load_mono(wav, SR)
            feat = _features(audio)
            record = meta.get(wav.name, {})
            recording = record.get("recording") or ""
            feat.update({
                "id": folder.name,
                "file": wav.name,
                "recording": recording,
                "flag": record.get("flag") or "",
                "author": record.get("author") or "",
            })
            rows.append(feat)
            if recording and recording not in seen_recording:
                seen_recording.add(recording)
                _spectrogram(audio, WORK / "spectra" / folder.name / f"{recording}.png")
        print(f"{folder.name}: {len(list(folder.glob('*.wav')))} клипов", flush=True)
    out = WORK / "clip-features.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out)
    # One line per recording: median features, so the check is not a single window.
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        groups.setdefault((row["id"], row["recording"]), []).append(row)
    print(f"{'class':12} {'recording':24} {'n':3} {'rms':7} {'sil':5} {'flat':6} {'cent':7} {'mod':5} {'harm':5}")
    for key in sorted(groups):
        items = groups[key]
        def med(name: str) -> float:
            vals = sorted(item[name] for item in items)
            return vals[len(vals) // 2]
        print(
            f"{key[0]:12} {key[1][:24]:24} {len(items):3} {med('rms'):7.4f} {med('silence'):5.2f} "
            f"{med('flatness'):6.3f} {med('centroid'):7.0f} {med('modulation'):5.2f} {med('harmonicity'):5.2f}"
        )


# Flags from the 2026-10-18 spot check. A flagged row stays in the manifest and
# does not train. Thresholds were read off clip-features.json, not guessed first.
# A window that is mostly under the silence floor is not a note. The second
# line caught diangong_m_013: silence 0.64 and rms 0.008, under the recording median.
RECORDING_FLAG = {
    "antti-luode": "ensemble",
    "iran-persian": "voice",
    "lizikus": "spectrum",
    "kantorei-st-michael": "review",
}


def apply_flags() -> None:
    """Mark clips the spectrum pass did not accept. Re-count the source summary."""
    import csv

    features = json.loads((WORK / "clip-features.json").read_text(encoding="utf-8"))
    silence = {row["file"]: row["silence"] for row in features}
    rms = {row["file"]: row["rms"] for row in features}
    manifest = Path(__file__).resolve().parent / "sources"
    for csv_path in sorted(manifest.glob("*.csv")):
        with csv_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        if not rows:
            continue
        fieldnames = list(rows[0].keys())
        if "flag" not in fieldnames:
            fieldnames.append("flag")
        changed = 0
        for row in rows:
            row.setdefault("flag", "")
            if (row.get("flag") or "").strip():
                continue
            name = row.get("file") or ""
            reason = RECORDING_FLAG.get(row.get("recording") or "")
            if not reason and silence.get(name, 0) >= 0.70:
                reason = "silence"
            elif not reason and silence.get(name, 0) >= 0.60 and rms.get(name, 1) < 0.01:
                reason = "silence"
            if reason:
                row["flag"] = reason
                changed += 1
        if not changed:
            continue
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{csv_path.name}: флагов {changed}", flush=True)
    from sources_fetch import summarize
    summarize()


if __name__ == "__main__":
    if "--apply" in sys.argv:
        apply_flags()
    else:
        main()
