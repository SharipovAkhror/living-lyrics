/**
 * Run: npx tsx src/data/comments.test.ts
 * A `comment-draft` comment never reaches the reader. The load gate drops the text
 * and keeps the flag; commentFor then refuses to inherit a neighbour.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hideDraftComments } from './comments';
import { LyricsSchema, type Flag, type Line, type Lyrics, type Section } from './schema';
import { buildTimeline, commentFor, type Timeline } from './timeline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRAFT: Flag = 'comment-draft';

function line(id: string, at: number, comment?: string, flags?: Flag[]): Line {
  return {
    id,
    lang: 'ar',
    script: 'Arab',
    words: [
      { w: 'слово', s: at, e: at + 1 },
      { w: 'ещё', s: at + 1, e: at + 2 },
    ],
    tr: { ru: `перевод ${id}` },
    ...(comment !== undefined ? { comment } : {}),
    ...(flags ? { flags } : {}),
  };
}

function vocal(id: string, lines: Line[], comment?: string, flags?: Flag[]): Section {
  const start = lines[0].words[0].s;
  const end = lines[lines.length - 1].words[lines[lines.length - 1].words.length - 1].e + 1;
  return {
    id,
    kind: 'vocal',
    start,
    end,
    label: id,
    lines,
    ...(comment !== undefined ? { comment } : {}),
    ...(flags ? { flags } : {}),
  };
}

function publish(sections: Section[]): { lyrics: Lyrics; shown: Lyrics; timeline: Timeline } {
  const lyrics: Lyrics = { sections };
  const shown = hideDraftComments(lyrics);
  return { lyrics, shown, timeline: buildTimeline(shown, 1000) };
}

function cueOf(timeline: Timeline, id: string): number {
  const cue = timeline.cues.find((c) => c.kind === 'line' && c.line.id === id);
  assert.ok(cue, id);
  return cue.idx;
}

function shownText(timeline: Timeline, id: string): string | null {
  return commentFor(timeline, cueOf(timeline, id))?.text ?? null;
}

function testHiddenLine() {
  const draft = 'Скрытое пояснение строки, которого зритель не видит.';
  const { shown, timeline } = publish([vocal('sec', [line('hidden', 1, draft, [DRAFT])])]);
  const published = shown.sections[0];
  assert.equal(published.kind, 'vocal');
  assert.equal(shownText(timeline, 'hidden'), null, 'hidden line showed its draft');
  assert.equal('comment' in published.lines[0], false, 'draft comment was not removed at load');
  assert.deepEqual(published.lines[0].flags, [DRAFT]);
}

function testHiddenSection() {
  const draft = 'Скрытое пояснение секции.';
  const inst = hideDraftComments({
    sections: [
      {
        id: 'bridge',
        kind: 'instrumental',
        start: 0,
        end: 8,
        label: 'Проигрыш',
        instruments: [],
        comment: draft,
        flags: [DRAFT],
      },
    ],
  });
  const bridge = inst.sections[0];
  assert.equal(bridge.kind, 'instrumental');
  assert.equal('comment' in bridge, false, 'section draft comment was not removed');
  assert.deepEqual(bridge.flags, [DRAFT]);
  const instTimeline = buildTimeline(inst, 1000);
  assert.equal(commentFor(instTimeline, 0), null, 'hidden instrumental section showed its comment');

  const { shown, timeline } = publish([
    vocal('sec', [line('bare', 1), line('own', 4, 'Своё пояснение строки остаётся.')], draft, [DRAFT]),
  ]);
  const section = shown.sections[0];
  assert.equal(section.kind, 'vocal');
  assert.equal('comment' in section, false);
  assert.deepEqual(section.flags, [DRAFT]);
  assert.equal(shownText(timeline, 'bare'), null, 'a line inherited the hidden section comment');
  assert.equal(shownText(timeline, 'own'), 'Своё пояснение строки остаётся.');
}

function testHiddenLineAfterVisibleDoesNotInherit() {
  const sectionComment = 'Пояснение секции, которое можно показать.';
  const visible = 'Видимое пояснение первой строки.';
  const draft = 'Черновик второй строки, который нельзя унаследовать.';
  const { lyrics, shown, timeline } = publish([
    vocal('sec', [line('first', 1, visible), line('second', 5, draft, [DRAFT, 'timing-draft'])], sectionComment),
  ]);
  const original = lyrics.sections[0];
  assert.equal(original.kind, 'vocal');
  assert.equal(original.lines[1].comment, draft, 'the gate mutated the source lyrics');
  assert.equal(shownText(timeline, 'first'), visible, 'a visible comment disappeared');
  assert.equal(shownText(timeline, 'second'), sectionComment, 'a hidden line inherited its neighbour');
  const published = shown.sections[0];
  assert.equal(published.kind, 'vocal');
  assert.equal(published.lines[0].comment, visible);
  assert.equal('comment' in published.lines[1], false);
  assert.deepEqual(published.lines[1].flags, [DRAFT, 'timing-draft']);

  const blocked = publish([vocal('sec', [line('first', 1, visible), line('second', 5, draft, [DRAFT])], draft, [DRAFT])]);
  assert.equal(shownText(blocked.timeline, 'second'), null, 'a hidden line inherited across a hidden section');
  assert.equal(shownText(blocked.timeline, 'first'), visible);
}

function testVisibleStaysAndLaterLineSkipsTheDraft() {
  const first = 'Первое пояснение остаётся у следующей строки.';
  const draft = 'Пропуск между ними скрыт.';
  const { lyrics, shown, timeline } = publish([
    vocal('sec', [line('first', 1, first), line('mid', 5, draft, [DRAFT]), line('last', 9)]),
  ]);
  assert.equal(shownText(timeline, 'first'), first);
  assert.equal(shownText(timeline, 'mid'), null);
  assert.equal(shownText(timeline, 'last'), first, 'a later line picked up the hidden comment or lost the earlier one');
  assert.deepEqual(hideDraftComments(shown), shown);
  const source = lyrics.sections[0];
  assert.equal(source.kind, 'vocal');
  assert.equal(source.lines[1].comment, draft);
}

function testPublishedSongs() {
  const dir = join(root, 'content/songs');
  const slugs = readdirSync(dir).filter((name) => {
    try {
      return readFileSync(join(dir, name, 'lyrics.json'));
    } catch {
      return false;
    }
  });
  assert.ok(slugs.length >= 1, 'no songs under content/songs');
  let drafts = 0;
  let visible = 0;
  for (const slug of slugs) {
    const lyrics = LyricsSchema.parse(JSON.parse(readFileSync(join(dir, slug, 'lyrics.json'), 'utf8')));
    const shown = hideDraftComments(lyrics);
    const timeline = buildTimeline(shown, 1e9);
    shown.sections.forEach((section, si) => {
      const source = lyrics.sections[si];
      if (source.flags?.includes(DRAFT)) {
        drafts += 1;
        assert.equal('comment' in section, false, `${slug} ${section.id}: section draft comment survived load`);
        assert.ok(section.flags?.includes(DRAFT), `${slug} ${section.id}: the hidden mark was dropped`);
      } else {
        assert.equal(section.comment, source.comment, `${slug} ${section.id}: a visible section comment changed`);
      }
      if (section.kind !== 'vocal' || source.kind !== 'vocal') return;
      section.lines.forEach((line, li) => {
        const was = source.lines[li];
        if (was.flags?.includes(DRAFT)) {
          drafts += 1;
          assert.equal('comment' in line, false, `${slug} ${line.id}: draft comment survived load`);
          assert.ok(line.flags?.includes(DRAFT), `${slug} ${line.id}: the hidden mark was dropped`);
        } else {
          assert.equal(line.comment, was.comment, `${slug} ${line.id}: a visible comment changed`);
        }
      });
    });
    for (const cue of timeline.cues) {
      const got = commentFor(timeline, cue.idx);
      if (cue.kind === 'inst') {
        if (cue.section.flags?.includes(DRAFT)) assert.equal(got, null, `${slug} ${cue.section.id}`);
        continue;
      }
      if (cue.line.flags?.includes(DRAFT)) {
        const sectionText = cue.section.flags?.includes(DRAFT) || !cue.section.comment ? null : cue.section.comment;
        assert.equal(got?.text ?? null, sectionText, `${slug} ${cue.line.id}: a flagged comment reached commentFor`);
        continue;
      }
      if (cue.line.comment) {
        visible += 1;
        assert.equal(got?.text, cue.line.comment, `${slug} ${cue.line.id}: a visible comment did not reach commentFor`);
      }
    }
  }
  assert.ok(drafts > 0, 'no comment-draft flag in content/songs: the sweep checked nothing');
  assert.ok(visible > 0, 'no visible comment survived');
  console.log(`comments: ${slugs.length} songs, ${drafts} draft comments hidden, ${visible} visible comments kept`);
}

function testLoadGate() {
  const src = readFileSync(join(root, 'src/data/library.ts'), 'utf8');
  assert.match(src, /return hideDraftComments\(LyricsSchema\.parse\(raw\)\)/);
}

testHiddenLine();
testHiddenSection();
testHiddenLineAfterVisibleDoesNotInherit();
testVisibleStaysAndLaterLineSkipsTheDraft();
testPublishedSongs();
testLoadGate();
console.log('comments: ok');
