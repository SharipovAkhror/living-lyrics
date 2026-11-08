# Go [Encore] — источники и статус проверки

Исполнитель: Sami Yusuf. В `song.json` попадает только то, что названо на странице официального видео или на официальной странице альбома.

## Запись

- Ссылка: https://www.youtube.com/watch?v=BiwdQW0UbFU
- Канал: Andante Records. Название ролика: «Sami Yusuf – Go [Encore] | (Live)».
- Версия: живой концерт. Подпись `version.label`: «Концерт Live at the Dubai Opera, Dubai 2016».
- Откуда подпись: страница альбома называет программу «Live at the Dubai Opera» и год альбома 2017; вечер в описании ролика — Dubai Opera, 16 декабря 2016. Год в подписи — год вечера. Город в источниках написан латиницей, Dubai.
- Длительность на странице ролика: 7:46. В части выдач та же страница показывает 7:47. Файл дорожки 140 измерен: 466,37 с.
- Откуда файл: одна попытка `python -m yt_dlp`, формат 140, в `work/go-encore/source.m4a`. В git лежит только шифр `content/audio-enc/go-encore/`.

Страница альбома: https://samiyusuf.art/music/live-at-the-dubai-opera — трек 22 «Go (Encore)», альбом 2017, запись декабря 2016 в Dubai Opera. Ссылка на выпуск: http://andnt.co/SYDubaiOpera

Другой официальный ролик того же названия, «Sami Yusuf - Go (Encore) | Live In Concert 2015», длится 6:46: https://www.youtube.com/watch?v=EltPMFvVX7U. Это не эта запись. Буквы стиха оттуда можно сверять, секунды — нет.

Студийный лирик-ролик «Go» с альбома The Centre, 3:49: https://www.youtube.com/watch?v=Mo0yAaQm6AA. Это не эта запись.

## Тексты

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| Английские слова | Will Knox | описание ролика BiwdQW0UbFU: «English Lyrics by Will Knox»; буквы стиха — блок LYRICS ролика EltPMFvVX7U | сверены, см. canon.md |

Дословные цитаты и порядок строк — в `canon.md`, не здесь.

У этого ролика есть английские, арабские, персидские и турецкие слова. В git они не копируются. Английские — оригинал порядка. Остальные три — перевод и в буквы стиха не входят. Время строк собрано в `docs/analysis/go-encore/cues.json` без текста.

Описание ролика также говорит: «Composed, arranged and performed by Sami Yusuf». Лад: «Mode: Aeolian with allusions to Dastgāh-e Navā». Песня входит в альбом 2014 года «The Centre» и в этой записи содержит соло тонбака и ударных. Текст описания про смысл песни совпадает со страницей альбома, трек 22.

## Исполнители

Из описания ролика, «PERFORMERS (From right to left)»:

- Seyyed Mohammad Jaberi: Daf, Bendir, Dayre & vocals
- Ömer Avci: Dohol, Bendir, Kudum & vocals
- Abbas Karacan: Bass Darabuka, Bendir & Tef
- Selim Boyaci: Oud & vocals
- Mustafa Olgan: Qanun & vocals
- Seyed Ali Jaberi: Tanbour, Tar & vocals
- Türker Dinletir: Ney, Zourna & vocals
- Adem Tosunoglu: Baglama, Tanbur, Kemançe & vocals
- Farshad Mohammadi: Santoor & vocals
- Jon Lawton: Classical Guitar, Tanbour & vocals
- Sami Yusuf: Vocal, Piano, Tar, Oud & Tonbak

Подголоски, «Backing Vocalists (From the right)»:

- Sami Mohammad Ahmad Alhaj: Bass
- AbdulRazzak Barma: Baritone
- Abeer El Sayed Ahmad: Mezzo-Soprano
- Nancy Al Baltaji: Contra-Alto

## Не подтверждено

- Русское написание города. В источниках только Dubai. В подписи другой песни проекта город того же написания принят как «Дубай»; для этой карточки оставлено Dubai.
- Точный день на странице альбома не назван: там «December 2016». День 16 декабря 2016 взят из описания ролика.
- Год выпуска альбома на странице исполнителя — 2017. Дата загрузки ролика на YouTube — 21 марта 2018. Какая из дат стоит на физическом издании, страница не говорит.
- Цвета обложки ещё не сняты: палитра в `song.json` — заглушка шаблона.
- Какие строки и сколько раз поются именно в этом ролике, решено по его английским словам и записано в `canon.md`. Окна голоса без этих слов строками не заполнены. Локальное распознавание вокала не запускалось: не загрузилась библиотека cublas64_12.dll.
- Инструменты на сцене в каждый проигрыш. Список выше — описание ролика, не покадровая сверка.
- Длительность альбомной дорожки на площадке в этой сессии заново не открывалась. Файл этого ролика — 466,37 с.

## Тайм-коды

- Статус: draft. Начала строк взяты из английских слов ролика. Концы слов внутри этих окон — черновые, по группам гласных. Выравнивание по голосу ещё не доказано.
