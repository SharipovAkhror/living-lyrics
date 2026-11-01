# Living Lyrics — инструкции для любого агента

Этот файл — единые правила для любого ИИ-агента и любой среды (Claude Code, Codex, Cursor, Gemini CLI, человек с терминалом). `CLAUDE.md` и `GEMINI.md` только подключают его.

**Начните с `docs/STATUS.md`** (состояние и решения) и `docs/BACKLOG.md` (задачи — каждая самодостаточна, её можно отдать агенту любого провайдера; полные задания — `docs/tasks/`). Что идёт прямо сейчас — `ops/board.json`. В конце каждой задачи обновите их и закоммитьте всё (код, данные, документацию): следующий агент продолжит без объяснений. Всё нужное для работы хранится в репозитории — не в памяти агента и не в сервисе какой-либо компании.

Сайт-сцена для песен: оригинал крупно, слова заливаются по мере пения (только при доказанном тайминге), русский перевод, пояснения, гравюры инструментов в проигрышах. Дизайн свой — качества Apple, но не копия. Сейчас в основном песни Sami Yusuf (персидский, арабский, турецкий, азербайджанский, английский, латынь, немецкий, испанский); проект — о музыке вообще, не только об этой теме.

## Если вы — отдельный чат или агент проекта

Общие правила агентов (общение с владельцем, чаты, их ротация и восстановление, исполнители и бюджеты) — в настройке владельца `agentic-os-live` (`AGENTS.md` там; Claude Code на его машинах подключает её сам). Без неё работайте по этому файлу: команды, методология, контракты.

Чаты проекта: **LL · Main** — оркестратор (решения, задачи, приёмка, доска `ops/board.json`, `docs/STATUS.md`); **LL · Business** — продукт и бизнес. Рабочие чаты отчитываются LL · Main. Приёмка — отдельный проверяющий `ll-judge` (только чтение, вердикт по списку «Готово, когда»); исполнитель сам себя не принимает.

- **LL · Site** — сайт и песни: ставит задачи Grok и Gemini, проверяет и готовит вливание (ветка с `main`, проверки зелёные, «готово» от `ll-judge`); **вливает в `main` только LL · Main** (решение владельца 2026-10-24);

## Если вас попросили добавить песню

Вам дают ссылку на официальное видео или файл записи (или то и другое). Звук и видео берутся из одного официального ролика: одна попытка `yt-dlp` на машине, где это разрешено владельцем (команду даёт `song-status`); если сайт просит войти или отказывает — не обходить, а попросить файл у владельца. Маршрут — `docs/methodology/README.md`. После каждого шага `npm run song-status -- <slug>`: таблица стадий и одна следующая команда. Навык `/add-song` указывает на тот же маршрут. Код под новую песню не пишется: язык — ISO 639 (`src/data/iso639.ts`), письмо — `SCRIPT_CODES` в `src/data/schema.ts`.

Главные правила:
- ничего не выдумывать: буквы — из `canon.md`, непроверенное — флагом и в `review`;
- оригинал — ровно то, что поётся, каждый повтор — отдельная строка;
- время слов измеряет выравнивание, не глаз; пока на ветке нет `.github/workflows/pipeline.yml`, `song-status` помечает тайм-коды как отложенные и не просит пустое задание;
- перевод успевает читаться (≤ 17 зн/с по времени пения строки, считает `song-status`); пояснение — по делу; нигде нет капса;
- перед коммитом запись шифруется (`npm run audio:encrypt`), в git попадает `content/audio-enc/`;
- модули связаны контрактами (`src/data/schema.ts`, `src/instruments/animation.ts`): меняя одну часть, не ломайте другие и обновляйте контракт и его документ.

## Что нужно агенту и где тяжёлые шаги

Агенту достаточно git и редактирования файлов. Тяжёлые шаги (Demucs, Whisper, выравнивание) выполняются там, где есть вычисления и открытая сеть — выбирайте то, что доступно в вашей среде:

1. **GitHub Actions** (нужен `git push` и файл `.github/workflows/pipeline.yml` на ветке): задание `jobs/<slug>.json` → результат приходит коммитом. Если файла конвейера нет, `song-status` пишет «отложено». Подробно — `docs/methodology/README.md` и `docs/methodology/05-alignment.md`.
2. **Vercel Sandbox** (если у агента есть инструменты Vercel — MCP или CLI): `scripts/pipeline/sandbox/*.sh`.
3. **Локально** (если у агента есть компьютер с Python и ffmpeg): `scripts/pipeline/*.py`.

Если сеть среды не открывает сайты с текстами, читайте их через песочницу (`scripts/pipeline/sandbox/fetch_text.py`) или веб-поиск.

## Команды

```bash
npm install
npm run dev                         # http://localhost:5173 (расшифрует записи, если есть AUDIO_KEY в .env.local)
npm run validate [-- <slug>]        # проверка данных, включая сверку строк с canon.md; --strict для финальной
npm run typecheck
npm run precheck                    # validate + typecheck + vite build, без ключа записи; перед пушем
npm run build                       # расшифровка записей + validate + typecheck + vite build
npm run new-song -- <slug> "Title" "Artist"
npm run song-status -- <slug>       # где песня на маршруте и одна следующая команда
npm run art [-- <key>]              # пересобрать гравюры инструментов
npm run shots -- <url> <dir> <paths…>   # скриншоты iPhone/десктоп, светлая/тёмная
npm run audio:encrypt -- <slug>     # зашифровать запись перед коммитом (репозиторий публичный)
python scripts/review/launch_round.py <round> [--wt <папка>] [--dry-run]  # круг студии Гроком без чата; журнал work/review/launch_round.log
```

Исполнитель перед пушем запускает `npm run precheck`. Хук `.githooks/pre-push` запускает ту же команду при пуше ветки `site/*`. Хук ставится сам при `npm install` (`prepare` записывает `core.hooksPath`). Обход хука — `git push --no-verify`: Git тогда не запускает хук, и проверку делает сам исполнитель.

Аудиоконвейер (Python, `scripts/pipeline/requirements.txt`): `decrypt_audio.py`, `process_audio.py`, `separate.py`, `sections.py`, `transcribe.py`, `align.py`, `qa_sync.py`. Нужны `ffmpeg` и сеть (модели Whisper, Demucs, MMS). В облачной среде Claude Code сеть закрыта — пользуйтесь GitHub Actions или песочницей.

## Устройство кода

- `content/songs/<slug>/` — данные песни: `song.json`, `lyrics.json`, `canon.md` (оригиналы), `sources.md`. Схема — `src/data/schema.ts`, описание — `docs/data-format.md`.
- `content/audio-enc/` — записи, зашифрованные AES-256-GCM (ключ `AUDIO_KEY`).
- `src/data/timeline.ts` — строки и инструментальные части по порядку, повторы, смена голоса.
- `src/scene/` — сцена: `flow.ts` (поток строк как функция времени), `Scene.tsx`, `LineBlock.tsx`, `InstBlock.tsx`, `Field.tsx` (живой фон).
- `src/player/engine.ts` — воспроизведение, эквалайзер (Web Audio подключается только когда включён: на iPhone он останавливает звук при блокировке экрана), Media Session.
- `src/pages/` — библиотека, страница песни (`song/`: плеер, настройки, «О песне», весь текст), методология.
- `src/instruments/` — каталог инструментов, гравюры (`scripts/art/` их рисует), раскладки (`layout.ts`), контракт анимации (`animation.ts`, `docs/instruments/animation-contract.md`).
- `src/styles/tokens.css` — дизайн-токены; правила — `docs/design/design-system.md`.
- `middleware.ts` — пароль на сайт (Vercel: `SITE_PASSWORD`, `AUTH_SECRET`).

## Стиль кода

TypeScript strict, React 19 без сторонних UI-библиотек. Комментарии по-английски, тексты интерфейса и документация — по-русски, обычным регистром. Анимации сцены — функции времени (перемотка должна давать тот же кадр). Перед коммитом: `npm run validate && npm run typecheck`. Перед пушем: `npm run precheck`. Приёмка — один список, его же держит `docs/tasks/README.md`. Команды, которые 2026-10-21 уже проходили на одной машине без `AUDIO_KEY` (замер `docs/research/repo-audit.md`, в CI не заводились): `npm run validate`, `npm run typecheck`, `npx vite build`, `npx tsx src/player/background.test.ts`, `npx tsx src/player/preload.test.ts`, `npx tsx src/app/marks.test.ts`, `npm run test:layout`, `python scripts/pipeline/test_sync.py`. Без `AUDIO_KEY` `npm run build` звук не проверяет: `scripts/tools/audio-crypt.mjs` предупреждает и выходит с кодом 0.
