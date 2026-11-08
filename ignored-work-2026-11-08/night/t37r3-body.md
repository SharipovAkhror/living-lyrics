Task: T37 comments, round 3, the last round allowed on this brief. Branch `site/t37-comments` already holds rounds 1 and 2. Read `docs/methodology/07-comment.md` and `work/t37/codex-recheck.md` (independent verdict on round 2: not fit; 16 of 39 old findings fixed badly, 7 not fixed, 7 of 60 fresh samples wrong).

The owner's demand: comments were short and empty; explain every line, because these poems are written from a state (хал). He did not understand «я был Юсуфом, а теперь рождаю Юсуфов». A comment must first tell a person who knows nothing of Sufism what is happening to the speaker and why the image says it. Sources support the explanation; they are not the explanation.

Do:
1. Close every row of the problem table in `codex-recheck.md`: fix, or dispute with evidence quoted from the opened page.
2. Joseph lines (`b19q3-01`, `rumi-19-5`, `b19q4-01`, `rumi-19-5b`): start from Codex's proposed text. Keep the two readings apart, mark the interpretation, and don't give 12:10 as the rescue (it is 12:19). No sentence about what pages don't say.
3. `b10q3-01`: comment and translation contradict each other. Here only, you may correct the translation, keeping ≤ 17 cps. List the change in the report. No other translation changes.
4. The fresh sample found about 1 wrong in 8, so the rest likely has the same faults. Go through ALL comments line by line, not only the named ones, for these classes:
   - a verse or page that doesn't say what is claimed;
   - a claim contradicted by a neighbouring line or by the translation;
   - research reports in reader text ("these pages don't say", "no entry", "one doesn't prove the other");
   - bibliography taking more room than the explanation;
   - a gloss or a repeat of the translation with no explanation of the state.
5. Evidence: Codex couldn't open many pages you may have opened. For each dictionary or book page a comment cites, `sources.md` of that song holds the URL and a short verbatim quote you read this session. A page you can't open this session: remove the citation, or use flag `comment-draft` with a `review` question naming the line id.

Limits: original, timing, `canon.md`, timing flags unchanged. Budget ceiling for a song bundle stays 26 000 bytes. Usually 150–450 characters; longer only if each sentence explains. Interpretation marked in plain words, and not in the same stock phrase every time.

Done when:
- every row of the table closed or disputed, listed by id in the report;
- the Joseph comments quoted in full in the report;
- count of comments changed by step 4, per song; count of flags; list of sources that stayed closed;
- real gzip of each song chunk and added 4G load time at 1.6 Mbit/s for the largest;
- `npm run validate`, `npm run typecheck`, `npx vite build` pass; `validate --strict` fails only on `Bir` (`tr9-03`) and on `comment-draft` if strict counts them, stated plainly; `origin/main` merged; pushed.

Stop at 10M tokens without a passed item and report.
