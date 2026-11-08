# Menem — источники и статус проверки

Исполнитель: Hasan Bayar. Сюда попадает каждый факт, который потом оказывается в `song.json` или `lyrics.json`. Нет ссылки или файла — факта в данных нет, он остаётся в `review`.

## Запись

- Ссылка: https://www.youtube.com/watch?v=umNt-sURvXc
- Канал: Hasan Bayar, https://www.youtube.com/@hasanbayar. Ролик на канале исполнителя, название «HASAN BAYAR - MENEM (Yeni)». Дата публикации на странице: 3 июля 2026. Это не концерт: в названии и описании нет города, зала и названия вечера. Вид версии — сингл. Подпись `version.label`: Menem (Yeni), 2026. «Yeni» — слово из названия ролика.
- Длительность на странице ролика: 3:08. Файл дорожки измерен: 187,66 с. Это записано в `song.json`.
- Откуда файл: одна загрузка `yt-dlp` с этого адреса, дорожка 140, затем `process_audio.py`. Чужой ролик (в том числе автоканал «Hasan Bayar - Topic», https://www.youtube.com/watch?v=jQ7o6n28wdU) не берётся.
- Официальных субтитров нет: одна загрузка `--write-subs` без автосубтитров вернула пусто.

Описание ролика, как оно прочитано со страницы 2026-11-02:

> Kıymetli dostlar 'Menem' eserimizi beğenilerinize sunuyoruz.
> Beğeni ve yorumlarınız için şükranlarımla...
>
> Sözler
> İsa menem musa menem muhammed mustafa menem
> ...
> Tevrat menem zebur menem incil menem
> Kuran menem
> ....
> Ömer menem sıddik menem osman menem ali menem
> ....
> Haydar menem hüseyn menem hasan menem
> Muhsin menem
> ....
> Arabiyem farisiyem hem kurdiyem hem Türkiyem
> ....
> Selçukiyem eyyubiyem osmaniyem
> Nefer menem
> ....
> Sevda menem sevgi menem  dertte menem
> Derman menem....
> Derviş menem aşık menem barış menem
> Destan menem
> ....
> Men azrail men mikail men cibrili kutsiyem
> Men cihanam men güneşem men lutfu ilahiyem
> Hem geceyem hem gündüzem Âlemin umuduyem
> Hem geceyem hem gündüzem cihanın umuduyem
>
> Söz&Müzik: Hasan Bayar
> Aranje: Hasan Bayar
> Video: Cactus Production

Многоточия в описании стоят так, как в карточке. На экране ролика на их месте повторяется припев из четырёх последних строк. Вступление «Benim adım İslam» описание не содержит: оно выведено на экран в начале пения.

## Тексты

| Часть | Автор | Источник | Подтверждено |
|---|---|---|---|
| Menem, текст в описании ролика и слова на его экране | Hasan Bayar (строка «Söz&Müzik: Hasan Bayar») | https://www.youtube.com/watch?v=umNt-sURvXc | 1 |

Дословные цитаты и порядок строк — в `canon.md`. Сайты «текстов песен», которые перепечатывают это описание, эталоном не считаются.

Отдельного издания этих строк старше ролика не найдено. Запросы «İsa menem Musa menem», «Selçukiyem eyyubiyem», «lutfu ilahiyem» открыли другие стихотворения с редифом «menem», не этот текст. Более ранний автор этим строкам не приписан.

Словари и статьи, открытые для перевода и пояснений: TDV İslâm Ansiklopedisi (Иса, Теврат, Инжил, Зебур, Азраил, Микаил, Абу Бакр, Хайдар, Хасан, Хусейн, сельджуки, Эйюбиды, османы). Статья о Джибриле не открылась, страница Мусы открылась как поиск, не как статья. TDK Güncel Türkçe Sözlük (cihan, âlem, lütuf, ilahi, dert, derman, sevda, sevgi, nefer, er, derviş, âşık, barış, destan, umut, kutsal; запрос kutsi ведёт на kutsal). Английский Викисловарь: азербайджанское mənəm, турецкое hem, арабские محسن и أحسن. Адреса стоят в пояснениях строк.

## Исполнители

Только из описания ролика:

- Söz&Müzik: Hasan Bayar
- Aranje: Hasan Bayar
- Video: Cactus Production

Имён музыкантов, инструментов и студии в описании нет.

## Не подтверждено

- Обложка отдельного релиза. Палитра снята с кадра этого ролика: чёрный фон, белые буквы, серый портрет. Цвета по настроению не подбирались.
- Город, зал, альбом, лейбл звукозаписи, годы жизни автора.
- Где описание пишет Men, cihanam, güneşem, umuduyem и kutsi, черновик распознавания голоса местами слышит Ben, cihanım, güneşim, umuduyum и kudsi. В строке оставлено описание.
- Две последние строки четвёртого припева на экран крупно не выведены. Их буквы — повтор описания. Время этих двух строк не измерено и в файл реплик не входит.

## Тайм-коды

- Статус: draft. Выравнивание не запускалось: для двух строк нет реплики с экрана.
- Начало остальных строк — появление крупного слова на экране ролика.
