# Приёмная записей

Сюда Telegram-бот сайта кладёт присланные записи — зашифрованными (`source.<ext>.enc`, ключ `AUDIO_KEY`) — и `info.json` с отчётом о качестве. Агент забирает запись по [стадии 2](../../docs/methodology/02-audio.md#приёмная-telegram) и удаляет папку. Подробно о боте — [docs/telegram-bot.md](../../docs/telegram-bot.md).
