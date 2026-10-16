"""Runs onboarding pipeline steps for one request file on a CI runner (GitHub Actions).

    python3 scripts/pipeline/ci_run.py ci/requests/<slug>.json

Request file:
    {
      "slug": "karitas",
      "url": "https://www.youtube.com/watch?v=…",      # or a direct audio URL
      "steps": ["fetch", "process", "separate", "sections", "frames", "transcribe", "align"],
      "commitAudio": "if-private"                       # "never" | "if-private"
    }

Outputs (committed by the workflow):
    content/songs/<slug>/pipeline/   info.json, provenance.json, sections.suggested.json,
                                     transcript.json, align-report.txt, log.txt, frames/ (private repos only)
    public/audio/<slug>/             peaks.json always; high.m4a, saver.m4a only when audio may be committed
    content/songs/<slug>/song.json   duration, audio block, timing (after align)
    content/songs/<slug>/lyrics.json word times (after align)

Copyrighted audio and video frames are never written to a public repository.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, audio_dir, load_json, save_json, song_dir, work_dir  # noqa: E402

LOG: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)
    LOG.append(msg)


def repo_is_private() -> bool:
    event = os.environ.get('GITHUB_EVENT_PATH')
    if event and Path(event).exists():
        data = json.loads(Path(event).read_text())
        repo = data.get('repository') or {}
        if 'private' in repo:
            return bool(repo['private'])
    return os.environ.get('REPO_PRIVATE', 'false') == 'true'


def sh(cmd: list[str]) -> None:
    log('$ ' + ' '.join(cmd))
    subprocess.run(cmd, check=True)


def main(req_path: str) -> int:
    req = json.loads(Path(req_path).read_text())
    slug = req['slug']
    steps = req.get('steps', [])
    allow_audio = req.get('commitAudio', 'if-private') == 'if-private' and repo_is_private()
    out = song_dir(slug) / 'pipeline'
    out.mkdir(parents=True, exist_ok=True)
    log(f'slug={slug} steps={steps} private={repo_is_private()} commitAudio={allow_audio}')
    failed = False

    def step(name, fn):
        nonlocal failed
        if name not in steps:
            return
        log(f'--- {name}')
        try:
            fn()
            log(f'ok {name}')
        except Exception:  # keep going: later steps may still be useful
            failed = True
            log(f'FAILED {name}\n{traceback.format_exc()[-3000:]}')

    def fetch():
        if any(work_dir(slug).glob('source.*')):
            log('source restored from cache')
        else:
            sh(['bash', str(ROOT / 'scripts/pipeline/fetch_audio.sh'), slug, req['url']])
        for name in ('provenance.json',):
            p = work_dir(slug) / name
            if p.exists():
                shutil.copy(p, out / name)
        info = work_dir(slug) / 'info.info.json'
        if info.exists():
            d = json.loads(info.read_text())
            keep = {k: d.get(k) for k in ('id', 'title', 'channel', 'channel_id', 'uploader', 'upload_date', 'duration', 'description', 'webpage_url', 'chapters', 'tags')}
            save_json(out / 'info.json', keep)

    def process():
        import process_audio

        song_path = song_dir(slug) / 'song.json'
        before = load_json(song_path)
        process_audio.main(slug)
        song = load_json(song_path)
        if not allow_audio:
            # Keep derived data (duration, loudness, peaks); do not publish the recording itself.
            for f in ('high.m4a', 'saver.m4a'):
                (audio_dir(slug) / f).unlink(missing_ok=True)
            song['audio'] = {
                'status': before['audio'].get('status', 'missing'),
                'peaks': f'/audio/{slug}/peaks.json',
                'gainDb': song['audio'].get('gainDb'),
                'provenance': song['audio'].get('provenance'),
            }
            song['audio'] = {k: v for k, v in song['audio'].items() if v is not None}
            save_json(song_path, song)
            log('audio files not committed (public repository); duration, loudness and peaks kept')

    def separate():
        if (work_dir(slug) / 'stems' / 'vocals.wav').exists():
            log('stems restored from cache')
            return
        import separate as sep

        sep.main(slug)

    def sections():
        import sections as secs

        secs.main(slug)
        shutil.copy(work_dir(slug) / 'sections.suggested.json', out / 'sections.suggested.json')

    def frames():
        if not allow_audio:
            log('frames skipped (public repository)')
            return
        import frames as fr

        fr.main(slug, every=8.0)
        dst = out / 'frames'
        dst.mkdir(exist_ok=True)
        for f in sorted((work_dir(slug) / 'frames').glob('*.jpg')):
            # Downscale to keep the repository small.
            subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(f), '-vf', 'scale=480:-2', '-q:v', '5', str(dst / f.name)], check=True)

    def transcribe():
        import transcribe as tr

        tr.main(slug, req.get('whisperModel', 'large-v3'))
        shutil.copy(work_dir(slug) / 'transcript.json', out / 'transcript.json')

    def align():
        import align as al
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            al.main(slug, req.get('section'), False)
        (out / 'align-report.txt').write_text(buf.getvalue(), encoding='utf-8')
        print(buf.getvalue())

    step('fetch', fetch)
    step('process', process)
    step('separate', separate)
    step('sections', sections)
    step('frames', frames)
    step('transcribe', transcribe)
    step('align', align)

    (out / 'log.txt').write_text('\n'.join(LOG) + '\n', encoding='utf-8')
    return 1 if failed else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sys.exit(main(sys.argv[1]))
