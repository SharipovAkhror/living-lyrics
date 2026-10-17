# Karitas — источники и статус проверки

Проверка 17 октября 2026. Дословные тексты и порядок строк — в `canon.md`. Подтверждённые credits внесены в `song.json`. В интерфейс попадают только пункты из раздела «Подтверждено страницей». Остальные имена записаны с оговоркой, откуда они видны и чего не хватает.

## Запись

- Файл на сайте есть: длительность 977,05 с, `audio.status = ready`, дорожка YouTube 140 официального видео [xWwMzfGVikA](https://www.youtube.com/watch?v=xWwMzfGVikA), получена 16 октября 2026 (sha256 в `song.json`). Открытый m4a в gitignore; в дереве лежит `content/audio-enc/karitas/high.m4a.enc` и `public/audio/karitas/peaks.json`. Прежняя пометка «аудиофайл не получен» и длительность 490 с относились к прототипу и больше не верны.
- Концерт: Holland Festival, Het Concertgebouw, Амстердам, понедельник 6 июня 2022, 20:30. Исполнители на афише: Cappella Amsterdam, Amsterdam Andalusian Orchestra, Sami Yusuf and others. Автор сочинений на афише — Sami Yusuf. Имен по голосам и дирижёра на странице нет. Источник: [cappellaamsterdam.nl, Holland Festival 2022: When Paths Meet](https://www.cappellaamsterdam.nl/en/production/holland-festival-2022-when-paths-meet/).
- Страница [samiyusuf.art/music/karitas](https://samiyusuf.art/music/karitas) и повтор той же справки на [samiyusuf.art/music/one-when-paths-meet](https://samiyusuf.art/music/one-when-paths-meet/): запись живьём на Holland Festival в Royal Concertgebouw, июнь 2022; Cappella Amsterdam, Amsterdam Andalusian Orchestra и ансамбль автора; лады Bayati Shiraz и Rast, эолийский; соло эрху, уда, ная и скрипки без имён; слова — Физули (азербайджанский поэт XVI в.) и Хильдегарда (XII в.); маввали — аш-Шуштари (XIII в.) и ан-Набулси (сирийский поэт XVII в.). Композитор — Sami Yusuf.
- [play.samaanetwork.net/music/karitas](https://play.samaanetwork.net/music/karitas/) открывается как карточка каталога. Буклета, списка хора и имени Francesca Thompson на ней нет. Прежняя ссылка на эту страницу как на источник имён и продюсера не подтвердилась.
- Живое описание ролика xWwMzfGVikA, снятое 17 октября 2026 (HTML страницы и API Invidious), блока CREDITS не содержит и строки Mahammad в нём нет. Поисковая выдача того же ролика такой блок показывает. Это либо старая редакция описания, либо текст, добавленный поиском. Страницу, на которой блок виден целиком, не открывали. Имена из выдачи — ниже, отдельно.
- Альбом в `song.json`: When Paths Meet (Live at The Holland Festival), год 2023. Дата EP «12 декабря 2022» и дата каталога Samaa «13 января 2023» в этом проходе по Apple Music и карточке каталога заново не открывались. Потоковая длина 15:51 (951 с) тоже не перепроверялась. Времена в `canon.md` относятся к файлу 977 с, не к потоковой версии.
- Страница хора [sami-yusuf-one](https://www.cappellaamsterdam.nl/en/sami-yusuf-one/) — удалённая премьера ONE 2020 года (другой состав, в том числе Селим Бояджи, танбур). К этой записи 2022 года не относится.

## Подтверждено страницей

| роль | кто | источник |
|---|---|---|
| композитор и автор аранжировки | Sami Yusuf | samiyusuf.art/music/karitas; афиша Cappella Amsterdam |
| слова газели | Физули, в справке исполнителя — азербайджанский поэт XVI в. | samiyusuf.art/music/karitas. Дорожка титров подписана Turkish. Форма «как поётся» — в `canon.md`, раздел 1 |
| латинские слова | Хильдегарда Бингенская, XII в. | samiyusuf.art/music/karitas. Текст антифона — `canon.md`, раздел 2 |
| маввали | аш-Шуштари, XIII в.; ан-Набулси, XVII в. | samiyusuf.art/music/karitas. Какой бейт чей — `canon.md`, разделы 4–6. Бейт о терпении релиз относит к ан-Набулси, издания этого не подтверждают |
| хор | Cappella Amsterdam, без имён | афиша и справка исполнителя. Что именно поёт хор, нигде не подписано |
| оркестр | Amsterdam Andalusian Orchestra, без имён | афиша и справка |
| ансамбль автора | назван, без имён | samiyusuf.art/music/karitas |
| лады | Bayati Shiraz, Rast, эолийский | samiyusuf.art/music/karitas |
| соло без времени и без имён | эрху, уд, най, скрипка | samiyusuf.art/music/karitas |
| место и дата | Het Concertgebouw, 6 июня 2022, 20:30 | афиша Cappella Amsterdam |
| мавваль ан-Набулси | Ahmed Elmaai, Amsterdam Andalusian Orchestra | короткие ролики исполнителя [-5qOGo_ai0E](https://www.youtube.com/watch?v=-5qOGo_ai0E) и [ueuVK9cuLgQ](https://www.youtube.com/watch?v=ueuVK9cuLgQ). HTML описаний 17 октября 2026 заново не скачан (зеркало ответило ошибкой). Имя и цитаты строк держатся на прошлом проходе и на поисковой выдаче этих роликов. Поёт ли он бейт аш-Шуштари — не сказано |

Кто поёт газель и антифон, страницы не пишут. «Физули — Сами Юсуф, антифон — Cappella Amsterdam» — вывод по составу, не по титру. Ролик «Celestial Vocals of Cappella Amsterdam» показывает хор в Karitas и не указывает фразу.

## Имена из поисковой выдачи описания

Блока нет в живом описании от 17 октября 2026. В интерфейс и в `song.json` не переносить, пока страница с блоком не открыта. Написание — как в выдаче.

Sami Yusuf & Ensemble: Sami Yusuf, вокал; Ömer Avci, бендир; Eyüpcan Açikpazu, най; Hasan Hekimoglu, уд; Onur Cicin, канун; Guo Gan, эрху; Seyyed Mohammad Jaberi, даф; Huseyin Can Pala, баглама; Mahyar Toreihi, сантур; Jon Lawton, гитара.

Cappella Amsterdam. Сопрано: Sanda Audere, Elisabeth Blom, Marijke van der Harst. Альт: Hebe de Champeaux, Irene Sorozabal, Inga Schneider. Тенор: Jon Etxabe Arzuaga, Jelle Leistra, Diederik Rooker. Бас: Jan Douwes, Angus van Grevenbroek, Johan Vermeer.

Amsterdam Andalusian Orchestra: Abderrahim Semlali, скрипка; Jaafar Lougmani, скрипка; Mohamed Al Mokhlis, скрипка; Hessel Moeselaar, альт; Hannelore de Vuyst, скрипка; Haytam Safia, уд; Marianne Noordink, най; Ruven Ruppik, ударные; Khaili Ahmed, ударные; Salah Mesbah, вокал; Dwight Breinburg, ударные и вокал; Mohamed Chairi, рабаб и вокал; Daniël van Huffelen, контрабас; Ahmed el Maai, канун, уд и вокал.

Там же, с той же оговоркой: перевод Dr Mohammad Faghfoory и Dr Oludamini Ogunnaike; режиссёр Henk van Engen; ассистент режиссёра Lieke van Zutphen; продюсер Holland Festival Rianne Super; технический продюсер The Crew (Daan Kluin, Kaj de Groot); свет Niels Hakkel, Ray van Verseveld; координатор Monica Hoogendoorn. Это титры съёмки, не авторы слов.

Мохаммед аль-Мохлис и Хайтам Сафия в прошлом проходе были помечены как отсутствующие в официальных титрах. В поисковой выдаче они есть (скрипка и уд; написание Haytam). Пост, приписанный Сами Юсуфу, называет соло: скрипка Mohamed Al Mokhlis, най Marianne Noordink, уд Haytham Safia, вокал Dwight Breinburg, Salah Mesbah и Ahmed El Maai. Страницу поста не открывали: [facebook.com/SamiYusuf, ролик 677294390662025](https://www.facebook.com/SamiYusuf/videos/677294390662025/). Пока страница не открыта, соло за этими именами не закреплять. Какой из перечисленных скрипачей играет соло в записи — выдачей не решено.

Го Ган как эрху назван и в более поздних официальных публикациях (описание ролика e3K2K8GImDs и ролик Facebook 1014048180546138). Полный состав оттуда не берём. Страницы в этом проходе не открывались, только поисковая выдача.

Francesca Thompson ни на одной открытой странице нет. В источники не входит.

## Слова, которые ещё не страница исполнителя

Порядок поиска — `docs/methodology/04-text.md`. Итог сверки:

| часть | автор в эталоне | подтверждение |
|---|---|---|
| газель, бейты 2658–2662 месневи; поются 1, 2, 4, 5 | Физули | слова: tr.wikisource и цитата Догана 2000 у Каяокая (Littera Turca, 2024); az.wikisource (Анар, 1999) — современная орфография. Как поётся: 1 источник, титры. Арабское письмо не найдено |
| антифон Karitas habundat | Хильдегарда | 2 источника: Hildegard Society и Cantus 588605. В титрах только перевод |
| يا ساقي القوم, бейт 1 | аш-Шуштари | 2 источника: aldiwan.net/poem69336 и диван, с. 80 (ablibrary.net). Огласовки титра — 1 источник |
| عيني لغير جمالكم, бейт 1 | ан-Набулси; зачин старше, есть у ат-Тилимсани | 2 источника: ar.wikisource и Harvard (Sulayman ibn Qiddees) |
| صبرت قلبي عليكم | по релизу ан-Набулси; в его десяти бейтах строки нет | слова: 1 источник, титры. Ближайший печатный бейт — ат-Тилимсани, с другим первым полустишием |
| يا هو, يا مولانا | возгласы, не стихотворение | 1 источник, титры |

Зеркало [nasheedlyrics.com/karitas-lyrics-sami-yusuf](https://nasheedlyrics.com/karitas-lyrics-sami-yusuf/) повторяет титры пословно и источником не считается.

## Лады, как их описывает автор

На странице исполнителя: от Bayati Shiraz и Rast к эолийскому. Ролик Facebook от 15 июля 2022 (736130174361646), страницу не открывали, в выдаче приписан Сами Юсуфу: начало в баяти-ширазе, затем нахаванд, отсылка к расту, эолийский лад Греции и Западной Европы, в коде — гармонический минор; кода — общее вступление, «не звук фьюжн». Пока страница не открыта, в текст о песне берём формулировку samiyusuf.art. Ролик от 26 июня 2022 (1404976556591841), тоже не открыт: слова Хильдегарды и Махаммада Физули, импровизации на эрху, уде, нае и скрипке, благодарность оркестру, хору и своей группе; эфир NTR 26 июня 2022, 19:15 CEST. Это не дата концерта 6 июня.

Короткий ролик лейбла (t5EqUNh9Fgg) в выдаче пишет «Muhammad Fuzuli». Страницу не открывали. В эталоне имя не нормализовано сверх источников раздела 1 в `canon.md`.

## Тайм-коды

Границы в `lyrics.json` — черновик на 490 с (`timing.status = draft`). Они не совпадают с файлом 977 с. Соответствие секций — таблица в `canon.md`, раздел «Сетка 490 с». Слова по файлу ещё не выровнены.
