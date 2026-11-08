Task: fix two regressions on the studio branch that you listed last run, then retake the shots. Three other Grok runs share this PC: no `npm run gate` and no `frames.mjs` now. Add no features. Push to `site/studio-pass-r22` required; no force-push.

1. Emphasized word: `em: true` on a word and `**…**` in a translation show colour on `origin/main`, on this branch the whole line is one colour (`player-*`, `scene-line-*`). Restore it, in the studio's own visual language. If `docs/design/studio-pass.md` records removing it as a decision, don't restore: quote the place in the report.
2. Phone instrumental scene: the comment runs through the musician labels (`scene-inst-phone-*`). Text and labels must not overlap. Find why and fix the layout; check the other three songs' instrumental sections on the phone too, and add this case to `npm run test:layout` if it fits there.

Then: `npm run validate`, `npm run typecheck`, `npm run test:layout`, `node scripts/perf/stage-geometry.mjs` (tolerances unchanged). Retake all `work/owner-check/new/` shots by `work/owner-check/INDEX.md`, open them, update INDEX. Merge `origin/main` first if it moved. Commit and push.

Done when: both checks above shown in new shots by file name; listed commands pass, numbers in report; pushed, `git rev-list --count HEAD..origin/main` is 0. Stop at 10M tokens without a passed item and report.
