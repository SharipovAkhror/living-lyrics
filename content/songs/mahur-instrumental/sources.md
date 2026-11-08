# Māhūr Instrumental — источники и статус проверки

Исполнитель: Sami Yusuf. В `song.json` и `lyrics.json` попадает только то, что названо ниже. Чего страница не говорит — в «Не подтверждено» и в `review`.

## Запись

Ролик выбран по длительности из задания (3:03) и по каналу лейбла. Другие официальные выкладки той же пьесы короче и сюда не взяты.

- Ссылка или файл: https://www.youtube.com/watch?v=KOxO1Uw_L4A
- Канал: Andante Records (лейбл; в описании ролика — Andante Records). Название ролика: «Sami Yusuf - Māhūr Instrumental (Live)». Опубликован 2019-01-04. Длительность на странице ролика: 3:03.
- Версия (та, что в этом ролике). Подпись `version.label`: «Концерт Live at the Dubai Opera, Dubai 2016».
  - Вечер: описание ролика, блок «THE CONCERT»: записан и снят в Dubai Opera 16 декабря 2016.
  - Имя концерта «Live at the Dubai Opera»: страница артиста того же вечера, https://samiyusuf.art/music/live-at-the-dubai-opera (2017, трек 7 «Māhūr Instrumental», тот же абзац про танбур). Полный ролик вечера на канале артиста: https://www.youtube.com/watch?v=if31jc76F4c («Sami Yusuf - Live at the Dubai Opera (Full)»), глава «Mahur Instrumental (Live)» с 18:34.
  - Город в источниках написан латиницей Dubai. В подписи оставлен Dubai, не перевод.
  - Год подписи — год вечера (2016), не год альбома.
- Длительность, с: файл дорожки 140 — 183,09 с (3:03). Страница ролика пишет 3:03. Совпадает.
- Откуда файл: одна попытка `yt-dlp`, дорожка 140 того же ролика. Дата попытки — в `audio.provenance.retrieved`, когда файл измерен.

Альбомная дорожка короче этого ролика, поэтому её секунды к видео не подходят:

- Apple Music, альбом Live at the Dubai Opera, id 1213947916, 7 апреля 2017: «Māhūr Instrumental (Live at the Dubai Opera)» — 2 минуты 58 секунд. https://music.apple.com/gb/album/live-at-the-dubai-opera/1213947916
- Tidal, тот же альбом: 2:57. https://tidal.com/track/71365023 (страница альбома; строка трека 7).
- Ролик-аудио на канале артиста, автовыгрузка YouTube, 2:58: https://www.youtube.com/watch?v=7IM8NxKDTck («Provided to YouTube by Andante Records», релиз 2017-04-07). В титрах этой выгрузки есть строка «Lyricist: Sami Yusuf». Описание концертного ролика и страница артиста называют пьесу инструментальной. Строку Lyricist как текст песни не беру: это поле автовыгрузки, не стих.

Глава полного концерта (18:34–21:28) даёт около 2:54. Это другой файл, не эта дорожка.

## Тексты

Спетых строк источники не дают.

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| Пьеса без стиха | Sami Yusuf (сочинил, аранжировал и исполнил) | описание ролика https://www.youtube.com/watch?v=KOxO1Uw_L4A и страница https://samiyusuf.art/music/live-at-the-dubai-opera | 1 источник (один и тот же абзац на двух страницах) |

Дословный абзац — в `canon.md`. Сайты с текстами песен эталоном не были.

## Исполнители

К этой пьесе описание говорит прямо: «Composed, arranged and performed by Sami Yusuf». Лад: «Dastgāh: Māhūr». Для чего написана: «written for tanbour and ensemble».

Ниже — состав всего вечера из того же описания (заголовок «PERFORMERS (From right to left)»). Тот же список стоит на других роликах этого концерта, поэтому он не доказывает, кто из них играет именно в этой пьесе. В `performers` секций и в `credits` сверх Сами Юсуфа имена не перенесены.

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
- Подпевка, «Backing Vocalists (From the right)»: Sami Mohammad Ahmad Alhaj (Bass), AbdulRazzak Barma (Baritone), Abeer El Sayed Ahmad (Mezzo-Soprano), Nancy Al Baltaji (Contra-Alto)

Продюсеры и съёмка из конца описания ролика (не музыканты пьесы): Executive Producers Ahmed Salim, Sami Yusuf, Christine Hoechstoetter; Recording Engineer Peter Herrmann; Mixed and Mastered by Vishnu Rajan @ Andante Studios; Video Editing and Postproduction Omar Habib @ Andante Studios; Filmed by 2Shoes (London, UK); Graphic Design & Artwork Kwame Busia; Additional Graphics & Design Mahdi Jahangir. Издатель: Andante Records, администрирует Fairwood Music (UK) Ltd.

На экране того же ролика, кадры `work/mahur-instrumental/frames/` (в git не входят):

- Около 1 и 6 с карточка: «Māhūr Instrumental», «Composed & Arranged by Sami Yusuf», «Dastgāh: Māhūr», «Live at the Dubai Opera», «Sponsored by Spiritique Foundation», «Copyright of Andante Records». Стиха на карточке нет. Спонсор в `credits` не перенесён: музыкантом он не назван.
- Около 176 с карточка альбома: подпись Sami Yusuf, «LIVE AT THE DUBAI OPERA», «AVAILABLE NOW», значки магазинов. Стиха нет.
- Около 181 с кадр чёрный.
- Каллиграфия на заднике в начале не читается как строка песни и в эталон не перенесена.

## Не подтверждено

- Кто из состава вечера звучит в этой пьесе и на каком ключе каталога. «written for tanbour» — для чего сочинено, не перечень секций. Точечные кадры (около 70 с длинношейная лютня с круглой чашей, около 130 с короткая торцевая дудка) не закрывают правило трёх планов и не измерялись уверенностью: `vision.json` не писался.
- Есть ли в записи голос без слов. Описание говорит instrumental. На кадре около 164 с человек в красном не играет: руки подняты, рядом расписной барабан-бокал. В том же окне вокальный стем громче остальных. Строку пения это не даёт.
- Код языка. Спетых слов нет. Схема требует один код ISO 639, кода «без языка» в списке проекта нет.
- Совпадает ли мастеринг ролика 3:03 с альбомной дорожкой 2:57–2:58. По длительности это разные выкладки.

## Тайм-коды

- Статус: draft. Спетых строк нет, выравнивание слов не запускалось. Официальных субтитров нет, на экране нет стиха, `cues.json` не написан. Пословная заливка выключена.
- Границы секций сняты `sections.py` с вокального стема htdemucs и сверены с уровнями четырёх стемов. Это черновик границ, не доказанные слова.
- Палитра: цвета с официальной обложки альбома, файл https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6b/83/96/6b839616-bb0e-594c-4cf9-36c1567eca5e/cover.jpg/1400x1400bb.jpg (ответ iTunes lookup id 1213947916, 2026-11-02). Квадраты в `public/covers` этим заданием не кладутся.
