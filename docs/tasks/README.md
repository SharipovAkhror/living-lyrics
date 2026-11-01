# Задания исполнителям

Каждый файл `T<N>-<имя>.md` — полное задание. Его можно отдать любому агенту (любого провайдера) или человеку без пересказа. Краткий список и порядок — `docs/BACKLOG.md`, состояние проекта — `docs/STATUS.md`, ход работы прямо сейчас — `ops/board.json`.

## Как выдать задание

1. Отдельная папка и ветка от `main`:
   ```bash
   git worktree add ../living-lyrics-wt/t<N>-<имя> -b <исполнитель>/t<N>-<имя> main
   ```
   Префикс ветки — кто исполняет (`grok/`, `gemini/`, `agent/`, `human/`).
2. Исполнителю — два текста подряд: [`_executor.md`](_executor.md) (общие правила; подставить папку и имя) и файл задания.
3. Владелец дополнил задачу по ходу — допишите в конец файла задания раздел «Дополнение N (дата)» и отправьте исполнителю тот же текст.

Урок T18: открытое «придумай три мира» исполнитель делает слабо; дизайн задаётся материалом, размерами, иконками и движением (`docs/tasks/T18-design.md`). Новый трекер и новый оркестратор не добавлять.

## Как принять

- отчёт исполнителя — по каждому пункту «Готово, когда»;
- дифф не выходит за «Зону» задания (`git diff --stat main...<ветка>`);
- приёмка, один список (тот же в `AGENTS.md`; замер 2026-10-21 на одной машине без `AUDIO_KEY`, в CI не заводился; `npx tsx src/data/comments.test.ts` — с 2026-11-01): `npm run validate`, `npm run typecheck`, `npx vite build`, `npm run precheck`, `npx tsx src/player/background.test.ts`, `npx tsx src/player/preload.test.ts`, `npx tsx src/app/marks.test.ts`, `npx tsx src/data/comments.test.ts`, `npm run test:layout`, `python scripts/pipeline/test_sync.py`. `npm run precheck` — это validate, typecheck и vite build одной командой; исполнитель запускает её перед пушем. Без `AUDIO_KEY` `npm run build` звук не проверяет: `scripts/tools/audio-crypt.mjs` предупреждает и выходит с кодом 0, а `npm run precheck` смотрит шифр в `content/audio-enc/`. Для песен ещё `npm run song-status -- <slug>`. Перед коммитом исполнителя по-прежнему `npm run validate && npm run typecheck`;
- выборочная сверка фактов с источниками; кадры — iPhone, десктоп, экран машины, светлая и тёмная тема;
- слияние в `main` и push (сайт обновится сам), удаление папки и ветки;
- обновить `docs/STATUS.md`, `docs/BACKLOG.md`, `ops/board.json`; в том же коммите, где карточка становится `done` или `rejected`, в первой строке файла задания — «сделано (дата)» или «отклонено (дата)». T25 не помечать сделанной, пока нет скриншота боковой панели от владельца.

## Кто сейчас исполняет

С 2026-10-17: код пишет Grok (Grok Build, `grok-4.7`), видео смотрит Gemini 3.8 Flash (Antigravity, `agy`), ведёт и принимает работу Claude Code. Так удобно, но проект от них не зависит: всё нужное лежит в репозитории, и любой другой агент или человек продолжит по этим файлам. Помощники для Grok Build (`grok_status.py`, `last_report.py`, `watch_log.py`) — в настройке владельца `agentic-os-live/ops/agents/`.
