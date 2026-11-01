"""Applause: broadband noise without a pitch, on the Demucs «other» stem.

One command, from the repository root:

    python scripts/instrument_id/run.py applause

It reads the other stem and the vocal stem (cache under work/t35/audio, or the
encrypted stems next to the repo in ../_artifacts, with AUDIO_KEY). It writes
docs/analysis/<slug>/applause.json and prints precision and recall against
sections already labelled «Аплодисменты». It does not edit lyrics.

Thresholds were measured once on i-have-come-alive, karitas and one
(2026-10-31) and then written down. They are not refit on each run.
`--calibrate` reprints the measurement so a later song can be checked
against the same procedure. The procedure:

1. Decode the htdemucs «other» stem to mono at 16 kHz. Windows are 1.0 s,
   hop 0.25 s, Hann window.
2. Spectral flatness is the geometric mean of the magnitude divided by the
   arithmetic mean, on bins from 200 Hz to 8 kHz. Pitch salience is the
   highest normalised autocorrelation peak at lags for 80–500 Hz.
3. A window quieter than the 10th percentile of other-stem RMS inside sung
   lines is silence. On these three songs that percentile is 0.0136.
   Flatness of a near-silent window is not a measurement, so those windows
   are left out of both medians and cannot open the gate.
4. Flatness gate: midpoint of the median flatness on the remaining windows
   that sit inside a section labelled «Аплодисменты», and the median on
   windows inside sung lines or an instrumental section that is not applause.
   Measured medians 0.7000 and 0.2807, midpoint 0.4904.
5. Pitch gate: the same midpoint, the other way. Measured medians 0.1325
   and 0.5791, midpoint 0.3558. Applause is the side with less pitch.
6. Vocal stem: midpoint of the median RMS inside labelled applause and the
   median RMS inside sung lines. Measured 0.0060 and 0.1297, midpoint 0.0678.
   A window this loud on the vocal stem is singing, not applause.
7. Windows that pass are joined across a hole of one hop (0.5 s). A stretch
   shorter than 2.0 s is dropped: one hit is a drum, and round 1 did not
   rewrite a section on a run shorter than 2 s. Neither number was chosen
   to raise the score.

The detector's number for a stretch is the mean spectral flatness of the
other stem on the windows that passed. Precision and recall count those
windows (each hop is 0.25 s) against windows whose centre lies in a section
already labelled «Аплодисменты». That count includes the bows and the
silence inside the label, so a fade that is not broadband noise lowers recall
on purpose.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

from paths import ROOT, SONGS

SR = 16000
WIN = SR
HOP = SR // 4
LABEL = "Аплодисменты"

# Written down from the procedure above. Do not edit one number without the others.
FLAT_MIN = 0.4904
PITCH_MAX = 0.3558
RMS_MIN = 0.0136
VOCAL_RMS_MAX = 0.0678
MIN_SPAN_S = 2.0
GAP_S = 0.5
# Half a window. A drawing must occupy more than this of an accepted stretch
# before the validator treats the edge of a hop as a real overlap.
EDGE_S = 0.5

CACHE = ROOT / "work" / "t35" / "audio"
ART = ROOT.parent / "_artifacts"


def _ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _key() -> bytes | None:
    raw = os.environ.get("AUDIO_KEY", "").strip()
    if not raw:
        env = ROOT / ".env.local"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("AUDIO_KEY="):
                    raw = line.split("=", 1)[1].strip()
                    break
    if len(raw) != 64:
        return None
    try:
        return bytes.fromhex(raw)
    except ValueError:
        return None


def _recording_id(slug: str) -> str:
    enc = ROOT / "content" / "audio-enc" / slug / "high.m4a.enc"
    return hashlib.sha256(enc.read_bytes()).hexdigest()[:12]


def _encrypted_stem(slug: str, stem: str) -> Path | None:
    if not ART.exists():
        return None
    name = f"{slug}-{_recording_id(slug)}-htdemucs-4.{stem}.flac.enc"
    found = list(ART.glob(f"**/align-{slug}/stems/{name}"))
    return found[0] if found else None


def _decode_flac(flac: bytes) -> np.ndarray:
    proc = subprocess.run(
        [_ffmpeg(), "-v", "error", "-f", "flac", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
        input=flac,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-400:]
        raise RuntimeError(f"ffmpeg не открыл стем: {err}")
    audio = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if audio.size == 0:
        raise RuntimeError("пустой стем")
    return audio


def load_stem(slug: str, stem: str) -> tuple[np.ndarray, str]:
    """Mono float32 at 16 kHz. Returns the samples and a short source name."""
    cache = CACHE / f"{slug}.{stem}.f32"
    if cache.exists():
        return np.fromfile(cache, dtype=np.float32), f"cache work/t35/audio/{slug}.{stem}.f32"
    enc_path = _encrypted_stem(slug, stem)
    key = _key()
    if enc_path is not None and key is not None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        blob = enc_path.read_bytes()
        # Same layout as scripts/pipeline/stem_cache.py unpack: 12-byte IV, 16-byte tag, ciphertext.
        flac = AESGCM(key).decrypt(blob[:12], blob[28:] + blob[12:28], None)
        audio = _decode_flac(flac)
        CACHE.mkdir(parents=True, exist_ok=True)
        audio.tofile(cache)
        return audio, f"htdemucs {stem} ({enc_path.parent.parent.parent.name})"
    plain = ROOT / "public" / "audio" / slug / "high.m4a"
    if stem == "other" and plain.exists():
        proc = subprocess.run(
            [_ffmpeg(), "-v", "error", "-i", str(plain), "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[-400:])
        audio = np.frombuffer(proc.stdout, dtype=np.float32).copy()
        return audio, f"mix {plain.name}"
    raise FileNotFoundError(
        f"{slug}: нет стема {stem}. Положите кэш work/t35/audio/{slug}.{stem}.f32 "
        f"или расшифруйте кэш ../_artifacts (AUDIO_KEY) — файл *{stem}.flac.enc."
    )


def window_features(audio: np.ndarray) -> dict[str, np.ndarray]:
    """One row per 1 s window. t is the centre, in seconds."""
    if audio.size < WIN:
        raise RuntimeError("запись короче окна анализа")
    n = 1 + (audio.size - WIN) // HOP
    rms = np.zeros(n, dtype=np.float64)
    flat = np.zeros(n, dtype=np.float64)
    pitch = np.zeros(n, dtype=np.float64)
    hann = np.hanning(WIN).astype(np.float64)
    freqs = np.fft.rfftfreq(WIN, 1 / SR)
    band = (freqs >= 200) & (freqs <= 8000)
    lag_lo = int(SR / 500)
    lag_hi = int(SR / 80)
    for i in range(n):
        frame = audio[i * HOP : i * HOP + WIN].astype(np.float64)
        r = float(np.sqrt(np.mean(frame * frame) + 1e-20))
        rms[i] = r
        spec = np.abs(np.fft.rfft(frame * hann))
        sl = np.maximum(spec[band], 1e-12)
        flat[i] = float(np.exp(np.mean(np.log(sl))) / np.mean(sl))
        ac = np.fft.irfft(spec * spec, n=WIN)
        pitch[i] = float(np.max(ac[lag_lo:lag_hi]) / (ac[0] + 1e-12))
    times = (np.arange(n) * HOP + WIN / 2) / SR
    return {"t": times, "rms": rms, "flat": flat, "pitch": pitch}


def gate(other: dict[str, np.ndarray], vocal_rms: np.ndarray) -> np.ndarray:
    return (
        (other["rms"] >= RMS_MIN)
        & (other["flat"] >= FLAT_MIN)
        & (other["pitch"] <= PITCH_MAX)
        & (vocal_rms <= VOCAL_RMS_MAX)
    )


def group_windows(mask: np.ndarray, times: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive index pairs. A hole of one hop (centres 0.5 s apart) stays one stretch."""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return []
    groups: list[tuple[int, int]] = []
    start = prev = int(idx[0])
    for raw in idx[1:]:
        i = int(raw)
        if times[i] - times[prev] <= GAP_S + 1e-9:
            prev = i
            continue
        groups.append((start, prev))
        start = prev = i
    groups.append((start, prev))
    return groups


def spans_from(mask: np.ndarray, other: dict[str, np.ndarray]) -> list[dict]:
    times = other["t"]
    found = []
    for a, b in group_windows(mask, times):
        start = round(float(times[a] - 0.5), 1)
        end = round(float(times[b] + 0.5), 1)
        if end - start < MIN_SPAN_S:
            continue
        # The hole of one hop did not pass the gate. The number is the mean of the windows that did.
        passed = mask[a : b + 1]
        flatness = float(np.mean(other["flat"][a : b + 1][passed]))
        found.append({
            "start": start,
            "end": end,
            "flatness": round(flatness, 3),
            "windows": [a, b],
        })
    return found


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def load_sections(slug: str) -> list[dict]:
    path = ROOT / "content" / "songs" / slug / "lyrics.json"
    return json.loads(path.read_text(encoding="utf-8"))["sections"]


def gold_mask(sections: list[dict], times: np.ndarray) -> np.ndarray:
    mask = np.zeros(times.shape, dtype=bool)
    for section in sections:
        if section.get("kind") != "instrumental" or section.get("label") != LABEL:
            continue
        mask |= (times >= float(section["start"])) & (times < float(section["end"]))
    return mask


def drawn_sections(sections: list[dict]) -> list[dict]:
    out = []
    for section in sections:
        if section.get("kind") != "instrumental":
            continue
        if section.get("instruments"):
            out.append(section)
    return out


def accept_span(span: dict, sections: list[dict]) -> tuple[bool, str]:
    """A stretch is kept for the validator only when it sits in an already empty label.

    A new stretch that covers a drawing is not marked here: the witnesses disagree
    until a person compares the video. The span stays in the file with accepted false.
    """
    start, end = span["start"], span["end"]
    applause = 0.0
    for section in sections:
        if section.get("kind") != "instrumental" or section.get("label") != LABEL:
            continue
        applause += _overlap(start, end, float(section["start"]), float(section["end"]))
    drawing = 0.0
    drawing_id = ""
    for section in drawn_sections(sections):
        got = _overlap(start, end, float(section["start"]), float(section["end"]))
        if got > drawing:
            drawing = got
            drawing_id = section.get("id", "")
    singing = 0.0
    singing_id = ""
    for section in sections:
        if section.get("kind") != "vocal":
            continue
        got = _overlap(start, end, float(section["start"]), float(section["end"]))
        if got > singing:
            singing = got
            singing_id = section.get("id", "")
    if applause >= MIN_SPAN_S and drawing <= EDGE_S and singing <= EDGE_S:
        return True, "уже размечено, сцена пустая"
    if drawing > EDGE_S:
        return False, f"пересекает рисунок {drawing_id} на {drawing:.1f} с, не мечу"
    if singing > EDGE_S:
        return False, f"пересекает пение {singing_id} на {singing:.1f} с, не мечу"
    return False, "нет уже размеченных аплодисментов на этом окне, не мечу"


def counts(hit: np.ndarray, gold: np.ndarray) -> tuple[float, float, float]:
    step = HOP / SR
    tp = float(np.sum(hit & gold) * step)
    fp = float(np.sum(hit & ~gold) * step)
    fn = float(np.sum(~hit & gold) * step)
    return tp, fp, fn


def rates(tp: float, fp: float, fn: float) -> tuple[float, float]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return precision, recall


def hit_mask(spans: list[dict], gate_mask: np.ndarray) -> np.ndarray:
    """Windows that passed the gate and sit in a stretch long enough to keep.

    A skipped hop inside the stretch did not pass, so it is not a hit.
    """
    mask = np.zeros(gate_mask.shape, dtype=bool)
    for span in spans:
        a, b = span["windows"]
        mask[a : b + 1] = gate_mask[a : b + 1]
    return mask


def analyse(slug: str) -> dict:
    other_audio, other_src = load_stem(slug, "other")
    vocal_audio, vocal_src = load_stem(slug, "vocals")
    n = min(other_audio.size, vocal_audio.size)
    other = window_features(other_audio[:n])
    vocal = window_features(vocal_audio[:n])
    if other["t"].shape != vocal["t"].shape:
        m = min(other["t"].size, vocal["t"].size)
        for key in other:
            other[key] = other[key][:m]
        vocal["rms"] = vocal["rms"][:m]
    passed = gate(other, vocal["rms"])
    spans = spans_from(passed, other)
    sections = load_sections(slug)
    gold = gold_mask(sections, other["t"])
    published = []
    for span in spans:
        ok, reason = accept_span(span, sections)
        published.append({
            "start": span["start"],
            "end": span["end"],
            "flatness": span["flatness"],
            "accepted": ok,
            "reason": reason,
        })
    kept = hit_mask(spans, passed)
    tp, fp, fn = counts(kept, gold)
    precision, recall = rates(tp, fp, fn)
    return {
        "slug": slug,
        "source": other_src,
        "vocalSource": vocal_src,
        "recording": _recording_id(slug),
        "thresholds": {
            "flatnessMin": FLAT_MIN,
            "pitchMax": PITCH_MAX,
            "rmsMin": RMS_MIN,
            "vocalRmsMax": VOCAL_RMS_MAX,
            "minSpanS": MIN_SPAN_S,
            "gapS": GAP_S,
        },
        "seconds": {"tp": round(tp, 2), "fp": round(fp, 2), "fn": round(fn, 2)},
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "spans": published,
        "gold": [
            {"id": s["id"], "start": s["start"], "end": s["end"]}
            for s in sections
            if s.get("kind") == "instrumental" and s.get("label") == LABEL
        ],
    }


def write_song(result: dict) -> Path:
    path = ROOT / "docs" / "analysis" / result["slug"] / "applause.json"
    body = {
        "source": result["source"],
        "vocalSource": result["vocalSource"],
        "recording": result["recording"],
        "thresholds": result["thresholds"],
        "precision": result["precision"],
        "recall": result["recall"],
        "seconds": result["seconds"],
        "spans": result["spans"],
    }
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _print_song(result: dict) -> None:
    print(f"\n## {result['slug']}")
    print(f"источник: {result['source']}")
    print(f"вокал: {result['vocalSource']}")
    print(
        f"пороги: плоскостность ≥ {FLAT_MIN}, высота ≤ {PITCH_MAX}, "
        f"энергия other ≥ {RMS_MIN}, энергия вокала ≤ {VOCAL_RMS_MAX}"
    )
    print(
        f"precision {result['precision']:.3f}  recall {result['recall']:.3f}  "
        f"tp {result['seconds']['tp']} с  fp {result['seconds']['fp']} с  fn {result['seconds']['fn']} с"
    )
    if not result["spans"]:
        print("участков нет")
    for span in result["spans"]:
        mark = "принят" if span["accepted"] else "не принят"
        print(
            f"  {span['start']:.1f}–{span['end']:.1f}  плоскостность {span['flatness']:.3f}  "
            f"{mark}: {span['reason']}"
        )
    print("уже размечено:", ", ".join(f"{g['id']} {g['start']}–{g['end']}" for g in result["gold"]) or "нет")


def run(slugs: list[str], write: bool) -> list[dict]:
    results = []
    for slug in slugs:
        result = analyse(slug)
        if write:
            path = write_song(result)
            result["wrote"] = str(path.relative_to(ROOT)).replace("\\", "/")
        results.append(result)
        _print_song(result)
    tp = sum(r["seconds"]["tp"] for r in results)
    fp = sum(r["seconds"]["fp"] for r in results)
    fn = sum(r["seconds"]["fn"] for r in results)
    precision, recall = rates(tp, fp, fn)
    print(f"\nвместе: precision {precision:.3f}  recall {recall:.3f}  tp {tp:.2f} с  fp {fp:.2f} с  fn {fn:.2f} с")
    return results


def _median(parts: list[np.ndarray]) -> tuple[float, int]:
    cat = np.concatenate(parts) if parts else np.array([])
    if cat.size == 0:
        return float("nan"), 0
    return float(np.median(cat)), int(cat.size)


def calibrate(slugs: list[str]) -> None:
    """Reprint the measurement. Does not change the written-down thresholds."""
    per = {}
    for slug in slugs:
        other, _ = load_stem(slug, "other")
        vocal, _ = load_stem(slug, "vocals")
        n = min(other.size, vocal.size)
        o = window_features(other[:n])
        v = window_features(vocal[:n])
        sections = load_sections(slug)
        g = gold_mask(sections, o["t"])
        neg = np.zeros(o["t"].shape, dtype=bool)
        for section in sections:
            a, b = float(section["start"]), float(section["end"])
            inside = (o["t"] >= a) & (o["t"] < b)
            if section.get("kind") == "vocal":
                for line in section.get("lines") or []:
                    words = line.get("words") or []
                    if not words:
                        continue
                    neg |= (o["t"] >= float(words[0]["s"])) & (o["t"] < float(words[-1]["e"]))
            elif section.get("instruments") and section.get("label") != LABEL:
                neg |= inside
        neg &= ~g
        per[slug] = (o, v["rms"], g, neg)
    # 10th percentile of other-stem RMS on sung lines only (not every non-applause window).
    sung_only = []
    for slug in slugs:
        o, _vocal, _g, _neg = per[slug]
        sections = load_sections(slug)
        sung = np.zeros(o["t"].shape, dtype=bool)
        for section in sections:
            if section.get("kind") != "vocal":
                continue
            for line in section.get("lines") or []:
                words = line.get("words") or []
                if not words:
                    continue
                sung |= (o["t"] >= float(words[0]["s"])) & (o["t"] < float(words[-1]["e"]))
        sung_only.append(o["rms"][sung])
    floor = float(np.quantile(np.concatenate(sung_only), 0.10))
    flat_g, flat_n, pitch_g, pitch_n, voc_g, voc_s = [], [], [], [], [], []
    for slug in slugs:
        o, vocal_rms, g, neg = per[slug]
        audible = o["rms"] >= floor
        flat_g.append(o["flat"][g & audible])
        flat_n.append(o["flat"][neg & audible])
        pitch_g.append(o["pitch"][g & audible])
        pitch_n.append(o["pitch"][neg & audible])
        voc_g.append(vocal_rms[g])
        sung = np.zeros(o["t"].shape, dtype=bool)
        for section in load_sections(slug):
            if section.get("kind") != "vocal":
                continue
            for line in section.get("lines") or []:
                words = line.get("words") or []
                if words:
                    sung |= (o["t"] >= float(words[0]["s"])) & (o["t"] < float(words[-1]["e"]))
        voc_s.append(vocal_rms[sung])
    fg, ng = _median(flat_g), _median(flat_n)
    pg, pn = _median(pitch_g), _median(pitch_n)
    vg, vs = _median(voc_g), _median(voc_s)
    print(f"энергия, 10-й перцентиль other на спетых строках: {floor:.4f} (записано {RMS_MIN})")
    print(f"плоскостность, медианы {fg[0]:.4f} (n={fg[1]}) и {ng[0]:.4f} (n={ng[1]}), середина {(fg[0] + ng[0]) / 2:.4f} (записано {FLAT_MIN})")
    print(f"высота, медианы {pg[0]:.4f} и {pn[0]:.4f}, середина {(pg[0] + pn[0]) / 2:.4f} (записано {PITCH_MAX})")
    print(f"вокал, медианы {vg[0]:.4f} и {vs[0]:.4f}, середина {(vg[0] + vs[0]) / 2:.4f} (записано {VOCAL_RMS_MAX})")


def selftest() -> None:
    rng = np.random.default_rng(1)
    noise = rng.normal(0, 0.05, SR * 4).astype(np.float32)
    t = np.arange(SR * 4) / SR
    tone = (0.05 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    silence = np.zeros(SR * 4, dtype=np.float32)
    n = window_features(noise)
    s = window_features(tone)
    z = window_features(silence)
    mid = n["t"].size // 2
    if not (n["flat"][mid] > s["flat"][mid] and s["pitch"][mid] > n["pitch"][mid]):
        raise SystemExit(
            f"шум и тон не разошлись: шум плоскостность {n['flat'][mid]:.3f} высота {n['pitch'][mid]:.3f}, "
            f"тон плоскостность {s['flat'][mid]:.3f} высота {s['pitch'][mid]:.3f}"
        )
    if not (n["flat"][mid] >= FLAT_MIN and n["pitch"][mid] <= PITCH_MAX and n["rms"][mid] >= RMS_MIN):
        raise SystemExit("широкополосный шум не проходит записанные пороги")
    if s["pitch"][mid] <= PITCH_MAX and s["flat"][mid] >= FLAT_MIN:
        raise SystemExit("тон 220 Гц прошёл порог шума без высоты")
    if z["rms"][mid] >= RMS_MIN:
        raise SystemExit("тишина прошла порог энергии")
    # One skipped window (index 8) stays in the stretch. Two skipped windows split it.
    # A blip shorter than 2 s is dropped.
    times = np.arange(0, 8, 0.25)
    mask = np.zeros(times.shape, dtype=bool)
    mask[4:8] = True
    mask[9:14] = True
    mask[20:22] = True
    groups = group_windows(mask, times)
    if groups != [(4, 13), (20, 21)]:
        raise SystemExit(f"склейка окон: {groups}")
    split = np.zeros(times.shape, dtype=bool)
    split[0:4] = True
    split[7:11] = True
    if group_windows(split, times) != [(0, 3), (7, 10)]:
        raise SystemExit(f"два пропущенных окна не разорвали участок: {group_windows(split, times)}")
    other = {"t": times, "flat": np.full(times.shape, 0.7), "rms": np.full(times.shape, 0.05), "pitch": np.full(times.shape, 0.1)}
    spans = spans_from(mask, other)
    if len(spans) != 1 or spans[0]["end"] - spans[0]["start"] < MIN_SPAN_S:
        raise SystemExit(f"короткий выброс не отброшен: {spans}")
    hit = np.array([False, True, True, False])
    gold = np.array([False, True, False, True])
    tp, fp, fn = counts(hit, gold)
    precision, recall = rates(tp, fp, fn)
    if abs(precision - 0.5) > 1e-9 or abs(recall - 0.5) > 1e-9:
        raise SystemExit(f"precision/recall: {precision} {recall}")
    print("applause selftest ok")


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        selftest()
        return
    write = "--no-write" not in args
    if "--calibrate" in args:
        calibrate(list(SONGS))
        return
    slugs = [a for a in args if not a.startswith("--")]
    run(slugs or list(SONGS), write)


if __name__ == "__main__":
    main()
