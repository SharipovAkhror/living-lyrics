#!/usr/bin/env bash
# Fetch the best available audio (and a small video for instrument frames) into work/<slug>/.
# Usage: scripts/pipeline/fetch_audio.sh <slug> <url | /path/to/file>
set -euo pipefail
slug="${1:?slug}"
src="${2:?url or file}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$root/work/$slug"
mkdir -p "$work"

if [[ -f "$src" ]]; then
  ext="${src##*.}"
  cp "$src" "$work/source.$ext"
  kind="file"
else
  # Best audio-only stream as delivered (no re-encode): usually Opus 251 or AAC 140 on YouTube.
  yt-dlp --no-playlist -f "bestaudio" -o "$work/source.%(ext)s" "$src"
  # Small video for looking at the musicians during instrumental parts (optional).
  yt-dlp --no-playlist -f "bv*[height<=360][ext=mp4]/bv*[height<=360]" -o "$work/video.%(ext)s" "$src" || true
  yt-dlp --no-playlist --skip-download --write-info-json -o "$work/info" "$src" || true
  kind="url"
fi

file="$(ls "$work"/source.* | head -1)"
codec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,bit_rate -of csv=p=0 "$file" | tr ',' ' ')"
sum="$(sha256sum "$file" | cut -d' ' -f1)"
cat > "$work/provenance.json" <<JSON
{ "kind": "$kind", "ref": "$src", "retrieved": "$(date +%F)", "codec": "$codec", "sha256": "$sum" }
JSON
echo "source: $file"
echo "codec:  $codec"
