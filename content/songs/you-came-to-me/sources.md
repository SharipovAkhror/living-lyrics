# You Came To Me — источники и статус проверки

Исполнитель: Sami Yusuf. В `song.json` попадает только то, что открыто в этом проходе.

## Запись

- Ссылка или файл: https://www.youtube.com/watch?v=z2_2cFityc4. Канал Sami Yusuf, https://www.youtube.com/@samiyusuf (oEmbed, 2026-11-01: author_name «Sami Yusuf», author_url тот же канал, title «Sami Yusuf  - You Came To Me #worldmusic»). Страница ролика, поле lengthSeconds: 240. Это 4:00, как в задании.
- Версия: сингл. Подпись `version.label`: «Сингл You Came To Me, 2009». Описание этого ролика: «Released on August 21, 2009» и «his first single under Andante Records». Названия концерта, города и слова live в названии и в описании нет. Формулу концерта не подставлял.
- Длительность, с: 240,05. Измерение `process_audio.py` по `work/you-came-to-me/source.m4a` (AAC, 44100 Гц, 2 канала, около 127 кбит/с). Карточка ролика 240 с с этим числом сходится. Громкость −8,7 LUFS, true peak 2,1 dBTP, `gainDb` −5,3. Числа написал скрипт.
- Откуда файл: одна попытка команды `song-status`, дорожка 140, файл `work/you-came-to-me/source.m4a` (в git не входит). Повторно ролик не скачивался. Открытый `public/audio/you-came-to-me/high.m4a` собран перепаковкой без перекодирования. `sha256` исходника: 61545a88660c7e292ad94ee5e773a2b262bfa3a20714c3c69b051ee2334e157e.

Описание этого ролика, прочитано со страницы 2026-11-01 (поле shortDescription):

- «Released on August 21, 2009, 'You Came to Me' … the very first video ever uploaded to his official channel … his first single under Andante Records».
- «Written from a place of spiritual intimacy and longing». К кому обращено «you», описание не говорит.
- CREDITS: «Music & Words by Sami Yusuf». «Published by Andante Records Administered by Fairwood Music (UK) Ltd for the World». «© Andante Records. All rights reserved».
- Ссылка на прослушивание: http://andnt.co/WhereverYouAre. Это не доказательство, что звук этого ролика равен дорожке альбома.
- Текста песни в текущем описании нет.

## Выпуск

- Год и лейбл сингла — из описания этого ролика: 21 августа 2009, Andante Records. В `song.json`: `release.year` = 2009, `release.label` = Andante Records. Поля альбома нет: страница этого ролика альбом годом не называет.
- Слова и музыка — «Music & Words by Sami Yusuf». В `credits`: композитор и слова, оба Sami Yusuf.

## Тексты

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| имя автора слов и музыки | Sami Yusuf | описание https://www.youtube.com/watch?v=z2_2cFityc4, строка Music & Words | имя, не буквы |
| английские строки и латинская формула | Sami Yusuf | https://www.youtube.com/watch?v=dbbIgfitajk, блок LYRICS | буквы, 1 источник |

Буквы песни в текущем описании ролика на 240 с не стоят. Их даёт лирик-видео Andante Records, https://www.youtube.com/watch?v=dbbIgfitajk (oEmbed 2026-11-01: канал Andante Records, название «Sami Yusuf - You Came To Me (Lyric Video) #worldmusic»). Длительность того ролика 257 с. Секунды с него не берутся. Сайты с адресом lyrics, letras, musixmatch в эталон не идут.

Зеркало старого описания того же ролика z2_2cFityc4: https://www.bandmine.com/yusufh/videos/2/z2_2cFityc4. Это не второй источник. Английские строки сходятся. Формула там без диакритики и с другим написанием второй половины. В песню взято написание листа Andante. Подробности в canon.md.

Порядок и число повторов — свидетель этой записи, файл work/you-came-to-me/transcript.json, в git не входит. Штатный scripts/pipeline/transcribe.py выбрал cuda и остановился: нет cublas64_12.dll. Свидетель снят той же моделью large-v3 на процессоре, обходным запуском, файл скрипта не менялся. Текст и секунды свидетеля в lyrics.json не копировались. Где свидетель расходится с листом, у строки флаг text-unverified.

Чтение адресата, не буквы. Описание этого ролика: духовная близость и тоска, к кому обращено you, не сказано. Заметка https://www.albawaba.com/news/sami-yusuf%E2%80%99s-new-single-%E2%80%98you-came-me%E2%80%99-released (прочитана 2026-11-01) цитирует блог автора: слова и музыка в ранние часы 23 ноября 2008, потеря, обида, боль, досада, затем «how truly blessed I am to be the slave of the One» и «my journey to Him», «This song is an encapsulation of that moment». Страница самого блога не открыта. Это чтение, не подпись строки. Заметка называет четыре версии сингла: English (Main), English-Arabic, English-Farsi, English-Turkish. Эта запись — ролик без языкового суффикса в названии. Арабская формула в ней всё же поётся, язык ar добавлен по свидетелю этой записи, буквы — латиница листа.

Глагол формулы, не буквы песни: https://sunnah.com/riyadussalihin:1407. Рияд ас-Салихин 1407 учит другой, более короткой формуле. Спетые слова с ним не совпадают.

## Исполнители

В карточке только Sami Yusuf. Других имён описание этого ролика не называет.

## Не подтверждено

- Страница альбома https://www.samiyusuf.art/music/wherever-you-are в этом проходе не открылась (пустое тело). Поисковая карточка того же адреса называет альбом 2010 и дорожку 4 «You Came to Me (English)». Пока страница не прочитана, альбом в `song.json` не стоит.
- Карточка YouTube Music «You Came to Me (English)», альбом Wherever You Are, «Released on: 2010-11-20», длительность в карточке поиска 4:07. Это не 240 с этого ролика. Секунды оттуда не брать. Страницу целиком ещё не открывал.
- Страница концерта https://samiyusuf.art/music/live-at-the-dubai-opera в поисковой карточке говорит: сочинено в 2008, выпущено в 2010, первый сингл альбома Wherever You Are. Это не описание ролика 4:00. В подпись версии не перенесено. Страницу целиком ещё не открывал.
- Ролик https://www.youtube.com/watch?v=dbbIgfitajk на канале Andante Records, lengthSeconds 257 (4:17), в описании есть блок LYRICS и та же строка «Music & words by Sami Yusuf». Это другой хронометраж. Буквы можно сверить на стадии 4, секунды — нет.
- Ролики арабской, турецкой и персидской версий и концертные ролики — другие записи. Их текст в эту песню не переносится. Заметка Al Bawaba называет четыре версии одного сингла. В эту карточку вошла только запись ролика на 240 с.
- Палитра и обложка: цветов с обложки ещё нет. Заглушка палитры остаётся.
- Страница блога, которую цитирует Al Bawaba, не открыта. В карточку она не перенесена.
- Обложка не снималась. Цвета палитры по-прежнему заглушка. Каталог public/covers этой задаче не принадлежит.

Официальные субтитры ролика на 240 с: одна попытка `python -m yt_dlp` (команды `yt-dlp` в PATH нет), языки ar, fa, tr, az, he, hi, la, de, en. Ответ: субтитров для этих языков нет. Повторно не запрашивались. В review: «официальные субтитры: пусто».

Видео того же ролика, формат 18, одна попытка, файл work/you-came-to-me/video.mp4, в git не входит. Кадры: work/you-came-to-me/lyric-frames, 68 файлов, буквы с них не читались. Титры экрана и просмотр инструментов ждут просмотра. agy не вызывался.

## Тайм-коды

- Статус: draft. Границы секций — карта стема htdemucs: 0–11,20 вступление, 11,20–218,40 пение, 218,40–240,05 окончание. Конец карты был 240,00 и продлён до длительности файла. Границы не слушались. Время слов — равная раскладка внутри пения, не выравнивание. Пословная заливка выключена.
