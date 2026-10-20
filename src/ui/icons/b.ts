/**
 * Direction B, «Черта». Line and fill pairs.
 *
 * Line drawings are based on Lucide v0.544.0 (ISC), including icons that
 * Lucide carries from Feather (MIT, copyright 2013 Cole Bemis): the four
 * chevrons, x, search, info and download. The rest of the borrowed
 * centre-lines (play, pause, skip, message, book, book-open, list, grid,
 * flag, volume, music) are Lucide's own, ISC.
 *
 * No package is added. What changed from the source:
 * - stroke weight 2 is drawn at 1.75, one weight for the whole set;
 * - terminals stay round, and corners that were sharp (grid, pause) are
 *   rounded to that same radius;
 * - circles, chevrons and bars are pulled onto one optical box so a 22 px
 *   header icon and a 24 px tab icon share a weight;
 * - the settings glyph keeps three tracks. Lucide's vertical ticks are
 *   used, because that is the line-and-fill pair this direction is
 *   showing, and it stays readable as "settings".
 *
 * Pressed tabs fill the same outer contour. Transport is filled in both
 * states: the play control is a solid disc.
 */
import { circle, fill, iconSet, rrect, stroke } from './geom';
import type { Glyph } from './types';

const play =
  'M5.15 5.35a1.7 1.7 0 0 1 2.55-1.47l11.15 6.5a1.7 1.7 0 0 1 0 2.94l-11.15 6.5a1.7 1.7 0 0 1-2.55-1.47V5.35z';

const backTri =
  'M16.55 4.7a1.7 1.7 0 0 1 2.6 1.45v11.7a1.7 1.7 0 0 1-2.6 1.45l-8.7-5.15a1.7 1.7 0 0 1 0-2.95l8.7-5.5z';
const fwdTri =
  'M7.45 4.7a1.7 1.7 0 0 0-2.6 1.45v11.7a1.7 1.7 0 0 0 2.6 1.45l8.7-5.15a1.7 1.7 0 0 0 0-2.95l-8.7-5.5z';

/** Circle-and-tail bubble, the Lucide message-circle idea, kept inside 24. */
const bubble =
  'M12.05 3.85a7.05 7.05 0 0 1 6.05 10.55l1.05 2.4a.72.72 0 0 1-.98.92l-2.75-.8a7.05 7.05 0 1 1-3.37-13.07z';
const bubbleHoles = rrect(8.15, 8.15, 7.3, 1.65, 0.82) + rrect(8.15, 11.25, 4.9, 1.65, 0.82);

/** Lucide book, inset half a pixel so the 1.75 stroke stays inside the grid. */
const book =
  'M4.6 19.15v-13.6A2.35 2.35 0 0 1 6.95 3.2H18.4a1 1 0 0 1 1 1v16.3a1 1 0 0 1-1 1H6.95a1 1 0 0 1 0-4.7H19.4';

const pages =
  'M12 5.35v13.3M19.35 17.7a1.7 1.7 0 0 0 1.7-1.7V6.15a1.7 1.7 0 0 0-1.7-1.7L15.7 4.5A4.4 4.4 0 0 0 12 5.85a4.4 4.4 0 0 0-3.7-1.35H4.65a1.7 1.7 0 0 0-1.7 1.7v9.85a1.7 1.7 0 0 0 1.7 1.7H8.3a4.4 4.4 0 0 1 3.7 1.7 4.4 4.4 0 0 1 3.7-1.7z';

const flag =
  'M5.15 20.6V5.15a.9.9 0 0 1 .35-.72A5.4 5.4 0 0 1 8.7 3.4c2.7 0 4.5 1.8 6.6 1.8 1.2 0 2.15-.25 2.75-.72a.9.9 0 0 1 1.35.72v9a.9.9 0 0 1-.35.72 5.4 5.4 0 0 1-3.2.95c-2.7 0-4.5-1.8-7.2-1.8a5.4 5.4 0 0 0-3.5 1.35';

const speaker =
  'M11.15 5.15a.7.7 0 0 0-1.18-.5L6.7 7.85c-.28.27-.66.42-1.05.42H4.15a1 1 0 0 0-1 1v5.45a1 1 0 0 0 1 1h1.5c.39 0 .77.15 1.05.42l3.27 3.2a.7.7 0 0 0 1.18-.5V5.15z';
const waveNear = 'M15.15 9.15a4.4 4.4 0 0 1 0 5.7';
const waveFar = 'M17.85 6.85a8 8 0 0 1 0 10.3';

const cells = [
  [3.55, 3.55],
  [13.15, 3.55],
  [3.55, 13.15],
  [13.15, 13.15],
] as const;

const grid = cells.map(([x, y]) => stroke(rrect(x, y, 7.3, 7.3, 1.75)));
const gridOn = cells.map(([x, y]) => fill(rrect(x - 0.85, y - 0.85, 9, 9, 2.15)));

const listY = [6.6, 12, 17.4];
const dots = (r: number) => listY.map((y) => fill(circle(5.05, y, r)));
const lines = stroke('M8.7 6.6H19.45M8.7 12H19.45M8.7 17.4H19.45');
const bars = listY.map((y) => fill(rrect(8.55, y - 1.2, 11, 2.4, 1.2)));

/** Lucide sliders-horizontal, pulled in from the edge and drawn at 1.75. */
const sliderLines = 'M10.2 5.5H3.8M12.15 18.5H3.8M20.2 12H11.4M20.2 18.5H15.15M20.2 5.5H13.35M8.15 12H3.8';
const sliderTicks = 'M14.15 3.7v4.1M16.05 16.2v4.1M8.15 9.95v4.1';
const tickPills = [
  fill(rrect(12.7, 3.35, 2.9, 4.8, 1.2)),
  fill(rrect(14.6, 15.85, 2.9, 4.8, 1.2)),
  fill(rrect(6.7, 9.6, 2.9, 4.8, 1.2)),
];

const note =
  'M9.15 17.35V5.35l10.6-1.75v11.35M9.15 8.7l10.6-1.75';

function line(d: string): Glyph {
  return { off: [stroke(d)] };
}

export const setB = iconSet('b', 24, 1.75, {
  'chevron.left': line('M15.15 17.55 9.05 12l6.1-5.55'),
  'chevron.right': line('M8.85 17.55 14.95 12 8.85 6.45'),
  'chevron.down': line('M6.45 8.85 12 14.95l5.55-6.1'),
  'chevron.up': line('M6.45 15.15 12 9.05l5.55 6.1'),
  xmark: line('M16.7 7.3 7.3 16.7M7.3 7.3l9.4 9.4'),
  play: { off: [fill(play)] },
  pause: {
    off: [fill(rrect(5.15, 3.7, 4.7, 16.6, 1.7)), fill(rrect(14.15, 3.7, 4.7, 16.6, 1.7))],
  },
  backward: { off: [fill(rrect(3.35, 4.55, 2.2, 14.9, 1.05)), fill(backTri)] },
  forward: { off: [fill(rrect(18.45, 4.55, 2.2, 14.9, 1.05)), fill(fwdTri)] },
  'character.bubble': {
    off: [stroke(bubble), stroke('M8.3 8.95h7.15M8.3 12.05h4.75', 1.6)],
    on: [fill(bubble + bubbleHoles)],
  },
  'book.closed': {
    off: [stroke(book)],
    // Closed silhouette. Filling the open Lucide centre-line left a slash.
    on: [fill(rrect(5.3, 3.2, 13.5, 13.7, 1.8)), fill(rrect(3.9, 15.85, 16.2, 3.45, 1.25))],
  },
  'music.note': {
    off: [stroke(note), stroke(circle(6.35, 17.45, 2.7)), stroke(circle(17.15, 15.55, 2.7))],
  },
  'list.bullet': { off: [...dots(1.15), lines], on: [...dots(1.4), ...bars] },
  'slider.horizontal.3': {
    off: [stroke(sliderLines), stroke(sliderTicks, 1.9)],
    on: [stroke(sliderLines, 2.15), ...tickPills],
  },
  'square.grid.2x2': { off: grid, on: gridOn },
  'book.pages': { off: [stroke(pages)] },
  magnifyingglass: {
    off: [stroke(circle(10.75, 10.75, 6.45)), stroke('M15.4 15.4 19.8 19.8')],
  },
  'info.circle': {
    off: [stroke(circle(12, 12, 8.45)), stroke('M12 11.15v4.85'), fill(circle(12, 8.05, 1.02))],
    on: [fill(circle(12, 12, 9.3) + circle(12, 8.05, 1.15) + rrect(11.15, 11.05, 1.7, 5.15, 0.85))],
  },
  flag: { off: [stroke(flag)] },
  'speaker.wave.2': { off: [stroke(speaker), stroke(waveNear), stroke(waveFar)] },
  'square.and.arrow.down': {
    off: [
      stroke('M12 14.45V4.15'),
      stroke('M8.15 10.7 12 14.55l3.85-3.85'),
      stroke('M4.7 15.2v2.15a1.75 1.75 0 0 0 1.75 1.75h11.1a1.75 1.75 0 0 0 1.75-1.75V15.2'),
    ],
  },
});
