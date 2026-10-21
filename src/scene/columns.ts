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
  /** Distance from the window edge to the note panel. */
  panelInset: number;
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
): StageFrame {
  const lyricW = Math.max(0, Math.min(MEASURE, stageW - padX * 2));
  return {
    colLeft,
    colRight,
    noteW,
    panelInset: marginNote ? PANEL_INSET : 0,
    gap: marginNote ? NOTE_GAP : 0,
    stageW,
    lyricW,
    padX,
    marginNote,
  };
}

/** How wide the margin may be before the lyric column is squeezed below 640 px. */
function noteWidth(vw: number): number {
  const want = Math.round(Math.min(360, Math.max(280, vw * 0.22)));
  const minColumn = 640;
  const room = vw - 28 - NOTE_GAP - PANEL_INSET - want;
  if (room >= minColumn) return want;
  const fit = vw - 28 - NOTE_GAP - PANEL_INSET - minColumn;
  return fit >= 260 ? fit : 0;
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
  const noteW = noteOpen && wide ? noteWidth(vw) : 0;
  if (noteW > 0) {
    const available = vw - PANEL_INSET - noteW - NOTE_GAP;
    let column = Math.min(MEASURE + LYRIC_PAD * 2, available - 28);
    let colLeft = Math.max(28, Math.round((available - column) / 2));
    if (colLeft + column > available) column = available - colLeft;
    const colRight = vw - colLeft - column;
    return frame(colLeft, colRight, noteW, column, true);
  }

  const column = Math.min(wide ? MEASURE + LYRIC_PAD * 2 : 760, vw - 56);
  const colLeft = Math.max(28, Math.round((vw - column) / 2));
  const colRight = vw - colLeft - column;
  return frame(colLeft, colRight, 0, column, false);
}

