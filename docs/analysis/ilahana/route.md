# ilahana — обходы

- Не было CUDA для `scripts/pipeline/transcribe.py` (нет cublas64_12.dll). Сделано: тот же large-v3 на CPU, int8, язык ar. Первый проход с VAD пропустил середину и лежит в `work/ilahana/transcript.json`. Второй без VAD — `work/ilahana/transcript-novad.json`. Оба в git не входят. Секунды и буквы распознавания в `lyrics.json` не переносились.
- ffmpeg 9 не принял `-vsync`. Кадры для просмотра сняты по `-ss` в `work/ilahana/spot/`. Букв на них нет.
- `lyric_frames.py` записал 225 кадров: нижняя полоса кадра часто меняется из-за света. Выборка с 0 по 244 с — сцена, лица, бубен, пюпитр. Строк песни на экране нет. `agy` не вызывался. `captions.json` и `cues.json` не собраны.
