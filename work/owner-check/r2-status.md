# T38, круг 2 — статус 57 дефектов

Сборка кадров `work/owner-check/r2/`: превью `127.0.0.1:4174` после `e2ccf2c2`.
Кадры `r2/proof/` — та же сборка, плюс замер перемотки и передачи строки.
Конец Alive (`r2/proof/alive-end-phone-dark.png`, `alive-end-pc-dark.png`) снят с превью после `f475b248`.
Перелёт из библиотеки (`r2/proof/flight2-*`) снят с превью после `acd2cf64`.
Кадры `new/` и `motion/stills/` сняты до круга 1 и здесь только как «до».

Замер передачи строки (телефон, тёмная, For True Lovers): с 40,0 до 43,2 с яркая строка держит верх 212 px и непрозрачность 1, полоса пояснения держит верх 612, высоту 44, ширину 361. Числа — `r2/proof/report.json`.

| № | Статус | Коммит | До | После | Что видно |
| --- | --- | --- | --- | --- | --- |
| 1 | исправлено | bbc6891d | motion/stills/phone-scrub-05…11, pc-scrub | r2/proof/scrub-phone-1…4.png, scrub-pc-1…3.png | Перетаскивание: наложение строк и инструментов 0, старых гравюр на арабской строке нет. Тема дефекта — тёмная, телефон и ПК. |
| 2 | исправлено | bbc6891d | motion/stills/pc-scrub, phone-scrub | те же scrub-*.png, scrub-phone-up.png | Сцена совпадает с подсказкой шкалы. Шапка и текст полосы до отпускания пальца остаются прежними, после отпускания шапка — «Газель Руми» (scrub-phone-up). |
| 3 | исправлено | 7988d0fc | motion/stills/*-load-06…11 | r2/proof/pause-hold-pc-a.png, pause-hold-pc-b.png, pause-hold-phone-a.png, pause-hold-phone-b.png | Пауза 0:42, тёмная, телефон и ПК. Фильтр гравюры none. На ПК сдвиг струн держится −1,186 px. Следующие 0,8 с: 0 отличающихся пикселей в прямоугольнике рисунков (max 0) на обоих. Первый кадр после открытия ещё пишет позу этого времени, дальше она стоит. |
| 4 | исправлено | bbc6891d | motion/stills/phone-load-00 | r2/i-have-come-alive-inst-phone-dark.png, inst-phone-light.png | Полоса стоит над плеером, подписи инструментов не закрывает. Ролик загрузки заново не снят. |
| 5 | исправлено | bbc6891d | fullsong/phone-dark/fast/f0440, phone-light/fast/f0449 | r2/for-true-lovers-line-a-phone-dark.png, line-a-phone-light.png, proof/handoff-phone-41.8.png | Полоса ниже колонки. На замере верх полосы 612, низ соседних строк около 478. |
| 6 | исправлено | bbc6891d | fullsong, обрывки «Эти…» | proof/handoff-phone-41.8.png, r2/for-true-lovers-line-a-pc-dark.png, line-a-phone-light.png | Ширина и верх полосы не меняются на смене строки. Текст — оборот «Эти английские строки исполнитель напечатал…», не «Эти…». На ПК карточка целиком. «ещё» открывает полный текст. |
| 7 | исправлено | bbc6891d | fullsong/*/fast, первые 60 с | proof/handoff-phone-41.8.png, handoff-phone-42.2.png, r2/for-true-lovers-line-a-pc-dark.png, line-b-pc-dark.png, line-a-phone-light.png, line-b-phone-light.png | Яркая строка на 212 px с 41,2 по 43,2 с. Предыдущая уходит вверх. Светлая и тёмная, телефон и ПК — на паре 0:40 / 0:43. |
| 8 | исправлено | bbc6891d | fullsong/phone-dark/fast/f0473–f0474 | те же handoff и line-a/line-b | На каждом замере от 40 до 43,2 с ровно одна строка с непрозрачностью 1. |
| 9 | исправлено | bbc6891d | fullsong/phone-dark/fast/f0411–f0413 | proof/handoff (t=40 следующая уже в колонке, t=41,2 она на опоре 212) | Входящая строка не прижата к плееру. |
| 10 | исправлено | bbc6891d | new/scene-line-*-dark | r2/for-true-lovers-line-a-phone-dark.png, line-a-pc-dark.png, i-have-come-alive-line-phone-light.png, line-pc-dark.png | Соседние строки серые и читаются, текущая темнее и крупнее. |
| 11 | исправлено | bbc6891d | fullsong/phone-light/f0128 | r2/for-true-lovers-line-a-phone-light.png, line-a-pc-light.png, i-have-come-alive-line-phone-light.png | Перевод под строкой, плотнее прежнего серого. На фиолетовом поле читается. |
| 12 | исправлено | 5986b7e0 | fullsong/sheets, метка «повтор» | r2/i-have-come-alive-end-phone-dark.png, end-pc-dark.png, for-true-lovers-line-b-phone-dark.png | «повтор» над строкой, обычным регистром, на телефоне и ПК. |
| 13 | исправлено | 5986b7e0 | fullsong/sheets/pc-dark-04 | r2/proof/scrub-phone-up.png (подпись «Сами Юсуф» над строкой) | Отдельный вес подписи голоса. Отдельный кадр арабской части ПК не снимался. |
| 14 | вопрос | — | new/player-*.png | r2/i-have-come-alive-line-phone-light.png, alive-settings-pc-dark.png | Плашки слов на месте. Владелец принял ударное слово, рисунок плашек не менялся. |
| 15 | вопрос | — | new/player-*.png | тот же светлый кадр строки | Плашка на приглушённой строке остаётся. Тот же запрет. |
| 16 | вопрос | — | fullsong/sheets/phone-*-09 | не снималось | Перенос арабского слова не мерился, огласовки не подбирались. |
| 17 | исправлено | 7988d0fc | fullsong/karitas-pc-dark/f0001 | r2/karitas-intro-phone-dark.png, intro-pc-dark.png, intro-phone-light.png, intro-pc-light.png, proof/karitas-intro-1100.png | Заголовок и авторы выше пюпитров, круг их не режет. Карточка на 1100: ширина 320, обрезки нет. |
| 18 | исправлено | e194e4e6 | описание перехода к пояснению | r2/for-true-lovers-line-a-pc-dark.png | `npm run test:position` после f475b248: скачок 0. На 1440 ось 550 с пояснением и 720 без него, внутри песни не прыгает. |
| 19 | исправлено | 7988d0fc | new/scene-inst-phone-*.png | r2/i-have-come-alive-inst-phone-dark.png, inst-phone-light.png | Две крупные гравюры, подписи меньше рисунка. Подпись «2 из 6». |
| 20 | исправлено | e2ccf2c2 | fullsong/sheets/phone-dark-01 | r2/i-have-come-alive-inst-phone-dark.png, karitas-choir-phone-dark.png | На тёмном телефоне штрих светлый и читается. Отдельная толщина только до 699 px. |
| 21 | вопрос | e2ccf2c2 | fullsong/sheets, светлая | r2/i-have-come-alive-inst-pc-light.png, inst-phone-light.png | Штрих темнее, но рисунок по-прежнему схема на фиолетовой плитке. |
| 22 | вопрос | — | new/scene-inst-pc-*.png | r2/i-have-come-alive-inst-pc-dark.png, inst-pc-light.png | Уд, канун и лютни остаются линейными гравюрами. Новый рисунок не выдумывался. Разведение штриха на широком экране снято, чтобы уложиться в бюджет CSS. |
| 23 | не успел | e2ccf2c2 | инструментальные листы | r2/karitas-choir-phone-dark.png, i-have-come-alive-inst-phone-dark.png | Круг с рисками ещё виден. Прозрачность рамки 0,05. Дальше упирается бюджет CSS. |
| 24 | не успел | — | new/scene-inst-phone-*.png | r2/i-have-come-alive-inst-phone-dark.png | Столбики названия, письма и музыканта на месте. Сетку подписей не перекладывал. |
| 25 | не успел | — | new/scene-inst-pc-*.png | r2/i-have-come-alive-inst-pc-light.png | Подписи в клетках раскладки, общая опорная линия не вводилась. |
| 26 | исправлено | 7988d0fc | fullsong/sheets/karitas-*-dark-01 | r2/karitas-choir-phone-dark.png, choir-pc-dark.png, intro-pc-dark.png | Розового ореола на штрихе нет. Свечение фильтра снято. |
| 27 | исправлено | 7988d0fc | motion/stills/*-buffer-05 | r2/i-have-come-alive-inst-phone-dark.png, inst-pc-dark.png | Общей фиолетовой вспышки по контуру нет. Фиолетовое поле — палитра песни. Движение пикселей на паузе — строка 3. |
| 28 | не успел | e2ccf2c2 | new/scene-inst-pc-light.png | r2/i-have-come-alive-inst-pc-light.png, karitas-intro-pc-dark.png | Прямоугольные подложки под гравюрами видны. Тень только внутренняя, заливка 46 %. |
| 29 | исправлено | 7988d0fc | сцены «Ансамбль» со значком уд+барабан+духовой | r2/karitas-intro-phone-dark.png, intro-pc-dark.png, for-true-lovers-end-pc-dark.png | Три пустых пюпитра, не набор инструментов. |
| 30 | вопрос | 55d781fc | fullsong/karitas-phone-dark/f0004 | r2/karitas-choir-phone-dark.png, choir-pc-dark.png, karitas-break-phone-dark.png, break-pc-dark.png | На хоре (0:04) шапка, подпись и рисунок — «Хор». На коротком проигрыше 35–37 с шапка «Проигрыш», рисунок и подпись остаются «Хор», чтобы сцена не пустела. Что показывать в эти 2,4 с — решение владельца. |
| 31 | вопрос | — | fullsong/sheets/pc-dark-09 | не снималось | Отдельная сцена голоса не рисовалась: состава, который можно подтвердить, в задаче нет. |
| 32 | вопрос | — | fullsong/sheets/pc-dark-06…07 | не снималось | Развитие кадра по секундам записи не подтверждалось. Сдвиг струн — функция времени песни, не новая пульсация. |
| 33 | исправлено | 55d781fc | Karitas около 0:40–0:43 | r2/karitas-break-phone-dark.png, break-pc-dark.png, karitas-first-line-phone-dark.png, first-line-pc-dark.png | Между хором и первой строкой сцена не пустая: стоит рисунок хора, затем строка. |
| 34 | исправлено | 7988d0fc | fullsong/pc-dark/f0216 | r2/proof/voice-handoff-pc-dark.png | ПК, тёмная, For True Lovers. В 6:59 шапка «Газель «Это я»», строка по центру, подписи «Голос» на сцене нет. На границе секции (419,1 с) низ подписи 695 px, верх входящей строки 732 px. В 7:10 подписи уже нет. |
| 35 | исправлено | 8310e5e3, f475b248 | последние листы, pc-scrub-12; на e2ccf2c2 шапка телефона «Газель Руми», шапка ПК «Аплодисменты» | r2/proof/alive-end-phone-dark.png, alive-end-pc-dark.png | На сборке f475b248 оба устройства в 9:35: шапка «Sami Yusuf · Аплодисменты», последняя строка яркая, перевод «стал непреходящим счастьем», сцена не пустая. Тёмная тема. |
| 36 | исправлено | 8310e5e3 | fullsong/sheets, «по секундам» | все пробы r2/probes.json, service=false | Служебных фраз на сцене нет. Полный текст остаётся в «О песне». |
| 37 | не успел | — | new/player-phone-*.png | r2/for-true-lovers-line-a-phone-dark.png | Зазор над плеером остаётся: его держит место под полосу, чтобы не вернуть дефекты 4–6. |
| 38 | исправлено | cc90e7b2 | new/look-pc-*.png | r2/alive-settings-pc-dark.png, for-true-lovers-line-a-pc-light.png, line-a-phone-dark.png | «Настройки» внутри плеера. Замер gearPast: телефон −14, ПК −94. |
| 39 | исправлено | 5986b7e0 | значок «Перевод» | r2/for-true-lovers-line-a-pc-dark.png, line-a-phone-dark.png | Новый знак речи и латинской буквы. Отдельного макрокадра значка нет. |
| 40 | исправлено | 5986b7e0 | флажок без подписи | r2/for-true-lovers-line-a-pc-dark.png, alive-settings-pc-dark.png | На ПК подпись «Метка». На телефоне уже 720 px её нет, в доступном имени — «Не совпадает». |
| 41 | не успел | 5986b7e0 | new/player-*.png | r2/for-true-lovers-line-a-pc-dark.png | Риски реже, но остаются волосками 1×3 px. Крупнее нельзя было оставить: бюджет CSS. |
| 42 | не успел | 5986b7e0 | fullsong/pc-dark/f0216 | нет кадра с наведением | Подсказка в коде уходит вниз от кнопки. Кадра наведения нет. |
| 43 | не успел | 5986b7e0 | конец For True Lovers, «−0:00» | нет кадра нулевого остатка | В коде остаток короче 0,5 с пишется как 0:00. На кадрах середины минус у ненулевого остатка — так и задумано. |
| 44 | не успел | — | new/player-phone-*.png | r2/for-true-lovers-line-a-phone-dark.png | Шапка и плеер по-прежнему разной геометрии. Общий материал не сводился. |
| 45 | исправлено | cc90e7b2 | motion/stills/pc-settings-03 | r2/proof/settings-phone-0.png, r2/alive-settings-pc-dark.png | Первый кадр листа: заголовок «Настройки», строки, заливка rgb(20, 19, 26), не пустая плашка. Высота 453. |
| 46 | исправлено | cc90e7b2 | motion/stills/phone-settings-03 | r2/proof/settings-phone-0.png, settings-phone-1.png | Первый кадр тёмный, не синий. Светлая тема листа не снята. |
| 47 | исправлено | cc90e7b2 | motion/stills/phone-settings-04…06 | settings-phone-0.png и alive-settings-phone-dark.png | Строки есть в первом кадре. Отдельного второго скачка высоты не видно. |
| 48 | исправлено | 5986b7e0 | new/settings-*-dark.png | r2/alive-settings-pc-dark.png, alive-settings-phone-dark.png | Подписи значений и стрелки читаются. Контраст числом не мерился. |
| 49 | исправлено | acd2cf64 | motion/stills/*-library-song-02…04; до правки r2/proof/flight-cdp-8.png (шапка поверх полки) | r2/proof/flight2-pc-8.png, flight2-pc-19.png, flight2-phone-19.png, flight2-phone-settled.png | Пока полка читается, шапка и заголовок песни не нарисованы. Обложка садится в слот шапки. На осевшем телефоне она внутри шапки, полки нет. Тёмная, ПК и телефон. |
| 50 | исправлено | 7988d0fc | motion/stills/phone-error-retry-02 | r2/proof/error-phone-light.png, error-retry-0.png | После «Повторить» сцена обычная, сжатого наложившегося текста нет. Только телефон, светлая. |
| 51 | не успел | 5986b7e0 | new/error-*-light.png | r2/proof/error-phone-light.png | На телефоне знак «!» и красная строка, не карточка пояснения. ПК не снят. |
| 52 | не успел | 5986b7e0 | new/error-*.png | error-phone-light.png | Кнопка пуска на ошибке остаётся крупной. Приглушение 0,38 в коде; пилюля повтора снята из‑за бюджета CSS. |
| 53 | не успел | — | new/player-pc-*.png | нет пары ПК с ошибкой и без | Сдвиг колонки сообщением не мерился. |
| 54 | вопрос | — | new/library-pc-*.png | r2/proof/flight-pc-0.png | Библиотеку владелец принял. Пустые полосы у обложек заново не мерились, раскладка не менялась. |
| 55 | вопрос | — | new/library-pc-*.png | flight-pc-0.png | Сейчас сверху широкий блок песни и ряд из четырёх обложек. Светлая тема не снята, раскладка не перестраивалась. |
| 56 | вопрос | — | new/library-phone-dark.png | не снималось отдельно | Голубой ореол кнопок не проверялся. Библиотека не красилась. |
| 57 | не успел | 5986b7e0 | new/opaque-pc-light.png, opaque-phone-light.png | r2/proof/contrast-phone-light.png | Соседние строки на замере 0,57 и 0,43, поле насыщенное. Непрозрачность строки задаёт сцена, не токен. ПК в повышенном контрасте не снят. |
