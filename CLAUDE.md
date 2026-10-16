# Living Lyrics — инструкции для агента

**Начните с `docs/STATUS.md`** — там текущее состояние, решения и следующий шаг. В конце каждой задачи обновите его и закоммитьте всё (код, данные, документацию) — следующий агент продолжит без объяснений.

Сайт-сцена для песен: оригинал крупно с кинетической анимацией и пословной подсветкой, русский перевод, шарх (комментарий). Плеер в стиле iOS 26. Сейчас в основном песни Sami Yusuf (персидский, арабский, турецкий, азербайджанский, английский, латынь, немецкий, испанский).

## Если вас попросили добавить песню

Вам дают **только ссылку или аудиофайл**. Всё остальное вы находите и делаете сами по регламенту:

1. Прочитайте `docs/methodology/README.md` и пройдите стадии 1–12 по порядку.
2. Или вызовите навык `/add-song <ссылка или путь>` — он ведёт по тем же стадиям.

Главные правила: ничего не выдумывать (непроверенное — флагом и в `review`); оригинал — ровно то, что поётся; перевод успевает читаться (≤ 17 зн/с); шарх — по делу, без пафоса; нигде нет капса.

## Команды

```bash
npm install
npm run dev                         # http://localhost:5173
npm run validate [-- <slug>]        # проверка данных; --strict для финальной
npm run typecheck
npm run build                       # validate + typecheck + vite build
npm run new-song -- <slug> "Title" "Artist"
npm run draft-timing -- <slug>      # черновое время слов по слогам
npm run art [-- <key>]              # пересобрать гравюры инструментов
npm run shots -- <url> <dir> <paths…>   # скриншоты iPhone/десктоп, светлая/тёмная
```

Аудиоконвейер (Python, `scripts/pipeline/requirements.txt`): `fetch_audio.sh`, `process_audio.py`, `separate.py`, `sections.py`, `frames.py`, `transcribe.py`, `align.py`. Нужны `ffmpeg` и сеть. Если агент работает в облачной среде Claude Code, в настройках среды (Network access → Allowed domains) должны быть разрешены:
`youtube.com`, `*.youtube.com`, `*.googlevideo.com`, `youtubei.googleapis.com`, `i.ytimg.com` — запись;
`huggingface.co`, `*.huggingface.co`, `*.hf.co` — модели Whisper;
`download.pytorch.org` — выравниватель MMS и колёса torch; `dl.fbaipublicfiles.com` — модели Demucs;
`ganjoor.net`, `*.wikisource.org`, `*.wikipedia.org`, `cantus.uwaterloo.ca`, `quran.com`, `sunnah.com` — тексты и справки.
Без них аудио нужно передать файлом, а тексты сверять через веб-поиск.

## Устройство кода

- `content/songs/<slug>/` — данные песни (`song.json`, `lyrics.json`, `sources.md`). Схема — `src/data/schema.ts`, описание — `docs/data-format.md`.
- `src/data/timeline.ts` — превращает данные в «реплики» сцены: когда строка появляется и уходит, какая анимация.
- `src/scene/` — сцена: `choreo.ts` (анимации как чистые функции времени), `LineView.tsx`, `InstView.tsx`, `Field.tsx` (живой фон).
- `src/player/engine.ts` — воспроизведение, эквалайзер (Web Audio подключается только когда включён: на iPhone он останавливает звук при блокировке экрана), Media Session.
- `src/pages/` — библиотека, страница песни, методология, редактор тайм-кодов (`/song/<slug>/edit`).
- `src/styles/tokens.css` — дизайн-токены; правила — `docs/design/design-system.md`.
- `middleware.ts` — пароль на сайт (Vercel, переменные `SITE_PASSWORD`, `AUTH_SECRET`).

## Стиль кода

TypeScript strict, React 19 без сторонних UI-библиотек. Комментарии по-английски, тексты интерфейса и документация — по-русски, обычным регистром. Анимации сцены — функции времени (перемотка должна давать тот же кадр). Перед коммитом: `npm run validate && npm run typecheck`.
