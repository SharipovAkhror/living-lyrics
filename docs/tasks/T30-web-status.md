# T30: a status view the owner can open in the web version

Owner: LL · Tech. Report to `LL · Main` in short English; screenshots go to the owner through `LL · Main`.

Owner's words (2026-10-20): "come up with a minimalist, beautiful way to display things like our mod; it's enough for me if it's at least in the web version." He is remote only (claude.ai on his laptop and phone). The Dashboard mod doesn't show in the web version.

## Do

- One page with the same data as the mod: chats and agents (who, what, state), tasks with progress, what waits for the owner, song progress, limits. Sources: `ops/board.json` and the `live` branch on GitHub.
- Suggested place: the existing site behind its password, e.g. `living-lyrics.vercel.app/ops`, read live from GitHub, so no new services and no deploy on every board change. Pick another place only if it's clearly better and within `AGENTS.md`'s service rules.
- Design: the site's own language ("soft glass", `docs/design/design-system.md`), minimal, Russian, readable on an iPhone in one screen, light and dark. Show the age of the data ("обновлено N мин назад").
- It must not touch the song pages' bundle or speed budgets (T19).

Done when: the owner opens it from his phone and sees the current state; screenshots (iPhone 393×852 light/dark) are sent; validate, typecheck and build pass.
