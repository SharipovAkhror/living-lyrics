/**
 * Qalam — the Living Lyrics icon family, round 8.
 *
 * Every stroke is the same reed pen (`pen.ts`): a 35° nib, thick across
 * the edge and thin along it, with the nib itself as the terminal.
 * The dot is a nuqta, never a circle. Plates keep that edge when they fill.
 *
 * Optical masters are 16, 20, 24 and 32 on one 24 grid.
 * 16 and 20 keep the silhouette and a quiet contrast.
 * 24 adds the bookmark. 32 opens the contrast and the rosette.
 * Rendered pixels = grid × (master / 24).
 */
import { ICON_NAMES, type Glyph, type IconName, type IconSet, type Mark } from '../../../src/ui/icons/types';
import {
  QATT_EDGE,
  arcPoints,
  closedPath,
  nibFor,
  nibOval,
  nibPlate,
  nibSlab,
  penDetail,
  pt,
  qalamLoop,
  qalamStroke,
  quadPoints,
  roundPoly,
  roundPolyPoints,
  nuqta,
  type Nib,
  type Pt,
} from './pen';

export const OPTICAL = [16, 20, 24, 32] as const;
export type Optical = (typeof OPTICAL)[number];

type Spec = {
  id: Optical;
  /**
   * Keyline aim, grid units, before `nibFor` holds the thin stroke at 1.6 px.
   * When that floor lifts the nib, the on-screen horizontal stroke is heavier
   * than `sw`. The measured pixels are in docs/design/t28-icons.md.
   */
  sw: number;
  /** Pressed keyline. Plates do not use this — they fill instead of growing. */
  swOn: number;
  /** Soft corner on plates. The nib cuts stay sharp. */
  rad: number;
};

const SPECS: Record<Optical, Spec> = {
  16: { id: 16, sw: 2.55, swOn: 3.35, rad: 1.55 },
  20: { id: 20, sw: 2.3, swOn: 3.05, rad: 1.45 },
  24: { id: 24, sw: 2.0, swOn: 2.7, rad: 1.35 },
  32: { id: 32, sw: 1.65, swOn: 2.25, rad: 1.2 },
};

function ink(d: string): Mark {
  return { d, draw: 'fill', rule: 'nonzero' };
}

function hole(d: string): Mark {
  return { d, draw: 'fill', rule: 'nonzero', knock: true };
}

function marks(...list: Mark[]): Mark[] {
  return list.filter((mark) => mark.d.length > 0);
}

function key(o: Spec, pressed = false): Nib {
  return nibFor(o.id, pressed ? o.swOn : o.sw);
}

/** Interior writing. A lower pixel floor, so the counter of an A can stay open. */
function writing(o: Spec): Nib {
  const sw = o.id <= 16 ? 1.9 : o.id === 20 ? 1.72 : o.id === 24 ? 1.5 : 1.28;
  return nibFor(o.id, sw, 1.05);
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

/** Idle is the nib ring. Pressed, the same ring fills and `cut` is knocked out. */
function plate(center: Pt[], nib: Nib, cut: string, cutOn = cut): Glyph {
  const ring = qalamLoop(center, nib);
  const body = closedPath(center);
  return {
    off: marks(ink(ring), ink(cut)),
    on: marks(ink(body), ink(ring), cutOn ? hole(cutOn) : ink('')),
  };
}

function chevron(direction: 'left' | 'right' | 'down' | 'up', o: Spec): Glyph {
  const map = {
    left: [pt(15.6, 5.7), pt(8.15, 12), pt(15.6, 18.3)],
    right: [pt(8.4, 5.7), pt(15.85, 12), pt(8.4, 18.3)],
    down: [pt(5.7, 8.4), pt(12, 15.85), pt(18.3, 8.4)],
    up: [pt(5.7, 15.6), pt(12, 8.15), pt(18.3, 15.6)],
  }[direction];
  return { off: [ink(qalamStroke(map, key(o)))], on: [ink(qalamStroke(map, key(o, true)))] };
}

/** One cross. The arm that runs with the nib is the thin one. */
function closeMark(o: Spec): Glyph {
  const a = 6.55;
  const b = 17.45;
  const draw = (nib: Nib) => qalamStroke([pt(a, a), pt(b, b)], nib) + qalamStroke([pt(b, a), pt(a, b)], nib);
  return { off: [ink(draw(key(o)))], on: [ink(draw(key(o, true)))] };
}

/**
 * Play. A solid triangle. Its top edge already lies within two degrees of
 * the nib, so a second cut on the apex reads as a clipped corner (round 6).
 * The nib shows on the base, where a 35° edge can actually land.
 * The apex uses the plate corner instead: a sharp geometric point was the
 * only corner in the family that was neither a nib cut nor a soft plate.
 * The body sits 0.42 to the right so the mass is on the centre of the field.
 * The cut is short at 16 and 20 and longer at 32, where it can be read.
 */
function play(o: Spec): Glyph {
  const cut = o.id >= 32 ? 4.6 : o.id >= 24 ? 3.3 : 2.3;
  const dx = QATT_EDGE.x * cut;
  const dy = QATT_EDGE.y * cut;
  const shift = 0.42;
  const shape = (grow: number) => {
    const pts = [pt(7.85 + shift, 4.5), pt(19.25 + shift, 12), pt(7.85 + shift + dx, 19.55), pt(7.85 + shift, 19.55 - dy)];
    return roundPoly(scaleAbout(pts, grow), [1.15, o.rad, 0.14, 0.14]);
  };
  const grow = o.id <= 20 ? 1.08 : 1.06;
  return { off: [ink(shape(1))], on: [ink(shape(grow))] };
}

/** Pause. Two solid bars. Both ends are the nib edge, on both bars. */
function pause(o: Spec): Glyph {
  const draw = (grow: number) => {
    const w = 4.05 * grow;
    const gap = 3.45 - (grow - 1) * 1.2;
    const h = 13.35 * grow;
    const dy = w * (QATT_EDGE.y / QATT_EDGE.x);
    const top = (24 - (h + dy)) / 2;
    const x0 = (24 - (w * 2 + gap)) / 2;
    return nibSlab(x0, top, w, h) + nibSlab(x0 + w + gap, top, w, h);
  };
  return { off: [ink(draw(1))], on: [ink(draw(o.id <= 20 ? 1.08 : 1.06))] };
}

/** Previous / next line. The bar and the wedge are both solid, both cut. */
function skip(direction: 'back' | 'fwd', o: Spec): Glyph {
  const draw = (grow: number) => {
    const w = 2.7 * grow;
    const h = 13.2 * grow;
    const dy = w * (QATT_EDGE.y / QATT_EDGE.x);
    const top = (24 - (h + dy)) / 2;
    const barX = direction === 'back' ? 3.7 - (grow - 1) * 1.4 : 24 - 3.7 - w;
    const cut = (o.id >= 32 ? 1.7 : 1.05) * grow;
    const tip = direction === 'back' ? pt(8.7, 12) : pt(15.3, 12);
    const base = direction === 'back' ? 18.55 : 5.45;
    const hy = (QATT_EDGE.y * cut) / 2;
    const hx = (QATT_EDGE.x * cut) / 2;
    const wedge =
      direction === 'back'
        ? [pt(tip.x + hx, tip.y - hy), pt(base, 5.35), pt(base, 18.65), pt(tip.x - hx, tip.y + hy)]
        : [pt(tip.x - hx, tip.y - hy), pt(tip.x + hx, tip.y + hy), pt(base, 18.65), pt(base, 5.35)];
    return nibSlab(barX, top, w, h) + roundPoly(wedge, 0.7);
  };
  return { off: [ink(draw(1))], on: [ink(draw(o.id <= 20 ? 1.07 : 1.05))] };
}

/**
 * Translation. A manuscript cartouche, not a speech bubble.
 * The Latin A is drawn with the pen. Its counter stays open at 20 px.
 * From 32 a second short stroke sits under it: the other language.
 */
function translation(o: Spec): Glyph {
  const cut = o.id >= 32 ? 3.15 : o.id >= 24 ? 2.55 : 2.15;
  const frame = nibPlate(3.15, 3.55, 17.7, 16.7, cut, o.rad);
  const nib = writing(o);
  const apex = pt(12, 6.55);
  const left = pt(7.85, 15.15);
  const right = pt(16.15, 15.15);
  const yBar = 12.05;
  const t = (yBar - apex.y) / (left.y - apex.y);
  const barL = pt(apex.x + (left.x - apex.x) * t, yBar);
  const barR = pt(apex.x + (right.x - apex.x) * t, yBar);
  let letter = qalamStroke([left, apex, right], nib) + qalamStroke([barL, barR], nib);
  if (penDetail(o.id) === 2) letter += qalamStroke([pt(8.7, 17.15), pt(15.3, 17.15)], nib);
  return plate(frame, key(o), letter);
}

/**
 * A manuscript page with the nib taken off the top-right corner only.
 * Translation cuts two corners; this one cut is the dog-ear of a note.
 */
function folio(x: number, y: number, w: number, h: number, cut: number, radius: number): Pt[] {
  const dx = QATT_EDGE.x * cut;
  const dy = QATT_EDGE.y * cut;
  const right = x + w;
  const bottom = y + h;
  return roundPolyPoints(
    [
      { x, y },
      { x: right - dx, y },
      { x: right, y: y + dy },
      { x: right, y: bottom },
      { x, y: bottom },
    ],
    [radius, 0.14, 0.14, radius, radius],
    3,
  );
}

/**
 * Explanation. A folio, not a speech tag. The fore-edge flap read as a beak.
 * Two rules at 16, 20 and 24: three rules closed up at the tab size.
 * A third rule appears at 32, where the counter can hold it.
 * There is no spine: a spine beside the rules read as the letter E.
 */
function gloss(o: Spec): Glyph {
  const cut = o.id >= 32 ? 3.35 : o.id >= 24 ? 2.8 : 2.3;
  const frame = folio(3.45, 3.1, 17.1, 17.65, cut, o.rad);
  const nib = writing(o);
  const rows =
    penDetail(o.id) < 2
      ? [
          [6.75, 17.05, 10.45],
          [6.75, 14.55, 15.05],
        ]
      : [
          [6.75, 17.05, 8.9],
          [6.75, 15.05, 12.4],
          [6.75, 16.25, 15.9],
        ];
  const lines = rows.map(([x1, x2, y]) => qalamStroke([pt(x1!, y!), pt(x2!, y!)], nib)).join('');
  return plate(frame, key(o), lines);
}

/** All the words. Three rules, three nuqtas. The star of the previous round. */
function manuscript(o: Spec): Glyph {
  const rows = [
    { y: 6.4, x2: 19.5 },
    { y: 12, x2: 16.7 },
    { y: 17.6, x2: 18.4 },
  ];
  const r = o.id >= 32 ? 1.85 : 1.7;
  const dots = rows.map((row) => nuqta(4.7, row.y, r)).join('');
  const dotsOn = rows.map((row) => nuqta(4.7, row.y, r * 1.14)).join('');
  const rules = (nib: Nib) => rows.map((row) => qalamStroke([pt(8.15, row.y), pt(row.x2, row.y)], nib)).join('');
  return { off: marks(ink(dots), ink(rules(key(o)))), on: marks(ink(dotsOn), ink(rules(key(o, true)))) };
}

/**
 * Settings. Two tracks, not three: three rails and three knobs collided at 20 px.
 * The rails are a lighter pen than the keyline, so the nuqta reads as a thumb
 * and not as a bead the same weight as the bar. Each thumb sits in from the
 * end, with track on both sides, and the two rows are not a mirror pair —
 * a mirrored pair read as a heraldic rule. The icon name stays
 * `slider.horizontal.3`.
 */
function grooves(o: Spec): Glyph {
  const rows = [
    { y: 7.4, cx: 16.55 },
    { y: 16.6, cx: 7.45 },
  ];
  const x1 = 2.05;
  const x2 = 21.95;
  const rail = (pressed: boolean) => nibFor(o.id, (pressed ? o.swOn : o.sw) * 0.58, 1.02);
  const draw = (nib: Nib, r: number) => {
    let d = '';
    for (const row of rows) {
      d += qalamStroke([pt(x1, row.y), pt(x2, row.y)], nib);
      d += nuqta(row.cx, row.y, r);
    }
    return d;
  };
  const r = o.id <= 16 ? 2.45 : o.id <= 20 ? 2.7 : 2.55;
  return { off: [ink(draw(rail(false), r))], on: [ink(draw(rail(true), r * 1.05))] };
}

/**
 * The recording. A quaver: solid nib-oval head, stem, one flag.
 * The flag is a lighter stroke than the keyline. At 20 px a full keyline
 * closed into a bowl and the sign read as a P.
 */
function note(o: Spec): Glyph {
  const cx = 7.85;
  const cy = 17.15;
  const along = o.id <= 16 ? 3.25 : 3.75;
  const across = o.id <= 16 ? 2.35 : 2.6;
  const head = (k: number) => nibOval(cx, cy, along * k, across * k, o.id <= 16 ? 14 : 26);
  const stemNib = (pressed: boolean) => nibFor(o.id, (pressed ? o.swOn : o.sw) * 0.86, 1.2);
  const stemX = 11.25;
  const stem = (nib: Nib) => qalamStroke([pt(stemX, 15.55), pt(stemX, 3.55)], nib);
  const flag = (nib: Nib) =>
    qalamStroke(quadPoints(pt(stemX, 3.75), pt(18.85, 6.55), pt(14.85, 10.85), o.id <= 16 ? 6 : 10), nib);
  return {
    off: marks(ink(head(1)), ink(stem(stemNib(false))), ink(flag(stemNib(false)))),
    on: marks(ink(head(1.08)), ink(stem(stemNib(true))), ink(flag(stemNib(true)))),
  };
}

/** A pennant with a deep swallowtail. The staff ends are the nib. */
function pennant(o: Spec): Glyph {
  const cloth = roundPolyPoints(
    [pt(7.5, 3.7), pt(20.5, 3.7), pt(11.6, 9.3), pt(20.5, 14.9), pt(7.5, 14.9)],
    [0.45, 0.3, 0.2, 0.3, 0.45],
    2,
  );
  const staff = (nib: Nib) => qalamStroke([pt(5.35, 2.7), pt(5.35, 21.2)], nib);
  const nib = key(o);
  const ring = qalamLoop(cloth, nib);
  return {
    off: marks(ink(staff(nib)), ink(ring)),
    on: marks(ink(staff(key(o, true))), ink(closedPath(cloth)), ink(ring)),
  };
}

/** About the song. A pen-drawn ring, a stem, a nuqta. No extra spur. */
function about(o: Spec): Glyph {
  const r = 8.35;
  const ringPts = arcPoints(12, 12, r, 0, Math.PI * 2, o.id >= 32 ? 40 : 28).slice(0, -1);
  const nib = key(o);
  const stem = qalamStroke([pt(12, 10.35), pt(12, 16.15)], writing(o));
  const dot = nuqta(12, 6.95, o.id <= 16 ? 1.35 : 1.5);
  return plate(ringPts, nib, stem + dot);
}

/**
 * Volume. The cone is a plate. The waves are arcs, a lighter pen than
 * the keyline: a full keyline on this radius turned into two bites at 20 px.
 * Ending each arc along the nib makes the terminal the short side, and at
 * 20 px those strokes read as slashes rather than sound. The arc stays a
 * wave. Its ends are still the nib.
 */
function horn(o: Spec): Glyph {
  const body = roundPolyPoints(
    [pt(3.15, 9.4), pt(6.4, 9.4), pt(10.55, 6.2), pt(10.55, 17.8), pt(6.4, 14.6), pt(3.15, 14.6)],
    0.8,
    2,
  );
  const arcNib = (pressed: boolean) => nibFor(o.id, (pressed ? o.swOn : o.sw) * 0.66, 1.08);
  const arcs = (nib: Nib) =>
    qalamStroke(arcPoints(11.05, 12, 3.15, -0.78, 0.72, 14), nib) +
    qalamStroke(arcPoints(11.05, 12, 5.55, -0.92, 0.86, 16), nib);
  const nib = key(o);
  return {
    off: marks(ink(qalamLoop(body, nib)), ink(arcs(arcNib(false)))),
    on: marks(ink(closedPath(body)), ink(qalamLoop(body, nib)), ink(arcs(arcNib(true)))),
  };
}

/** Bring your own file. Arrow and tray are the same pen. */
function bring(o: Spec): Glyph {
  const draw = (nib: Nib) =>
    qalamStroke([pt(12, 3.45), pt(12, 10.2)], nib) +
    qalamStroke([pt(7.7, 7.55), pt(12, 11.85), pt(16.3, 7.55)], nib) +
    qalamStroke([pt(4.7, 11.35), pt(4.7, 18.15), pt(19.3, 18.15), pt(19.3, 11.35)], nib);
  return { off: [ink(draw(key(o)))], on: [ink(draw(key(o, true)))] };
}

/** Search. An empty lens. The handle runs near the nib, so it is the thin stroke. */
function search(o: Spec): Glyph {
  const c = pt(10.05, 10.05);
  const radius = 6.25;
  const ring = (nib: Nib) => qalamLoop(arcPoints(c.x, c.y, radius, 0, Math.PI * 2, 32).slice(0, -1), nib);
  const handle = (nib: Nib) => {
    const join = radius + 1.55;
    return qalamStroke([pt(c.x + join * 0.7071, c.y + join * 0.7071), pt(20.15, 20.15)], nib);
  };
  return {
    off: marks(ink(ring(key(o))), ink(handle(key(o)))),
    on: marks(ink(ring(key(o, true))), ink(handle(key(o, true)))),
  };
}

/**
 * Instruments. A circular soundhole in both states. The outer frame does
 * not become a diamond when the disc fills.
 * Four nuqta petals sit in a cross, with open counters between them.
 * A continuous plus read as the add control, so the petals stay separate.
 * They are small enough that the active holes cannot join into one diamond.
 * At 32, four smaller diagonal nuqtas join the rosette. The name stays
 * `square.grid.2x2`.
 */
function rosette(o: Spec): Glyph {
  const radius = 8.05;
  const ringPts = arcPoints(12, 12, radius, 0, Math.PI * 2, o.id >= 32 ? 40 : 28).slice(0, -1);
  const reach = o.id <= 16 ? 3.85 : o.id <= 20 ? 4.15 : o.id <= 24 ? 4.35 : 4.5;
  const petal = o.id <= 16 ? 1.28 : o.id <= 20 ? 1.38 : o.id <= 24 ? 1.48 : 1.55;
  const cardinal = [
    [12, 12 - reach],
    [12 + reach, 12],
    [12, 12 + reach],
    [12 - reach, 12],
  ];
  const petals = cardinal.map(([x, y]) => nuqta(x!, y!, petal)).join('');
  const extra =
    penDetail(o.id) === 2
      ? [
          [12 + 3.05, 12 - 3.05],
          [12 + 3.05, 12 + 3.05],
          [12 - 3.05, 12 + 3.05],
          [12 - 3.05, 12 - 3.05],
        ]
          .map(([x, y]) => nuqta(x!, y!, 0.72))
          .join('')
      : '';
  return plate(ringPts, key(o), petals + extra);
}

/**
 * Methodology. An open book. From 24, a nuqta bookmark on the right page.
 * Pressing fills the leaves. The bookmark is not punched out: a hole that
 * exists only in the active state read as a keyhole.
 */
function codex(o: Spec): Glyph {
  const left = roundPolyPoints([pt(2.85, 8.15), pt(8.85, 4.25), pt(8.85, 16.7), pt(2.85, 20.25)], [1.2, 0.45, 0.45, 1.2], 2);
  const right = roundPolyPoints([pt(15.15, 4.25), pt(21.15, 8.15), pt(21.15, 20.25), pt(15.15, 16.7)], [0.45, 1.2, 1.2, 0.45], 2);
  const nib = key(o);
  const mark = penDetail(o.id) > 0 ? nuqta(18.15, 11.35, penDetail(o.id) === 2 ? 1.15 : 1.0) : '';
  return {
    off: marks(ink(qalamLoop(left, nib)), ink(qalamLoop(right, nib)), ink(mark)),
    on: marks(ink(closedPath(left)), ink(qalamLoop(left, nib)), ink(closedPath(right)), ink(qalamLoop(right, nib))),
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
      return rosette(o);
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
  const keyName = `${name}:${optical}`;
  const hit = cache.get(keyName);
  if (hit) return hit;
  const glyph = draw(name, SPECS[optical]);
  cache.set(keyName, glyph);
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
