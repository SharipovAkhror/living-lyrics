/**
 * Direction A, «Перо». Drawn for this site.
 * 24 grid, 1.75 stroke, round caps and joins, corner radius about 2.
 * Idle tab glyphs are line. Pressed tab glyphs are the same figure filled.
 * Transport stays filled: the play control is a solid disc, and a hairline
 * triangle inside it looks unfinished.
 */
import { circle, ellipse, fill, iconSet, rrect, roundPoly, stroke } from './geom';
import type { Glyph, Mark } from './types';

const play = roundPoly(
  [
    { x: 8.55, y: 4.7 },
    { x: 19.35, y: 12 },
    { x: 8.55, y: 19.3 },
  ],
  1.85,
);

const backTri = roundPoly(
  [
    { x: 7.7, y: 12 },
    { x: 17.85, y: 5.15 },
    { x: 17.85, y: 18.85 },
  ],
  1.3,
);

const fwdTri = roundPoly(
  [
    { x: 16.3, y: 12 },
    { x: 6.15, y: 5.15 },
    { x: 6.15, y: 18.85 },
  ],
  1.3,
);

/** Speech bubble, closed. Tail sits inside the grid. */
const bubble =
  'M12 3.55c4.55 0 8.15 2.95 8.15 6.7 0 3.55-3.2 6.45-7.45 6.7l-3.05 2.85c-.42.38-1.08.05-.98-.48l.62-2.55C6.15 15.85 3.7 13.35 3.7 10.25 3.7 6.5 7.45 3.55 12 3.55z';

/** Two text slots knocked out of the filled bubble. */
const bubbleLines =
  rrect(7.7, 7.85, 8.3, 1.7, 0.85) + rrect(7.7, 11.05, 5.5, 1.7, 0.85);

const bookOuter = rrect(4.45, 3.15, 15.15, 17.7, 2.35);
/** Binding, close to the left edge so the filled book does not read as a letter. */
const bookSpine = rrect(5.95, 5.15, 2.2, 13.7, 0.8);

/** Stroke centreline of the cover, so the ink meets the filled cover's edge. */
const bookStroke = rrect(5.325, 4.025, 13.4, 15.95, 1.5);

const listY = [6.85, 12, 17.15];
const listDots = (r: number) => listY.map((y) => fill(circle(5.15, y, r)));
const listLines = stroke('M8.85 6.85H19.25M8.85 12H19.25M8.85 17.15H19.25');
const listBars = listY.map((y) => fill(rrect(8.7, y - 1.15, 10.6, 2.3, 1.15)));

/** Knob centre x per row, top to bottom. */
const knobs: { y: number; cx: number }[] = [
  { y: 6.75, cx: 15.55 },
  { y: 12, cx: 8.55 },
  { y: 17.25, cx: 12.35 },
];

function slider(track: number, knobW: number, knobH: number): Mark[] {
  return [
    stroke(`M3.7 ${knobs[0]!.y}H20.3M3.7 ${knobs[1]!.y}H20.3M3.7 ${knobs[2]!.y}H20.3`, track),
    ...knobs.map(({ y, cx }) => fill(rrect(cx - knobW / 2, y - knobH / 2, knobW, knobH, knobH / 2))),
  ];
}

const cells = [
  [3.7, 3.7],
  [13.05, 3.7],
  [3.7, 13.05],
  [13.05, 13.05],
] as const;

const gridStroke = cells.map(([x, y]) => stroke(rrect(x, y, 7.25, 7.25, 2)));
const gridFill = cells.map(([x, y]) => fill(rrect(x - 0.85, y - 0.85, 8.95, 8.95, 2.55)));

const pages =
  'M12 6.05C9.25 4.5 6.35 4.35 3.6 5.5v12.7c2.85-1.15 5.7-.95 8.4.7 2.7-1.65 5.55-1.85 8.4-.7V5.5C17.65 4.35 14.75 4.5 12 6.05z';

const noteHead = ellipse(8.15, 16.85, 3.25, 2.4, -22);
const noteStem = 'M10.85 15.55V4.85';
const noteFlag = 'M10.85 4.85c3.15.55 4.85 2.15 4.55 4.55';

const searchRing = circle(10.6, 10.6, 6.15);
const infoRing = circle(12, 12, 8.3);
const infoDot = circle(12, 7.75, 1.05);
const infoStem = rrect(11.125, 10.55, 1.75, 5.85, 0.875);

const flagPole = 'M6.45 3.65V20.35';
const flagFly = 'M6.45 4.55H16.85L14.85 8.05 16.85 11.55H6.45z';

const speaker =
  'M4.55 9.4h2.55l3.85-3.2c.4-.32.95-.04.95.48v10.64c0 .52-.55.8-.95.48l-3.85-3.2H4.55c-.55 0-1-.45-1-1v-3.2c0-.55.45-1 1-1z';
const waveNear = 'M14.7 9.25a3.85 3.85 0 0 1 0 5.5';
const waveFar = 'M17.25 6.95a7.15 7.15 0 0 1 0 10.1';

const downloadArrow = 'M12 3.7v9.15M8.4 9.55 12 13.15l3.6-3.6';
const downloadTray = 'M5.15 15.35v2.05a1.85 1.85 0 0 0 1.85 1.85h10a1.85 1.85 0 0 0 1.85-1.85v-2.05';

const chevron = {
  left: 'M15.2 6.55 8.9 12l6.3 5.45',
  right: 'M8.8 6.55 15.1 12l-6.3 5.45',
  down: 'M6.55 8.8 12 15.1l5.45-6.3',
  up: 'M6.55 15.2 12 8.9l5.45 6.3',
};

function line(d: string, sw?: number): Glyph {
  return { off: [stroke(d, sw)] };
}

export const setA = iconSet('a', 24, 1.75, {
  'chevron.left': line(chevron.left),
  'chevron.right': line(chevron.right),
  'chevron.down': line(chevron.down),
  'chevron.up': line(chevron.up),
  xmark: line('M7.15 7.15 16.85 16.85M16.85 7.15 7.15 16.85'),
  play: { off: [fill(play)] },
  pause: { off: [fill(rrect(5.85, 4.45, 4.55, 15.1, 1.6)), fill(rrect(13.6, 4.45, 4.55, 15.1, 1.6))] },
  backward: { off: [fill(rrect(4.2, 5.05, 2.15, 13.9, 1.05)), fill(backTri)] },
  forward: { off: [fill(rrect(17.65, 5.05, 2.15, 13.9, 1.05)), fill(fwdTri)] },
  'character.bubble': {
    off: [stroke(bubble), stroke('M7.85 8.7h8.1M7.85 11.9h5.4', 1.6)],
    on: [fill(bubble + bubbleLines)],
  },
  'book.closed': {
    off: [stroke(bookStroke), stroke('M7.05 4.2v15.6'), stroke('M10.15 8.15h6.2M10.15 11.35h4.3', 1.55)],
    on: [fill(bookOuter + bookSpine)],
  },
  'music.note': { off: [fill(noteHead), stroke(noteStem), stroke(noteFlag)] },
  'list.bullet': { off: [...listDots(1.15), listLines], on: [...listDots(1.35), ...listBars] },
  'slider.horizontal.3': { off: slider(1.75, 4.7, 3.35), on: slider(2.55, 5.5, 3.9) },
  'square.grid.2x2': { off: gridStroke, on: gridFill },
  'book.pages': { off: [stroke(pages), stroke('M12 6.05v12.85')] },
  magnifyingglass: {
    off: [stroke(searchRing), stroke('M15.15 15.15 19.85 19.85')],
    on: [fill(circle(10.6, 10.6, 7.025) + circle(10.6, 10.6, 4.35)), stroke('M15.7 15.7 19.85 19.85', 2.4)],
  },
  'info.circle': {
    off: [stroke(infoRing), fill(infoDot), stroke('M12 10.7v5.55')],
    on: [fill(circle(12, 12, 9.175) + circle(12, 7.75, 1.2) + infoStem)],
  },
  flag: { off: [stroke(flagPole), stroke(flagFly)] },
  'speaker.wave.2': { off: [stroke(speaker), stroke(waveNear), stroke(waveFar)] },
  'square.and.arrow.down': { off: [stroke(downloadArrow), stroke(downloadTray)] },
});
