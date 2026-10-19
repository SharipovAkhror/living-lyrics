# Ход работы

- `board.json` — доска: что идёт сейчас, что нужно от владельца, прогресс песен, путь «до новых песен», последние передачи работы. Обычный JSON, читает кто угодно. Обновляет тот, кто ведёт работу, после каждого шага (выдал задание, принял, решение владельца) и коммитит.
  Поля: `updated` (ISO, UTC), `headline`, `tasks[]` (`id`, `section`: `you` | `now` | `done` | `later`, `agent`, `status`, `title`, `what`, `now`, `next`, `worktree`), `songs[]` (группы строк: доказано / поставлено / всего), `roadmap` (шаги с весом и долей готовности), `feed[]` (не больше 8, новые сверху), `models`.
- `usage/` — учёт расхода исполнителей (Grok, Gemini), см. `usage/README.md`.
- `agents/` — помощники для Grok Build: `grok_status.py` (кто что делает по папкам `../living-lyrics-wt/*`), `last_report.py <папка>` (последний отчёт), `watch_log.py <папки…>` (ждать, пока кто-то закончит ход).
- `dashboard-mod/` — мод Claude Code: строка над полем ввода, панель Dashboard и карточка в чате по слову `dashboard`. Это окно в `board.json`: в сессии, открытой в репозитории, он читает файл с диска, в любой другой — берёт доску из GitHub (репозиторий публичный), так что работает на любом компьютере. Живое состояние Grok и Gemini и сбор расхода — только там, где рядом с репозиторием лежит `../living-lyrics-wt` (машина, на которой работают исполнители).

## Поставить мод на другой компьютер

Репозиторий — витрина плагинов (`.claude-plugin/marketplace.json`). В приложении Claude (вкладка Code): «+» у поля ввода → Plugins → Add marketplace → `SharipovAkhror/living-lyrics` → Add plugin → `ll-dashboard`.

В терминале, в сессии Claude Code:

```
/plugin install ll-dashboard --marketplace SharipovAkhror/living-lyrics
```

Из командной строки:

```bash
claude plugin install ll-dashboard --marketplace SharipovAkhror/living-lyrics
```

На машине, где мод уже загружен из папки разработки, второй раз его не ставить — будет две строки над полем ввода.
