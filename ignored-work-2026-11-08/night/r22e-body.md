Task: studio round after an owner-role check that failed. Verdict with evidence: `work/owner-check/verdict-1.json` (read it; 14 of 52 items failed). Predicted owner reaction: "this is 'almost' again". Standard: `work/owner-check/standards.md`; owner's complaints: `work/owner-check/portrait.md`. Fix the branch `site/studio-pass-r22`; push required, no force-push. This is one of at most two fix rounds, and the branch isn't merged until it passes.

Keep what the check found better than live: engravings on the phone, readable neighbour lines and «повтор», larger main line on PC, comment card clear of the oud, cover in the header, plain words in settings.

Fix:
1. Emphasized word: restore a visible mark on both the original word and the translation word, using the song accent colour as on live. This overrides the round 20 table row in `docs/design/studio-pass.md`: note the change and why there, and change D26 to match. Keep contrast ≥ 4.5:1 in both themes.
2. Phone song header: show the section line and the concert version again, as on live.
3. PC player: not a stretched phone. Compact dock (centred like live, or a proper PC layout), labels at least 12 px, times readable, nothing scattered into far corners.
4. Text contrast ≥ 4.5:1 for dock labels and times, light and dark, measured.
5. «Перевод» and «Пояснение» buttons show on or off at a glance, by shape or fill and not by colour alone.
6. Progress track: restore the section marks.
7. Glass only on controls: glass back on the song page's dock and header; library cards become a plain surface without the coloured fill. Remove the glare on the search field and buttons (dark), the violet glow on the settings sheet, and the blue blur filling the hero card's right half.
8. Library: covers aren't cropped (titles of Karitas, ONE and I Have Come Alive whole); hero card has no empty half; on the phone more than one song is seen without scrolling.
9. PC instrumental scene: remove the scraps of the cut line under «I was dead».
10. Same instruments at the same second on PC and phone (1:10 now gives 3 vs 4). Decide from the section's data, not screen size; a smaller screen may show them one at a time, but the set is the same.
11. Musician names aren't cut off; a truncated comment has a visible way to open it.
12. PC settings: no iOS-style sheet frame; a PC form.

Then:
- Add shots to `work/owner-check/new/` and INDEX: empty or error state of the library or song, and one pair under `prefers-reduced-transparency` and `prefers-contrast: more` (must be opaque). Measure time to first screen on phone and PC; put the number in INDEX.
- Merge `origin/main`. Update `stage-geometry.json` only if the layout truly moved, tolerances unchanged; record on a settled first frame, so the Karitas 0.3 s row (578, top 8) isn't a load artefact.
- Run `npm run gate` (now allowed, ≤ 10 min; it's at 9.9, so if it goes over, say so and don't weaken any line), `npm run test:interactions`, `npm run test:layout`, `frames.mjs` phone and PC p95 ≤ 16.8 ms, `npm run validate`, `npm run typecheck`, `npx vite build` with budget. Retake all shots, open each one, update INDEX.

Done when: each of the 12 items is named with the shot file that shows it fixed, with measured contrast for item 4; listed commands green with numbers; pushed, `git rev-list --count HEAD..origin/main` is 0. Stop at 10M tokens without a passed item and report. If an item conflicts with a gate line, report it rather than weakening the line.
