# T34: живая панель показывает верные данные без новой публикации

Исполнитель: agy (Claude Opus 4.6). Оркестрация и приёмка: LL · Tech и ll-judge; отчёт — LL · Main.

## Почему

Живая страница панели на claude.ai (артефакт `UxZtjaBuWo2eDXW3fSC6tp`) — старая разметка; её код без публикации не меняется. Она рисует документ `dashboard/now`, который пишет мод (`ops/dashboard-mod/hooks/register.tsx`, `panelDoc` → `writePanel`). Новые данные сломали старую страницу:

- в строке Grok печатается `[object Object]`: старая страница выводит `d.limits.grok` как строку (`esc(L.grok)`), а мод пишет туда объект;
- «Кто что делает» показывает старую строку «Claude · Lead»: её пишут чаты, запущенные со старым кодом мода (мод загружается при старте чата), и они перебивают записи новых чатов.

Как старая страница читает документ — см. функцию `render` в старой разметке (поля `you`, `chats`, `agents[{agent,name,task,state,tone,detail}]`, `runs`, `songs`, `goal`, `limits.claude[{label,used}]`, `limits.gemini[...]`, `limits.grok` — строка, `roadmap`, `at`). Новая разметка — `ops/dashboard-mod/panel.html`.

## Что сделать

1. В `cardDoc` (`register.tsx`) поле `limits.grok` — снова короткая строка для старой страницы, например `«сутки 38 М ток. · неделя 76 %»` (только то, что есть в данных; без данных — поле отсутствует). Объект, который сейчас лежит в `limits.grok`, переезжает в `limits.grokInfo`. `panel.html` и `card/render.mjs` читают `limits.grokInfo` (если его нет, а `limits.grok` — объект, берут его: совместимость со старыми записями).
2. Версия кода в документе: константа `PANEL_REV` (целое, начать с 2) пишется в документ как `rev`. Перед записью `writePanel` уже читает документ один раз (`ArtifactData get`): если там `rev` больше своего — не писать (чат со старым кодом не перебивает новый). Своё `rev` не меньше записанного — писать как сейчас.
3. Тесты в `ops/dashboard-mod/tests/dashboard.test.tsx`: строка `limits.grok` и объект `limits.grokInfo` в `cardDoc`; `rev` в `panelDoc`; решение «писать / не писать» вынести в чистую функцию и проверить (больше / равно / меньше / нет поля).

## Зона

Только `ops/dashboard-mod/hooks/register.tsx`, `ops/dashboard-mod/panel.html`, `ops/dashboard-mod/card/render.mjs`, `ops/dashboard-mod/tests/dashboard.test.tsx`, `ops/dashboard-mod/types/index.d.ts` (если нужно). Ничего не публиковать, не вызывать ArtifactData, не трогать настройки.

## Готово, когда (проверяет приёмка)

- [ ] `claude plugin test ops/dashboard-mod` — все тесты проходят, новых ≥ 4;
- [ ] в `cardDoc` `limits.grok` — строка или отсутствует, `limits.grokInfo` — прежний объект;
- [ ] `panel.html` рисует строку Grok из `grokInfo` (как раньше рисовал из `grok`);
- [ ] `panelDoc` содержит `rev`; `writePanel` не пишет, если в базе `rev` больше;
- [ ] строки «Claude · Lead» в коде нет (уже убрана; не возвращать);
- [ ] один коммит в ветку `agy/panel-compat`, сообщение по-английски.
