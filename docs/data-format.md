# Формат данных песни

Источник истины — `src/data/schema.ts` (zod). JSON-схемы для автодополнения в редакторе: `docs/schema/song.schema.json`, `docs/schema/lyrics.schema.json` (обновляются командой `npm run validate -- --emit-schema`).

## song.json

| Поле | Тип | Описание |
|---|---|---|
| `slug` | строка | совпадает с именем папки: `[a-z0-9-]+` |
| `title` | строка | название как в релизе |
| `titleOriginal` | строка? | название на языке оригинала (`مرده بدم زنده شدم`) |
| `artist`, `featuring[]` | строки | исполнитель и приглашённые |
| `release` | `{ album?, year?, label? }` | |
| `performance` | `{ event?, venue?, city?, date? }` | для живых записей |
| `languages[]` | коды языков | только реально спетые, по порядку появления |
| `poets[]` | `{ name, lang?, era? }` | авторы текстов |
| `duration` | секунды | длительность файла `high.m4a` |
| `palette` | `{ accent, accentDark, field[3–4] }` | цвет песни (светлая/тёмная тема) и цвета живого фона |
| `coverGlyph` | строка? | слово на сгенерированной обложке |
| `audio` | см. ниже | |
| `timing` | `{ status: draft∣aligned∣verified, method, notes? }` | |
| `credits[]` | `{ role, name }` | **только подтверждённые** |
| `review[]` | строки | открытые вопросы |

`audio`:

```json
{
  "status": "ready",
  "high": "/audio/<slug>/high.m4a",
  "saver": "/audio/<slug>/saver.m4a",
  "peaks": "/audio/<slug>/peaks.json",
  "gainDb": -3.2,
  "provenance": { "kind": "url", "ref": "https://…", "retrieved": "2026-10-16", "codec": "opus 160k", "sha256": "…" }
}
```

## lyrics.json

```json
{ "sections": [ Section, … ] }
```

**Секция** — общие поля: `id`, `start`, `end` (секунды), `label` (обычный регистр), `sharh?`, `flags?`.

- `kind: "vocal"` — `voice?` (кто поёт), `lines[]`.
- `kind: "instrumental"` — `instruments[]` (ключи каталога), `performers?[]`, `mode?` (лад), `note?` (1–2 фразы).

**Строка** (`line`):

| Поле | Описание |
|---|---|
| `id` | уникальный, `[a-z0-9-]+` |
| `lang`, `script` | язык (`ar`, `fa`, `az`, `tr`, `en`, `la`, `de`, …) и письмо (`Arab`, `Latn`, `Cyrl`) |
| `words[]` | `{ w, s, e, br?, em? }` — слово как поётся, начало и конец (с), перенос после слова, ключевое слово |
| `alt?` | `{ script, text }` — та же строка другим письмом (Физули арабицей) |
| `translit?` | кириллическая транскрипция (обязательна для арабского письма) |
| `tr` | `{ ru: "…" }`, можно добавить другие языки: `{ ru, uz, en }` |
| `sharh?` | комментарий, разметка `**…**`, `*…*`, пустая строка — новый абзац |
| `voice?` | кто поёт эту строку |
| `fx?` | анимация: `auto`, `rise`, `focus`, `ink`, `assemble`, `drop`, `bloom`, `cascade`, `spotlight`, `stack`, `whisper` |
| `flags?` | `text-unverified`, `timing-draft`, `translation-draft`, `sharh-draft`, `attribution-unverified` |

## peaks.json

```json
{ "rate": 20, "duration": 490.1, "rms": [0.02, 0.05, …] }
```

`rate` значений в секунду, нормированный RMS 0…1. Сцена использует его для живого фона и выбора анимаций, таймлайн — для формы.

## Как сцена читает данные

- Строка появляется за 0,35–0,7 с до первого слова (зависит от анимации) и уходит, когда приходит следующая, но не позже чем через 4,2 с после последнего слова.
- Если до следующей строки дольше ~1,6 с — показываются три «дышащие» точки.
- Шарх: у строки → у ближайшей предыдущей строки той же секции → у секции.
- Инструментальная секция показывается от `start` до `end` с отсчётом до первого слова следующей вокальной.
