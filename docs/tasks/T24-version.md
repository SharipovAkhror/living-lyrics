# Задача T24: версия исполнения в названии песни — сделано (2026-10-19)

Слова владельца (2026-10-19): «В названии пиши, какая версия песни: иногда концертные варианты, и одна песня может быть в разных концертах».

В данных версия уже есть, но в интерфейсе не видна: `song.json` → `release` (`album`, `year`, `label`) и `performance` (`event`, `venue`, `city`, `date`). Сейчас:
- I Have Come Alive — концерт Beyond the Stars, Expo 2020 Dubai, Al Wasl Plaza, 2021-10; релиз Beyond the Stars (Live), 2022;
- Karitas и ONE — концерт When Paths Meet, Holland Festival, Het Concertgebouw, Амстердам, 2022-06-06; релиз When Paths Meet (Live at The Holland Festival), 2023 (EP: Karitas / One (ONE: When Paths Meet)).

Зона: `src/data/schema.ts` (+ `docs/data-format.md`), `content/songs/*/song.json` (только новое поле версии), `src/pages/LibraryPage.tsx`, `src/pages/song/**` (шапка, «О песне»), `src/player/engine.ts` — только `MediaMetadata` (title/artist/album), стили этих мест, `scripts/tools/new-song.ts`, `scripts/tools/song-status.ts`, `scripts/tools/validate.ts` (проверка поля), `docs/methodology/01-intake.md` и шаблоны `docs/methodology/templates/`.

## Сделать

1. **Поле версии.** В `song.json` — `version`: `{ kind: 'live' | 'studio' | 'single' | 'other', label: string }`, где `label` — короткая подпись по-русски для интерфейса, из фактов `release`/`performance` (ничего не выдумывать): концерт — «Концерт <название>, <город> <год>» (например «Концерт When Paths Meet, Амстердам 2022», «Концерт Beyond the Stars, Дубай 2021»); студийная — «Студийная, <альбом> <год>». Обязательное поле: `validate` требует его у каждой песни, `new-song` спрашивает, `song-status` показывает строку «версия». Правило для будущих песен: если та же песня уже есть в другой версии — новый `slug` с суффиксом версии (`karitas-amsterdam-2022`); в методике (01-intake) — как выбрать версию: та, что в официальном видео, которое прислал владелец.
2. **Где видно — везде, где название:**
   - плитка библиотеки: название, под ним версия (мельче), затем исполнитель — или «исполнитель · версия» одной строкой, если так чище; поиск находит и по версии;
   - шапка песни: под названием — версия (подзаголовок с частью песни, который там сейчас, — сохранить, например вторым уровнем или через « · »; не перегружать — реши аккуратно);
   - «О песне»: версия первой строкой сведений (концерт, площадка, дата; релиз и год);
   - экран блокировки и CarPlay (`MediaMetadata`): title — название, artist — исполнитель, album — версия.
3. Не ломать: стекло T21, иконки, обложки, сцену; бюджеты скорости.

Проверки: `npm run validate && npm run typecheck`, `npm run test:layout`, `npx vite build`, `npx tsx src/player/background.test.ts`, `npm run song-status -- <slug>` для трёх песен. Кадры (`work/shots/t24/`): библиотека и шапка песни, iPhone тёмная и светлая, экран машины 800×480. Отчёт коротко, с путями к кадрам.

Готово, когда: у трёх песен есть версия; она видна в библиотеке, шапке, «О песне» и на экране блокировки; новая песня без версии не проходит `validate`; методика описывает выбор версии; проверки проходят.
