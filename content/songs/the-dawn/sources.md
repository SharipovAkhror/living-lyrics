# The Dawn — источники и статус проверки

Исполнитель: Sami Yusuf. В `song.json` попадает только то, что открыто в этом проходе. Другой концерт с тем же названием сюда не переносится.

## Запись

- Ссылка или файл: https://www.youtube.com/watch?v=MZZgoKhzdnA. Канал Sami Yusuf. Название по карточке поиска: «Sami Yusuf - The Dawn (Live in New Delhi, INDIA) #worldmusic #worldmusictraditions». Дата публикации по той же карточке: 2019-05-18. Длительность ролика по карточке: 3:33. Это совпадает с пометкой задания «3:33».
- Версия: живой концерт. Подпись `version.label`: «Концерт The Sufi Route, New Delhi 2019». Описание ролика: «Performed live on 9th February 2019 at The Sufi Route (New Delhi, India)». Год — год вечера, не год поздней публикации. Город оставлен как в источнике: New Delhi. Русского написания на открытых страницах нет.
- Длительность, с: 212,63. Измерение `process_audio.py` по `work/the-dawn/source.m4a` (AAC, 44100 Гц, 2 канала, около 127 кбит/с). Карточка ролика 3:33 с этим числом сходится: 212,63 с — это 3:32,63, ролик показывает 3:33. Магазинные карточки пишут 3:34 (Deezer 03:34, Spotify 3 мин 34 сек). Разница с измеренным файлом больше секунды, поэтому секунды берутся только из этого ролика.
- Откуда файл: одна попытка команды `song-status`, дорожка 140, файл `work/the-dawn/source.m4a` (в git не входит). Повторно ролик не скачивался. Открытый `public/audio/the-dawn/high.m4a` собран перепаковкой без перекодирования. `gainDb` −0,9. sha256 исходника записан в `song.json`.

Описание того же ролика, открытое карточкой поиска:

- «Download/Stream ‘The Dawn (Live in New Delhi, INDIA)’: https://sy.lnk.to/TheDawn».
- «Composed, arranged and performed by Sami Yusuf».
- «Mixed & Mastered by Vishnu Rajan @ Andante Studios».
- «Video editing and post-production by Omar Al-Balushi @ Andante Studios».
- «Published by Andante Records & Administered by Fairwood Music (UK) Ltd for the World».
- «Special thanks to The Sufi Route».

Страница выпуска на сайте артиста, открыта 2026-11-02: https://samiyusuf.art/music/LiveinNewDelhi. Заголовок «Live in New Delhi», вид «EP», год 2019. Текст: «Performed live on 9th February 2019 at The Sufi Route (New Delhi, India)». Дорожка 1 — «The Dawn». Дальше You Came to Me, Mawlana, Hasbi Rabbi. Отсюда `release.album` = Live in New Delhi, `release.year` = 2019.

Deezer, тот же выпуск, карточка поиска: https://www.deezer.com/en/album/99053352. «Live in New Delhi», 4 дорожки, дата 04/06/2019, Andante Records. Дорожка 1 «The Dawn (Live in New Delhi)» — 03:34. Это на одну секунду длиннее карточки ролика 3:33. Файл ролика измерен: 212,63 с; это значение указано в song.json. Секунды слов, если они появятся, берутся только из ролика выше.

Spotify, отдельный сингл, карточка поиска: https://open.spotify.com/album/7eUz0O4PF77TH9Llf3KHSN. «The Dawn (Live in New Delhi)», 2019, 1 песня, 3 мин 34 сек, дата May 19, 2019, © 2019 Andante Records, ℗ 2019 Andante Records. Отсюда `release.label` = Andante Records. Это не другая концертная программа: название то же, вечер тот же. Хронометраж магазина в тайм-коды не идёт.

Apple, открыто 2026-11-02: https://itunes.apple.com/lookup?id=1466689561&entity=song. Дорожка The Dawn (Live in New Delhi), `trackTimeMillis` 214527, то есть 214,53 с. Разница с файлом ролика 212,63 с больше секунды. Это другая шкала. Секунды только из MZZgoKhzdnA. Поля автора слов в этом ответе нет.

## Тексты

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| автора слов нет в описании | Sami Yusuf назван композитором и исполнителем | https://www.youtube.com/watch?v=MZZgoKhzdnA | нет букв |
| автора слов нет в подписи дорожки | Composer, Arranger, Artist | карточка Qobuz https://www.qobuz.com/us-en/album/the-dawn-sami-yusuf/l8v4b2w52uwja | нет букв |

Дословная цитата описания — в `canon.md`. Спетой строки в `lyrics.json` нет.

Теги ролика канала Sami Yusuf включают слово Instrumental. Короткий ролик лейбла Andante Records https://www.youtube.com/watch?v=v-ySZb1kS7Y (не источник звука) в описании повторяет вечер 9 февраля 2019 в The Sufi Route и помечает запись хэштегом instrumental. Букв текста эти страницы не дают.

Официальные субтитры: одна попытка, без звука:

`yt-dlp --skip-download --write-subs --sub-langs "ar,fa,tr,az,he,hi,la,de,en" --convert-subs vtt -o "work/the-dawn/subs" "https://www.youtube.com/watch?v=MZZgoKhzdnA"`

Ответ: «There are no subtitles for the requested languages». Команда предупредила, что не нашла JavaScript runtime. Файла субтитров нет. Повтор не делался. В `review` стоит «официальные субтитры: пусто».

Видео того же ролика, одна попытка, формат 18: `work/the-dawn/video.mp4` (в git не входит). `lyric_frames.py` записал 162 кадра в `work/the-dawn/lyric-frames/`. Это смены плана. Просмотрены кадры 0, 55, 70, 89, 109, 140, 150, 161, 203 и 204 с. На 0 с на экране знак «The Sufi Route». Строк песни нет. На 89 и 109 с крупно щипковый многострунник. На 140 с длинношеечный щипковый и большой барабан. На 150 с люди у микрофонов и хлопки. На 161 с общий план и рояль на переднем крае. На 203 с человек у микрофона. Имена с титров не читались: титров имён на этих кадрах нет. Ключи инструментов по одному кадру не ставились.

## Исполнители

В `song.json` внесены только имена из описания ролика канала Sami Yusuf:

- Sami Yusuf — composed, arranged and performed.
- Vishnu Rajan — mixed and mastered, Andante Studios.
- Omar Al-Balushi — video editing and post-production, Andante Studios.
- Andante Records — published. Fairwood Music (UK) Ltd — administered for the world.

Имена музыкантов вечера New Delhi описание не называет.

## Не подтверждено

- Площадка внутри New Delhi, кроме слов «at The Sufi Route», не названа. Поле `performance.venue` не заполнено.
- Русское написание города на открытых страницах нет. В подписи оставлено New Delhi.
- Спетый язык не назван. Код `en` в `languages` оставлен, потому что схема требует хотя бы один код. Английский как спетый язык эти страницы не подтверждают.
- Ролик лейбла Andante Records https://www.youtube.com/watch?v=Mg6_23vHs5s называется «Sami Yusuf - The Dawn (Live)» и длится 3:56. Описание: Dubai Opera, 16 декабря 2016, лад Shūr-Aeolian, и длинный список музыкантов того концерта. Это другой вечер и другая длительность. Имена, лад и хронометраж оттуда в карточку не переносились.
- Ролик https://www.youtube.com/watch?v=-vUzoFaHSt4 на канале Sami Yusuf длится 3:35, в описании «Provided to YouTube by Andante Records», «Released on: 2019-06-04», «Auto-generated by YouTube». Это не ролик живого кадра. Звук берётся из MZZgoKhzdnA.
- Genius для дорожки альбома Live at the Dubai Opera пишет «This song is an instrumental». Это страница другой записи, не этого ролика. В эталон букв не идёт.

## Обложка

- Файл: `public/covers/the-dawn/source.jpg`, 1400×1400, скачан 2026-11-02 с обложки Apple Music выпуска Live in New Delhi - EP: https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/ee/53/95/ee53959c-527d-51f0-a1c0-cc1cd44854ed/cover.jpg/1400x1400bb.jpg. Страница: https://music.apple.com/us/album/live-in-new-delhi-ep/1466689561. Это обложка всего EP, не отдельная картинка только The Dawn.
- Цвета в `song.json` сняты с файла. Акцент `#601F25` — медиана красных точек кадра (бумага `#efe6da`, контраст около 9,9). `#BB8B5E` — медиана золотых букв, для тёмной темы (ночь `#07060c`, контраст около 6,7). Поле: `#12130C` (тёмный край), `#601F25` (красный), `#181748` (синий), `#BB8B5E` (золото).

## Структура

Локально, 2026-11-02. `python scripts/pipeline/separate.py the-dawn`: Demucs `htdemucs`, четыре стема в `work/the-dawn/stems/` (в git не входят), около 78 с. Затем `python scripts/pipeline/sections.py the-dawn`. Черновик `work/the-dawn/sections.suggested.json`.

Громкость стемов по этим окнам, не слух человека. Там, где скрипт поставил голос, вокальный стем поднимается с примерно −75 дБ до −45…−27 дБ. Самые явные окна: 52,55–59,25, 64,30–75,35, 88,60–99,55, 106,30–115,75, 133,20–164,90, 201,80–206,05. Вспышка 169,50–169,65 длится 0,15 с. В окне 201,80–206,05 вокальный стем громче стема other, ударные всё ещё громче вокала.

`transcribe.py` (модель large-v3, VAD) записал пустой список. Первый запуск упал на `cublas64_12.dll`. Повтор той же команды с `CUDA_VISIBLE_DEVICES=-1` дошёл до конца. Букв он не дал, поэтому окна в вокальные строки не переносились. В `lyrics.json` одна инструментальная секция на всю запись, ключ `ensemble`, флаги `attribution-unverified` и `timing-draft`.

## Тайм-коды

- Статус: draft. Источника реплик нет: файл субтитров не получен, текста песни на кадрах нет. `jobs/the-dawn.json` не создавался. Пословная заливка при draft выключена.
