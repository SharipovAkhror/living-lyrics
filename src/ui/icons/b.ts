/**
 * Direction B, «Черта». Line and fill pairs.
 *
 * Line drawings are based on Lucide v0.544.0 (ISC), including icons that
 * Lucide carries from Feather (MIT, copyright 2013 Cole Bemis): the four
 * chevrons, x, search, info and download. Also Lucide's own (ISC): play,
 * pause, skip, book-open, list, grid, flag, volume.
 *
 * No package is added. What changed from the source:
 * - stroke weight 2 is drawn at 1.75, one weight for the whole set;
 * - terminals stay round, and corners that were sharp (grid, pause) are
 *   rounded to that same radius;
 * - circles, chevrons and bars sit in one optical box;
 * - chevron elbows are an explicit curve, and the arms are pulled in,
 *   so the tip is not a sharp corner and the opening is not wider than
 *   the circles next to it;
 * - the comment tab, the speech bubble, the note and the faders are
 *   original drawings. Lucide's book read as a phone, its message circle
 *   read as @, its beamed pair clogged at 16 px, and its slider ticks
 *   read as crosses.
 *
 * Pressed tabs fill the same outer contour (the stroke is drawn again on
 * the fill so the edge does not jump). Transport is filled in both states.
 */
import { capsule, circle, ellipse, fill, iconSet, noteSheet, openChevron, rrect, stroke } from './geom';
import type { Glyph, Mark } from './types';

const play =
  'M5.15 5.35a1.7 1.7 0 0 1 2.55-1.47l11.15 6.5a1.7 1.7 0 0 1 0 2.94l-11.15 6.5a1.7 1.7 0 0 1-2.55-1.47V5.35z';

const backTri =
  'M16.55 4.7a1.7 1.7 0 0 1 2.6 1.45v11.7a1.7 1.7 0 0 1-2.6 1.45l-8.7-5.15a1.7 1.7 0 0 1 0-2.95l8.7-5.5z';
const fwdTri =
  'M7.45 4.7a1.7 1.7 0 0 0-2.6 1.45v11.7a1.7 1.7 0 0 0 2.6 1.45l8.7-5.15a1.7 1.7 0 0 0 0-2.95l-8.7-5.5z';

/** Squircle speech bubble. A circle with a tail read as @ at 16 px. */
const bubble =
  'M12 3.55c4.55 0 8.15 2.95 8.15 6.7 0 3.55-3.2 6.45-7.45 6.7l-3.05 2.85c-.42.38-1.08.05-.98-.48l.62-2.55C6.15 15.85 3.7 13.35 3.7 10.25 3.7 6.5 7.45 3.55 12 3.55z';
const bubbleA = 'M7.95 8.2H14.55';
const bubbleB = 'M7.95 11.6H12.05';
const bubbleSw = 1.45;
const bubbleHoles = capsule(7.95, 8.2, 14.55, 8.2, bubbleSw) + capsule(7.95, 11.6, 12.05, 11.6, bubbleSw);

/** Same folded sheet as A. Lucide's book read as a handset at this size. */
const sheet = noteSheet(4.85, 3.65, 14.3, 16.5, 2.15, 5.05);
const sheetCrease = 'M13.05 5.05 L17.85 9.85';
const glossTop = 'M7.15 12.15H15.35';
const glossBot = 'M7.15 15.5H12.45';
const glossSw = 1.55;
const glossHoles =
  capsule(7.15, 12.15, 15.35, 12.15, glossSw) +
  capsule(7.15, 15.5, 12.45, 15.5, glossSw) +
  capsule(13.05, 5.05, 17.85, 9.85, 1.3);

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
const bars = listY.map((y) => fill(rrect(8.55, y - 1.05, 10.7, 2.1, 1.05)));

/** Two faders. Vertical ticks read as crosses; the knob centre does not move when pressed. */
const faderRows: { y: number; cx: number }[] = [
  { y: 8.4, cx: 15.35 },
  { y: 15.6, cx: 8.65 },
];

function faders(mode: 'off' | 'on'): Mark[] {
  const knobW = mode === 'on' ? 5.35 : 4.95;
  const knobH = mode === 'on' ? 3.5 : 3.25;
  const track = mode === 'on' ? 2.1 : 1.75;
  const left = 3.9;
  const right = 20.1;
  return faderRows.flatMap(({ y, cx }) => {
    const kL = cx - knobW / 2;
    const kR = cx + knobW / 2;
    const knob = rrect(kL, y - knobH / 2, knobW, knobH, knobH / 2);
    if (mode === 'off') {
      return [
        stroke(`M${left} ${y}H${kL - 0.4}M${kR + 0.4} ${y}H${right}`, track),
        stroke(knob, track),
      ];
    }
    return [
      fill(capsule(left, y, kL + 0.45, y, track)),
      fill(capsule(kR - 0.45, y, right, y, track)),
      fill(knob),
    ];
  });
}

const noteHead = ellipse(8.05, 17.05, 3.55, 2.6, -26);
const noteStem = 'M11.0 15.4V4.55';
const noteFlag = 'M11.0 4.5c3.5 1 5.5 2.45 4.7 4.55';

function line(d: string, sw?: number): Glyph {
  return { off: [stroke(d, sw)] };
}

const elbow = 2.35;

export const setB = iconSet('b', 24, 1.75, {
  'chevron.left': line(openChevron({ x: 14.9, y: 7.7 }, { x: 9.25, y: 12 }, { x: 14.9, y: 16.3 }, elbow)),
  'chevron.right': line(openChevron({ x: 9.1, y: 7.7 }, { x: 14.75, y: 12 }, { x: 9.1, y: 16.3 }, elbow)),
  'chevron.down': line(openChevron({ x: 7.7, y: 9.1 }, { x: 12, y: 14.75 }, { x: 16.3, y: 9.1 }, elbow)),
  'chevron.up': line(openChevron({ x: 7.7, y: 14.9 }, { x: 12, y: 9.25 }, { x: 16.3, y: 14.9 }, elbow)),
  xmark: line('M8.25 8.25 15.75 15.75M15.75 8.25 8.25 15.75', 1.6),
  play: { off: [fill(play)] },
  pause: {
    off: [fill(rrect(5.15, 3.7, 4.7, 16.6, 1.7)), fill(rrect(14.15, 3.7, 4.7, 16.6, 1.7))],
  },
  backward: { off: [fill(rrect(3.35, 4.55, 2.2, 14.9, 1.05)), fill(backTri)] },
  forward: { off: [fill(rrect(18.45, 4.55, 2.2, 14.9, 1.05)), fill(fwdTri)] },
  'character.bubble': {
    off: [stroke(bubble), stroke(bubbleA, bubbleSw), stroke(bubbleB, bubbleSw)],
    on: [fill(bubble + bubbleHoles), stroke(bubble)],
  },
  'book.closed': {
    off: [stroke(sheet), stroke(sheetCrease, 1.45), stroke(glossTop, glossSw), stroke(glossBot, glossSw)],
    on: [fill(sheet + glossHoles), stroke(sheet)],
  },
  'music.note': { off: [fill(noteHead), stroke(noteStem, 2.25), stroke(noteFlag, 3.05)] },
  'list.bullet': { off: [...dots(1.15), lines], on: [...dots(1.62), ...bars] },
  'slider.horizontal.3': { off: faders('off'), on: faders('on') },
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
