#!/usr/bin/env bash
# Run audio pipeline stages for one song. Works the same on a GitHub Actions runner
# (.github/workflows/pipeline.yml), a Vercel Sandbox (after setup.sh) or any machine with ffmpeg
# and scripts/pipeline/requirements.txt.
#
#   bash scripts/pipeline/sandbox/run.sh <slug> <stage…>
#
# Stages (run in this order whatever order you give them):
#   decrypt     content/audio-enc/<slug>/high.m4a.enc → work/<slug>/source.m4a   (needs AUDIO_KEY)
#   separate    Demucs htdemucs, four stems → work/<slug>/stems/{vocals,drums,bass,other}.wav
#   sections    voice / instrument map → work/<slug>/sections.suggested.json
#               also runs before align or qa, and is copied to docs/analysis/<slug>/
#   transcribe  Whisper draft → work/<slug>/transcript.json
#               also runs before align or qa, and is copied to docs/analysis/<slug>/
#   diagnose    read-only locator table → docs/analysis/<slug>/locate.md (does not write lyrics)
#   bench       compare aligners and vocal stems against cues.json → docs/analysis/bench/
#               (does not write lyrics). Heavy; run it on its own, not beside align.
#   calibrate   score rows for the cue threshold → work/<slug>/score-rows.json
#               (does not write lyrics). The workflow runs this for every align job
#               before align, then calibrate_score.py --choose.
#   align       word times into lyrics.json (align.py), report → work/<slug>/align-report.json
#   qa          sync check (qa_sync.py) → work/<slug>/qa-sync.md, copied to docs/analysis/<slug>-qa.md
#   features    animation envelopes → public/audio/<slug>/features.json (features.py)
#   instruments who plays when → docs/analysis/<slug>-instruments.json and .md (instruments.py)
# Stages that need stems decrypt and separate first when a stem is missing.
# features and instruments need all four htdemucs stems. They do not edit lyrics.json.
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
  case "$s" in decrypt|separate|sections|transcribe|diagnose|bench|calibrate|align|qa|features|instruments) ;; *) echo "неизвестная стадия: $s"; exit 2 ;; esac
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
  local want="${SEPARATOR_MODEL:-htdemucs}" have="" stem complete=1
  [ -f "$w/stems/model.txt" ] && have="$(cat "$w/stems/model.txt")"
  case "$want" in
    *.ckpt|*.onnx|*.pth|*.yaml) complete=0; [ -f "$w/stems/vocals.wav" ] && complete=1 ;;
    *) for stem in vocals drums bass other; do [ -f "$w/stems/$stem.wav" ] || complete=0; done ;;
  esac
  if [ "$complete" = 1 ] && [ -z "${FORCE:-}" ] && { [ -z "$have" ] || [ "$have" = "$want" ]; }; then
    echo "стемы уже есть (${have:-модель не записана})"; return 0
  fi
  decrypt || return $?
  step separate python3 separate.py "$slug" --model "$want"
}
need_stem() { [ -f "$w/stems/vocals.wav" ] || separate; }

if has decrypt; then decrypt || fail decrypt; fi
if has separate; then separate || fail separate; fi
publish() {  # publish <src> <name>: copy a small analysis file, never work/ itself
  if [ -f "$1" ]; then
    mkdir -p "$root/docs/analysis/$slug"
    cp "$1" "$root/docs/analysis/$slug/$2"
    echo "→ docs/analysis/$slug/$2"
  fi
}
# A timing run publishes the voice map and the transcript. A later agent reads them from
# docs/analysis and cannot see work/. Naming the stage still runs it on its own.
# PIPELINE_SKIP_PREP=1: qa is running after align already published both files.
if [ -z "${PIPELINE_SKIP_PREP:-}" ] && { has sections || has align || has qa; } && [ $status -lt 2 ]; then
  if need_stem && step sections python3 sections.py "$slug" --gap 3; then
    publish "$w/sections.suggested.json" sections.suggested.json
  else
    fail sections
  fi
fi
if [ -z "${PIPELINE_SKIP_PREP:-}" ] && { has transcribe || has align || has qa; } && [ $status -lt 2 ]; then
  if need_stem && step transcribe python3 transcribe.py "$slug" --model "${WHISPER_MODEL:-large-v3-turbo}"; then
    publish "$w/transcript.json" transcript.json
  else
    fail transcribe
  fi
fi
if has diagnose && [ $status -lt 2 ]; then
  { need_stem && step diagnose python3 diagnose_locate.py "$slug"; } || fail diagnose
fi
# The bench measures line starts against cues.json. It separates the three songs itself
# and does not write lyrics. One job is enough: models load once inside the script.
# Unpack every song's four-stem cache first so Demucs is not repeated.
if has bench && [ $status -lt 2 ]; then
  for s in i-have-come-alive karitas one; do
    python3 stem_cache.py unpack "$s" "$root/work/stem-cache" || true
  done
  { step bench python3 bench_align.py i-have-come-alive karitas one --stems i-have-come-alive; } || fail bench
  for s in i-have-come-alive karitas one; do
    python3 stem_cache.py pack "$s" "$root/work/stem-cache" || true
  done
fi
if has calibrate && [ $status -lt 2 ]; then
  # Scores only. sections and transcribe stay with align: this pass must not fit a threshold
  # on the first song before the others have been measured.
  { need_stem && step calibrate python3 calibrate_score.py "$slug" --collect; } || fail calibrate
fi
aligned=""
if has align && [ $status -lt 2 ]; then
  cp "$root/content/songs/$slug/lyrics.json" "$w/lyrics.before.json"
  # shellcheck disable=SC2086
  if need_stem && step align python3 align.py "$slug" ${ALIGN_ARGS:-}; then aligned=1; else fail align; fi
fi
if has qa && [ $status -lt 2 ]; then
  baseline=()
  # Align writes lyrics.before.json. A later qa-only pass still compares against it.
  if [ -n "$aligned" ] || [ -f "$w/lyrics.before.json" ]; then
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
# Sound features for the scene. Independent of alignment: a sync miss (code 1) still leaves
# envelopes and an instrument proposal. Neither script writes lyrics.json.
# The stem cache restores the four wavs without the mix, so decrypt even when separate is a no-op.
if has features && [ $status -lt 2 ]; then
  { decrypt && separate && step features python3 features.py "$slug"; } || fail features
fi
if has instruments && [ $status -lt 2 ]; then
  { decrypt && separate && step instruments python3 instruments.py "$slug"; } || fail instruments
fi
echo "=== итог $slug: код $status (0 — всё в такт, 1 — есть строки не в такт, 2 — стадия упала)" | tee -a "$log"
exit $status
