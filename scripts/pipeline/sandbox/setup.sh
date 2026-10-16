#!/usr/bin/env bash
# One-time setup of a Vercel Sandbox (python3.13 image) for the analysis pipeline.
# Installs a static ffmpeg, CPU-only PyTorch and the pipeline's Python packages.
set -euo pipefail
cd /vercel/sandbox
if [ ! -x "$HOME/bin/ffmpeg" ]; then
  mkdir -p "$HOME/bin" /tmp/ff && cd /tmp/ff
  curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ff.tar.xz
  # The image has no xz binary; Python's tarfile reads .tar.xz on its own.
  python3 -c "import tarfile; tarfile.open('ff.tar.xz').extractall('.')"
  cp ./*/ffmpeg ./*/ffprobe "$HOME/bin/" && cd /vercel/sandbox
fi
export PATH="$HOME/bin:$PATH"
python3 -m pip install -q --upgrade pip
python3 -m pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu
python3 -m pip install -q demucs faster-whisper uroman soundfile numpy cryptography pillow
[ -d living-lyrics ] || git clone -q --depth 1 https://github.com/SharipovAkhror/living-lyrics
echo "setup ok: $(ffmpeg -version | head -1)"
