# T29: re-check the sung text of all three songs, line by line — сделано (2026-10-20)

Owner: LL · Site (Grok for scripts, Gemini for listening). Report to `LL · Main` in short English.

Owner's report (2026-10-20): "very many errors, even in I Have Come Alive, the best song… in the middle a lot of mismatches, words swap places and so on. Check everything again from scratch. The texts again."

The canon letters were checked against editions on 2026-10-17. What breaks is most likely the **sequence**: which line is sung where, the repeats, the order inside a line, and which line is shown at which time. Check, don't assume.

## Do

1. For each song (start with `i-have-come-alive`, middle part first) build a line-by-line table: shown line and time → what is actually sung there. Evidence comes from the vocal stem transcripts (Whisper, the pipeline), the official video subtitles or title frames (`lyric_frames.py` on the owner's file), and a listening pass by Gemini on the audio. Every disagreement gets a time and a source.
2. Fix `canon.md` «Последовательность в записи» and `lyrics.json` only where the evidence agrees. Unclear places go to `review` with a flag; nothing is invented.
3. Put the places the owner should listen to (≤ 15 per song, with timestamps) in `docs/analysis/<slug>-recheck.md`. `LL · Main` sends him the list.
4. Find out why the earlier checks missed this, and add a check (validator or QA script) so it can't come back.

Done when: all three songs have the table, the fixes are in `main`, `npm run validate -- --strict` passes, and the owner's listening list is sent.

## Где остановились (2026-10-20)

Карточка `t29` — `done`. Влитие записано в `docs/STATUS.md` (коммит `8671cdd`). Список, который владельцу ещё слушать, — карточка `you-listen` (на доске: было 26 мест, осталось 9). Из-за этого списка T29 заново не открывать.
