# T30: a status view the owner can open in the web version

Owner: LL · Tech. Report to `LL · Main` in short English; screenshots go to the owner through `LL · Main`.

Owner's words (2026-10-20): "come up with a minimalist, beautiful way to display things like our mod; it's enough for me if it's at least in the web version." He is remote only (claude.ai on his laptop and phone). The Dashboard mod doesn't show in the web version.

## Do

- One page with the same data as the mod: chats and agents (who, what, state), tasks with progress, what waits for the owner, song progress, limits. Sources: `ops/board.json` and the `live` branch on GitHub.
- Suggested place: the existing site behind its password, e.g. `living-lyrics.vercel.app/ops`, read live from GitHub, so no new services and no deploy on every board change. Pick another place only if it's clearly better and within `AGENTS.md`'s service rules.
- Design: the site's own language ("soft glass", `docs/design/design-system.md`), minimal, Russian, readable on an iPhone in one screen, light and dark. Show the age of the data ("обновлено N мин назад").
- It must not touch the song pages' bundle or speed budgets (T19).

Done when: the owner opens it from his phone and sees the current state; screenshots (iPhone 393×852 light/dark) are sent; validate, typecheck and build pass.

## Correction (owner, 2026-10-20) and where we stopped

"Web version" meant **Claude Code on the web** (claude.ai/code: Remote Control sessions from the Station and, ideally, cloud sessions, in a laptop or phone browser), not our site. The `/ops` page on the site was built (commit 05cd3b3) and then removed by the owner's decision; the chat registry stays (`.claude/agents/ll-*.md`, `ops/agents/registry.py`).

What renders where (docs: https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run):
- A mod's hooks run in a Remote Control session, on the Station; **what it draws (pane, band, chat card) shows only in the terminal on the Station**, not in claude.ai/code or the mobile app.
- A cloud session draws nothing from a mod.
- Where nothing draws, the docs suggest "a line in the transcript or a command's text reply". The mod already has both: `/dashboard` answers with the summary text (no model turn), and the word `dashboard` makes Claude's reply carry the summary (one short turn).

Options for the owner (asked by LL · Main):
1. `/dashboard` in any Remote Control session — a text summary as the command's reply; free (no model turn). Needs a 10-second check that claude.ai/code shows a local command's reply.
2. The word «дашборд» / `dashboard` — Claude answers with the same summary; works everywhere, including cloud sessions once a repo skill `.claude/skills/dashboard` reads `ops/board.json` and the `live` branch; costs a short turn.
3. A status line posted by the mod into LL · Main's transcript when the board or the agents' states change (`$.session.append`, a notice the model doesn't read) — appears in the web without asking; risk of clutter, and whether claude.ai/code shows such notices needs a check.

## Try: a live panel artifact (2026-10-21)

- `ops/dashboard-mod/panel.html`, published as a private artifact https://claude.ai/artifact/UxZtjaBuWo2eDXW3fSC6tp. It has the same blocks as the pane: owner items, chats, agents and Actions runs with icons, word-sync bars against the goal, usage; light and dark. It reads one document, `dashboard/now`, from its own database and redraws when that document changes; only the owner writes. The page can't fetch GitHub itself (artifact CSP).
- Seeded once by hand on 2026-10-21. If the owner picks it: the mod on the Station writes the document on every state change (`ArtifactData` through `$.tool.call`), and the artifact gets pinned in the claude.ai sidebar.
- `/dashboard` card: one test line of markdown images (Lobe icons from raw.githubusercontent), to see whether remote windows draw images.
