# Living Lyrics — инструкции для любого агента

Этот файл — единые правила для любого ИИ-агента и любой среды (Claude Code, Codex, Cursor, Gemini CLI, человек с терминалом). `CLAUDE.md` и `GEMINI.md` только подключают его.

**Начните с `docs/STATUS.md`** — там текущее состояние, решения и следующий шаг. В конце каждой задачи обновите его и закоммитьте всё (код, данные, документацию): следующий агент продолжит без объяснений.

Сайт-сцена для песен: оригинал крупно, слова заливаются по мере пения, русский перевод, шарх (комментарий). Плеер в духе Apple Music на iOS 26. Сейчас в основном песни Sami Yusuf (персидский, арабский, турецкий, азербайджанский, английский, латынь, немецкий, испанский).

## Если вас попросили добавить песню

Вам дают **только ссылку или аудиофайл** (или запись уже лежит в `content/inbox/` — её прислали Telegram-боту, см. `docs/telegram-bot.md`). Всё остальное вы находите и делаете сами по регламенту `docs/methodology/README.md`, стадии 1–12. В Claude Code то же самое ведёт навык `/add-song`.

Главные правила:
- ничего не выдумывать: текст — от дословного оригинала из источников (`canon.md`), непроверенное — флагом и в `review`;
- оригинал — ровно то, что поётся, каждый повтор — отдельная строка;
- время слов измеряется по записи (выравнивание + `qa_sync.py`), а не оценивается;
- перевод успевает читаться (≤ 17 зн/с); шарх — по делу, без пафоса; нигде нет капса.

## Что нужно агенту и где тяжёлые шаги

Агенту достаточно git и редактирования файлов. Тяжёлые шаги (Demucs, Whisper, выравнивание) выполняются там, где есть вычисления и открытая сеть — выбирайте то, что доступно в вашей среде:

1. **GitHub Actions** (любой агент, нужен только `git push`): задание `jobs/<slug>.json` → результат приходит коммитом. Подробно — `docs/methodology/05-alignment.md`.
2. **Vercel Sandbox** (если у агента есть инструменты Vercel — MCP или CLI): `scripts/pipeline/sandbox/*.sh`.
3. **Локально** (если у агента есть компьютер с Python и ffmpeg): `scripts/pipeline/*.py`.

Если сеть среды не открывает сайты с текстами, читайте их через песочницу (`scripts/pipeline/sandbox/fetch_text.py`) или веб-поиск.

## Команды

```bash
npm install
npm run dev                         # http://localhost:5173 (расшифрует записи, если есть AUDIO_KEY в .env.local)
npm run validate [-- <slug>]        # проверка данных, включая сверку строк с canon.md; --strict для финальной
npm run typecheck
npm run build                       # расшифровка записей + validate + typecheck + vite build
npm run new-song -- <slug> "Title" "Artist"
npm run art [-- <key>]              # пересобрать гравюры инструментов
npm run shots -- <url> <dir> <paths…>   # скриншоты iPhone/десктоп, светлая/тёмная
npm run audio:encrypt -- <slug>     # зашифровать запись перед коммитом (репозиторий публичный)
```

Аудиоконвейер (Python, `scripts/pipeline/requirements.txt`): `decrypt_audio.py`, `process_audio.py`, `separate.py`, `sections.py`, `transcribe.py`, `align.py`, `qa_sync.py`. Нужны `ffmpeg` и сеть (модели Whisper, Demucs, MMS). В облачной среде Claude Code сеть закрыта — пользуйтесь GitHub Actions или песочницей.

## Устройство кода

- `content/songs/<slug>/` — данные песни: `song.json`, `lyrics.json`, `canon.md` (оригиналы), `sources.md`. Схема — `src/data/schema.ts`, описание — `docs/data-format.md`.
- `content/audio-enc/` — записи, зашифрованные AES-256-GCM (ключ `AUDIO_KEY`); `content/inbox/` — присланное Telegram-боту.
- `src/data/timeline.ts` — строки и инструментальные части по порядку, повторы, смена голоса.
- `src/scene/` — сцена: `flow.ts` (поток строк как функция времени), `Scene.tsx`, `LineBlock.tsx`, `InstBlock.tsx`, `Field.tsx` (живой фон).
- `src/player/engine.ts` — воспроизведение, эквалайзер (Web Audio подключается только когда включён: на iPhone он останавливает звук при блокировке экрана), Media Session.
- `src/pages/` — библиотека, страница песни (`song/`: плеер, настройки, «О песне», весь текст), методология.
- `src/instruments/` — каталог инструментов и гравюры (`scripts/art/` их рисует).
- `src/styles/tokens.css` — дизайн-токены; правила — `docs/design/design-system.md`.
- `api/telegram.ts` — Telegram-бот-приёмная; `middleware.ts` — пароль на сайт (Vercel: `SITE_PASSWORD`, `AUTH_SECRET`).

## Стиль кода

TypeScript strict, React 19 без сторонних UI-библиотек. Комментарии по-английски, тексты интерфейса и документация — по-русски, обычным регистром. Анимации сцены — функции времени (перемотка должна давать тот же кадр). Перед коммитом: `npm run validate && npm run typecheck`.
