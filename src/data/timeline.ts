/**
 * Turns lyrics.json into the ordered list of cues the Scene scrolls through: every sung line
 * (each repetition is its own line) and every instrumental passage. Pure function of the data,
 * so seeking backwards renders exactly like playing forwards.
 */
import { commentDraftHidden } from './comments';
import type { InstrumentalSection, Line, Lyrics, Peaks, VocalSection } from './schema';

export interface LineCue {
  kind: 'line';
  idx: number;
  line: Line;
  section: VocalSection;
  /** First word start / last word end (seconds). */
  start: number;
  end: number;
  rtl: boolean;
  /** Number of the line inside the song, 1-based (for the text list). */
  n: number;
  /** Who sings it: the line's own voice, else the section's. */
  voice: string | null;
  /** True when the voice differs from the previous line's, so the Scene names the singer. */
  voiceChanged: boolean;
  /** 0 for a new line; k when it repeats the text of the line k places before it, uninterrupted. */
  repeat: number;
}

export interface InstCue {
  kind: 'inst';
  idx: number;
  section: InstrumentalSection;
  start: number;
  end: number;
}

export type Cue = LineCue | InstCue;

export interface Timeline {
  cues: Cue[];
  lines: LineCue[];
  duration: number;
  /** Index of the cue that "owns" time t (latest cue whose start ≤ t), or −1 before the first. */
  ownerAt(t: number): number;
  energyAt(t: number): number;
}

const RTL_SCRIPTS = new Set(['Arab']);

export function lineText(line: Line) {
  return line.words.map((w) => w.w).join(' ');
}

/** Text without harakat, punctuation and case, to recognise the same line sung again. */
function normalized(line: Line) {
  return lineText(line)
    .normalize('NFKD')
    .replace(/[ً-ٰٟۖ-ۭ̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function buildTimeline(lyrics: Lyrics, duration: number, peaks: Peaks | null = null): Timeline {
  type Draft = { kind: 'line'; line: Line; section: VocalSection } | { kind: 'inst'; section: InstrumentalSection };
  const drafts: Draft[] = [];
  for (const section of lyrics.sections) {
    if (section.kind === 'instrumental') drafts.push({ kind: 'inst', section });
    else for (const line of section.lines) drafts.push({ kind: 'line', line, section });
  }
  const startOf = (d: Draft) => (d.kind === 'inst' ? d.section.start : d.line.words[0].s);
  drafts.sort((a, b) => startOf(a) - startOf(b));

  const cues: Cue[] = [];
  let n = 0;
  let prevVoice: string | null = null;
  const recent: string[] = [];
  drafts.forEach((d, idx) => {
    if (d.kind === 'inst') {
      cues.push({ kind: 'inst', idx, section: d.section, start: d.section.start, end: d.section.end });
      recent.length = 0;
      return;
    }
    const voice = d.line.voice ?? d.section.voice ?? null;
    const key = normalized(d.line);
    // A repeat: the same text as one of the last two lines (refrains often alternate A B A B).
    let repeat = 0;
    for (let k = recent.length - 1, back = 1; k >= 0 && back <= 2; k--, back++) {
      if (recent[k] === key) {
        repeat = back;
        break;
      }
    }
    recent.push(key);
    if (recent.length > 2) recent.shift();
    n += 1;
    cues.push({
      kind: 'line',
      idx,
      line: d.line,
      section: d.section,
      start: d.line.words[0].s,
      end: d.line.words.at(-1)!.e,
      rtl: RTL_SCRIPTS.has(d.line.script),
      n,
      voice,
      voiceChanged: !!voice && voice !== prevVoice,
      repeat,
    });
    prevVoice = voice;
  });

  const lines = cues.filter((c): c is LineCue => c.kind === 'line');
  const starts = cues.map((c) => c.start);

  function ownerAt(t: number) {
    let lo = 0;
    let hi = starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function energyAt(t: number) {
    if (!peaks) return 0;
    const i = Math.floor(t * peaks.rate);
    return peaks.rms[Math.max(0, Math.min(peaks.rms.length - 1, i))] ?? 0;
  }

  return { cues, lines, duration, ownerAt, energyAt };
}

/** Section commentary, when the section itself was not hidden as a draft. */
function sectionComment(cue: LineCue): { text: string; from: Cue } | null {
  if (commentDraftHidden(cue.section.flags)) return null;
  return cue.section.comment ? { text: cue.section.comment, from: cue } : null;
}

/**
 * The commentary the reader sees at a cue: the line's own, else the latest earlier
 * line in the same section that still has one, else the section's.
 * A line marked `comment-draft` does not inherit a neighbour. It shows the section
 * comment when that comment is itself visible, and nothing otherwise.
 */
export function commentFor(timeline: Timeline, cueIdx: number): { text: string; from: Cue } | null {
  const cue = timeline.cues[cueIdx];
  if (!cue) return null;
  if (cue.kind === 'inst') {
    if (commentDraftHidden(cue.section.flags)) return null;
    return cue.section.comment ? { text: cue.section.comment, from: cue } : null;
  }
  if (commentDraftHidden(cue.line.flags)) return sectionComment(cue);
  for (let i = cueIdx; i >= 0; i--) {
    const c = timeline.cues[i];
    if (c.kind !== 'line' || c.section.id !== cue.section.id) break;
    if (commentDraftHidden(c.line.flags)) continue;
    if (c.line.comment) return { text: c.line.comment, from: c };
  }
  return sectionComment(cue);
}
