Task: prepare PR #19 (studio, `site/studio-pass-r22`) for an owner-role design check, which another agent runs from your screenshots. Add no features and change no visuals. Three other Grok runs share this PC (one is a memory soak): do not run `npm run gate`, `frames.mjs` or any other heavy suite.

Push to `site/studio-pass-r22` is allowed and required. No force-push.

Do:
1. `git fetch origin`, merge `origin/main` with a normal merge (only hand-off commits are expected).
2. `scripts/perf/stage-geometry.json` holds an outdated record (scene 512, real 532 since before the merge). Update the record so `scripts/perf/stage-geometry.mjs` measures the merged state. Do not change tolerances. Run it, then `npm run validate` and `npm run typecheck`. Commit and push.
3. Screenshots of two builds, same viewport, song and playback moment for each pair:
   - `work/owner-check/new/` — this branch;
   - `work/owner-check/live/` — `origin/main` (the live site deploys from it). Build it locally in a temporary git worktree under `../living-lyrics-wt/`, removed when done. Do not read or use the site password or any Vercel secret.
   Matrix: phone (iPhone viewport) and PC × light and dark × these screens: library; player with a sung line; scene during a sung line; scene during an instrumental section with instruments; settings sheet. Use one of the songs with a proved scene; use a tool already in the repo (`npm run shots`, `scripts/perf/shots.mjs`) where it fits. Same file name in both folders: `<screen>-<device>-<theme>.png`. `work/` is outside git; do not commit shots.
4. Open every shot yourself. A shot of a loading state, an empty scene, a password page or the wrong moment is a failed shot: fix and retake.
5. Write `work/owner-check/INDEX.md`: one line per pair (file, song, moment), and how to retake them.

Done when:
- `stage-geometry.mjs` passes on merged code with tolerances unchanged, number in the report;
- `validate` and `typecheck` green; pushed; `git rev-list --count HEAD..origin/main` is 0;
- both folders hold the full matrix (2 × 2 × 5 = 20 shots each) and you checked them per step 4;
- the temporary worktree is gone.

Stop at 10M tokens without a passed item and report. Report in the usual format, with paths and numbers. If a screen differs between builds in a way that looks like a bug, list it, don't fix it.
