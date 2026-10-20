/**
 * Direction A, «Перо». Drawn for this site.
 * 24 grid, 1.75 stroke, round caps and joins, corner radius about 2.
 * Idle tab glyphs are line. Pressed tab glyphs are the same figure filled:
 * the fill is traced again with the same stroke so the outer edge does not
 * jump between states.
 * Transport stays filled. The play triangle is optically larger than its
 * bounding box suggests, so at 16–20 px it keeps the weight of the other glyphs.
 * The comment tab is a folded sheet (a note on this line). Methodology stays an open book.
 */
import { capsule, circle, ellipse, fill, iconSet, noteSheet, rrect, roundPoly, stroke } from './geom';
import type { Glyph, Mark } from './types';

const play = roundPoly(
  [
    { x: 7.55, y: 4.35 },
    { x: 20.95, y: 12 },
    { x: 7.55, y: 19.65 },
  ],
  1.5,
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

/** Two short lines, clear of the outline. One centred line read as a minus. */
const bubbleA = 'M7.95 8.2H14.55';
const bubbleB = 'M7.95 11.6H12.05';
const bubbleSw = 1.45;
const bubbleHoles = capsule(7.95, 8.2, 14.55, 8.2, bubbleSw) + capsule(7.95, 11.6, 12.05, 11.6, bubbleSw);

/**
 * A sheet with the corner folded: a note on this line.
 * Methodology keeps the open book, so the two are not two books.
 */
const sheet = noteSheet(4.85, 3.65, 14.3, 16.5, 2.15, 5.05);
const sheetCrease = 'M13.05 5.05 L17.85 9.85';
const glossTop = 'M7.15 12.15H15.35';
const glossBot = 'M7.15 15.5H12.45';
const glossSw = 1.55;
const glossHoles =
  capsule(7.15, 12.15, 15.35, 12.15, glossSw) +
  capsule(7.15, 15.5, 12.45, 15.5, glossSw) +
  capsule(13.05, 5.05, 17.85, 9.85, 1.3);

const listY = [6.85, 12, 17.15];
const listDots = (r: number) => listY.map((y) => fill(circle(5.15, y, r)));
const listLines = stroke('M8.85 6.85H19.25M8.85 12H19.25M8.85 17.15H19.25');
const listBars = listY.map((y) => fill(rrect(8.7, y - 1.05, 10.5, 2.1, 1.05)));

/** Two faders. Three tracks closed up at 16 px; the centres stay put when pressed. */
const faders: { y: number; cx: number }[] = [
  { y: 8.4, cx: 15.35 },
  { y: 15.6, cx: 8.65 },
];

function slider(track: number, knobW: number, knobH: number): Mark[] {
  return [
    stroke(`M3.85 ${faders[0]!.y}H20.15M3.85 ${faders[1]!.y}H20.15`, track),
    ...faders.map(({ y, cx }) => fill(rrect(cx - knobW / 2, y - knobH / 2, knobW, knobH, knobH / 2))),
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

const noteHead = ellipse(7.9, 17.15, 3.75, 2.75, -26);
const noteStem = 'M11.05 15.45V4.45';
/** Open hook, heavy enough to sit with the filled head. A closed flag read as a P. */
const noteFlag = 'M11.05 4.45c3.5 1 5.5 2.45 4.7 4.55';

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
  // Shorter and a hair lighter than the chevrons: two strokes otherwise outweigh one.
  xmark: line('M8.2 8.2 15.8 15.8M15.8 8.2 8.2 15.8', 1.6),
  play: { off: [fill(play)] },
  pause: { off: [fill(rrect(5.3, 4.4, 4.9, 15.2, 1.7)), fill(rrect(13.8, 4.4, 4.9, 15.2, 1.7))] },
  backward: { off: [fill(rrect(4.2, 5.05, 2.15, 13.9, 1.05)), fill(backTri)] },
  forward: { off: [fill(rrect(17.65, 5.05, 2.15, 13.9, 1.05)), fill(fwdTri)] },
  'character.bubble': {
    off: [stroke(bubble), stroke(bubbleA, bubbleSw), stroke(bubbleB, bubbleSw)],
    on: [fill(bubble + bubbleHoles), stroke(bubble)],
  },
  'book.closed': {
    off: [stroke(sheet), stroke(sheetCrease, 1.45), stroke(glossTop, glossSw), stroke(glossBot, glossSw)],
    on: [fill(sheet + glossHoles), stroke(sheet)],
  },
  'music.note': { off: [fill(noteHead), stroke(noteStem, 2.3), stroke(noteFlag, 3.15)] },
  'list.bullet': { off: [...listDots(1.15), listLines], on: [...listDots(1.62), ...listBars] },
  'slider.horizontal.3': { off: slider(1.75, 5.15, 3.2), on: slider(2.05, 5.5, 3.55) },
  'square.grid.2x2': { off: gridStroke, on: gridFill },
  'book.pages': { off: [stroke(pages), stroke('M12 6.05v12.85')] },
  magnifyingglass: {
    off: [stroke(searchRing), stroke('M15.15 15.15 19.85 19.85')],
    // Solid lens. A ring with a large hole read as a target. Separate fills so the handle does not punch the disc.
    on: [
      fill(circle(10.6, 10.6, 7.025)),
      fill(capsule(10.6 + 4.7 * Math.SQRT1_2, 10.6 + 4.7 * Math.SQRT1_2, 19.9, 19.9, 2.7)),
    ],
  },
  'info.circle': {
    off: [stroke(infoRing), fill(infoDot), stroke('M12 10.7v5.55')],
    on: [fill(circle(12, 12, 9.175) + circle(12, 7.75, 1.2) + infoStem)],
  },
  flag: { off: [stroke(flagPole), stroke(flagFly)] },
  'speaker.wave.2': { off: [stroke(speaker), stroke(waveNear), stroke(waveFar)] },
  'square.and.arrow.down': { off: [stroke(downloadArrow), stroke(downloadTray)] },
});
