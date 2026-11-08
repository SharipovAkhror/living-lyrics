Task: T37 comments, round 4 on `site/t37-comments`, allowed by LL · Main and only on the rows named in `work/t37/codex-recheck3.md` (its problem table: 11 not fixed, 18 fixed badly, and the fresh-sample rows marked wrong). Change no other comment. Read `docs/methodology/07-comment.md` first.

Rules from before hold: explain the speaker's state first, in plain words; sources support it; interpretation is marked; no research reports in reader text; original, timing, `canon.md`, timing flags and translations unchanged; bundle ceiling 26 000 bytes.
Joseph lines passed: use Codex's more direct text in `codex-recheck3.md` for `b19q3-01`, `rumi-19-5`, `b19q4-01`, `rumi-19-5b`, unless a quoted page contradicts it.
A line you can't support from a page opened in this session: remove the claim, or flag it `comment-draft` with a `review` question naming the id. Grammar claims need the same support: Codex's wrong labels this time include wrong conclusions from grammar.

Done when: every row is listed by id as fixed, draft or disputed with a quoted page; `sources.md` holds URL and quote for each new citation; `npm run validate`, `npm run typecheck`, `npx vite build` pass; `validate --strict` fails only on `Bir` (`tr9-03`); `origin/main` merged; pushed. Stop at 10M tokens without a passed item and report.
