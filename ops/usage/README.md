# Учёт расхода агентов

Отдельно от продукта: сколько тратят исполнители и сколько осталось по подпискам владельца.

| Агент | Подписка | Что видно | Откуда |
|---|---|---|---|
| Grok (Grok Build) | SuperGrok Heavy | токены по каждой сессии; сегодня и за 7 дней | `grok usage <id>` по сессиям из `living-lyrics-wt`. Лимит подписки xAI не сообщает |
| Gemini (Antigravity) | Google AI Pro | остаток 5-часового и недельного окна в процентах, когда сброс; число и длительность заданий | экран `/usage` в `agy` (отдельно группа Gemini и группа Claude/GPT); результат `agy -p --output-format json` |
| Claude Code | подписка владельца | 5-часовое и недельное окно | сам Claude Code; в журнал не пишется, показывается в Dashboard |

Файлы:

- `ledger/<ГГГГ-ММ>.jsonl` — снимки, только дописываются: `agent`, `kind` (`session`, `quota`, `run`), время и числа.
- `latest.json` — последняя сводка; её читает Dashboard в приложении Claude.
- `collect.py` — сборщик.

Запуск на машине владельца (там вошли Grok и Antigravity):

```bash
python ops/usage/collect.py
```

Dashboard запускает его сам раз в 10 минут. Задание Gemini после окончания записывается так:

```bash
python ops/usage/collect.py --run <вывод agy в JSON> --task "watch-video karitas"
```

Адрес почты, который печатает `agy`, и любые ключи в учёт не попадают. Для экрана `/usage` нужен пакет `pywinpty`.
