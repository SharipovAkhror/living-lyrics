# Alive — источники и статус проверки

Исполнитель: Sami Yusuf. В `song.json` попадает только то, что открыто в этом проходе. Поисковая цитата без открытой страницы остаётся здесь и в `review`, не в карточке.

## Запись

- Ссылка или файл: https://www.youtube.com/watch?v=okICm2EWb7U. Короткая форма, которую прислал владелец: https://youtu.be/okICm2EWb7U. Канал Sami Yusuf, https://www.youtube.com/@samiyusuf. Название по oEmbed: «Sami Yusuf - Alive (feat. Homayoun Shajarian) #worldmusictraditions #worldmusic». Дата публикации по карточке поиска YouTube: 2025-03-23. Длительность ролика по той же карточке: 11:26. В названии нет слов live, города и названия концерта.
- Версия: сингл. Подпись `version.label`: «Сингл Alive, 2025». Год совпадает у даты ролика, Qobuz и Shazam (ниже). Формулу концерта не подставлял: страница выпуска концертом этот ролик не называет.
- Длительность, с: 686,34. Это измерение `process_audio.py` по `work/alive/source.m4a` (AAC, 44100 Гц, 2 канала, около 128 кбит/с). Карточка ролика 11:26 с этим числом сходится. Магазинная дорожка короче, см. раздел «Выпуск».
- Откуда файл: одна попытка команды `song-status`, дорожка 140, файл `work/alive/source.m4a` (в git не входит). Повторно ролик не скачивался. Открытый `public/audio/alive/high.m4a` собран перепаковкой без перекодирования. Шифрование отложено решением оркестратора до конца маршрута: `AUDIO_KEY` по-прежнему нет, открытый m4a в git не кладётся.

## Выпуск

Открыто напрямую 2026-10-24.

- Qobuz, альбом Alive, https://www.qobuz.com/ie-en/album/alive-sami-yusuf-homayoun-shajarian/o3hadrsg02wka. Дата 23/03/2025, лейбл Andante Records, 1 диск, 1 дорожка, 24-bit/48 kHz. Дорожка Alive, 00:11:12. В подписи дорожки: Rumi — lyricist; Sami Yusuf — composer, producer, main artist; Homayoun Shajarian — main artist. Отсюда в карточке `release.album` = Alive, `release.year` = 2025, `release.label` = Andante Records, `credits` композитора, продюсера и автора слов, `poets`.
- Shazam, https://www.shazam.com/song/1801655259/alive. «Alive was released on March 23, 2025 by Andante Records as a part of the album Alive - EP». Альбом Apple Music: https://music.apple.com/uz/album/alive-ep/1801655257. Исполнители: Sami Yusuf, Homayoun Shajarian. Композитор: Sami Yusuf. Автор слов: Rumi. Продюсер: Sami Yusuf. Имя продукта у Apple — «Alive - EP», у Qobuz заголовок альбома — «Alive». Дата, лейбл и состав авторов совпадают. В подпись версии взято слово «сингл» и название Alive, не слово EP: его нет в названии ролика владельца.
- oEmbed ролика владельца подтверждает канал Sami Yusuf и имя Homayoun Shajarian в названии. Отсюда `featuring`.

Разница 11:26 и 11:12 больше секунды. Это разные временные шкалы. Секунды слов и видео — только из ролика https://www.youtube.com/watch?v=okICm2EWb7U. Магазинный мастер 11:12 для тайм-кодов не использовать.

## Тексты

Дословная цитата персидской газели — в `canon.md`. Это текст издания, не порядок пения.

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| имя автора слов | Rumi | Qobuz и Shazam, адреса выше | имя, не буквы |
| персидский оригинал и переводы на турецкий и английский как языки композиции | автор объявления — Sami Yusuf | короткий ролик того же канала https://www.youtube.com/watch?v=WaXYDgsKSxU (описание в карточке поиска) и страница Homayoun Shajarian https://www.youtube.com/watch?v=P8HF-bx5u1U | языки, не буквы и не секунды |
| газела 1393, 21 бейт, буквы цитаты | مولانا на странице Ганджура; в карточке песни — Rumi | https://ganjoor.net/moulavi/shams/ghazalsh/sh1393, открыта 2026-10-24. Цифровой источник страницы — ویکی‌درج, https://ganjoor.net/sources/wikidorj/ | буквы и частичные огласовки этой страницы |
| тот же состав и порядок бейтов | страница не называет подготовителя издания | Викитека, oldid 78574, 21 декабря 2015, участник MRG90: https://fa.wikisource.org/w/index.php?title=دیوان_شمس/مرده_بدم_زنده_شدم_گریه_بدم_خنده_شدم&oldid=78574 | состав, порядок и согласные буквы; два лишних «و» против Ганджура записаны в `canon.md` |

Связь газели с этой записью: выпуск называет Rumi и не приводит строк. Номер 1393 совпал с поисковой цитатой непрочитанной страницы samiyusuf.art. Сайты текстов на ту же газель не копировались. Официальные субтитры ролика пусты. Порядок строк снят с текста на экране того же ролика (`docs/analysis/alive/ocr.json`, чтение Gemini 2026-10-24) и сверен с распознаванием вокального стема (`work/alive/transcript.json`, в git не входит). Буквы персидского — из цитаты в `canon.md`. Буквы английского и турецкого — с кадра ролика: поиск 2026-10-24 по en.wikisource.org и tr.wikisource.org страницы с этими строками не дал, отдельной публикации, кроме ролика, не открыто.

Объявление на канале Sami Yusuf (ролик 58 с, не ролик владельца) говорит: пьеса на Turkish Rast, в основе стихотворение Rumi целиком, рядом турецкий и английский переводы, хор из Azerbaijan, музыканты из Iran, Turkey и UK. Страница Homayoun Shajarian повторяет: original Persian alongside Turkish and English translations. Его ролик длится 11:18, это не шкала ролика владельца. Из этих двух страниц взяты только языки композиции, не секунды и не буквы.

Комментарий канала @samiyusuf под роликом владельца (карточка поиска): Rumi’s words in full, снова с Homayoun Shajarian, master musicians and a remarkable choir. Имен в этом комментарии нет.

## Исполнители

В `song.json` внесены только Sami Yusuf и Homayoun Shajarian и автор слов Rumi. Источники — Qobuz, Shazam и название ролика.

## Не подтверждено

- Прямое открытие https://samiyusuf.art/chronicles/news/alive-news-releases вернуло капчу (страница обновления на `/.well-known/sgcaptcha/`), тело заметки не прочитано. Поисковая выдача цитирует с этого адреса: «New Single by Sami Yusuf», газела номер 1393 из Divan-e Shams-e Tabrizi, танбур Seyyed Ali Jaberi, даф Mohamad Jaberi. Пока страница не открыта, этих имён и номера в `song.json` нет.
- Описание самого ролика владельца целиком не прочитано: страница YouTube без подстановки скрипта отдала только колонтитул. Две поисковые цитаты одного адреса расходятся (короткая: Rumi и Andante Records; длинная совпадает с текстом чужого ролика). Длинный список имён в карточку не перенесён.
- Чужой ролик https://www.youtube.com/watch?v=UsUP_dUt5KI (канал Sami Yusuf World, 11:18) публикует список инструменталистов и переводчиков. Это не ролик владельца. Имена оттуда не использованы.
- Ролик https://www.youtube.com/watch?v=AhFpaDdWnf4 на канале Sami Yusuf длится 11:12, в описании «Provided to YouTube by Andante Records», «Released on: 2025-03-23». Это длина магазинной дорожки, не ролика владельца.
- Английский припев и турецкий пересказ поются: их слышит распознавание вокального стема, и они стоят на экране как оригинал. Английские строки рядом с персидским и турецким — перевод на экране, в `lyrics.json` их нет. Кто сложил английский припев и кто перевёл на турецкий, открытые страницы выпуска не называют.
- Кадры ролика владельца разобраны в `docs/analysis/alive/vision.json` (172 кадра, 0–684 с, шаг 4 с). Файл видео — одна попытка формата 18, `work/alive/video.mp4` (в git не входит), ffprobe 686,29 с. Ни один кадр не пометил инструмент или певца (`visible` ложь, `players` пуст). Заметки называют мозаичную анимацию, титры имён Sami Yusuf и Homayoun Shajarian, текст на экране по-персидски, по-английски и по-турецки и тёмный кадр в конце. Буквы с экрана в `lyrics.json` не переносились. Сведение и вступления: принятых инструментов 0, ключи секций не менялись. Название концертом ролик не называет, и кадр сцены просмотр не описал.
- Годы жизни Rumi на открытых страницах выпуска не написаны.
- Лад Rast назван в объявлении автора, не в открытом описании ролика владельца. В карточке поля лада нет.
- Снимки бумаги на странице Ганджура (Фурузанфар, изображение ۷۲۱; Амир Кабир, ۱۳۷۶, изображение ۵۲۹) по буквам не прочитаны.
- Официальные субтитры ролика владельца: одна попытка, субтитров нет. Повтор не делался. Подробности в `canon.md`.

## Обложка

- Файл: `public/covers/alive/source.jpg`, 1400×1400, скачан 2026-10-24 с обложки Apple Music того же выпуска: https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ae/1f/74/ae1f7459-9a2b-6dc8-af65-d3f6414deda4/cover.jpg/1400x1400bb.jpg. Страница альбома: https://music.apple.com/uz/album/alive-ep/1801655257. Название продукта у Apple — Alive - EP.
- Меньший кадр той же обложки есть на Qobuz: https://static.qobuz.com/images/covers/ka/2w/o3hadrsg02wka_600.jpg. В репозиторий взят кадр Apple 1400 px, не кадр 600.
- Цвета в `song.json` сняты с файла, не подобраны по настроению. Акцент `#032845` — точка диска обложки (700, 532) и (700, 868). `#97BBD8` — тот же оттенок светлее, для тёмной темы. Поле: `#032845` (диск), `#5FD1D9` (бирюзовая лента, медиана), `#14694D` (зелёная лента, медиана), `#B2804E` (охра, медиана). Бирюза на белом не дотягивает до 4,5 : 1, поэтому акцентом не стоит.

## Структура

Локально, 2026-10-24, без GitHub Actions. `python scripts/pipeline/separate.py alive`: Demucs `htdemucs`, четыре стема `vocals`, `drums`, `bass`, `other` в `work/alive/stems/` (в git не входят). Отделение смеси заняло 3 мин 47 с по полосе прогресса, вместе с загрузкой весов команда вышла за 253 с. Затем `python scripts/pipeline/sections.py alive`: пауза голоса длиннее 4 с — инструментальная секция. Черновик `work/alive/sections.suggested.json`. Секунды перенесены в `lyrics.json`. Конец последней секции продлён с 686,30 до 686,34 — это конец измеренного файла, сетка шага 0,05 с до него не дошла.

Сверка громкости стемов, не слух человека. В окнах, где скрипт поставил голос, вокальный стем на 40–50 дБ выше, чем в паузах. В окне 56,20–80,10 ударные громче вокала (около −18,8 дБ против −22,9 дБ), голос при этом есть. Хвост с 670,20: к 671 с все четыре стема падают к нулю, до конца файла цифровая тишина. У этой секции список инструментов пустой, подпись «Тишина». У проигрышей ключ `ensemble` и флаг `attribution-unverified`: тембр по стему не назывался. У окон голоса ключ `voice` и флаг `text-unverified`: слов стем не разбирает. Хор из объявления автора в ключ не ставился.

Человек эти границы ухом не двигал. Флаг `timing-draft` оставлен. Окна голоса, где появились строки, стали вокальными секциями внутри тех же границ стема. Окна 56,20–80,10 и 500,00–524,25 остались без строк: распознавание слов там не дало.

## Тайм-коды

- Статус: draft. Секунды секций — из вокального стема. Черновые секунды слов разложены по окнам экранного текста, чтобы строка лежала внутри своей секции. Это не измерение. Измерение — выравнивание `align.py` по вокальному стему. `docs/analysis/alive/cues.json` держит те же окна, без текста реплики: официальной дорожки субтитров нет, окна экрана стоят вместо неё.

## Пояснения

Открыто для пояснений строк, 2026-10-31. В пояснение попало только то, что открыто в этом проходе.

- Арберри, Mystical Poems of Rumi, стихотворение 170 (Фурузанфар 1393). Первый бейт на с. 183, бейты 2–15 на с. 184, бейты 16–21 на с. 185. Примечания 9, 18, 19 и 21 на с. 402. Текст: https://archive.org/stream/MysticalPoemsOfRumiArberry_201806/mystical%20poems%20of%20Rumi%20%28Arberry_djvu.txt
- Стейнгасс, A Comprehensive Persian-English Dictionary, London, Routledge, 1892. Страницы 236 (pāyanda), 546 (daulat), 608 (zāyanda), 626 (zinda и zinda-kun), 631 (zahra и zuhra), 772 (shaikh). https://dsal.uchicago.edu/dictionaries/steingass/
- Кулиев: 2:144 (кибла), 12:10 и 12:31 (Юсуф), 67:3 (семь небес). https://quran-online.ru/2:144 https://quran-online.ru/12:10 https://quran-online.ru/12:31 https://quran-online.ru/67:3
- Буквы персидской газели: https://ganjoor.net/moulavi/shams/ghazalsh/sh1393
- Буквы английского припева и турецкого пересказа: кадр ролика https://www.youtube.com/watch?v=okICm2EWb7U

В пояснениях не утверждается как словарный факт то, чья страница не открыта: Редхаус на турецкие слова, статья Стейнгасса на هول, отдельная статья на عارف, этимология فرخ.

## Круг 2, 2026-10-31

Заново открыты и сверены с текстом страницы: Ганджур, газель 1393; Арберри, поток djvu (бейты 183–185 и примечания на с. 402); Стейнгасс, с. 236, 546, 608, 626, 631, 772; Кулиев, 2:144, 12:10, 12:31, 67:3.

Не открыты в этом круге, из пояснений убраны: кадры https://www.youtube.com/watch?v=okICm2EWb7U. На с. 608 есть زاينده «Bringing forth; a mother». Глагола زائیدن на этой странице нет, пояснение на него не опирается.

## Круг 3, 2026-10-31

Страницы открыты в этом круге. Ниже — короткая цитата с самой страницы.

- Стейнгасс, с. 236, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=236. pāyanda: “Firm, solid, lasting, perpetual”.
- С. 546, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=546. daulat: “good turn of fortune; felicity, wealth, victory; power, dominion, empire; a state, reign, dynasty”.
- С. 608, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=608. zāyanda: “Bringing forth; a mother”. zāʼīdan: “To bring forth (a child); to originate, appear, come forth”. Рядом zāydan: “To be born; to beget”.
- С. 626, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=626. zinda: “Alive, living; life”. zinda shudan: “To become alive”. zinda-kun: “One who brings to life”.
- С. 631, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=631. zahra: “Boldness, spirit; power, vigour; the gall-bladder, bile”. zuhra: “The planet Venus”.
- С. 772, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=772. shaikh: “A venerable old man; a man of fifty and upwards; a man of authority, a chief… doctor learned in religion and law”.
- С. 812, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=812. tarab: “Skipping, leaping, dancing for joy; cheerfulness, joy, gladness; motion; emotion; grief, sadness”.
- С. 1444, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=1444. nayam: “(for na am), I am not”. nīm: “A half”.
- С. 1518, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=1518. haul: “fright, terror”. hol: “High, lofty; true, just; straight.”
- Арберри, поток https://archive.org/stream/MysticalPoemsOfRumiArberry_201806/mystical%20poems%20of%20Rumi%20%28Arberry_djvu.txt. Маркер [ 183 ] стоит перед бейтом 169; стихотворение 170 сразу после. “I was dead, I became alive; I was weeping, I became laughing”. Маркер [ 184 ]: “He said, ‘You are not mad, you are not appropriate to this house’; I went and became mad, I became bound in shackles.” И “for out of grace and generosity I am now coming to you.” Маркер [ 185 ]: “I have become bright and bountiful.” “I was Joseph, henceforth I have become the waxing Joseph.” После маркера [402]: “9. ‘Impotent’: i.e. ‘plucked clean of feathers.’” “18. ‘The seven layers’: the seven heavens.” “19. Joseph, after coming up from the well, waxed in beauty and power.” “21. ‘The face’: a pun on rukh, which also means ‘rook.’” В том же стихотворении 170: “Do not move from my breast”. “Move silently like a chessman… I have become happy and blissful.” “Your paper gives thanks for your limitless sugar.”
- Ганджур, https://ganjoor.net/moulavi/shams/ghazalsh/sh1393. Заголовок «غزل شمارهٔ ۱۳۹۳». «مُرده بُدم زنده شدم، گریه بُدم خنده شدم». «زانک من از لطف و کرم سوی تو آینده شدم». «یوسف بودم ز کنون یوسف زاینده شدم». Пересказ «هوش مصنوعی» на той же странице в цитату не брался. Английского «you have lit the fire» на странице нет.
- Кулиев, https://quran-online.ru/12:31. «Когда они увидели его, то так превознесли его, что порезали ножами себе руки».
- https://quran-online.ru/2:144. «Мы обратим тебя к кибле, которой ты останешься доволен. Обрати же свое лицо в сторону Заповедной мечети.»
- https://quran-online.ru/67:3. «Он создал семь небес одно над другим.»

Не открыты в этом круге и в пояснениях не цитируются: кадры https://www.youtube.com/watch?v=okICm2EWb7U, Редхаус, отдельный лист Лейна. Аят 12:10 как спасение из колодца в пояснения Юсуфа не входит: примечание 19 говорит о колодце, аят 12:19 в эти пояснения не брался.


## Круг 4, 2026-10-31

Страницы открыты в этом круге. Цитата — с самой страницы.

- Стейнгасс, с. 236, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=236. pāyanda: “Firm, solid, lasting, perpetual”.
- С. 546, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=546. daulat: “good turn of fortune; felicity, wealth, victory; power, dominion, empire; a state, reign, dynasty”.
- С. 631, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=631. zahra: “Boldness, spirit; power, vigour; the gall-bladder, bile”. zuhra: “The planet Venus”.
- С. 1518, https://dsal.uchicago.edu/cgi-bin/app/steingass_query.py?page=1518. haul: “fright, terror”. hol: “High, lofty; true, just; straight.”
- Арберри, поток https://archive.org/stream/MysticalPoemsOfRumiArberry_201806/mystical%20poems%20of%20Rumi%20%28Arberry_djvu.txt. В этом OCR маркера [ 183 ] нет. Первый бейт стихотворения 170 стоит сразу перед маркером [ 184 ]: “I was dead, I became alive; I was weeping, I became laughing; the power of love came, and I became everlasting power.” После [ 184 ]: “You are not appropriate to this house”; “I went and became mad, I became bound in shackles”; “You are not slain”; “I became a fool, I became straightened”; “the qibla of this assembly”; “Go not on the way, do not become pained”; “You are the fountain of the sun, I am the shadow of the willow”; “Your paper gives thanks for your limitless sugar, for it came into my embrace”. После [ 185 ]: “through its gaze and circling I became light-receiving”; “I have become bright and bountiful”; “I became the two hundredfold slcy”; “I was Joseph, henceforth I have become the waxing Joseph.” Примечание под [402], “NOTES TO PAGES 171-178”, стихотворение 170: “19. Joseph, after coming up from the well, waxed in beauty and power.”
- Ганджур, https://ganjoor.net/moulavi/shams/ghazalsh/sh1393. «کز کرم و بخشش او روشن بخشنده شدم» — без союза. «یوسف بودم ز کنون یوسف زاینده شدم». К бейту бумаги и сахара, пояснение без пометы «هوش مصنوعی»: «در قدیم شکر را در کاغذ پیچیده و به خریدار و مشتری می‌داده‌اند». Пересказ с пометой «هوش مصنوعی» в пояснения не брался.
- Кулиев, https://quran-online.ru/12:31. «Когда они увидели его, то так превознесли его, что порезали ножами себе руки». На той же странице толкование ас-Саади: «были очень поражены его красотой» и «Никогда ранее они не видели подобной красоты». Слова «красота» в самом переводе Кулиева на этой странице нет: там «превознесли».
- https://quran-online.ru/2:144. «Мы обратим тебя к кибле, которой ты останешься доволен. Обрати же свое лицо в сторону Заповедной мечети.»

Не открыты в этом круге: Редхаус, лист Лейна, кадры ролика. Пояснение en5-01 по-прежнему без страницы припева.

