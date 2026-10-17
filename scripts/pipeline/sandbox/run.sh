#!/usr/bin/env bash
# Run audio pipeline stages for one song. Works the same on a GitHub Actions runner
# (.github/workflows/pipeline.yml), a Vercel Sandbox (after setup.sh) or any machine with ffmpeg
# and scripts/pipeline/requirements.txt.
#
#   bash scripts/pipeline/sandbox/run.sh <slug> <stage…>
#
# Stages (run in this order whatever order you give them):
#   decrypt     content/audio-enc/<slug>/high.m4a.enc → work/<slug>/source.m4a   (needs AUDIO_KEY)
#   separate    Demucs vocal stem → work/<slug>/stems/vocals.wav
#   sections    voice / instrument map → work/<slug>/sections.suggested.json
#   transcribe  Whisper draft → work/<slug>/transcript.json
#   align       word times into lyrics.json (align.py), report → work/<slug>/align-report.json
#   qa          sync check (qa_sync.py) → work/<slug>/qa-sync.md, copied to docs/analysis/<slug>-qa.md
# Stages that need the vocal stem decrypt and separate first when it is missing.
#
# Environment: AUDIO_KEY, ALIGN_ARGS / QA_ARGS (extra options), WHISPER_MODEL (large-v3-turbo),
# SEPARATOR_MODEL (htdemucs | htdemucs_ft | an audio-separator model file, see separate.py),
# FORCE=1 (separate again even if a stem exists).
# Exit code: 0 — done, the check passed; 1 — done, qa found lines off; 2 — a stage failed.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export PATH="$HOME/bin:$PATH"
slug="${1:-}"
shift || true
if [ -z "$slug" ] || [ $# -eq 0 ]; then
  sed -n '2,20p' "$0"
  exit 2
fi
for s in "$@"; do
  case "$s" in decrypt|separate|sections|transcribe|align|qa) ;; *) echo "неизвестная стадия: $s"; exit 2 ;; esac
done
want=" $* "
has() { [[ "$want" == *" $1 "* ]]; }

w="$root/work/$slug"
mkdir -p "$w"
log="$w/run.log"
: > "$log"
status=0
cd "$root/scripts/pipeline"
echo "python $(python3 --version 2>&1), ядер $(nproc 2>/dev/null || echo '?'), память $(free -g 2>/dev/null | awk '/Mem/{print $2}' || echo '?') ГБ" | tee -a "$log"

step() {  # step <name> <command…>: run, log, keep the exit code
  local name="$1"; shift
  local t0; t0=$(date +%s)
  echo "=== $name: $*" | tee -a "$log"
  "$@" 2>&1 | tee -a "$log"
  local rc=${PIPESTATUS[0]}
  echo "--- $name: код $rc, $(( $(date +%s) - t0 )) с" | tee -a "$log"
  return "$rc"
}
fail() { echo "!!! стадия $1 не удалась" | tee -a "$log"; status=2; }

have_source() { compgen -G "$w/source.*" > /dev/null; }
decrypt() {
  if have_source; then echo "запись уже расшифрована: $(ls "$w"/source.*)"; return 0; fi
  if [ -z "${AUDIO_KEY:-}" ]; then echo "нет AUDIO_KEY: запись не расшифровать"; return 2; fi
  step decrypt python3 decrypt_audio.py "$slug"
}
separate() {
  local want="${SEPARATOR_MODEL:-htdemucs}" have=""
  [ -f "$w/stems/model.txt" ] && have="$(cat "$w/stems/model.txt")"
  if [ -f "$w/stems/vocals.wav" ] && [ -z "${FORCE:-}" ] && { [ -z "$have" ] || [ "$have" = "$want" ]; }; then
    echo "вокальный стем уже есть (${have:-модель не записана})"; return 0
  fi
  decrypt || return $?
  step separate python3 separate.py "$slug" --model "$want"
}
need_stem() { [ -f "$w/stems/vocals.wav" ] || separate; }

if has decrypt; then decrypt || fail decrypt; fi
if has separate; then separate || fail separate; fi
if has sections && [ $status -lt 2 ]; then
  { need_stem && step sections python3 sections.py "$slug" --gap 3; } || fail sections
fi
if has transcribe && [ $status -lt 2 ]; then
  { need_stem && step transcribe python3 transcribe.py "$slug" --model "${WHISPER_MODEL:-large-v3-turbo}"; } || fail transcribe
fi
aligned=""
if has align && [ $status -lt 2 ]; then
  cp "$root/content/songs/$slug/lyrics.json" "$w/lyrics.before.json"
  # shellcheck disable=SC2086
  if need_stem && step align python3 align.py "$slug" ${ALIGN_ARGS:-}; then aligned=1; else fail align; fi
fi
if has qa && [ $status -lt 2 ]; then
  baseline=()
  if [ -n "$aligned" ]; then
    step qa-before python3 qa_sync.py "$slug" --lyrics "$w/lyrics.before.json" --tag before
    [ -f "$w/qa-sync-before.json" ] && baseline=(--baseline "$w/qa-sync-before.json")
  fi
  # shellcheck disable=SC2086
  if need_stem; then
    # --apply writes timing-draft and song.json timing. QA_ARGS must not repeat --apply.
    apply=()
    case " ${QA_ARGS:-} " in
      *" --apply "*) ;;
      *) apply=(--apply) ;;
    esac
    step qa python3 qa_sync.py "$slug" "${baseline[@]}" "${apply[@]}" ${QA_ARGS:-}
    rc=$?
    if [ $rc -eq 1 ]; then status=$(( status > 1 ? status : 1 )); elif [ $rc -ne 0 ]; then fail qa; fi
    if [ -f "$w/qa-sync.md" ]; then
      mkdir -p "$root/docs/analysis"
      cp "$w/qa-sync.md" "$root/docs/analysis/$slug-qa.md"
    fi
  else
    fail qa
  fi
fi
echo "=== итог $slug: код $status (0 — всё в такт, 1 — есть строки не в такт, 2 — стадия упала)" | tee -a "$log"
exit $status
