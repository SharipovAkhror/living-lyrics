Studio rounds up to 22 into main: large screens first-class (keys, hover, focus rings, scrubber preview, wheel, Media Session, 1280–3440 sizes), a quieter player, and desktop rows in the gate. Main merged in; T36 protection and all four songs kept.

Gate green: 9.9 min against the 10 min cap, almost no margin. Interactions 134/134, layout 18168 with 0 errors, Chromium p95 ≤ 16.8 ms, CSS 20414/20600, entry 190846/200000. No threshold changed. ll-judge: 5 items PASS, the 6th was unclear and is now answered.

Stage geometry: `stage-geometry.mjs` is outside the gate and fails on 24 old rows. The record was stale before the merge: the stage is 532 px on 8c27e0bd and after the merge, against 512 recorded on 2026-10-21. It comes from studio round 8, `f5f0db02`, which was never measured alone. On main the stage is 512, so merging this PR changes the height there; on the Karitas frame measured, the line stays inside the stage and clear of the player.

The instrument baseline stays on three songs (outside the gate).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014EB8w1gJB9t7ukz3NyRsV3
