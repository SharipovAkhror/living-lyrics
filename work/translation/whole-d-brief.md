One attempt: the Russian translation of `alive`, whole poem first, then cut to sung lines. There will be no second attempt. Answer in Russian. Do not commit, do not push. Rules: `docs/methodology/translation-standard.md`. Dossiers and canon as in `work/translation/brief.md`; thread: `work/translation/thread.md`. Earlier attempts failed on living Russian and on the thread. Do not open `whole.md` or `russian.md`, and do not start from the Russian now in `lyrics.json`: write from the dossiers.

The owner's complaint: «короткие по-издевательски, там такие смыслы, а ты тремя словами отделываешься»; lines are not connected, the thread is lost.

Do the steps in this order and do not go back to change an earlier file after a later step.

1. Read `work/translation/jumps.md`: the checked list of places where the source itself jumps. Do not change it. Only there may the text jump; everywhere else the next line follows from the one before.

2. `work/translation/whole-d.md`: the whole poem as one continuous Russian text, stanza by stanza, in sung order, line breaks not tied to the sung lines, no character limit. Write what a Russian reader of poetry would read as one thought going on, and say it as a person would. Explain nothing in the text: no word that is not sung, no added name or subject beyond what Russian grammar needs. Foreign terms a reader cannot understand get a Russian word when the dossier supports one. Name who speaks and to whom where the dossier settles it; otherwise leave it open. Where sources give several readings, keep the one that best fits the thread. The same sung line repeated gets the same Russian unless the dossier says otherwise. Every line is supported by the dossier; nothing invented.

The «я стал …» warning. The Persian refrain `شدم` closes most stanzas. Copying it as «я стал» + adjective or participle is the main defect of the earlier attempts: it is a calque, not Russian. Do not repeat that pattern to mirror the refrain. Use the verb Russian wants («пал», «ожил», «рассеялся», «таю»). Keep «я стал» only with a noun where a person would say it. The sense of having become something must stay in the line.

Calques readers marked in earlier attempts. Do not reuse these wordings or their pattern; find what the source means and say it naturally:
«я стал скован цепью»; «я стал убитым и поверженным»; «я стал беспёрым и ощипан»; «я стал восприимчив к свету»; «я стал оторван от всего»; «к тебе стал идти»; «пал и стал таять»; «стал сияющей Зухрой»; «непреходящим счастьем»; «Пришло счастье любви»; «счастье вечности»; «наполнился жизнью»; «Сыт мой глаз»; «Глазу моему довольно»; «ты не убит»; «не пропитан радостью»; «недостоин этого дома»; «пьян мечтой и сомнением»; «киблой этого круга», «стороной этого круга»; «рабом твоего приказа»; «из милости и щедрости»; «родник солнца»; «ударил мне в темя»; «обрело сияние души»; «врагом этой рвани»; «врагом этого тряпья»; «Образ души»; «царём-владыкой»; «Бумага твоя благодарит»; «сахар без меры»; «от его взгляда и вращения»; «Ариф правды»; «небом в двести слоёв»; «рождать Юсуфов»; «след смеха»; «шахматная фигура, что ходит»; «говори всем собой»; «от лица того царя мира»; «Я стал глупцом и выпрямился».
Where a real image of the source stands behind a wording (the chess piece, the sugar, the two-hundredfold sky), keep the image and find its Russian.

3. Cut `whole-d.md` to the sung lines: the Russian translation field of `content/songs/alive/lyrics.json`. Every line stays at or under 17 characters per second (`python work/translation/budget.py`). The ceiling is a limit, not a target: fill it where the meaning needs it, never with padding. If a line cannot hold what `whole-d.md` says, shorten the phrase, keep the sense, and record it in the report.

Fixed points:
- `b18q3-01`: «небес» is not sung, so it is not in the line. Arberry's note 18 may go in that line's `comment`.
- `b6q3-01`: keep the reading that best fits the thread; give the others in that line's `comment` as marked readings with their sources (`docs/methodology/07-comment.md`).
- Those two `comment` fields are the only comments you may change. Do not touch timing, the original, other comments, `docs/STATUS.md`, `docs/BACKLOG.md`, `ops/board.json`.

4. `work/translation/whole-d-support.md`: one row per distinct sung line: line id, the Russian, dossier file and section that supports it. Written from what you used, not reconstructed by guess; say plainly where support is thin.

5. Run `python work/translation/export_russian.py`, `python work/translation/budget.py`, `npm run validate -- alive`, `npx tsx src/data/comments.test.ts`. Write `work/translation/whole-d-report.md`: the numbers (median of the limit used, lines under 50 %, visible characters, lines over 17 chars/s), every place where the cut lost sense, and section «цитаты»: ids whose `comment` quotes Russian that has changed, with the new wording. Paste the last lines of the commands. Don't stop while anything you started runs.
