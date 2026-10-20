# Агентная система: что есть готового и что нам взять

_LL · Tech, 2026-10-20. Задание — `docs/tasks/T26-agent-system-research.md`. Источники — в конце, у каждого утверждения есть ссылка._

## Коротко

**Брать.** Всё нужное уже есть в самом Claude Code, и оно работает на подписке и на Windows:

- **Роли — файлами в git.** Определения агентов в `.claude/agents/*.md` (официальный формат) станут карточками ролей. Чат запускается прямо по карточке: `claude --agent <роль> --bg …` [1][2].
- **Тяжёлые разборы — «динамическими процессами».** Исследования и аудиты по всему репозиторию запускаются `/deep-research` или с пометкой `ultracode` вместо ручной раздачи задач [3].
- **Ночная проверка порядка — облачной «рутиной».** Она идёт по расписанию в облаке Anthropic, на подписке и при выключенной Станции [4].
- **Автоудаление влитых веток** — одна настройка GitHub [5].
- **Пробный «Проект» Claude** для одного потока работы. Это ближайший готовый путь к оркестрации без ПК: потоки идут в облаке, а при необходимости на Станции через Remote Control [6].

**Оставить** то, что мы построили: состояние в репозитории (`AGENTS.md`, `docs/STATUS.md`, `docs/tasks/`, `ops/board.json`, `ops/handoff/`), фоновые чаты под демоном и сообщения между ними [7][8], `rotate_chat.py`, `keep_chats.py`, мод Dashboard и страницу `/ops`, Grok через мост, Gemini через `agy`. Готовые инструменты этого не заменяют, а наш набор опирается на штатные возможности Claude Code.

**Не брать:**

- Gas Town, claude-squad, Conductor, vibe-kanban, Claude Flow (Ruflo) — оркестраторы;
- LangGraph, CrewAI, AutoGen, OpenAI Agents SDK — фреймворки;
- A2A — протокол;
- GitHub Agentic Workflows.

Причины — в таблице. Они либо требуют платный API-ключ, либо не работают нормально на Windows, либо закрываются, либо решают другую задачу: они для тех, кто строит продукт на агентах, а не ведёт работу агентами.

## Как это делают профессионалы

- **Оркестратор и исполнители.** Ведущий агент планирует и раздаёт части работы параллельным исполнителям. Хорошее задание называет цель, вид результата, инструменты и границы. Расплывчатые задания дают повторы и дыры [9].
- **Результаты — в файлах, по ссылке.** Исполнители кладут результат в файлы и передают ведущему только ссылку: так ничего не искажается при пересказе. План ведущий сохраняет вне контекста, чтобы пережить его переполнение [9]. У нас это `docs/tasks/`, сдачи дел и отчёты Grok.
- **Многоагентность дорогая.** Она тратит примерно в 15 раз больше токенов, чем обычный чат, и окупается только на ценных задачах [9]. Правила Claude Code говорят то же: десять агентов расходуют лимит в десять раз быстрее [2].
- **Пишет один, проверяют многие.** Параллельные «писатели» принимают несовместимые неявные решения. Работает другое: один пишущий агент плюс проверяющий с чистым контекстом, который ничего не знает заранее. Такой проверяющий находит в среднем 2 ошибки на PR [10][11]. У нас так и есть: код пишет Grok в своей ветке, а принимает его Claude.
- **Долгая работа держится на файлах.** Журнал хода, список готовности и мелкие коммиты, а не память разговора [12]. Наши сдачи дел и доска — это оно.
- **Одна задача — один контекст — один PR.** Мелкие проверяемые задачи легче откатить и перезапустить [13].
- **Наблюдаемость.** Трассировка решений агентов позволяет находить причины сбоев системно [9]. У нас для этого журнал демона, `grok_status.py`, мод и `/ops`.
- **Порядок.** GitHub сам удаляет ветку после вливания PR, если включить настройку [5]. Claude Code удаляет worktree вместе с сессией (`claude rm`), а сессии хранит по `cleanupPeriodDays` [2][14].

## Сравнение

| Кандидат | Что это | Подписка без API-ключа | Windows | Claude + Grok + Gemini | Состояние в git | Вывод |
|---|---|---|---|---|---|---|
| Фоновые сессии + `claude agents` | фоновые чаты под демоном | да | да | Claude; Grok и Gemini вызываются из чата | нет, но чаты читают репозиторий | **уже стоит** [2] |
| Сообщения между сессиями | `SendMessage` между чатами, также на другие машины и в облако | да | да (v2.1.234+) | Claude | нет | **уже стоит** [8] |
| Определения агентов (`.claude/agents`) | роли файлами: описание, инструменты, модель, текст роли | да | да | Claude | **да** | **брать**: карточки ролей [1] |
| Agent teams | ведущий и «товарищи» с общим списком задач | да | да, без разделения экрана | Claude | нет, `~/.claude/teams` | для коротких параллельных разборов внутри одного чата; для постоянных чатов нет: экспериментальная, «товарищи» не восстанавливаются после `/resume`, одна команда на сессию [15] |
| Dynamic workflows | скрипт раздаёт задания десяткам субагентов и сверяет результаты | да (на Pro — включить в `/config`) | да | Claude | скрипт можно хранить в `.claude/workflows/` | **брать** для исследований и аудитов [3] |
| Routines | сохранённое задание, которое идёт в облаке по расписанию, по событию GitHub или по API | да (Pro/Max), тратит лимит | облако | Claude | работает с репозиторием, пушит ветки `claude/…` | **брать** для ночной проверки порядка [4] |
| Projects (бета) | один координирующий разговор, задачи — облачные потоки или потоки на ПК через Remote Control | да, Pro/Max, раскатывается постепенно | облако + ПК | Claude; Grok и Gemini только в потоке на ПК | инструкции и память в проекте, код в репозитории | **попробовать** на одном потоке [6] |
| Agent SDK, `claude -p` | программный запуск | с 15.06.2026 отдельный месячный кредит; для продуктов — API-ключ | да | — | — | не нужен: мы ведём работу, а не продукт [16] |
| claude-squad | TUI для нескольких агентов в tmux | да (запускает CLI агентов) | Windows не заявлена, нужен tmux | Claude, Codex, Gemini, Aider | нет | не брать [17] |
| ccmanager | TUI для сессий по worktree | да | путь `%APPDATA%` в доках есть, явной поддержки нет; tmux не нужен | 10 агентов, **включая Grok Build** и Gemini CLI | нет, `sessions.json` | не брать: владелец работает удалённо, а TUI на Станции ему не виден [18] |
| Conductor | приложение для параллельных агентов | да | **только macOS** | Claude, Codex, Cursor | нет | не брать [19] |
| vibe-kanban | канбан, где агенты работают в worktree | да | неясно | 10+ агентов | локальная база | не брать: **проект закрывается** [20] |
| Gas Town + Beads | оркестратор на 20–30 агентов: «мэр», рабочие, очередь слияний; задачи в Beads (Dolt) | да | на Windows «минимальный CLI», полный режим — WSL, tmux, Go, Dolt | много пресетов, включая Gemini | Beads: Dolt-база, синхронизируется через git | не брать: тяжёлый, рассчитан на десятки агентов и Linux; идеи стоит взять [21][22][23] |
| Claude Flow (Ruflo) | «рои» агентов через MCP | — | — | Claude | — | не брать: заявления не подтверждены независимо [24] |
| Backlog.md | задачи markdown-файлами в репозитории, MCP, веб-канбан | да | **да** | Claude Code, Gemini CLI и другие через MCP | **да** | возможная замена `docs/tasks` + `board.json`; решать после шагов 1–3 [13][25] |
| Task Master | разбор PRD на задачи, MCP | Claude Code без ключа; Gemini — с ключом | не заявлена | Claude | `.taskmaster/` | не брать: дублирует наши задания [26] |
| GitHub Issues / Projects | задачи в GitHub | да | да | все через `gh` | вне файлов репозитория | не брать сейчас: второй источник правды рядом с `docs/tasks` |
| GitHub Agentic Workflows | Actions, описанные markdown-ом, с агентом внутри | для Claude — API-ключ | — | Copilot, Claude, Codex | да | не брать: нужен ключ [27][28] |
| LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, MetaGPT | библиотеки для своих агентных приложений | ключ провайдера моделей | — | — | — | не брать: другая задача [29] |
| MCP / A2A | протоколы: инструменты для агента / агент с агентом | — | — | — | — | MCP уже используем; A2A не нужен, наши агенты на одной машине и общаются штатно [30] |

## План перехода

Каждый шаг — отдельная задача для одного чата; порядок важен.

1. **Карточки ролей** (LL · Tech). Файлы `.claude/agents/ll-main.md`, `ll-site.md`, `ll-tech.md`, `ll-business.md`: роль, кому отчитывается, границы, модель. `rotate_chat.py` запускает новый чат с `--agent <роль>`. Новый чат начинает с карточки и сдачи дел. Добавить чат — значит добавить одну карточку и запись в реестре.
2. **Реестр** (LL · Tech). `ops/agents/registry.json`: имя, роль (ссылка на карточку), папка и ветка, кому отчитывается, статус (работает / в архиве), последняя сдача дел. Его читают `keep_chats.py` (вместо зашитого списка), `rotate_chat.py` (пишет статус), мод Dashboard и `/ops` (показывают).
3. **Порядок** (LL · Tech).
   - Включить на GitHub «Automatically delete head branches» — одна галочка владельца или `gh api`.
   - `ops/agents/hygiene.py` ищет и сам удаляет безопасное: влитые ветки и worktree, остановленные копии чатов. О спорном сообщает LL · Main: невлитые ветки старше N дней, сдачи дел без живого чата, карточки доски без исполнителя, ссылки в документах на несуществующие файлы.
   - Скрипт запускает каждый чат в конце шага; итог показывают мод и `/ops`.
   - Ночью тот же скрипт в режиме «только отчёт» гоняет облачная рутина и открывает PR с отчётом. Так проверка не зависит от Станции.
4. **Пробный проект** (LL · Tech + владелец). Перенести в Projects один поток без локальных инструментов, например LL · Business. Неделю смотреть: держит ли он контекст, сколько тратит лимита, удобно ли владельцу с телефона. По итогам решить, переносить ли туда оркестратора.
5. **Разборы — процессами** (все чаты). Исследования и аудиты по репозиторию — через `/deep-research` и `ultracode`, а не ручной раздачей. На Pro по умолчанию размер «small» (до 5 агентов), его не поднимать без нужды [3].
6. **Backlog.md — потом.** Пробовать, только если после шагов 1–3 доска и задания всё ещё расходятся.

Для шагов 2 и 3 карточки ролей не нужны. Готового инструмента, который заменил бы реестр и проверку порядка и при этом подходил под наши условия, я не нашёл. Шаг 4 их тоже не отменяет: реестр нужен и облачному проекту.

## Решения для владельца

Задаёт LL · Main кнопками:

1. **Реестр и порядок строим сами на штатных средствах Claude Code** (рекомендую) — или переходим на готовый трекер (Backlog.md или Beads)?
2. **Ночная проверка порядка в облаке через рутину** (рекомендую; тратит немного лимита подписки, нужно приложение Claude на GitHub для репозитория) — или только на Станции?
3. **Попробовать Projects на LL · Business сейчас** — или подождать, пока не освободится лимит недели (сейчас занято 81 %)?

## Источники

1. Claude Code: субагенты — https://code.claude.com/docs/en/sub-agents
2. Claude Code: agent view, фоновые сессии, демон, `claude --agent … --bg`, worktree — https://code.claude.com/docs/en/agent-view ; обзор способов: https://code.claude.com/docs/en/agents
3. Claude Code: dynamic workflows — https://code.claude.com/docs/en/workflows
4. Claude Code: routines — https://code.claude.com/docs/en/routines
5. GitHub Docs: Managing the automatic deletion of branches — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches
6. Claude Code: Projects — https://code.claude.com/docs/en/claude-projects
7. Claude Code: Remote Control — https://code.claude.com/docs/en/remote-control
8. Claude Code: сообщения между сессиями — https://code.claude.com/docs/en/cross-session-messaging
9. Anthropic Engineering: How we built our multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system
10. Cognition: Don't Build Multi-Agents — https://cognition.com/blog/dont-build-multi-agents
11. Cognition: Multi-Agents: What's Actually Working (апрель 2026) — https://cognition.com/blog/multi-agents-working
12. Anthropic: харнесс для долгих агентов (пересказ) — https://www.creolestudios.com/anthropic-harness-design-for-reliable-ai-agents/ ; https://infoq.com/news/2026/04/anthropic-three-agent-harness-ai/
13. Backlog.md, доклад на AI Engineer Code 2025 — https://ai.engineer/talks/backlog-md-terminal-kanban-board-for-managing-tasks-with-ai-agents-alex-gavrilescu-funstage
14. Claude Code: каталог `.claude`, очистка — https://code.claude.com/docs/en/claude-directory
15. Claude Code: agent teams — https://code.claude.com/docs/en/agent-teams
16. Claude Code: legal and compliance (OAuth и Agent SDK) — https://code.claude.com/docs/en/legal-and-compliance ; Claude Help Center — https://support.claude.com/articles/15036540
17. claude-squad — https://github.com/smtg-ai/claude-squad
18. ccmanager — https://github.com/kbwo/ccmanager
19. Conductor: обзоры 2026 — https://www.morphllm.com/conductor-ai-coding ; https://rywalker.com/research/conductor
20. vibe-kanban — https://github.com/BloopAI/vibe-kanban
21. Gas Town — https://github.com/steveyegge/gastown
22. Beads — https://github.com/steveyegge/beads
23. heise: Gas Town orchestrates ten or more coding agents — https://www.heise.de/en/background/Full-Control-Gas-Town-Orchestrates-Ten-or-More-Coding-Agents-11178824.html
24. Claude Flow / Ruflo (каталоги; независимых обзоров нет) — https://vibeindex.ai/plugins/ruvnet/ruflo/claude-flow
25. Backlog.md — https://github.com/MrLesk/Backlog.md
26. Task Master — https://github.com/eyaltoledano/claude-task-master
27. GitHub Agentic Workflows — https://github.github.com/gh-aw/ ; https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/
28. gh-aw: разбор документации по Claude (ключ API) — https://github.com/github/gh-aw/discussions/49575
29. Сравнение фреймворков — https://composio.dev/blog/openai-agents-sdk-vs-langgraph-vs-autogen-vs-crewai
30. MCP и A2A в 2026 — https://beam.ai/agentic-insights/agent2agent-vs-mcp-2026-ai-agent-stack
