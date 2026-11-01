# Почему `prove` не выбирает свидетеля

Причина: в отчёте выравнивания нет реплики. У каждой поставленной строки `you` и `nasimi` поле `cue_start` пустое, потому что в коммите запуска не было `docs/analysis/<slug>/cues.json`. Строка без реплики не входит в проход строки (`attack_chance._line_candidate`: нужно `cue_start`, группа соло или хор, не меньше двух слов и `|ctc_start − cue| ≤ 0,30 с`). Кандидатов 0 по всем постановщикам, шанс строки не считается (`None`), `decide_lines` не доходит до перебора K. `search()` возвращает `None`, и `choose()` пишет «no assignment keeps the word chance and the line chance inside the caps». Это не провал порога 5 % и не другая версия кода.

Проход слова при этом внутри 15 % у всех четырёх моделей. Код `scripts/pipeline` и `.github/workflows/pipeline.yml` на коммитах упавших запусков, успешного `for-true-lovers` (`7488846f`) и текущего `main` один и тот же: `git diff` пустой.

Пороги не менялись. Код не менялся: зелёный свидетель при нуле кандидатов обошёл бы проход строки, а не измерил его.

## Числа

`cand` — кандидаты постановщиков `mms`, `stable-ts`, `second`, `phoneme`. `nearest_*` пустые: активных постановщиков нет, худший K не выбирался. `blocked` пуст.

| песня | языки | слов | модели в пределе слова | проход слова (one) | cand | nearest_k | выбор |
|---|---|---:|---|---|---|---|---|
| you | en | 149 | 4 из 4 | small 0,0638; medium 0,0872; large-v3-turbo 0,0570; large-v3 0,0638 | 0, 0, 0, 0 | нет | нет |
| nasimi | az | 78 | 4 из 4 | small 0,0705; medium 0,0962; large-v3-turbo 0,0641; large-v3 0,1154 | 0, 0, 0, 0 | нет | нет |
| for-true-lovers | ar, en, tr | 330 | 64 из 64 | худший по паре внутри 15 %; en короче 30 слов, why `song-fallback` | 91, 0, 2, 0 | не нужен, K есть | ar `large-v3-turbo`, en `large-v3`, tr `large-v3-turbo` |

У `you` и `nasimi` режим слова `one`, why `slice-one`. Сдвиг разбора: `you` — `whisperx|en` 0,03 с (как в журнале запуска); `nasimi` — пусто. У `for-true-lovers` локальный `choose()` дал тот же набор моделей, что журнал `41244546916`: K = 0,25, проход строки 0,005495, доказано 46.

Поставленных строк с репликой: `you` 0 из 37, `nasimi` 0 из 12, `for-true-lovers` 93 из 93. Пики голоса на месте (190, 499, 462), отчёт и стем в артефакте есть. Языки и четыре модели Whisper на словах есть.

Проверка «если подставить время экрана». У `you` 54 подписи `captions.json` совпали с 54 строками отчёта по тексту и порядку. Если записать их `first_s`/`last_s` в `cue_start`/`cue_end` уже готового отчёта, кандидатов mms становится 29, выбор собирается: en `large-v3`, K = 0,25, проход строки 0,0345 (1/29), доказано 20. Это не то, что сделал запуск, и не правка кода: `whisper_choice` читает реплику из отчёта, не из `captions.json`. Повторный `prove` на том же артефакте реплику не появит. Нужен новый align, чтобы окно поиска было окном реплики.

У `nasimi` нет ни `cues.json`, ни `captions.json`. `|ctc_start − draft_start|` у 12 поставленных строк: медиана 0,82 с, максимум 1,83 с, внутри 0,30 с — 0. Черновое время репликой не становится. Пока реплик нет, проход строки измерить нельзя.

## Команда

Без ключа и без звука, после скачивания артефактов:

```
gh run download 41324202894 -n align-you -D work/prove/you
gh run download 41325522868 -n align-nasimi -D work/prove/nasimi
gh run download 41217910624 -n align-for-true-lovers -D work/prove/for-true-lovers
python -c "import json, pathlib; root=pathlib.Path('work/prove');
slugs=('you','nasimi','for-true-lovers')
for slug in slugs:
 p=root/slug/'report'/slug/'align-report.json'
 d=json.loads(p.read_text(encoding='utf-8'))
 good=[x for x in d['lines'] if x.get('status')=='good']
 cued=sum(x.get('cue_start') is not None for x in good)
 print(slug, 'good', len(good), 'with cue', cued)"
```

Полный выбор (совпал с журналом: «4 из 4» и модели `for-true-lovers`): расшифровать `*.vocals.flac.enc` из артефакта в `work/<slug>/stems/vocals.wav` ключом `AUDIO_KEY`, положить `align-report.json` в `work/<slug>/`, из `scripts/pipeline` вызвать `aligner_review.build_payload` и `whisper_choice.choose`. На `you` и `nasimi` `choose` бросает тот же `RuntimeError`.

## Запуски 05 и 07

Оба ещё в задании `align`, до `prove` не дошли (смотрелось вместе с разбором, дольше 10 минут не ждалось).

- `41326101562`, `night/ll-song-05-lovers`, коммит `dfb4f87b`: ещё идёт. `docs/analysis/lovers/cues.json` есть, 64 реплики. Это не пустая выборка `you`/`nasimi`.
- `41327236367`, `night/ll-song-07-healing`, коммит `df16d438`: ещё идёт. `docs/analysis/healing/cues.json` в этом коммите нет. Когда дойдёт до `prove`, пустая выборка вероятна. Это прогноз, не журнал.

## Что делать очереди

Текст можно продолжать. `prove` на тех же артефактах `you` и `nasimi` перезапускать не нужно: отчёт уже без реплики, правки кода нет.

`you`: написать `cues.json` по времени экрана (без текста подписи) и заново прогнать align, затем prove. На текущей расстановке эти часы уже держат 5 %.

`nasimi`: сначала нужны реплики (субтитры или экран). Черновик слов от голоса в среднем на 0,82 с. Без реплик свидетель не выбирается, строки не доказаны, подсветки слов нет.

`healing`, если align закончится без `cues.json`, встанет так же. `lovers` реплики уже имеет: ждать его `prove`, не чинить заранее.
