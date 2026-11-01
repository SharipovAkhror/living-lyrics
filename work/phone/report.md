# Телефон: наложение строк и лаг

Ветка `site/phone-overlap`, база `72c14792` (main на момент ответвления, после #31). Не пушилось.

Ответ про #29: **старше**. Откатывать #29 не нужно. Тот же `npm run test:overlap` (WebKit, 390×844, настоящее воспроизведение, тишина вместо записи, пояснение вкл. / свёрнуто / выкл., `alive` и `for-true-lovers`) падает и до вливания, и на базе ветки. Худшее пересечение 92–102 px на обоих коммитах.

| прогон | коммит | alive вкл. | alive свёрнуто | alive выкл. | for-true-lovers вкл. | свёрнуто | выкл. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| до #29 | `700f1e04` | 102.2 FAIL | 102.2 FAIL | 92.4 FAIL | 102.2 FAIL | 102.2 FAIL | 102.2 FAIL |
| база ветки (main) | `72c14792` | 92.4 FAIL | 102.2 FAIL | 92.4 FAIL | 102.2 FAIL | 102.2 FAIL | 102.2 FAIL, в том числе гравюра 102.2 |
| после правки | `72c14792` + сцена | 0 PASS | 0 PASS | 0 PASS | 0 PASS | 0 PASS | 0 PASS |

Полные консоли: ниже. Журналы прогона (не в git): `work/phone/overlap-before.log`, `work/phone/overlap-main.log`, `work/phone/overlap-fix.log`.

Почему перемотка была зелёной, а воспроизведение нет. `scripts/tools/position-test.ts` (вход #29) перематывает через `onSeek` и не сравнивает прямоугольники строк и гравюр. Прямой `seek` часто не попадает в смену окна слотов: кэш transform не совпадает со строкой, запись стиля происходит, строки стоят раздельно. При воспроизведении смена окна на телефоне обнуляет transform (`Scene.tsx`, с `f7010f2e`, это раньше #29). Если кэш строки совпал, `LineBlock` пропускал запись, и все строки оставались вверху сцены с `transform: none`. #29 `LineBlock.tsx` не менял.

Три причины наложения, все старше #29:

1. Стек строк после обнуления слоя. Перед сменой слота сцена пишет `dataset.cleared`, и следующая постановка записывает transform даже при совпавшем кэше.
2. Гравюра припаркованного слота. В тени было `visibility: visible`, а такой потомок рисуется сквозь `visibility: hidden` предка. Активная гравюра теперь `inherit`, припаркованный корень ещё и с `opacity: 0`.
3. Живая гравюра выше зарезервированного ящика (`.fb-inst-full` абсолютный). На телефоне у `.fb--inst` стоит `overflow: hidden`. Угасающий перевод выше резерва `subRoom` подрезан по высоте хоста; измерение читает `scrollHeight`, поэтому клип не сжимает следующую постановку.

Окрестность 7:00–7:30 `alive` в тесте всегда ×1. Остальное ×4 только после сверки 300–318 с ×1 (расхождение ≤ 1 px, достигнутая скорость ×4 не ниже 2.5). На всех трёх прогонах сверка сошлась, достигнутая скорость около 4 и около 1 в обязательной зоне.

Часы в тесте — подмена `HTMLMediaElement`, которая уважает `playbackRate`. Запись не качается: ранний прогон с настоящим m4a закрывал строки плашкой «Не удалось загрузить запись». Ошибки медиа глотаются, звук — тишина нужной длины.

## Прогон до #29 (`700f1e04`, порт 5216, код выхода 1)

```
root work/phone/before
commit 700f1e04 port 5216
alive on
  spot 300–318 ×1 worst=0.0px achieved=0.98 samples=195
  spot 300–318 ×4 worst=0.0px achieved=3.90 samples=50
  ×4 matches ×1 on this passage
  0–418s ×4 worst=102.2px achieved=4.00 samples=1122
  418–452s ×1 worst=92.4px achieved=0.97 samples=367
  452–686s ×4 worst=102.2px achieved=3.98 samples=630
  phone=1 stage=390x568 samples=2119 worst=102.2px
  FAIL
alive collapsed
  0–418s ×4 worst=92.4px achieved=3.99 samples=1124
  418–452s ×1 worst=92.4px achieved=0.97 samples=366
  452–686s ×4 worst=102.2px achieved=3.99 samples=629
  phone=1 stage=390x568 samples=2119 worst=102.2px
  FAIL
alive off
  0–418s ×4 worst=92.4px achieved=3.99 samples=1124
  418–452s ×1 worst=92.4px achieved=0.97 samples=366
  452–686s ×4 worst=92.4px achieved=3.99 samples=628
  phone=1 stage=390x568 samples=2118 worst=92.4px
  FAIL
for-true-lovers on
  0–537s ×4 worst=102.2px achieved=4.00 samples=1443
  phone=1 stage=390x568 samples=1443 worst=102.2px
  FAIL
for-true-lovers collapsed
  0–537s ×4 worst=102.2px achieved=4.00 samples=1440
  phone=1 stage=390x568 samples=1440 worst=102.2px
  FAIL
for-true-lovers off
  0–537s ×4 worst=102.2px achieved=4.00 samples=1440
  12 overlap(s) over 1px
  phone=1 stage=390x568 samples=1440 worst=102.2px
  FAIL
```

Строки попаданий с текстом песен в отчёт не копировались. Они в `work/phone/overlap-before.log`. Среди них пересечение строк 92.4 px на 430.1 с (это 7:10, пояснение выключено).

## Прогон базы (`72c14792`, порт 5212, код выхода 1)

```
root phone-overlap (work/phone/main)
commit 72c14792 port 5212
alive on
  spot 300–318 ×1 worst=0.0px achieved=0.99 samples=195
  spot 300–318 ×4 worst=0.0px achieved=3.99 samples=49
  0–418s ×4 worst=51.6px achieved=4.00 samples=1122
  418–452s ×1 worst=92.4px achieved=0.99 samples=364
  452–686s ×4 worst=92.4px achieved=3.98 samples=625
  phone=1 stage=390x504 samples=2111 worst=92.4px
  FAIL
alive collapsed
  0–418s ×4 worst=92.4px achieved=3.99 samples=1114
  418–452s ×1 worst=92.4px achieved=0.99 samples=364
  452–686s ×4 worst=102.2px achieved=3.99 samples=627
  phone=1 stage=390x504 samples=2105 worst=102.2px
  FAIL
alive off
  0–418s ×4 worst=92.4px achieved=3.99 samples=1120
  418–452s ×1 worst=92.4px achieved=0.99 samples=364
  452–686s ×4 worst=0.0px achieved=3.98 samples=627
  phone=1 stage=390x568 samples=2111 worst=92.4px
  FAIL
for-true-lovers on
  0–537s ×4 worst=102.2px achieved=3.99 samples=1436
  phone=1 stage=390x504 samples=1436 worst=102.2px
  FAIL
for-true-lovers collapsed
  0–537s ×4 worst=102.2px achieved=4.00 samples=1439
  phone=1 stage=390x504 samples=1439 worst=102.2px
  FAIL
for-true-lovers off
  0–537s ×4 worst=102.2px achieved=4.00 samples=1439
  phone=1 stage=390x568 samples=1439 worst=102.2px
  FAIL
```

В `work/phone/overlap-main.log` у `for-true-lovers` без пояснения есть попадание гравюры `ensemble` 102.2 px. У `alive` свёрнуто попадание строк 92.4 px на 432.2 с, между кадрами 7:09 и 7:23.

## Прогон после правки (порт 5211, код выхода 0)

Правка списка «Весь текст» геометрию сцены не меняет. Этот прогон снят на правке сцены, стилей и `RichText` до коммита про лаг.

```
commit 72c14792 port 5211
alive on
  spot 300–318 ×1 worst=0.0px achieved=0.99 samples=194
  spot 300–318 ×4 worst=0.0px achieved=3.88 samples=50
  ×4 matches ×1 on this passage
  0–418s ×4 worst=0.0px achieved=3.99 samples=1092
  418–452s ×1 worst=0.0px achieved=0.99 samples=356
  452–686s ×4 worst=0.0px achieved=3.99 samples=613
  phone=1 stage=390x504 samples=2061 worst=0.0px
  PASS
alive collapsed
  0–418s ×4 worst=0.0px achieved=3.99 samples=1112
  418–452s ×1 worst=0.0px achieved=0.97 samples=359
  452–686s ×4 worst=0.0px achieved=3.98 samples=625
  phone=1 stage=390x504 samples=2096 worst=0.0px
  PASS
alive off
  0–418s ×4 worst=0.0px achieved=3.99 samples=1121
  418–452s ×1 worst=0.0px achieved=0.99 samples=366
  452–686s ×4 worst=0.0px achieved=3.98 samples=626
  phone=1 stage=390x568 samples=2113 worst=0.0px
  PASS
for-true-lovers on
  0–537s ×4 worst=0.0px achieved=3.99 samples=1440
  phone=1 stage=390x504 samples=1440 worst=0.0px
  PASS
for-true-lovers collapsed
  0–537s ×4 worst=0.0px achieved=4.00 samples=1431
  phone=1 stage=390x504 samples=1431 worst=0.0px
  PASS
for-true-lovers off
  0–537s ×4 worst=0.0px achieved=4.00 samples=1431
  phone=1 stage=390x568 samples=1431 worst=0.0px
  PASS
no painted overlap over 1px
```

## Кадры 390×844

Не коммитятся. Каталог `work/phone/frames/`.

- `before-709-open.png` — база, пояснение раскрыто, часы 7:09. Две персидские строки и два перевода наложены. В пояснении у «آینده» пунктирный кружок вместо آ.
- `after-709-open.png` — после правки, то же место. Строка одна, перевод под ней, в пояснении «آینده شدم» буквами, кружка нет.
- `after-709.png` — пояснение свёрнуто, 7:09. Строка и перевод раздельно, кнопка паузы не перекрыта.
- `after-723.png` — пояснение свёрнуто, 7:23. Перевод под своей строкой, не через гравюру и не через «Пауза».
- `before-709.png`, `before-723.png` — база, пояснение свёрнуто, те же часы. Стоп-кадр может попасть между срабатываниями стека. Число теста на этом прогоне: 92.4 px на 432.2 с.

## Пунктирный кружок

Не отдельная буква в данных. В `content/songs/alive/lyrics.json` пояснение строки (около строки 3187 файла) содержит слово с U+0622 и персидским U+06CC. `RichText` заворачивал весь арабский прогон в `bdi.rt-ar.f-mushaf lang=ar`. KFGQPC рисует U+0622 в таком слове кружком. Строки песни на `fa` идут Amiri (`f-persian`) и там буквы целые. Если в прогоне есть буква пехлеви/персидская (`پ چ ژ گ ک ی`), пояснение теперь тоже `f-persian` и `lang=fa`. Иначе остаётся mushaf.

На текущем main (`8b58131b`, #38) `arabic()` всё ещё вешает `f-mushaf` на каждый прогон. При вливании эту ветку надо сохранить внутри новой функции, а не затирать её.

## Лаг

Обе прокрутки, 390×844, `alive`, воспроизведение с 410 с (поются строки, не интро), 8 с. Кадры — разница `requestAnimationFrame`. Долгая задача — `longtask` длиннее 50 мс, начавшаяся внутри окна (не буфер загрузки). Профиль CPU к кадрам не подключался.

WebKit. CDP нет: `browserContext.newCDPSession: CDP session is only available in Chromium`. Job object на `WebKitWebProcess` назначается, но ручка должна жить: первый прогон закрывал PowerShell и вместе с ним ограничение, кадры не менялись. Удержанный колпак `CpuRate` 104 (около 1/6 одного логического процессора; в машине 16 потоков, i5-13400F) на 6 с пения дал p50 30, p95 32, p99 46, доля кадров > 33 мс 0.028. Без колпака на той же сцене p50 21, p95 32, p99 46. Это не замедление ×6: один поток рисования на 16 потоках колпаком не упирается. Числа ×6 — только Chromium `Emulation.setCPUThrottlingRate` 6.

Время кадра в мс. `>33` — доля кадров длиннее 33.34 мс.

Поток строк при воспроизведении:

| | n | p50 | p95 | p99 | >33 | долгие задачи | их мс |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WebKit до | 349 | 21 | 32 | 46 | 0.026 | 0 | 0 |
| WebKit после | 347 | 21 | 33 | 46 | 0.046 | 0 | 0 |
| Chromium ×6 до | 402 | 16.7 | 16.8 | 100 | 0.022 | 9 | 1525 |
| Chromium ×6 после | 455 | 16.7 | 16.8 | 50 | 0.018 | 7 | 508 |

Список «Весь текст» (прокрутка `.sheet-body`, 163 строки, высота около 15000 px):

| | n | p50 | p95 | p99 | >33 | долгие задачи | их мс |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WebKit до | 330 | 28 | 31 | 32 | 0.003 | 0 | 0 |
| WebKit после | 330 | 28 | 30 | 33 | 0.003 | 0 | 0 |
| Chromium ×6 до | 482 | 16.7 | 16.7 | 16.8 | 0 | 0 | 0 |
| Chromium ×6 после | 482 | 16.7 | 16.8 | 16.8 | 0 | 0 | 0 |

Причина не в прокрутке открытого списка. На ×6 его кадр остаётся 16.7–16.8 мс и до, и после. В трассе таймлайна за 5 с прокрутки самый тяжёлый свой вызов — `step` самого замера, 15.7 мс суммарно. `BeginMainFrame` максимум 20.6 мс. Слоя или функции продукта, которая держит прокрутку, трасса не назвала. `backdrop-filter` листа на телефоне уже `none`.

Причина рывков потока строк — `TextSheet`. Пока лист закрыт, он всё равно строил все строки песни. Смена поющейся строки идёт из `Scene.loop` через `flushSync(onOwnerChange)`, поэтому эта сборка сидела внутри кадра лирики. Профиль CPU Chromium ×6, 6 с пения с 410 с: из 1113 мс внутри `loop` 724 мс — `jsxDEV`, вызванный из `TextSheet.tsx` (сборщик строки, в файле это `timeline.cues.map`). Трасса таймлайна на том же месте: `FunctionCall loop` в `Scene.tsx` 1172 мс за 5 с, 34 вызова, один вызов 302.8 мс. Рядом `LocalFrameView::UpdateStyleAndLayout` 197 мс, максимум 59.8 мс. После раннего выхода закрытого телефонного листа из сборки строк те же 6 с дают 400 мс внутри `loop`, и `TextSheet` из профиля уходит. Долгие задачи кадра: 1525 мс → 508 мс. Замер — Vite dev, обёртка `jsxDEV` раздувает миллисекунды. В проде обёртки нет, но тот же обход всех строк на каждую смену строки внутри кадра лирики остаётся. На iPhone это и есть рывок при чтении.

Список открывается по-прежнему: после правки замер прокрутки видит 163 строки. На телефоне закрытый лист не держит пружину закрытия (`Sheet` и так сразу снимает `render`), поэтому пустой выход ничего не обрезает. Десктоп не тронут: `isPhone()` там ложен, список по-прежнему строится и для анимации закрытия.

Файл `src/pages/song/TextSheet.tsx` вне объявленной зоны. Трасса назвала его, и короткая правка только там. Сцену ради этого не менял: `flushSync` по-прежнему сначала сбрасывает слой пояснения, потом отдаёт React новую строку.

Настоящий iPhone замерит владелец. На этой машине WebKit без настоящего ×6 рывок почти не показывает (p99 около 46 мс и до, и после).

## Вопросы

- Совместит ли вливание ветку `f-persian` в `RichText.arabic()` с main после #38, где каждый арабский прогон всё ещё `f-mushaf`.
- Настоящий iPhone: строки в 7:09 и 7:23 и ощущение прокрутки во время пения. Открытый «Весь текст» на десктопном ×6 и так был ровный.
