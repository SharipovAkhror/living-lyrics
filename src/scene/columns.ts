/**
 * Desktop column geometry for the song stage.
 *
 * One function owns the numbers. The page writes them as CSS variables, and
 * `npm run test:layout` checks the same function from 800 to 1920. A lyric box
 * is the stage's content box: it is centred in the canvas left of the margin
 * note and never crosses into that note.
 */

export interface StageFrame {
  colLeft: number;
  colRight: number;
  /** Width of the margin panel. Zero when the note is not a side column. */
  noteW: number;
  /** Top and bottom inset of the note panel. Stays small on every width. */
  panelInset: number;
  /** Distance from the window's right edge to the note. Matches panelInset until the centred group. */
  noteRight: number;
  /** Clear gap between the stage and the note panel. */
  gap: number;
  stageW: number;
  /** Widest the original line may be, inside the stage, after horizontal padding. */
  lyricW: number;
  padX: number;
  /** The note is a column beside the stage, not a sheet. */
  marginNote: boolean;
}

export const LYRIC_PAD = 24;
/** A spread, not a banner. Longer lines wrap inside this. */
const MEASURE = 820;
const PANEL_INSET = 16;
const NOTE_GAP = 20;

function frame(
  colLeft: number,
  colRight: number,
  noteW: number,
  stageW: number,
  marginNote: boolean,
  padX = LYRIC_PAD,
  panelInset = marginNote ? PANEL_INSET : 0,
  noteRight = panelInset,
  measure = MEASURE,
): StageFrame {
  const lyricW = Math.max(0, Math.min(measure, stageW - padX * 2));
  return {
    colLeft,
    colRight,
    noteW,
    panelInset,
    noteRight,
    gap: marginNote ? NOTE_GAP : 0,
    stageW,
    lyricW,
    padX,
    marginNote,
  };
}

/** One fixed column. The stage is centred in whatever width is left. */
const NOTE_W = 320;

/**
 * One spread on the desk and on a large display. Growing it past 2000 stretched
 * the header and the floor past the 920 column (round 18). 4rem type still wraps.
 */
function measureFor(_vw: number): number {
  return MEASURE;
}

/**
 * `noteOpen` is true when a note should stand in the margin. Narrow and short
 * windows keep the note one tap away instead, and this returns `marginNote: false`.
 */
export function stageFrame(vw: number, vh: number, noteOpen: boolean): StageFrame {
  const car = vw >= 700 && vh <= 640;
  if (car) {
    const col = 12;
    return frame(col, col, 0, Math.max(0, vw - col * 2), false);
  }
  if (vw < 800) return frame(0, 0, 0, vw, false);

  const wide = vw >= 1100 && vh > 640;
  const noteW = noteOpen && wide ? NOTE_W : 0;
  const measure = measureFor(vw);
  if (noteW > 0) {
    // One group: the stage and the note, centred together. Desk and a large
    // display use the same rule. A window that cannot hold the group keeps the
    // note on the window edge, which the 800–1920 checks still cover.
    const cap = measure + LYRIC_PAD * 2;
    const wanted = cap + NOTE_GAP + noteW;
    if ((vw - wanted) / 2 >= 28) {
      const colLeft = Math.floor((vw - wanted) / 2);
      const noteRight = vw - colLeft - wanted;
      const colRight = vw - colLeft - cap;
      return frame(colLeft, colRight, noteW, cap, true, LYRIC_PAD, PANEL_INSET, noteRight, measure);
    }
    const reserved = PANEL_INSET + noteW + NOTE_GAP;
    const remaining = Math.max(0, vw - reserved);
    const stageW = Math.min(cap, Math.max(0, remaining - 28));
    const colLeft = Math.max(28, Math.round((remaining - stageW) / 2));
    const colRight = vw - colLeft - stageW;
    return frame(colLeft, colRight, noteW, stageW, true, LYRIC_PAD, PANEL_INSET, PANEL_INSET, measure);
  }

  const column = Math.min(wide ? measure + LYRIC_PAD * 2 : 760, vw - 56);
  const colLeft = Math.max(28, Math.round((vw - column) / 2));
  const colRight = vw - colLeft - column;
  return frame(colLeft, colRight, 0, column, false);
}

