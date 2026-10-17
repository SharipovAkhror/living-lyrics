"""Drop-in shape for a later change beside scripts/pipeline/instruments.py.

This file does not import or edit that module. The recognizer is called on a
file path and returns segments. Credits, vision and the song text are not inputs.
"""

from __future__ import annotations

from pathlib import Path

from predict import recognize_file


def recognize(audio_path: str | Path, stem: str = "mix") -> dict:
    """Recognize one audio file.

    stem is mix, vocals, drums, bass or other. On drums, vocals, bass and other,
    a class outside that stem's list is dropped rather than renamed.

    Return value:
    {
      "audio": path,
      "stem": "mix",
      "model": "efficientat-mn10_as-linear-probe",
      "noncommercial": true,
      "windows": 120,
      "segments": [
        {"start": 10.0, "end": 16.0, "id": "violin", "name": "скрипка",
         "family": "bowed", "kind": "instrument", "confidence": 0.93,
         "accepted": true, "catalogKey": "violin"}
      ]
    }

    kind "family" has id null and accepted false: the probe refused the
    instrument and named only the family. A class with no training examples
    is never returned as an instrument.
    """
    return recognize_file(Path(audio_path), stem)
