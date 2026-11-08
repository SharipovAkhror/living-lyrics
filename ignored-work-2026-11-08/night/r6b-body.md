Task: round 6 follow-up on `site/bench-r6`, two parts. Read `docs/analysis/bench/round-6.md` first. No new alignment, no threshold changed, no song data written. Push required, no force-push. `ffmpeg` isn't on PATH here.

Part 1, one small change: in `.github/workflows/pipeline.yml`, upload `qa-sync.json` as an artifact even when the file gate refuses (`if: always()` or equivalent), with the same 90-day retention. Losing it cost the en/fa/tr split of Alive. Add a check to `test_sync.py` if the existing workflow checks cover this kind of thing.

Part 2, one diagnosis. It decides whether the 152 baseline lines are reproducible. The gate refused 97 of 152 in run https://github.com/SharipovAkhror/living-lyrics/actions/runs/41159206022. Use that run's artifacts (and 41145970412's, local copy `../_artifacts/run-41145970412/`) and compare each of the 97 refused lines with the times already committed in `lyrics.json`. Answer: is the new alignment close to the published times with the gate refusing anyway, or did the times really move?
- Numbers: distribution of start and end differences in ms over the 97 (median, p90, max, per song), and the same for the 55 lines that held, as a control.
- Which witness dropped per line, counted (which check in `qa_sync.py` / `attack_chance.py` said no).
- Was the separated stem itself different from before, if that can be told from what's there?
- Recover the Alive en/fa/tr split of the 37 if you can.
If `qa-sync.json` isn't in the artifacts, a single QA-only recompute over the existing alignment outputs is allowed, locally or in Actions, with no new separation or alignment and nothing written to `content/`. If a number can't be recovered, say which and why.

Write the result as a section in `docs/analysis/bench/round-6.md`, opening with one sentence that states which of the two it is. Scripts for it go in `scripts/pipeline/` only if worth keeping.

Done when:
- `pipeline.yml` uploads `qa-sync.json` on refusal;
- the section states which of the two it is, with the numbers above;
- `git diff origin/main --name-only` has nothing under `content/`, and no threshold moved (0.15, 0.05, `BASE_INTERNAL`, LIMIT);
- `PYTHONUTF8=1 python scripts/pipeline/test_sync.py`, `npm run validate`, `npm run typecheck`, `npx vite build` pass; `origin/main` merged; pushed.
Stop at 10M tokens without a passed item and report.
