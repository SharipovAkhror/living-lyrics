# T27: iPhone Safari — the page reloads mid-song, settings lag — сделано в коде (2026-10-21); час на iPhone ещё у владельца

Owner: LL · Site (gives the code to Grok, accepts it). Report to `LL · Main` in short English.

Owner's report (2026-10-20, iPhone, Safari tab): "every few minutes some error, the site reloads and the song stops. At first every 5 minutes, then every 3, then every 2." Also: "the settings lag, the site lags very badly, the settings especially."

The interval shrinks while playing. That is the pattern of iOS killing the tab's WebContent process for memory ("A problem repeatedly occurred" → reload). Treat it as a memory or GPU leak until measured otherwise. Suspects to measure, not to assume: the live background (`src/scene/Field.tsx`), the 3D instruments, "soft glass" `backdrop-filter` layers (T21), the decrypted audio/blob URLs and `features.json` kept more than once, timers and listeners not cleaned up on re-render, and Web Audio nodes (`src/player/engine.ts`).

## Do

1. Reproduce: a long-play run, at least 30 minutes of playback with seeks and settings open and close. Use WebKit (Playwright) plus Chromium heap snapshots as a proxy. Record memory, DOM node count, listeners, canvases and GPU layers over time. Write it up in `docs/performance/t27-iphone.md`.
2. Fix every leak found. Cap the expensive layers on phones: fewer blur layers, smaller canvases, and pause what is off-screen.
3. The settings sheet must open and scroll smoothly on an iPhone (no dropped frames in a WebKit trace; open < 100 ms).
4. If the page ever reloads, playback resumes at the saved position (shared with T28's resume).

Done when: memory is flat over a 60-minute run in WebKit, the cause is named with numbers, `npm run validate && npm run typecheck && npx vite build` pass, and the owner confirms 60 minutes on his iPhone with no reload.

## Где остановились (2026-10-21)

Карточка `t27` на доске — `done`: код влит, что именно — в поле `now` карточки и в `docs/performance/t27-iphone.md`. Час на iPhone владельца — отдельная карточка `you-iphone` (`waiting`). Пометка «сделано» выше относится к влитому коду, не к этому часу.

## Где остановились (2026-10-31)

Круг памяти на настольном Chrome, сборка `index-GSgj3Gn2.js`. Снимок кучи не назвал объект JS, который копился бы на мегабайт в минуту: на паузе куча и отсоединённые узлы плоские, при игре растёт процесс рендерера. Час с декодированной записью в установленном Chrome — рендерер 0,68 МБ/мин по окну 10–60 (ниже порога) и 1,40 МБ/мин на живой сцене минут 36–54. Кучи JS за час нет. WebKit с подставными часами остаётся 6,31 МБ/мин; час WebKit с настоящей записью на Windows не запускался, декодера там нет. Код сцены не менялся. Подробно — `docs/performance/t27-iphone.md`, раздел «T27. Куча Chromium». Час на iPhone владельца по-прежнему не снят.
