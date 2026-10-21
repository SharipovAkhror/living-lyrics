/**
 * Qalam — the Living Lyrics icon family, round 6.
 *
 * One monoline, round caps, round joins. The pen shows up as a cut you can
 * still name at 20 px: a chamfer on both pause bars, a swallowtail on the
 * flag, a diamond bullet, the speech bubble's nib tail.
 * A facet on the play apex and a wedge on the search handle were drawn and
 * removed: at 20 px they read as clipped corners, not as a pen.
 * Copperplate hatching is not used. At 16–24 px it turns into gray mud and
 * reads as a broken path (see docs/design/t28-icons.md).
 *
 * Idle and active are the same paths.
 * Keylines get heavier. Plates fill in, and their writing stays as paper.
 * Solids (play, pause, skip, the note head) grow; they do not grow a hole.
 *
 * Optical masters are 16, 20, 24 and 32 on a shared 24 grid. Stroke widths
 * are in grid units. Rendered pixels = grid × (master / 24).
 */
import { ICON_NAMES, type Glyph, type IconName, type IconSet, type Mark } from '../../../src/ui/icons/types';
import {
  capsule,
  circle,
  diamond,
  elbow,
  line,
  n,
  pt,
  rrect,
  roundPoly,
  type Pt,
} from './pen';

export const OPTICAL = [16, 20, 24, 32] as const;
export type Optical = (typeof OPTICAL)[number];

type Spec = {
  id: Optical;
  /** Keyline weight, grid units. Targets about 1.7 / 1.9 / 2.0 / 2.2 px. */
  sw: number;
  /** Same path, pressed. About +40 %, still inside the 24 box. */
  swOn: number;
  /** Corner radius for plates. */
  rad: number;
};

const SPECS: Record<Optical, Spec> = {
  16: { id: 16, sw: 2.55, swOn: 3.55, rad: 1.7 },
  20: { id: 20, sw: 2.3, swOn: 3.2, rad: 1.6 },
  24: { id: 24, sw: 2.0, swOn: 2.8, rad: 1.5 },
  32: { id: 32, sw: 1.65, swOn: 2.35, rad: 1.35 },
};

function stroke(d: string, sw: number): Mark {
  return { d, draw: 'stroke', sw };
}

function fill(d: string): Mark {
  return { d, draw: 'fill', rule: 'evenodd' };
}

function keyline(d: string, o: Spec, idle = o.sw, active = o.swOn): Glyph {
  return { off: [stroke(d, idle)], on: [stroke(d, active)] };
}

function scaleAbout(pts: Pt[], k: number): Pt[] {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

function leftPerp(u: Pt): Pt {
  return { x: u.y, y: -u.x };
}

function dir(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Outline of one open stroke with round caps and a round join.
 * Used to knock a letter out of a filled plate. The loop does not
 * cross itself, so an evenodd cut stays a clean groove.
 */
function ribbon(points: Pt[], width: number): string {
  const r = width / 2;
  const count = points.length;
  const incoming = points.map((_, i) => (i === 0 ? dir(points[0]!, points[1]!) : dir(points[i - 1]!, points[i]!)));
  const outgoing = points.map((_, i) =>
    i === count - 1 ? incoming[i]! : dir(points[i]!, points[i + 1]!),
  );
  const side = (i: number, sign: number, which: 'in' | 'out'): Pt => {
    const u = which === 'in' ? incoming[i]! : outgoing[i]!;
    const p = leftPerp(u);
    return { x: points[i]!.x + p.x * r * sign, y: points[i]!.y + p.y * r * sign };
  };
  // sign +1 is the left of the walking direction.
  const L = (i: number, which: 'in' | 'out') => side(i, 1, which);
  const R = (i: number, which: 'in' | 'out') => side(i, -1, which);

  let d = `M${n(L(0, 'out').x)} ${n(L(0, 'out').y)}`;
  for (let i = 0; i < count - 1; i++) {
    d += `L${n(L(i + 1, 'in').x)} ${n(L(i + 1, 'in').y)}`;
    if (i + 1 < count - 1) {
      const joinTo = L(i + 1, 'out');
      d += `A${n(r)} ${n(r)} 0 0 1 ${n(joinTo.x)} ${n(joinTo.y)}`;
    }
  }
  d += `A${n(r)} ${n(r)} 0 0 1 ${n(R(count - 1, 'out').x)} ${n(R(count - 1, 'out').y)}`;
  for (let i = count - 1; i > 0; i--) {
    d += `L${n(R(i - 1, 'out').x)} ${n(R(i - 1, 'out').y)}`;
    if (i - 1 > 0) {
      const joinTo = R(i - 1, 'in');
      d += `A${n(r)} ${n(r)} 0 0 1 ${n(joinTo.x)} ${n(joinTo.y)}`;
    }
  }
  d += `A${n(r)} ${n(r)} 0 0 1 ${n(L(0, 'out').x)} ${n(L(0, 'out').y)}Z`;
  return d;
}

function chevron(direction: 'left' | 'right' | 'down' | 'up', o: Spec): Glyph {
  const elbowR = 2.45;
  const map = {
    left: { a: pt(15.35, 5.85), tip: pt(8.15, 12), b: pt(15.35, 18.15) },
    right: { a: pt(8.65, 5.85), tip: pt(15.85, 12), b: pt(8.65, 18.15) },
    down: { a: pt(5.85, 8.65), tip: pt(12, 15.85), b: pt(18.15, 8.65) },
    up: { a: pt(5.85, 15.35), tip: pt(12, 8.15), b: pt(18.15, 15.35) },
  }[direction];
  return keyline(elbow(map.a, map.tip, map.b, elbowR), o);
}

/** One cross. Pressing it only adds weight — end ticks read as a star. */
function closeMark(o: Spec): Glyph {
  const a = 6.9;
  const b = 17.1;
  return keyline(`M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}`, o);
}

/**
 * Play. A solid rounded triangle in both states. A nib facet on the apex
 * was tried: at 20 px it disappeared, and at 56 px it read as a clipped
 * corner. Pressed, the same triangle grows. It does not grow a hole.
 */
function play(o: Spec): Glyph {
  // The centroid of a left-based triangle is a third of the way from the base,
  // which lands on the optical centre of the 24 box.
  const pts = [pt(7.85, 4.5), pt(19.4, 12), pt(7.85, 19.5)];
  const rad = [1.55, 1.2, 1.55];
  const grow = o.id <= 20 ? 1.16 : 1.13;
  return { off: [fill(roundPoly(pts, rad))], on: [fill(roundPoly(scaleAbout(pts, grow), rad))] };
}

/** Pause. Solid bars. The top-left corner is a nib chamfer large enough to be a cut, not a snag. */
function pause(o: Spec): Glyph {
  const cut = 2.15;
  const w = 4.2;
  const h = 14.7;
  const top = 4.55;
  const gap = 5.15;
  const x0 = (24 - (w * 2 + gap)) / 2;
  const bar = (x: number): Pt[] => [
    pt(x, top + cut),
    pt(x + cut, top),
    pt(x + w, top),
    pt(x + w, top + h),
    pt(x, top + h),
  ];
  const rad = [0.35, 0.35, 1.15, 1.15, 1.15];
  const left = bar(x0);
  const right = bar(x0 + w + gap);
  const grown = (pts: Pt[]) => roundPoly(scaleAbout(pts, o.id <= 20 ? 1.16 : 1.12), rad);
  return { off: [fill(roundPoly(left, rad) + roundPoly(right, rad))], on: [fill(grown(left) + grown(right))] };
}

/** Previous / next line. Bar and triangle are both solid, so the density matches. */
function skip(direction: 'back' | 'fwd', o: Spec): Glyph {
  const barW = 2.65;
  const barX = direction === 'back' ? 3.85 : 24 - 3.85 - barW;
  const bar = (w: number, x: number) => rrect(x, 5.15, w, 13.7, Math.min(1.2, o.rad));
  // Clean triangle. A facet on this tip read as a chip next to the solid bar.
  const tri =
    direction === 'back'
      ? [pt(8.85, 12), pt(18.65, 5.15), pt(18.65, 18.85)]
      : [pt(15.15, 12), pt(5.35, 5.15), pt(5.35, 18.85)];
  const rad = [1.05, 1.2, 1.2];
  const triOn = scaleAbout(tri, o.id <= 20 ? 1.14 : 1.1);
  const barOnX = direction === 'back' ? barX - 0.22 : barX - barW * 0.08;
  return {
    off: [fill(roundPoly(tri, rad)), fill(bar(barW, barX))],
    on: [fill(roundPoly(triOn, rad)), fill(bar(barW * 1.16, barOnX))],
  };
}

/**
 * Translation. A speech bubble with one Latin A.
 * An ayn or beh beside the A was drawn and looked at 20 px: the Arabic
 * letter collapsed into a squiggle and the A was the only thing left.
 * The bubble is the container the eye already calls language; the A is
 * big enough to have an open counter. The tail is a nib, offset, not a speck.
 */
function translation(o: Spec): Glyph {
  const bubble: Pt[] = [
    pt(3.5, 3.15),
    pt(20.5, 3.15),
    pt(20.5, 15.15),
    pt(13.35, 15.15),
    pt(7.7, 20.85),
    pt(9.85, 15.15),
    pt(3.5, 15.15),
  ];
  const rad = [2.45, 2.45, 2.05, 0.4, 0.34, 0.4, 2.05];
  const shape = roundPoly(bubble, rad);
  const lw = o.id === 16 ? 2.05 : o.id === 20 ? 1.9 : o.id === 24 ? 1.75 : 1.5;
  const apex = pt(12, 5.45);
  const left = pt(8.35, 13.35);
  const right = pt(15.65, 13.35);
  const yBar = 10.55;
  const t = (yBar - apex.y) / (left.y - apex.y);
  const barL = pt(apex.x + (left.x - apex.x) * t, yBar);
  const barR = pt(apex.x + (right.x - apex.x) * t, yBar);
  const letter = line(apex, left) + line(apex, right) + line(barL, barR);
  const legs = ribbon([left, apex, right], lw);
  const bar = capsule(barL.x, barL.y, barR.x, barR.y, lw);
  return {
    off: [stroke(shape, o.sw), stroke(letter, lw)],
    on: [fill(shape + legs + bar), stroke(shape, o.sw)],
  };
}

/** Explanation. A closed book. The lines sit inside the cover; loose lines read as overflow. */
function gloss(o: Spec): Glyph {
  const shape = rrect(5.15, 3.15, 13.7, 17.7, o.rad + 0.2);
  const w = Math.min(o.sw * 0.9, 2.05);
  // No spine. A vertical rule beside horizontal ones read as the letter E.
  const rows = [
    { x1: 8.05, x2: 16.35, y: 7.7 },
    { x1: 8.05, x2: 14.55, y: 12 },
    { x1: 8.05, x2: 15.7, y: 16.3 },
  ];
  const rules = rows.map((row) => ({
    ink: stroke(line(pt(row.x1, row.y), pt(row.x2, row.y)), w),
    cut: capsule(row.x1, row.y, row.x2, row.y, w),
  }));
  return {
    off: [...rules.map((row) => row.ink), stroke(shape, o.sw)],
    on: [fill(shape + rules.map((row) => row.cut).join('')), stroke(shape, o.sw)],
  };
}

/**
 * All the words. Three lines and three diamond bullets — a list, not a page.
 * A filled page was the same silhouette as the closed book, and heavier than
 * the icons beside it.
 */
function manuscript(o: Spec): Glyph {
  const rows = [
    { y: 6.35, x2: 19.4 },
    { y: 12, x2: 16.5 },
    { y: 17.65, x2: 18.3 },
  ];
  const r = 1.7;
  const dots = rows.map((row) => diamond(4.85, row.y, r)).join('');
  const dotsOn = rows.map((row) => diamond(4.85, row.y, r * 1.16)).join('');
  const rules = rows.map((row) => line(pt(8.15, row.y), pt(row.x2, row.y))).join('');
  return { off: [fill(dots), stroke(rules, o.sw)], on: [fill(dotsOn), stroke(rules, o.swOn)] };
}

/** Three grooves and solid knobs. Hollow knobs closed up at 20 px. */
function grooves(o: Spec): Glyph {
  const rows = [
    { y: 6.2, cx: 15.4 },
    { y: 12, cx: 8.7 },
    { y: 17.8, cx: 13.5 },
  ];
  const knob = 2.55;
  const knobOn = 3.15;
  const off: Mark[] = [];
  const on: Mark[] = [];
  for (const row of rows) {
    const gap = (r: number) => r + o.sw * 0.42;
    const track = (r: number) =>
      line(pt(3.5, row.y), pt(row.cx - gap(r), row.y)) + line(pt(row.cx + gap(r), row.y), pt(20.5, row.y));
    off.push(stroke(track(knob), o.sw * 0.95), fill(circle(row.cx, row.y, knob)));
    on.push(stroke(track(knobOn), o.swOn), fill(circle(row.cx, row.y, knobOn)));
  }
  return { off, on };
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 1 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 1 ${n(-rx * 2)} 0`;
}

/**
 * The recording. A quaver: solid head, stem, one flag as thick as the stem.
 * A nay at this size read as a smudge. The head stays solid — a hollow head
 * at 20 px is a dirty ring.
 */
function note(o: Spec): Glyph {
  const cx = 8.55;
  const cy = 16.55;
  const rx = 4.25;
  const ry = 3.15;
  const spin = `rotate(-20 ${n(cx)} ${n(cy)})`;
  const head = (k: number): Mark => ({ d: ellipse(cx, cy, rx * k, ry * k), draw: 'fill', transform: spin });
  const stem = (w: number) => stroke(line(pt(12.15, 15.35), pt(12.15, 4.35)), w);
  const flag = (w: number) => stroke(`M12.15 4.55C16.35 5.15 17.15 8.35 13.85 9.85`, w);
  const w = o.sw * 0.95;
  return { off: [head(1), stem(w), flag(w)], on: [head(1.14), stem(o.swOn), flag(o.swOn)] };
}

/** A pennant with a deep swallowtail. No hatch: stripes read as a hazard mark. */
function pennant(o: Spec): Glyph {
  const cloth = [pt(7.35, 4.15), pt(18.15, 4.15), pt(12.35, 8.45), pt(18.15, 12.75), pt(7.35, 12.75)];
  const rad = [0.7, 0.55, 0.4, 0.55, 0.7];
  const shape = roundPoly(cloth, rad);
  const staff = (w: number) => stroke(line(pt(6.15, 3.45), pt(6.15, 20.55)), w);
  return {
    off: [staff(o.sw), stroke(shape, o.sw)],
    on: [staff(o.swOn), fill(shape), stroke(shape, o.sw)],
  };
}

/**
 * About the song. Ring, stem, naskh diamond.
 * This is the one icon the previous round already got right, so the
 * drawing stays: no hatch, no extra spur except a short foot from 24 up,
 * where the foot is wider than 2 px and reads as a serif.
 */
function about(o: Spec): Glyph {
  const r = 8.5;
  const ring = circle(12, 12, r);
  const stemW = o.sw * 0.9;
  const foot = o.id >= 24;
  const y0 = 10.55;
  const y1 = 15.85;
  const stemD = foot ? line(pt(12, y0), pt(12, y1)) + line(pt(10.35, y1), pt(13.65, y1)) : line(pt(12, y0), pt(12, y1 + 0.25));
  const dotR = o.id === 16 ? 1.3 : 1.45;
  const dot = diamond(12, 7.2, dotR);
  const disc = circle(12, 12, r - o.sw * 0.46);
  const cut =
    capsule(12, y0, 12, foot ? y1 : y1 + 0.25, stemW) +
    (foot ? capsule(10.35, y1, 13.65, y1, stemW) : '') +
    dot;
  return {
    off: [stroke(ring, o.sw), stroke(stemD, stemW), fill(dot)],
    on: [fill(disc + cut), stroke(ring, o.sw)],
  };
}

/** Volume. Cone and two arcs, one weight. The cone is empty — hatch there became sludge. */
function horn(o: Spec): Glyph {
  const body = [pt(3.55, 9.35), pt(6.85, 9.35), pt(11.7, 6.05), pt(11.7, 17.95), pt(6.85, 14.65), pt(3.55, 14.65)];
  const shape = roundPoly(body, 0.95);
  const near = `M14.35 8.75a4.15 4.15 0 0 1 0 6.5`;
  const far = `M17.15 6.35a7.05 7.05 0 0 1 0 11.3`;
  return {
    off: [stroke(shape, o.sw), stroke(near, o.sw), stroke(far, o.sw)],
    on: [fill(shape), stroke(shape, o.sw), stroke(near, o.swOn), stroke(far, o.swOn)],
  };
}

/** Bring your own file. Arrow and tray are the same weight. The tray is not striped. */
function bring(o: Spec): Glyph {
  const stem = line(pt(12, 3.25), pt(12, 11.15));
  const head = elbow(pt(8.05, 8.15), pt(12, 12.25), pt(15.95, 8.15), 0.85);
  const tray = `M5.15 11.7V18.15Q5.15 20.15 7.15 20.15H16.85Q18.85 20.15 18.85 18.15V11.7`;
  return keyline(stem + head + tray, o);
}

/**
 * Search. The lens is empty. The handle is the same monoline as the ring.
 * A mild wedge was tried: at 20 px it read as an uneven stroke, not a nib.
 */
function search(o: Spec): Glyph {
  const c = pt(10.2, 10.2);
  const r = 6.2;
  const ring = circle(c.x, c.y, r);
  const join = r + o.sw * 0.15;
  const handle = line(pt(c.x + join * 0.7071, c.y + join * 0.7071), pt(19.85, 19.85));
  return keyline(ring + handle, o);
}

/** Instruments. Four equal plates. Hatching two of them read as a broken code. */
function plates(o: Spec): Glyph {
  // The gap has to survive the stroke. At 20 px a 2.5 gap closes and the four squares fuse.
  const margin = 2.5;
  const gap = 4.4;
  const cell = (24 - gap - margin * 2) / 2;
  const x0 = margin;
  const origins = [
    [x0, x0],
    [x0 + cell + gap, x0],
    [x0, x0 + cell + gap],
    [x0 + cell + gap, x0 + cell + gap],
  ];
  const off: Mark[] = [];
  const on: Mark[] = [];
  for (const [x, y] of origins) {
    const shape = rrect(x!, y!, cell, cell, o.rad);
    off.push(stroke(shape, o.sw));
    on.push(fill(shape), stroke(shape, o.sw));
  }
  return { off, on };
}

/**
 * Methodology. An open book: two pages, a gutter, tops rising toward the spine.
 * Page-filling hatch at 20 px became a gray wedge, so the pages stay clear.
 */
function codex(o: Spec): Glyph {
  // Gutter wider than the stroke, or the two pages fuse into one plaque at 20 px.
  const left = [pt(2.95, 8.35), pt(9.7, 4.35), pt(9.7, 16.55), pt(2.95, 20.15)];
  const right = [pt(14.3, 4.35), pt(21.05, 8.35), pt(21.05, 20.15), pt(14.3, 16.55)];
  const rad = [1.35, 0.55, 0.55, 1.35];
  const a = roundPoly(left, rad);
  const b = roundPoly(right, rad);
  return {
    off: [stroke(a, o.sw), stroke(b, o.sw)],
    on: [fill(a), stroke(a, o.sw), fill(b), stroke(b, o.sw)],
  };
}

function draw(name: IconName, o: Spec): Glyph {
  switch (name) {
    case 'chevron.left':
      return chevron('left', o);
    case 'chevron.right':
      return chevron('right', o);
    case 'chevron.down':
      return chevron('down', o);
    case 'chevron.up':
      return chevron('up', o);
    case 'xmark':
      return closeMark(o);
    case 'play':
      return play(o);
    case 'pause':
      return pause(o);
    case 'backward':
      return skip('back', o);
    case 'forward':
      return skip('fwd', o);
    case 'character.bubble':
      return translation(o);
    case 'book.closed':
      return gloss(o);
    case 'list.bullet':
      return manuscript(o);
    case 'slider.horizontal.3':
      return grooves(o);
    case 'music.note':
      return note(o);
    case 'flag':
      return pennant(o);
    case 'info.circle':
      return about(o);
    case 'speaker.wave.2':
      return horn(o);
    case 'square.and.arrow.down':
      return bring(o);
    case 'magnifyingglass':
      return search(o);
    case 'square.grid.2x2':
      return plates(o);
    case 'book.pages':
      return codex(o);
    default: {
      const never: never = name;
      throw new Error(`no qalam glyph for ${never}`);
    }
  }
}

const cache = new Map<string, Glyph>();

export function opticalFor(px: number): Optical {
  if (px <= 18) return 16;
  if (px <= 22) return 20;
  if (px <= 28) return 24;
  return 32;
}

export function glyphAt(name: IconName, optical: Optical): Glyph {
  const key = `${name}:${optical}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const glyph = draw(name, SPECS[optical]);
  cache.set(key, glyph);
  return glyph;
}

function masterGlyphs(): Record<IconName, Glyph> {
  const glyphs = {} as Record<IconName, Glyph>;
  for (const name of ICON_NAMES) glyphs[name] = glyphAt(name, 24);
  return glyphs;
}

export const setQalam: IconSet = {
  id: 'qalam',
  vb: 24,
  sw: SPECS[24].sw,
  glyphs: masterGlyphs(),
};

/** Used by the proof and the boards. Every name, both states, four masters. */
export function eachGlyph(): { name: IconName; optical: Optical; glyph: Glyph }[] {
  const rows: { name: IconName; optical: Optical; glyph: Glyph }[] = [];
  for (const name of ICON_NAMES) {
    for (const optical of OPTICAL) rows.push({ name, optical, glyph: glyphAt(name, optical) });
  }
  return rows;
}
