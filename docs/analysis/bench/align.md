# Стенд выравнивания

Эталон начала строки — реплика `cues.json` (её ставит человек, точность около 0,1–0,3 с).
Доли «≤ 0,3 с» и «≤ 0,7 с» считаются от всех строк: строка без начала в долю не входит.
Медиана и 90-й перцентиль — модуль |начало выравнивателя − начало реплики| по строкам, где начало есть.
Окно у всех одно и то же: реплика с запасом 0,8 с до начала и 0,5 с после конца, на соседа не больше 0,5 с.
Средневековый немецкий (`gmh`) современным немецким не подменяется. Латынь и азербайджанский тоже.

## Выравниватели на вокале htdemucs

| выравниватель | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 | CPU, с |
|---|---:|---:|---:|---:|---:|---:|
| mms-ctc-star | 243 | 178 | 227 | 0.186 | 0.499 | 944.1 |
| whisperx | 243 | 21 | 35 | 0.294 | 0.78 | 36.6 |
| stable-ts | 243 | 39 | 223 | 0.5 | 0.649 | 1073.3 |
| huang-2025 | 243 | 0 | 0 | — | — | 20.8 |
| nemo — not-installed: RuntimeError: operator torchvision::nms does not exist | 243 | 0 | 0 | — | — | 0.2 |

### По языкам

| выравниватель | язык | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 |
|---|---|---:|---:|---:|---:|---:|
| mms-ctc-star | en | 16 | 13 | 16 | 0.192 | 0.339 |
| mms-ctc-star | tr | 16 | 16 | 16 | 0.149 | 0.184 |
| mms-ctc-star | ar | 86 | 62 | 78 | 0.193 | 0.522 |
| mms-ctc-star | fa | 49 | 36 | 46 | 0.137 | 0.501 |
| mms-ctc-star | az | 26 | 20 | 26 | 0.212 | 0.354 |
| mms-ctc-star | la | 24 | 15 | 21 | 0.247 | 0.654 |
| mms-ctc-star | de | 26 | 16 | 24 | 0.228 | 0.683 |
| whisperx | en | 16 | 14 | 16 | 0.185 | 0.294 |
| whisperx | tr | 16 | 0 | 0 | — | — |
| whisperx | ar | 86 | 0 | 0 | — | — |
| whisperx | fa | 49 | 0 | 0 | — | — |
| whisperx | az | 26 | 0 | 0 | — | — |
| whisperx | la | 24 | 0 | 0 | — | — |
| whisperx | de | 26 | 7 | 19 | 0.504 | 0.78 |
| stable-ts | en | 16 | 4 | 16 | 0.5 | 0.5 |
| stable-ts | tr | 16 | 3 | 16 | 0.5 | 0.5 |
| stable-ts | ar | 86 | 14 | 79 | 0.5 | 0.601 |
| stable-ts | fa | 49 | 4 | 48 | 0.5 | 0.5 |
| stable-ts | az | 26 | 6 | 25 | 0.48 | 0.5 |
| stable-ts | la | 24 | 3 | 24 | 0.5 | 0.5 |
| stable-ts | de | 26 | 5 | 15 | 0.5 | 0.8 |
| huang-2025 | en | 16 | 0 | 0 | — | — |
| huang-2025 | tr | 16 | 0 | 0 | — | — |
| huang-2025 | ar | 86 | 0 | 0 | — | — |
| huang-2025 | fa | 49 | 0 | 0 | — | — |
| huang-2025 | az | 26 | 0 | 0 | — | — |
| huang-2025 | la | 24 | 0 | 0 | — | — |
| huang-2025 | de | 26 | 0 | 0 | — | — |
| nemo | en | 16 | 0 | 0 | — | — |
| nemo | tr | 16 | 0 | 0 | — | — |
| nemo | ar | 86 | 0 | 0 | — | — |
| nemo | fa | 49 | 0 | 0 | — | — |
| nemo | az | 26 | 0 | 0 | — | — |
| nemo | la | 24 | 0 | 0 | — | — |
| nemo | de | 26 | 0 | 0 | — | — |

### Что выбрано бы по доле строк в пределах 0,3 с

- ar: mms-ctc-star
- az: mms-ctc-star
- de: mms-ctc-star
- en: whisperx
- fa: mms-ctc-star
- la: mms-ctc-star
- tr: mms-ctc-star

Правило выбора: больше доля ≤ 0,3 с, при равенстве меньше медиана, затем меньше 90-й перцентиль.
Выравниватель, который в этом языке ничего не поставил, не выбирается.

## Вокальный стем

Тот же замер на других стемах, на первых 240 с микса (один и тот же отрывок для каждой модели).
Полная песня на htdemucs_ft и Mel-RoFormer на CPU в лимит раннера не входит. Строка берётся, только если её окно целиком внутри отрывка.
Плохой стем ломает любой выравниватель, поэтому здесь MMS и WhisperX, а не все пять.

| стем | выравниватель | строк | ≤ 0,3 с | ≤ 0,7 с | медиана | p90 | отделение, с | выравнивание, с |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| htdemucs | mms-ctc-star | 38 | 34 | 38 | 0.169 | 0.278 | 123.9 | 96.8 |
| htdemucs | whisperx | 38 | 14 | 16 | 0.185 | 0.294 | 123.9 | 7.2 |
| htdemucs_ft | mms-ctc-star | 38 | 35 | 38 | 0.164 | 0.243 | 493.2 | 96.2 |
| htdemucs_ft | whisperx | 38 | 13 | 16 | 0.185 | 0.311 | 493.2 | 6.9 |
| mdx — CalledProcessError: Command '['audio-separator', '/home/runner/work/living-lyrics/living-lyrics/work/i-have-come-alive/bench-excerpt-240.wav', '--model_filename', 'UVR-MDX-NET-Voc_FT.onnx', '--output_dir', '/home/runner/work/living-lyrics/living-lyrics/work/i-have-come-alive/separator', '--single_stem', 'Vocals', '--output_format', 'WAV']' returned non-zero exit status 1. | mms-ctc-star | 0 | 0 | 0 | — | — | 3.3 | 0.0 |
| mdx — CalledProcessError: Command '['audio-separator', '/home/runner/work/living-lyrics/living-lyrics/work/i-have-come-alive/bench-excerpt-240.wav', '--model_filename', 'UVR-MDX-NET-Voc_FT.onnx', '--output_dir', '/home/runner/work/living-lyrics/living-lyrics/work/i-have-come-alive/separator', '--single_stem', 'Vocals', '--output_format', 'WAV']' returned non-zero exit status 1. | whisperx | 0 | 0 | 0 | — | — | 3.3 | 0.0 |
| mel-roformer — StopIteration:  | mms-ctc-star | 0 | 0 | 0 | — | — | 741.7 | 0.0 |
| mel-roformer — StopIteration:  | whisperx | 0 | 0 | 0 | — | — | 741.7 | 0.0 |

## Лицензии

- mms-ctc-star: torchaudio MMS_FA, веса CC-BY-NC 4.0. В репозиторий не коммитятся.
- whisperx: Чекпоинты wav2vec2, которые выбирает WhisperX (torchaudio и Hugging Face). Веса не коммитятся.
- stable-ts: Код stable-ts — MIT (архив с 2026-05-30). Веса Whisper small — MIT. Это выравнивание известного текста, не распознавание. Веса не коммитятся.
- nemo: Код NeMo Apache-2.0. Модель nvidia/stt_en_fastconformer_ctc_large — лицензия NVIDIA (исследование), только английский. Веса не коммитятся.
- huang-2025: jhuang448/LyricsAlignment-Multilingual: код и checkpoint_Baseline под MIT. Обучена на DALI, проверялась на Jamendo и MUSDB (ISMIR 2025, акустическая модель ICASSP 2022). Фонемы espeak только для en/de/fr/es/it. gmh немецким не подменяется. Веса не коммитятся.
- htdemucs: Код Demucs MIT. Веса автор не относит к MIT и оставляет для научного использования. Не коммитятся.
- htdemucs_ft: Тот же статус весов, что у htdemucs: набор из четырёх дообученных моделей. Не коммитятся.
- mdx: UVR-MDX-NET-Voc_FT.onnx. Код UVR MIT, веса моделей UVR — MIT с указанием Anjok07 и aufr33. Не коммитятся.
- mel-roformer: Вокальный Mel-Band RoFormer из каталога audio-separator. У весов Kimberley Jensen и viperx нет явной коммерческой лицензии. Только стенд, в репозиторий не коммитятся. Сайт некоммерческий.

## Что из литературы не запускалось

- Cheng, Nakano, Goto, DAFx 2025 (masked cross-entropy, Jamendo MedAE 0,041 с): публичных весов для прогона нет.
- Kick и др., box loss, 2025 (github.com/tikick/LyricsAlignment): код есть, готового чекпоинта в репозитории нет, нужен DALI и phonemizer IPA. Не запускался.
- schufo/lyrics-aligner (2021, MIT, MUSDB, английские фонемы) старше запрошенного окна 2022–2026. Вместо него взята многоязычная модель Huang.

## Чего в нулях нет

Это не оценка качества, и повторный прогон не запускался: дыры не меняют выбор для арабского, персидского, турецкого, азербайджанского и латыни.

- whisperx на fa, tr и ar: `ModuleNotFoundError: Could not import module 'Wav2Vec2ForCTC'`. Английский (14/16) и немецкий (7/26, медиана 0,504 с) измерены. Ноль здесь — ошибка ленивого импорта transformers после пакетов стенда (NeMo, audio-separator), не чекпоинт и не качество на пении. Те же три модели на конвейере песни грузятся. Импорт теперь при этой ошибке берёт класс напрямую и печатает версии.
- huang-2025: `AttributeError: np.Inf was removed in the NumPy 2.0 release`. Модель только для en/de/fr/es/it. 0/243 — сбой адаптера, не счёт.
- nemo: `RuntimeError: operator torchvision::nms does not exist`. Только английский.
- mdx: audio-separator, код выхода 1, 3,3 с.
- mel-roformer: `StopIteration` через 741,7 с.

## Решение

Первый выравниватель — mms-ctc-star, стем — htdemucs, четыре дорожки. 178/243 в пределах 0,3 с, медиана 0,186 с. WhisperX выигрывает английский на одну строку из 16 (14 против 13). htdemucs_ft выигрывает отрывок на одну строку из 38 (35 против 34) за 493 с отделения против 124 с. Ни то ни другое конвейер не делит.

## Худшие места

- mms-ctc-star: karitas sabr-p1 3.961 с, karitas shushtari-s2 3.564 с, i-have-come-alive coda-fa-8 3.087 с, i-have-come-alive coda-fa-2 1.688 с, i-have-come-alive arabic-26b 1.626 с
- whisperx: one eckhart-f-07 0.795 с, one eckhart-f-02 0.78 с, one eckhart-f-03 0.78 с, one eckhart-f-08 0.78 с, one eckhart-f-09 0.78 с
- stable-ts: karitas call-y2-2 3.72 с, karitas call-y2-1 2.78 с, karitas sabr-p1 2.19 с, i-have-come-alive coda-fa-b 1.42 с, i-have-come-alive arabic-26b 0.86 с
