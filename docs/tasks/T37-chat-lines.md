# T37: строки чатов в панели — настоящий последний отчёт и причина ожидания

Исполнитель: agy (Claude Sonnet 4.6, medium, 900 с). Оркестрация и приёмка: LL · Tech и ll-judge; отчёт — LL · Main.

## Почему

Раздел «Чаты» панели берёт строки из `ops/agents/registry.py` (`live_chats`):

- последняя строка чата — `last_said`: последний текст ассистента в транскрипте. Чат, получивший сообщение «для сведения», отвечает служебной строкой «No response requested.» — и панель показывает её вместо настоящего отчёта (так было у LL · Site 2026-10-23);
- причина ожидания — `pending_tool`: последний вызов инструмента без результата. Когда чат стоит на диалоге самого Claude Code (например «Resume this conversation?» после `claude respawn`), открытого вызова нет: `claude agents --json` даёт `status: waiting`, `waitingFor: "dialog open"`, а панель пишет «ждёт вас» без причины, под ним — старый отчёт (LL · Ops 2026-10-23).

## Что сделать

1. `last_said`: пропускать служебные строки и брать предыдущий содержательный текст. Служебная — короче 40 знаков после нормализации и совпадает (без учёта регистра и конечной точки) с одной из: `No response requested`, `No response needed`, `Acknowledged`, `Noted`, `OK`, `Ок`, `Принято`. Список — константа в начале файла.
2. `live_chats`: если `state == 'waiting'`, а `pending_tool` пуст — `waiting_for` берётся из `waitingFor` сессии: `"dialog open"` → `«открыт диалог Claude Code — откройте чат и ответьте»`, `"permission prompt"` → `«ждёт разрешения — откройте чат»`, иное непустое — как есть.
3. Тесты в `ops/agents/tests/test_registry.py` (новый файл; запуск `python ops/agents/tests/test_registry.py`): `last_said` на транскрипте-заглушке (временный каталог, подмена `transcript_tail`) пропускает «No response requested.» и возвращает предыдущий текст; длинный текст, начинающийся с «Noted», не пропускается; `live_chats` с подменёнными `cards`, `pending_tool` (пусто) и списком сессий даёт текст для `dialog open` и `permission prompt`.

## Зона

Только `ops/agents/registry.py` и `ops/agents/tests/test_registry.py`. Мод (`ops/dashboard-mod/`), `panel.html`, настройки, `keep_chats.py` не трогать; ничего не публиковать.

## Готово, когда (проверяет приёмка)

- [ ] тесты из п. 3 есть (≥ 4) и проходят, `python ops/agents/tests/test_publish_live.py` тоже проходит;
- [ ] `python ops/agents/registry.py` печатает чаты без ошибок; строка «No response requested.» нигде не стоит в `last`;
- [ ] для сессии с `waitingFor: "dialog open"` и без открытого вызова `waiting_for` — текст из п. 2;
- [ ] сигнатуры `live_chats`, `last_said`, `pending_tool` не изменились (их читают `publish_live.py` и мод);
- [ ] один коммит в ветку `agy/chat-lines`, сообщение по-английски.
