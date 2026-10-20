/**
 * Direction C, «Стекло». Duotone, heavier, for the soft-glass look.
 * 24 grid. Primary shapes are solid. The second tone is the same ink at
 * 42% — a glass body, not a drop shadow. Corners are rounder than A
 * (about 2.6 to 3). Pressed tabs raise the glass body to full ink and
 * cut the detail out, so the state changes without changing the metaphor.
 * Transport stays solid: a translucent glyph on the accent disc looks unfinished.
 */
import { circle, ellipse, fill, iconSet, rrect, roundPoly, stroke } from './geom';
import type { Mark } from './types';

const GLASS = 0.42;

const play = roundPoly(
  [
    { x: 7.9, y: 4.35 },
    { x: 19.7, y: 12 },
    { x: 7.9, y: 19.65 },
  ],
  2.2,
);

const backTri = roundPoly(
  [
    { x: 7.55, y: 12 },
    { x: 17.7, y: 5.05 },
    { x: 17.7, y: 18.95 },
  ],
  1.7,
);
const fwdTri = roundPoly(
  [
    { x: 16.45, y: 12 },
    { x: 6.3, y: 5.05 },
    { x: 6.3, y: 18.95 },
  ],
  1.7,
);

const bubble =
  'M12 3.7c4.15 0 7.45 2.7 7.45 6.15 0 3.2-2.85 5.8-6.7 6.1l-2.7 2.7c-.4.4-1.05.08-.95-.45l.5-2.4C6.3 14.9 4.4 12.7 4.4 9.85 4.4 6.4 7.85 3.7 12 3.7z';
const bubbleHoles = rrect(8.05, 7.7, 7.5, 1.85, 0.92) + rrect(8.05, 10.85, 5.15, 1.85, 0.92);

const book = rrect(4.15, 3.05, 15.7, 17.9, 3);
const bookSpine = rrect(6.15, 5.2, 2.7, 13.5, 1);
const bookTitle = rrect(10.15, 7.55, 6.15, 1.75, 0.85);

const listY = [6.9, 12, 17.1];
const dots = listY.map((y) => fill(circle(5.2, y, 1.55)));
const bars = (opacity?: number) => listY.map((y) => fill(rrect(8.35, y - 1.25, 11.15, 2.5, 1.25), opacity));

const knobs = [
  { y: 6.8, cx: 15.6 },
  { y: 12, cx: 8.5 },
  { y: 17.2, cx: 12.4 },
];

function tracks(opacity: number | undefined, sw: number): Mark {
  return stroke(`M3.55 ${knobs[0]!.y}H20.45M3.55 ${knobs[1]!.y}H20.45M3.55 ${knobs[2]!.y}H20.45`, sw, opacity);
}
function knobPills(w: number, h: number): Mark[] {
  return knobs.map(({ y, cx }) => fill(rrect(cx - w / 2, y - h / 2, w, h, h / 2)));
}

const cells: { x: number; y: number; opacity: number }[] = [
  { x: 3.25, y: 3.25, opacity: 1 },
  { x: 12.95, y: 3.25, opacity: GLASS },
  { x: 3.25, y: 12.95, opacity: GLASS },
  { x: 12.95, y: 12.95, opacity: 1 },
];
const grid = cells.map(({ x, y, opacity }) => fill(rrect(x, y, 7.8, 7.8, 2.6), opacity));

const pageL = 'M12 6.35C9.25 4.9 6.35 4.75 3.6 5.85v12.15c2.75-1.05 5.55-.9 8.4.5V6.35z';
const pageR = 'M12 6.35C14.75 4.9 17.65 4.75 20.4 5.85v12.15c-2.75-1.05-5.55-.9-8.4.5V6.35z';

const noteHead = ellipse(8.15, 16.85, 3.35, 2.45, -22);
/** Filled flag joined to the stem. A translucent stroke read as a smudge at 16 px. */
const noteFlag = 'M11.05 4.4c3.7.25 5.45 1.95 5.15 3.95-.25 1.6-1.75 2.5-3.65 2.15-.85-.15-1.4-.55-1.5-.95V4.4z';

const lens = circle(10.55, 10.55, 6.35);
const infoDisc = circle(12, 12, 9.05);
const infoMark = circle(12, 7.85, 1.2) + rrect(11.05, 10.45, 1.9, 5.7, 0.95);

const flagPole = 'M6.35 3.45V20.55';
const flagFly = 'M6.35 4.4H17.15L14.9 8.15 17.15 11.9H6.35z';

const speaker =
  'M4.2 9.15h2.85l4.05-3.35c.45-.38 1.1-.05 1.1.55v11.3c0 .6-.65.93-1.1.55l-4.05-3.35H4.2c-.7 0-1.25-.55-1.25-1.25v-3.2c0-.7.55-1.25 1.25-1.25z';
const waveNear = 'M14.85 9.05a4.15 4.15 0 0 1 0 5.9';
const waveFar = 'M17.55 6.55a7.6 7.6 0 0 1 0 10.9';

const chev = 2.25;
const chevron = {
  left: 'M14.7 6.9 9.2 12l5.5 5.1',
  right: 'M9.3 6.9 14.8 12l-5.5 5.1',
  down: 'M6.9 9.3 12 14.8l5.1-5.5',
  up: 'M6.9 14.7 12 9.2l5.1 5.5',
};

export const setC = iconSet('c', 24, 2.15, {
  'chevron.left': { off: [stroke(chevron.left, chev)] },
  'chevron.right': { off: [stroke(chevron.right, chev)] },
  'chevron.down': { off: [stroke(chevron.down, chev)] },
  'chevron.up': { off: [stroke(chevron.up, chev)] },
  xmark: { off: [stroke('M7.35 7.35 16.65 16.65M16.65 7.35 7.35 16.65', chev)] },
  play: { off: [fill(play)] },
  pause: {
    off: [fill(rrect(5.35, 4.15, 5.05, 15.7, 2)), fill(rrect(13.6, 4.15, 5.05, 15.7, 2))],
  },
  backward: { off: [fill(rrect(3.9, 4.85, 2.45, 14.3, 1.2)), fill(backTri)] },
  forward: { off: [fill(rrect(17.65, 4.85, 2.45, 14.3, 1.2)), fill(fwdTri)] },
  'character.bubble': {
    off: [fill(bubble, GLASS), stroke(bubble, 1.6), stroke('M8.2 8.6h7.3M8.2 11.75h5', 1.9)],
    on: [fill(bubble + bubbleHoles)],
  },
  'book.closed': {
    off: [fill(book, GLASS), fill(bookSpine), fill(bookTitle)],
    on: [fill(book + bookSpine)],
  },
  'music.note': {
    off: [fill(noteHead), stroke('M11.05 15.65V4.4', 2.3), fill(noteFlag)],
  },
  'list.bullet': { off: [...bars(GLASS), ...dots], on: [...bars(1), ...dots] },
  'slider.horizontal.3': {
    off: [tracks(GLASS, 2.4), ...knobPills(5.1, 3.7)],
    on: [tracks(1, 2.7), ...knobPills(5.6, 4.15)],
  },
  'square.grid.2x2': { off: grid },
  'book.pages': { off: [fill(pageL, GLASS), fill(pageR)] },
  magnifyingglass: {
    off: [fill(lens, GLASS), stroke(lens, 1.9), stroke('M15.2 15.2 19.9 19.9', 2.2)],
  },
  'info.circle': {
    off: [fill(infoDisc, GLASS), fill(infoMark)],
  },
  flag: {
    off: [stroke(flagPole, 2.2), fill(flagFly, GLASS), stroke(flagFly, 1.7)],
  },
  'speaker.wave.2': {
    off: [fill(speaker), stroke(waveNear, 2.05), stroke(waveFar, 2.05, GLASS)],
  },
  'square.and.arrow.down': {
    off: [
      fill(rrect(4.3, 14.7, 15.4, 4.7, 1.7), GLASS),
      stroke('M12 3.6v9.3', 2.25),
      fill(roundPoly(
        [
          { x: 7.7, y: 10.3 },
          { x: 16.3, y: 10.3 },
          { x: 12, y: 15.35 },
        ],
        0.9,
      )),
    ],
  },
});
