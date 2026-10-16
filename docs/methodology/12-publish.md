# 12. Публикация

## Коммит

Одна песня — один коммит (или серия коммитов в отдельной ветке):

```bash
git checkout -b song/<slug>
git add content/songs/<slug> public/audio/<slug> src/instruments scripts/art
git commit -m "Add <Title>: text, translation, commentary, timing (<status>)"
git push -u origin song/<slug>
```

Рабочие файлы (`work/`) не коммитятся: там исходники, стемы, транскрипты и кадры.

Аудио в `public/audio` коммитится в приватный репозиторий. Если файлов станет много (> 1 ГБ), переносите их в Git LFS или во внешнее хранилище (Vercel Blob, S3) и указывайте полные URL в `song.json → audio`.

## Деплой

Сайт статический (Vite) и разворачивается на Vercel из ветки `main`.

- Сборка: `npm run build` (валидатор → проверка типов → сборка).
- Закрытый доступ: файл `middleware.ts` спрашивает пароль. В настройках проекта Vercel → Environment Variables задайте:
  - `SITE_PASSWORD` — пароль для входа;
  - `AUTH_SECRET` — случайная строка для подписи cookie (`openssl rand -hex 32`).
  Без `SITE_PASSWORD` сайт открыт — так удобно при локальной разработке.
- Ссылка на момент песни: `/song/<slug>?t=95`.

## После публикации

Откройте песню на телефоне, добавьте сайт «На экран „Домой“» и пройдите её целиком в наушниках. Замечания — в `review` и новым коммитом.
