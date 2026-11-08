# LL · Site queue (local, for the hand-off)
1. After song-4 test: T36 acceptance by machine — 60-min Karitas playback soak in Playwright WebKit (iPhone viewport/UA, settings open + a few seeks, memory each minute, reload + resume position logged) + kill-and-resume scenarios. Grok writes, ll-judge accepts. Owner does NOT do the iPhone check (owner 2026-10-24: owner tasks < 2 min, only what agents can't).
2. After PR #6: owner feedback — (a) Persian sung but Arabic shown: per-line language ID on vocal stem vs lyrics.json lang, all three songs, report; (b) voice/instrument/subtitle appearance on stage unfinished; (c) sync proof ~60 % vs 90 % bar. Order set by LL · Main after the test.
3. Studio: 21c (running) → judge → my gate → frames → ff into site/studio-pass → round 22 (+ r21/confirmed.md findings).
4. T35 r2 brief (applause detector etc.) — not written.
Note: two live LL · Main sessions (pipes 8577…, f4d3…) — tell Main once.

## 2026-10-24 evening (from LL · Main)
- Every ll-judge "done when" list includes "Vercel preview build of the PR is green", not only local validate.
- PR #8 -> draft; docs split into PR #9. Song data waits on site/song4 for AUDIO_KEY (Main + owner).
- After studio 22: ONE brief for route fixes from the song-4 log: (1) encryption gates only the audio commit, not later stages; (2) on-screen lyrics step (lyric video -> screen text -> 4v, lyric_frames.py for any video file); (3) video-type check ("what kind of video") in the stock Gemini prompt of 9b.
- 2026-10-25 (Main/AOS): until ~Fri 30 Oct agy Claude is out; Grok is the only code executor, LL ≤ 8 % of Grok's week per day, only for merging work (song 4 lines/timing, then translation/comments by Grok). No new studio rounds. Non-code checks → agy Gemini. Claude: only turns that lead to a merge.

- Cross-song bench task (Main 2026-10-26, not before the Grok week resets ~Fri 30.10): why frozen baseline lines flip when a song joins the bench (Alive round 4 lost arabic-26b, coda-fa-1, coda-fa-7 in IHCA and hildegard-h6-3, hildegard-h1-4 in karitas; run 40192236489). Fold in: pipeline.yml run/align-stage path (~l.526) still adds docs/analysis/bench without the PR #15 commit gate.
- Alive: decision (a), it stays as shipped; no Grok on Alive timing this week. The 90 % bar and per-line fill (fill.ts:54) are owner questions held by Main.
