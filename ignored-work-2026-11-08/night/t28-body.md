Задача: подготовить студию к вливанию в `main`. Круг 22 закончен (`work/review/round22-brief.md` в C:/Users/User/Documents/GitHub/living-lyrics, раздел Done when; `docs/design/studio-pass.md`). Новых функций не добавлять. Ветка отстала от `origin/main` на 212 коммитов.

Push в `site/studio-pass-r22` разрешён и обязателен. Force-push запрещён.

Сделать:
1. `git fetch origin`, влить `origin/main` обычным слиянием. Конфликты по пробе: `src/pages/song/SongPage.tsx`, `src/player/resume.test.ts`, `src/scene/Scene.tsx`, `vite.config.ts`. Сохранить обе стороны: из `main` защиту T36 (`restorePlan`, запись на перемотку, `SceneBoundary`, тайм-аут `fileStore`, `lastError`, «О песне») и песню Alive; из студии круг 22. Проверь, что `npm run test:resume` — тесты убийства страницы (`scripts/perf/resume-crash.mjs`, 5 тестов) и входят в `test:interactions`; юнит-тест `src/player/resume.test.ts` тоже должен запускаться.
2. Ворота могли считать только три песни: пусть проверяют и четвёртую; пороги не снижать.
3. Прогнать всё на слитом коде. Чинить только сломанное слиянием; строку ворот не ослаблять. Причина глубже — разбор в отчёт и стоп.

Готово, когда (на слитом коде):
- `npm run gate` зелёный, время в отчёте (≤ 10 минут);
- `npm run test:interactions`, `npm run test:layout`, `frames.mjs` телефон и десктоп p95 ≤ 16,8 мс, бюджет сборки, `npm run validate`, `npm run typecheck`, `npx vite build` зелёные, с числами;
- на сайте четыре песни, `git diff origin/main --stat -- content/` пуст;
- `docs/design/studio-pass.md` дополнен разделом о вливании; ветка запушена; `git rev-list --count HEAD..origin/main` при push равно 0.
