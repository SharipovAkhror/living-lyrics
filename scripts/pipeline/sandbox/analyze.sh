#!/usr/bin/env bash
# Stage 3–4 on a Vercel Sandbox: decrypt → Demucs vocals → sections → Whisper transcript.
# Usage: AUDIO_KEY=… bash scripts/pipeline/sandbox/analyze.sh <slug> [whisper-model]
# Results: work/<slug>/{stems/vocals.wav, sections.suggested.json, transcript.json}
set -euo pipefail
slug="$1"; model="${2:-large-v3-turbo}"
export PATH="$HOME/bin:$PATH"
cd /vercel/sandbox/living-lyrics/scripts/pipeline
python3 decrypt_audio.py "$slug"
python3 separate.py "$slug"
python3 sections.py "$slug" --gap 3
python3 transcribe.py "$slug" --model "$model"
echo "analyze ok: $slug"
