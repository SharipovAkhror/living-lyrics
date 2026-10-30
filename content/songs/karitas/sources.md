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

## Закрытый набор этой записи

Соло, которые открытая страница этой записи называет без времени и без имён. Имена из поисковой выдачи ниже в набор не входят. Оркестр без поимённых инструментов — `ensemble`.

- erhu
- oud
- ney
- violin
- ensemble

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
| عيني لغير جمالكم, бейт 1 | релиз и шапка Викитеки: ан-Набулси. Страница ат-Тилимсани в круге 2 не открыта | ar.wikisource открыта; Harvard в этом круге отдал заголовок |
| صبرت قلبي عليكم | по релизу ан-Набулси; в его десяти бейтах строки нет | слова: 1 источник, титры. Страница ат-Тилимсани в круге 2 не открыта и в пояснение не взята |
| يا هو, يا مولانا | возгласы, не стихотворение | 1 источник, титры |

Зеркало [nasheedlyrics.com/karitas-lyrics-sami-yusuf](https://nasheedlyrics.com/karitas-lyrics-sami-yusuf/) повторяет титры пословно и источником не считается.

## Адреса страниц

Полные адреса тех же страниц, что уже названы в `canon.md`. Новых утверждений нет.

- Газель Физули, tr.wikisource: https://tr.wikisource.org/wiki/%C3%96yle_ser-mestem_ki_idr%C3%A2k_etmezem_d%C3%BCny%C3%A2_nedir
- Антифон Хильдегарды, International Society of Hildegard von Bingen Studies: https://www.hildegard-society.org/2014/11/karitas-habundat-antiphon.html
- Диван аш-Шуштари, с. 80: https://ablibrary.net/book_content/b/9579/80
- Десять бейтов ан-Набулси, ar.wikisource: https://ar.wikisource.org/wiki/%D8%B9%D9%8A%D9%86%D9%8A_%D9%84%D8%BA%D9%8A%D8%B1_%D8%AC%D9%85%D8%A7%D9%84%D9%83%D9%85_%D9%84%D8%A7_%D8%AA%D9%86%D8%B8%D8%B1
- Гарвардская страница о тех же бейтах и о бейте ат-Тилимсани: https://sites.harvard.edu/sulaymanibnqiddees/2023/09/01/my-eyes-only-see-your-beauty/

## Лады, как их описывает автор

На странице исполнителя: от Bayati Shiraz и Rast к эолийскому. Ролик Facebook от 15 июля 2022 (736130174361646), страницу не открывали, в выдаче приписан Сами Юсуфу: начало в баяти-ширазе, затем нахаванд, отсылка к расту, эолийский лад Греции и Западной Европы, в коде — гармонический минор; кода — общее вступление, «не звук фьюжн». Пока страница не открыта, в текст о песне берём формулировку samiyusuf.art. Ролик от 26 июня 2022 (1404976556591841), тоже не открыт: слова Хильдегарды и Махаммада Физули, импровизации на эрху, уде, нае и скрипке, благодарность оркестру, хору и своей группе; эфир NTR 26 июня 2022, 19:15 CEST. Это не дата концерта 6 июня.

Короткий ролик лейбла (t5EqUNh9Fgg) в выдаче пишет «Muhammad Fuzuli». Страницу не открывали. В эталоне имя не нормализовано сверх источников раздела 1 в `canon.md`.

## Тайм-коды

Границы в `lyrics.json` — черновик на 490 с (`timing.status = draft`). Они не совпадают с файлом 977 с. Соответствие секций — таблица в `canon.md`, раздел «Сетка 490 с». Слова по файлу ещё не выровнены.


## Перевод, сверка 18 октября 2026

- Натаниэл М. Кэмпбелл, перевод Karitas habundat, International Society of Hildegard von Bingen Studies, 20 ноября 2014. Латынь на той же странице сверена с изданием Барбары Ньюман. Сами с. 140 и 279 книги Symphonia не открыты.
- Прямого аята в песне нет. Статья Аляутдинова о суфизме от 1 октября 2020 терминов этой песни не определяет.
- James W. Redhouse, *A Turkish and English Lexicon* (1890), с. 1354, статья غوغا: для *kavga* в fuzuli-f8. Рядом со вздохами и стонами взято outcry, tumult.
- Залог *amantissima* в строке — действительный, по форме причастия *amans*. Чтение Кэмпбелла most beloved — на странице 20 ноября 2014. Чтение Ньюман most loving названо при приёмке; страницы *Symphonia* 140 и 279 не открыты.

## Обложка

Снято 2026-10-19 через iTunes Lookup, без ключа: https://itunes.apple.com/lookup?id=1654660354

Карточка называет релиз Karitas (ONE: When Paths Meet) - EP. Исполнители на карточке: Sami Yusuf, Cappella Amsterdam & Amsterdam Andalusian Orchestra. Дата релиза 2022-12-12. Длительность дорожки 951500 мс (951,5 с). Выше дата EP и потоковая длина 15:51 в этом проходе ещё не были открыты заново; эти две цифры теперь есть в ответе Lookup. collectionId 1654660348, trackId 1654660354. Страница того же релиза: https://music.apple.com/us/album/1654660348?i=1654660354

Файл обложки, размер в адресе заменён с 100×100 на 3000×3000: https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/86/c0/55/86c05550-97a3-a9fe-aaae-a216198a4523/cover.jpg/3000x3000bb.jpg

Запрос просил 3000×3000. Ответ Apple — JPEG 1440×1440. Он лежит как `public/covers/karitas/source.jpg`. 1024 и меньшие размеры — уменьшение этого файла, без растягивания.

Альбом из `song.json`, When Paths Meet (Live at The Holland Festival), collectionId 1661656156. Дорожка там называется Karitas (Live at The Holland Festival), trackId 1661656179, та же дата 2022-12-12 и те же 951500 мс, общая обложка альбома `fdc5ba6b-1052-ddc5-7b11-0e9129411e7a`. На плитку положена обложка отдельного EP. Файл проекта — дорожка YouTube, 977,05 с. Времена в `canon.md` относятся к этому файлу.


## Пояснения

Открыто для пояснений строк.

- Газель Физули, пять бейтов: https://tr.wikisource.org/wiki/Öyle_ser-mestem_ki_idrâk_etmezem_dünyâ_nedir (снимок oldid 171025). Третий бейт, о свидании, на странице есть и в записи не поётся. Расхождения записи и этой страницы (men и Ben, mey û и mey ü, içün и için, degil и degül, feryâdın и feryâdun, incidipdir и incidübdür, aşk и ışk, kavga и gavga) в пояснения строк не вынесены: они не объясняют смысл. Сомнение о гласном feryâdın — в review. Место газели в месневи и номера бейтов в этом проходе заново не открывались и в пояснения строк не вошли. Словарь Редхауса, с. 1354, не открыт, в пояснении последней строки его нет. Азербайджанская антология не открыта, чтение «мои вздохи» в пояснения не взято.
- Антифон: https://www.hildegard-society.org/2014/11/karitas-habundat-antiphon.html, страница Натаниэла Кэмпбелла от 20 ноября 2014. Латынь, его английский и комментарий. На странице названы рукописи D 157r и R 466v. Страницы Symphonia 140 и 279 не открыты, чтение Ньюман в пояснения строк не взято. Cantus в этом проходе не открыт.
- Шуштари, первый бейт: диван, с. 80, https://ablibrary.net/book_content/b/9579/80, заголовок «يا من هو هو». Те же слова: https://www.aldiwan.net/poem69336.html. Автоматический разбор на aldiwan не использован: страница сама пишет, что он сгенерирован. Поздний бейт «يا هو» этой касыды пояснением возгласа ياهو не служит.
- Набулси, десять бейтов: https://ar.wikisource.org/wiki/عيني_لغير_جمالكم_لا_تنظر (oldid 475413). В шапке автор Абд аль-Гани ан-Набулси. Категория страницы — тексты неизвестного источника. Строки صبرت قلبي в этих десяти бейтах нет. В третьем бейте там другая фраза: وعنكم ساعة لا أصبر.
- Возгласы. Коран 112:1, https://quran-online.ru/112:1. Кулиев: «Скажи: «Он — Аллах Единый,». Коран 2:286, https://quran-online.ru/2:286. Кулиев: «Ты — наш Покровитель.» Связка возгласа с аятом в пояснении помечена как чтение.
- Бейт о терпении. Автор спетой строки не установлен. Гарвардская страница в этом проходе отдала только заголовок, тело не прочитано, поэтому ближайший печатный вариант в пояснения не цитируется. Пояснение держится на отсутствии строки в десяти бейтах Набулси и на чтении спетых слов.

## Круг 2, 2026-10-31

Заново открыты: Викитека Физули; страница Общества Хильдегарды от 20 ноября 2014; диван, с. 80, и https://www.aldiwan.net/poem69336.html; десять бейтов ан-Набулси; Кулиев, 112:1 и 2:286.

Не открыты: кадры ролика, Редхаус, страницы Symphonia 140 и 279, страница ат-Тилимсани. Утверждение о нём из пояснения секции снято. Сомнение о гласном feryâdın оставлено в review, не в пояснении fuzuli-f7-1.
