/**
 * The site's icon set, «Стекло». Duotone, for the soft-glass look.
 * 24 grid. The second tone is the same ink at 0.78 — a glass body,
 * not a drop shadow or an offset. One value for every glass part:
 * large bodies, thin tracks, the chevron shoulder, the search well.
 * Inactive tabs and the skip buttons are already painted at 72% ink
 * (the flag at 58%, search at 55%). A second tone of 0.42 then falls
 * under 2:1 on the lightest glass. 0.78 holds near 4:1 there and
 * stays lighter than the solid structure.
 * Pressed tabs keep the same outer path and the same stroke; the
 * glass body goes to full ink.
 * Play and pause stay solid. They sit in `--on-accent` on a solid
 * song-colour disc, and a second tone there is a hole in that disc.
 * The close mark stays a short solid cross: a glass cross blobs
 * at the centre.
 */
import { capsule, circle, ellipse, fill, iconSet, noteSheet, rrect, roundPoly, stroke } from './geom';
import type { Glyph, Mark } from './types';

/** Second tone, as a fraction of currentColor. See the file comment. */
const GLASS = 0.78;

const play = roundPoly(
  [
    { x: 7.35, y: 4.15 },
    { x: 21.0, y: 12 },
    { x: 7.35, y: 19.85 },
  ],
  1.85,
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

/** Same speech bubble as A and B, so the three sets differ in material, not in the object. */
const bubble =
  'M12 3.55c4.55 0 8.15 2.95 8.15 6.7 0 3.55-3.2 6.45-7.45 6.7l-3.05 2.85c-.42.38-1.08.05-.98-.48l.62-2.55C6.15 15.85 3.7 13.35 3.7 10.25 3.7 6.5 7.45 3.55 12 3.55z';
const bubbleA = 'M7.95 8.2H14.55';
const bubbleB = 'M7.95 11.6H12.05';
const bubbleLineSw = 1.7;
const bubbleSw = 1.9;
const bubbleHoles =
  capsule(7.95, 8.2, 14.55, 8.2, bubbleLineSw) + capsule(7.95, 11.6, 12.05, 11.6, bubbleLineSw);

/** Folded sheet. A glass slab with a slit read as a door. */
const sheet = noteSheet(4.85, 3.65, 14.3, 16.5, 2.2, 5.05);
const sheetCrease = 'M13.05 5.05 L17.85 9.85';
const glossTop = 'M7.15 12.15H15.35';
const glossBot = 'M7.15 15.5H12.45';
const glossSw = 1.85;
const glossHoles =
  capsule(7.15, 12.15, 15.35, 12.15, glossSw) +
  capsule(7.15, 15.5, 12.45, 15.5, glossSw) +
  capsule(13.05, 5.05, 17.85, 9.85, 1.35);
const sheetSw = 2.05;

const listY = [6.9, 12, 17.1];
const dots = listY.map((y) => fill(circle(5.2, y, 1.55)));
const bars = (opacity?: number) => listY.map((y) => fill(rrect(8.35, y - 1.25, 11.15, 2.5, 1.25), opacity));

const knobs = [
  { y: 8.4, cx: 15.35 },
  { y: 15.6, cx: 8.65 },
];

function tracks(opacity: number | undefined, sw: number): Mark {
  return stroke(`M3.7 ${knobs[0]!.y}H20.3M3.7 ${knobs[1]!.y}H20.3`, sw, opacity);
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

const noteHead = ellipse(7.9, 17.15, 3.75, 2.75, -26);
const noteStem = 'M11.05 15.45V4.45';
/** Open hook in the second tone. A closed flag read as a hollow P. */
const noteFlag = 'M11.05 4.45c3.5 1 5.5 2.45 4.7 4.55';

const lens = circle(10.55, 10.55, 6.15);
/**
 * Same construction as the search lens: a glass disc inside a solid ring.
 * A bare translucent disc read as a grey blob at 16 px, and the stem sat
 * so close to the dot that the two merged.
 */
const infoDisc = circle(12, 12, 8.2);
const infoDot = circle(12, 7.85, 1.38);
const infoStem = rrect(10.92, 11.15, 2.16, 5.9, 1.08);
/** Arrow stops short of the bowl, so the two do not fuse into one wedge. */
const downloadStem = 'M12 3.2V8.15';
const downloadHead = roundPoly(
  [
    { x: 7.85, y: 7.15 },
    { x: 16.15, y: 7.15 },
    { x: 12, y: 11.15 },
  ],
  0.9,
);
const downloadTray = 'M5.2 14.9v3.7c0 1.2 1 2.15 2.2 2.15h9.2c1.2 0 2.2-.95 2.2-2.15v-3.7';
const downloadBowl = 'M6.4 15.2v3.15c0 .7.55 1.25 1.3 1.25h8.6c.75 0 1.3-.55 1.3-1.25v-3.15z';

const flagPole = 'M6.35 3.45V20.55';
const flagFly = 'M6.35 4.4H17.15L14.9 8.15 17.15 11.9H6.35z';

const speaker =
  'M4.2 9.15h2.85l4.05-3.35c.45-.38 1.1-.05 1.1.55v11.3c0 .6-.65.93-1.1.55l-4.05-3.35H4.2c-.7 0-1.25-.55-1.25-1.25v-3.2c0-.7.55-1.25 1.25-1.25z';
const waveNear = 'M14.85 9.05a4.15 4.15 0 0 1 0 5.9';
const waveFar = 'M17.55 6.55a7.6 7.6 0 0 1 0 10.9';

const chevron = {
  left: 'M14.7 6.9 9.2 12l5.5 5.1',
  right: 'M9.3 6.9 14.8 12l-5.5 5.1',
  down: 'M6.9 9.3 12 14.8l5.1-5.5',
  up: 'M6.9 14.7 12 9.2l5.1 5.5',
};

/** Glass body under a solid core. Concentric, not a shadow. */
function glassStroke(d: string, core = 2.6, body = 4.5): Glyph {
  return { off: [stroke(d, body, GLASS), stroke(d, core)] };
}

export const setC = iconSet('c', 24, 2.15, {
  'chevron.left': glassStroke(chevron.left),
  'chevron.right': glassStroke(chevron.right),
  'chevron.down': glassStroke(chevron.down),
  'chevron.up': glassStroke(chevron.up),
  // A thick glass cross blobs at the centre, so the arms stay solid and short.
  xmark: { off: [stroke('M8.15 8.15 15.85 15.85M15.85 8.15 8.15 15.85', 2.45)] },
  play: { off: [fill(play)] },
  pause: {
    off: [fill(rrect(5.15, 4.2, 5.15, 15.6, 2.05)), fill(rrect(13.7, 4.2, 5.15, 15.6, 2.05))],
  },
  backward: {
    off: [fill(backTri, GLASS), stroke(backTri, 1.9), fill(rrect(3.9, 4.85, 2.45, 14.3, 1.2))],
  },
  forward: {
    off: [fill(fwdTri, GLASS), stroke(fwdTri, 1.9), fill(rrect(17.65, 4.85, 2.45, 14.3, 1.2))],
  },
  'character.bubble': {
    off: [fill(bubble, GLASS), stroke(bubble, bubbleSw), stroke(bubbleA, bubbleLineSw), stroke(bubbleB, bubbleLineSw)],
    on: [fill(bubble + bubbleHoles), stroke(bubble, bubbleSw)],
  },
  'book.closed': {
    off: [
      fill(sheet, GLASS),
      stroke(sheet, sheetSw),
      stroke(sheetCrease, 1.6),
      stroke(glossTop, glossSw),
      stroke(glossBot, glossSw),
    ],
    on: [fill(sheet + glossHoles), stroke(sheet, sheetSw)],
  },
  'music.note': {
    off: [fill(noteHead), stroke(noteStem, 2.45), stroke(noteFlag, 3.35, GLASS)],
  },
  'list.bullet': { off: [...bars(GLASS), ...dots], on: [...bars(1), ...dots] },
  'slider.horizontal.3': {
    off: [tracks(GLASS, 2.15), ...knobPills(5.15, 3.25)],
    on: [tracks(1, 2.35), ...knobPills(5.45, 3.5)],
  },
  'square.grid.2x2': { off: grid },
  'book.pages': {
    // A stroke on both pages, so the glass page keeps an edge at 20 px.
    // The shared spine is the binding.
    off: [fill(pageL, GLASS), fill(pageR), stroke(pageL, 1.45), stroke(pageR, 1.45)],
  },
  magnifyingglass: {
    // Glass well inside a solid ring. A well at 0.28 vanished in the
    // search field, which paints the icon at 55% ink.
    off: [fill(lens, GLASS), stroke(lens, 2.35), stroke('M15.05 15.05 19.9 19.9', 2.4)],
  },
  'info.circle': {
    off: [fill(infoDisc, GLASS), stroke(infoDisc, 2.15), fill(infoDot), fill(infoStem)],
  },
  flag: {
    off: [stroke(flagPole, 2.35), fill(flagFly, GLASS), stroke(flagFly, 1.85)],
  },
  'speaker.wave.2': {
    off: [fill(speaker), stroke(waveNear, 2.05), stroke(waveFar, 2.05, GLASS)],
  },
  'square.and.arrow.down': {
    off: [fill(downloadBowl, GLASS), stroke(downloadTray, 2.15), stroke(downloadStem, 2.15), fill(downloadHead)],
  },
});
