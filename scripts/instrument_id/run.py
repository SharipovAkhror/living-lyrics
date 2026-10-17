"""One entry point for the instrument recognizer.

Training, from a machine with the venv:

    work/instrument_id/venv/Scripts/python scripts/instrument_id/run.py all

Eyes are separate and local: `watch` and `vision-selftest`. They are not part of `all`,
so a repeated training run does not spend the Antigravity quota.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Своё распознавание инструментов")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download")
    sub.add_parser("prepare")
    sub.add_parser("embed")
    sub.add_parser("train")
    sub.add_parser("eval")
    songs_cmd = sub.add_parser("songs")
    songs_cmd.add_argument("--primary", default="mix", choices=("mix", "stem"))
    watch = sub.add_parser("watch")
    watch.add_argument("slug")
    watch.add_argument("--backend", default="agy", choices=("agy", "gemini-api"))
    fuse = sub.add_parser("fuse")
    fuse.add_argument("slug")
    sub.add_parser("openset")
    sub.add_parser("anchors")
    sub.add_parser("stems")
    sub.add_parser("loso")
    sub.add_parser("report")
    sub.add_parser("selftest")
    eyes = sub.add_parser("vision-selftest")
    eyes.add_argument("--backend", default="agy", choices=("agy", "gemini-api"))
    sub.add_parser("all")
    args = parser.parse_args(argv)

    if args.cmd == "download":
        from dataset import download
        download()
    elif args.cmd == "prepare":
        from dataset import prepare
        prepare()
    elif args.cmd == "embed":
        from embed import embed
        embed()
    elif args.cmd == "train":
        from train import train
        train()
    elif args.cmd == "eval":
        from evaluate import evaluate
        from report import write_report
        evaluate()
        write_report()
    elif args.cmd == "songs":
        from predict import predict_songs
        from fuse import write_fusion
        from report import write_report
        missing = predict_songs(args.primary)
        for slug in ("i-have-come-alive", "karitas", "one"):
            if slug not in missing:
                write_fusion(slug)
        if args.primary == "stem" and not missing:
            from stems import mark_published
            mark_published("stem")
        elif args.primary == "stem" and missing:
            print("stem publish incomplete:", ", ".join(missing))
        from anchors import write_anchors
        write_anchors()
        write_report()
    elif args.cmd == "watch":
        from watch import watch_slug
        from fuse import write_fusion
        if watch_slug(args.slug, backend=args.backend):
            write_fusion(args.slug)
    elif args.cmd == "fuse":
        from fuse import write_fusion
        write_fusion(args.slug)
    elif args.cmd == "openset":
        from openset import evaluate
        evaluate()
    elif args.cmd == "anchors":
        from anchors import write_anchors
        write_anchors()
    elif args.cmd == "stems":
        from stems import compare
        compare()
    elif args.cmd == "loso":
        from loso import evaluate
        evaluate()
    elif args.cmd == "report":
        from report import write_report
        write_report()
    elif args.cmd == "selftest":
        from selftest import main as selftest_main
        selftest_main()
    elif args.cmd == "vision-selftest":
        from watch import vision_selftest
        from report import write_report
        vision_selftest(backend=args.backend)
        write_report()
    elif args.cmd == "all":
        from dataset import download, prepare
        from embed import embed
        from train import train
        from evaluate import evaluate
        from report import write_report
        from selftest import main as selftest_main
        from taxonomy import write_doc
        download()
        prepare()
        embed()
        train()
        evaluate()
        write_doc()
        selftest_main()
        write_report()
    else:
        raise SystemExit(args.cmd)


if __name__ == "__main__":
    main()
