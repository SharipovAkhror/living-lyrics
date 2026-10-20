# T28: player polish — seek bar, resume, settings, product-grade icons

Owner: LL · Site (gives the code to Grok, the screenshots to the owner through `LL · Main`). Report to `LL · Main` in short English.

Owner's words (2026-10-20): "the icons are cheap, very simple, not product-like, not finished… set up the seek bar properly so the colours show where I am seeking, make seek position saving convenient, and so on. Think through all these little things so it is convenient to use."

## Do

1. **Seek bar:** coloured segments per part (verse, chorus, instrumental, in the song's palette), a clear playhead, and a preview of the part/line under the finger while dragging. Large touch target.
2. **Resume:** remember the position per song (`localStorage`, try/catch) and offer to continue on reopen or after a reload (T27).
3. **Settings:** audit every control for clarity and speed; group them, cut what nobody uses, and give each a short Russian label.
4. **Icons:** the current Phosphor Fill set reads cheap. Prepare 2–3 product-grade directions (e.g. a custom set drawn for this site, or SF-Symbols-like line + fill, licences checked) as iPhone screenshots of the player and settings. `LL · Main` asks the owner to choose by buttons. Ship only the chosen one.
5. **Small things:** list and fix the friction points on iPhone (tap targets, safe areas, lock screen, rotation, one-hand reach). Write the list in `docs/design/t28-ux-audit.md`.

Done when: the owner has chosen the icons, the screenshots (iPhone 393×852 light/dark, desktop) are sent to him, and validate, typecheck and build pass.
