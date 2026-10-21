/**
 * Qalam — the Living Lyrics icon family, round 10.
 *
 * Every stroke is the same reed pen (`pen.ts`): one 35° nib, thick across
 * the edge and thin along it. Straight stems stay polygons so the pixel snap
 * holds. Circles, arcs and rounded corners are real curves (`curve.ts`):
 * arcs, translated quadratics, or cubics within 0.015 of the parallel curve.
 * The nib itself is the terminal. The dot is a nuqta, never a circle.
 *
 * Optical masters are 16, 20, 24, 28 and 32 on one 24 grid.
 * Stems snap to the CSS pixel grid of the size being drawn.
 * 16 and 20 keep the silhouette and a quiet contrast.
 * 24 adds the bookmark. 28 is the play button's own master.
 * 32 opens the contrast and the rosette.
 *
 * A pressed framed tab (translation, gloss, methodology) paints an opaque
 * wash of the plate: the second tone, not a second black slab. The ring
 * stays on top and is one pixel heavier.
 */
import { ICON_NAMES, type Glyph, type IconName, type IconSet, type Mark } from '../../../src/ui/icons/types';
import {
  QATT_EDGE,
  beginGlyph,
  circle,
  endGlyph,
  framePlate,
  nibFor,
  nibOval,
  nibSlab,
  penDetail,
  pixelUnit,
  pt,
  qalamArc,
  qalamCircle,
  qalamOuter,
  qalamQuad,
  qalamRoundLoop,
  qalamStroke,
  roundPoly,
  roundPolyPoints,
  rrect,
  nuqta,
  type Nib,
  type Pt,
} from './pen';

export const OPTICAL = [16, 20, 24, 28, 32] as const;
export type Optical = (typeof OPTICAL)[number];

type Spec = {
  id: Optical;
  /**
   * Keyline aim, grid units, before `nibFor` holds the thin stroke at 1.6 px.
   * When that floor lifts the nib, the on-screen horizontal stroke is heavier
   * than `sw`. The measured pixels are in docs/design/t28-icons.md.
   */
  sw: number;
  /** Pressed keyline. Filled plates ignore it; inked plates use it for the ring. */
  swOn: number;
  /** Soft corner on plates. The nib cuts stay sharp. */
  rad: number;
};

const SPECS: Record<Optical, Spec> = {
  16: { id: 16, sw: 2.55, swOn: 3.35, rad: 1.55 },
  20: { id: 20, sw: 2.3, swOn: 3.05, rad: 1.45 },
  24: { id: 24, sw: 2.0, swOn: 2.7, rad: 1.35 },
  28: { id: 28, sw: 1.82, swOn: 2.45, rad: 1.28 },
  32: { id: 32, sw: 1.65, swOn: 2.25, rad: 1.2 },
};

function ink(d: string): Mark {
  return { d, draw: 'fill', rule: 'nonzero' };
}

function hole(d: string): Mark {
  return { d, draw: 'fill', rule: 'nonzero', knock: true };
}

/** Opaque second tone. The renderer mixes the ink with the page; this is not a transparency. */
function wash(d: string): Mark {
  return { d, draw: 'fill', rule: 'nonzero', tone: 'wash' };
}

function marks(...list: Mark[]): Mark[] {
  return list.filter((mark) => mark.d.length > 0);
}

function key(o: Spec, pressed = false): Nib {
  const base = nibFor(o.id, o.sw);
  if (!pressed) return base;
  // The idle stem snaps to a whole CSS pixel. Pressing adds one pixel,
  // still an outline: the old filled plate was a black slab.
  const u = 24 / o.id;
  const idleCss = o.id <= 24 ? 2 : 3;
  const h = (idleCss + 1) * u;
  const contrast = base.broad / base.hair;
  const hair = h / (contrast * QATT_EDGE.y + QATT_EDGE.x);
  return { broad: hair * contrast, hair };
}

/** Interior writing. A lower pixel floor, so the counter of an A can stay open. */
function writing(o: Spec, pressed = false): Nib {
  const sw = o.id <= 16 ? 1.9 : o.id === 20 ? 1.72 : o.id === 24 ? 1.5 : o.id === 28 ? 1.38 : 1.28;
  return nibFor(o.id, pressed ? sw * 1.22 : sw, 1.05);
}

/** Whole CSS pixels. 16–24 sit on a 2 px stem; 28 and 32 sit on 3. Pressed adds one. */
function frameWidth(o: Spec, pressed: boolean): number {
  const idle = o.id <= 24 ? 2 : 3;
  return (pressed ? idle + 1 : idle) * uOf(o);
}

/**
 * Framed tab. Idle is the ring and the writing. Pressed paints the plate in
 * the second tone, under a heavier ring. The wash is the centreline, so a
 * fit error of 0.02 cannot poke past the outer edge.
 */
function framed(pts: Pt[], radii: number | number[], o: Spec, cutOff: string, cutOn: string): Glyph {
  const off = framePlate(pts, radii, frameWidth(o, false), uOf(o));
  const on = framePlate(pts, radii, frameWidth(o, true), uOf(o));
  return {
    off: marks(ink(off.ring), ink(cutOff)),
    on: marks(wash(on.plate), ink(on.ring), ink(cutOn)),
  };
}

type TransportVariant = 'a' | 'b' | 'c';

/** CSS pixels of this master, as grid units. The site draws play at its own master. */
function uOf(o: Spec): number {
  return 24 / o.id;
}

/**
 * Play triangle in CSS pixels of the master.
 * Width is a multiple of 3, so the centroid and the vertical base
 * both land on the pixel grid (the centroid sits one third of the way
 * from the base to the tip). Height is even, so the top and bottom do too.
 */
function playBox(o: Spec, pressed: boolean): { h: number; w: number; r: number } {
  const box =
    o.id <= 16
      ? { h: 10, w: 9, r: 1 }
      : o.id <= 20
        ? { h: 12, w: 12, r: 1 }
        : o.id <= 24
          ? { h: 14, w: 15, r: 2 }
          : o.id <= 28
            ? { h: 16, w: 18, r: 2 }
            : { h: 18, w: 21, r: 2 };
  // Taller by two pixels. Width stays: the tip is already near the frame.
  return pressed ? { h: box.h + 2, w: box.w, r: box.r } : box;
}

function playPoints(o: Spec, pressed: boolean, cutCss: number): { pts: Pt[]; radii: number[] } {
  const box = playBox(o, pressed);
  const u = uOf(o);
  const h = box.h * u;
  const w = box.w * u;
  const r = box.r * u;
  const yTop = 12 - h / 2;
  const yBot = 12 + h / 2;
  const xBase = 12 - w / 3;
  const xTip = xBase + w;
  const tip = pt(xTip, 12);
  const top = pt(xBase, yTop);
  const bottom = pt(xBase, yBot);
  if (cutCss <= 0) return { pts: [top, tip, bottom], radii: [r, r, r] };
  const L = cutCss * u;
  const bx = xTip - xBase;
  const by = 12 - yBot;
  const t = (QATT_EDGE.x * L) / bx;
  const a = QATT_EDGE.y * L - t * by;
  const onLeft = pt(xBase, yBot - a);
  const onBase = pt(xBase + QATT_EDGE.x * L, yBot - a + QATT_EDGE.y * L);
  return { pts: [top, tip, onBase, onLeft], radii: [r, r, 0, 0] };
}

/** Area centroid of a sampled polygon. */
function centroidOf(pts: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-8) return pt(12, 12);
  return pt(cx / (6 * a), cy / (6 * a));
}

function centeredSolid(pts: Pt[], radii: number[]): string {
  const sampled = roundPolyPoints(pts, radii, 16);
  const c = centroidOf(sampled);
  // The geometric centroid is already on the button centre. Rounding moves
  // it by a fraction; shift the source polygon, then round it as curves.
  const dx = 12 - c.x;
  const dy = 12 - c.y;
  return roundPoly(
    pts.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    radii,
  );
}

/**
 * A — pure triangle, corners slightly rounded, no nib cut.
 * B — the same triangle with one 35° cut at the bottom of the base.
 * C — the same triangle as a quiet nib's outer silhouette.
 * The default on the site is A until the owner picks.
 */
function playShape(variant: TransportVariant, o: Spec, pressed: boolean): string {
  if (variant === 'c') {
    // Solid triangle whose corners are the nib, so the edges carry a little
    // broad-pen contrast. Hinting is off: a one-pixel snap would erase it.
    const box = playBox(o, pressed);
    const u = uOf(o);
    const inset = 3.2;
    const h = Math.max(6, box.h - inset) * u;
    const w = Math.max(6, box.w - inset) * u;
    const yTop = 12 - h / 2;
    const xBase = 12 - w / 3;
    const xTip = xBase + w;
    const sw = 2.6 * u;
    const contrast = 1.45;
    const sin = QATT_EDGE.y;
    const cos = QATT_EDGE.x;
    const hair = sw / (contrast * sin + cos);
    const nib: Nib = { broad: hair * contrast, hair };
    return qalamOuter([pt(xBase, yTop), pt(xTip, 12), pt(xBase, yTop + h)], nib, 0);
  }
  const cut = variant === 'b' ? (o.id <= 16 ? 2.4 : o.id <= 20 ? 3 : o.id <= 24 ? 3.6 : o.id <= 28 ? 4 : 4.2) : 0;
  const shape = playPoints(o, pressed, cut);
  return centeredSolid(shape.pts, shape.radii);
}

function pauseBox(o: Spec): { h: number; bar: number; gap: number; r: number } {
  if (o.id <= 16) return { h: 10, bar: 3, gap: 2, r: 1 };
  if (o.id <= 20) return { h: 12, bar: 4, gap: 2, r: 1 };
  if (o.id <= 24) return { h: 14, bar: 4, gap: 4, r: 2 };
  if (o.id <= 28) return { h: 16, bar: 4, gap: 4, r: 2 };
  return { h: 18, bar: 4, gap: 4, r: 2 };
}

/**
 * A — two rounded bars, no slant.
 * B — the same bars, each bottom edge the full 35° cut.
 * C — a slight 35° shear, every corner rounded so the slant cannot nick.
 */
function pauseShape(variant: TransportVariant, o: Spec, pressed: boolean): string {
  const box = pauseBox(o);
  const u = uOf(o);
  const hCss = box.h + (pressed ? 2 : 0);
  const bar = box.bar * u;
  const gap = box.gap * u;
  const radius = Math.min(box.r, box.bar / 2) * u;
  const H = hCss * u;
  const total = bar * 2 + gap;
  const x0 = 12 - total / 2;
  const shear = variant === 'c' ? 1.7 * u : 0;
  const drop = variant === 'b' ? bar * (QATT_EDGE.y / QATT_EDGE.x) : 0;
  const y0 = 12 - (H - drop / 2) / 2;
  let d = '';
  for (let i = 0; i < 2; i++) {
    const x = x0 + i * (bar + gap);
    if (variant === 'a') d += rrect(x, y0, bar, H, radius);
    else if (variant === 'b') {
      d += roundPoly(
        [pt(x, y0), pt(x + bar, y0), pt(x + bar, y0 + H), pt(x, y0 + H - drop)],
        [radius, radius, 0, 0],
      );
    } else {
      d += roundPoly(
        [pt(x, y0), pt(x + bar, y0), pt(x + bar + shear, y0 + H), pt(x + shear, y0 + H)],
        radius,
      );
    }
  }
  return d;
}

function transportGlyph(variant: TransportVariant, name: 'play' | 'pause', o: Spec): Glyph {
  const shape = name === 'play' ? playShape : pauseShape;
  return { off: [ink(shape(variant, o, false))], on: [ink(shape(variant, o, true))] };
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

/** Play. Option A until the owner picks. The notched base from round 8 is gone. */
function play(o: Spec): Glyph {
  return transportGlyph('a', 'play', o);
}

/** Pause matched to play A: two rounded bars, no parallelogram. */
function pause(o: Spec): Glyph {
  return transportGlyph('a', 'pause', o);
}

/** Previous / next line. The bar and the wedge are both solid, both cut. */
function skip(direction: 'back' | 'fwd', o: Spec): Glyph {
  const draw = (grow: number) => {
    const w = 2.7 * grow;
    const h = 13.2 * grow;
    const dy = w * (QATT_EDGE.y / QATT_EDGE.x);
    const top = (24 - (h + dy)) / 2;
    const barX = direction === 'back' ? 3.7 - (grow - 1) * 1.4 : 24 - 3.7 - w;
    // Long enough to read as one pen edge. A cut near one pixel looked like a nick.
    const cut = (o.id >= 32 ? 2.4 : o.id >= 24 ? 2.05 : 1.75) * grow;
    const tip = direction === 'back' ? pt(8.7, 12) : pt(15.3, 12);
    const base = direction === 'back' ? 18.55 : 5.45;
    const hy = (QATT_EDGE.y * cut) / 2;
    const hx = (QATT_EDGE.x * cut) / 2;
    const wedge =
      direction === 'back'
        ? [pt(tip.x + hx, tip.y - hy), pt(base, 5.35), pt(base, 18.65), pt(tip.x - hx, tip.y + hy)]
        : [pt(tip.x - hx, tip.y - hy), pt(tip.x + hx, tip.y + hy), pt(base, 18.65), pt(base, 5.35)];
    const radii = direction === 'back' ? [0, o.rad, o.rad, 0] : [0, 0, o.rad, o.rad];
    return nibSlab(barX, top, w, h) + roundPoly(wedge, radii);
  };
  return { off: [ink(draw(1))], on: [ink(draw(o.id <= 20 ? 1.07 : 1.05))] };
}

/**
 * Translation. A manuscript cartouche, not a speech bubble.
 * The Latin A is drawn with the pen. Its counter stays open at 20 px.
 * From 32 a second short stroke sits under it: the other language.
 */
function cartouche(x: number, y: number, w: number, h: number, cut: number, radius: number): { pts: Pt[]; radii: number[] } {
  const dx = QATT_EDGE.x * cut;
  const dy = QATT_EDGE.y * cut;
  const right = x + w;
  const bottom = y + h;
  return {
    pts: [pt(x, y), pt(right - dx, y), pt(right, y + dy), pt(right, bottom), pt(x + dx, bottom), pt(x, bottom - dy)],
    radii: [radius, 0, 0, radius, 0, 0],
  };
}

function translation(o: Spec): Glyph {
  const cut = o.id >= 32 ? 3.15 : o.id >= 24 ? 2.55 : 2.15;
  const frame = cartouche(3.15, 3.55, 17.7, 16.7, cut, o.rad);
  const letter = (pressed: boolean) => {
    const nib = writing(o, pressed);
    const apex = pt(12, 6.55);
    const left = pt(7.85, 15.15);
    const right = pt(16.15, 15.15);
    const yBar = 12.05;
    const t = (yBar - apex.y) / (left.y - apex.y);
    const barL = pt(apex.x + (left.x - apex.x) * t, yBar);
    const barR = pt(apex.x + (right.x - apex.x) * t, yBar);
    let d = qalamStroke([left, apex, right], nib) + qalamStroke([barL, barR], nib);
    if (penDetail(o.id) === 2) d += qalamStroke([pt(8.7, 17.15), pt(15.3, 17.15)], nib);
    return d;
  };
  return framed(frame.pts, frame.radii, o, letter(false), letter(true));
}

/**
 * A manuscript page with the nib taken off the top-right corner only.
 * Translation cuts two corners; this one cut is the dog-ear of a note.
 */
function folio(x: number, y: number, w: number, h: number, cut: number, radius: number): { pts: Pt[]; radii: number[] } {
  const dx = QATT_EDGE.x * cut;
  const dy = QATT_EDGE.y * cut;
  const right = x + w;
  const bottom = y + h;
  return {
    pts: [pt(x, y), pt(right - dx, y), pt(right, y + dy), pt(right, bottom), pt(x, bottom)],
    radii: [radius, 0, 0, radius, radius],
  };
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
  const lines = (pressed: boolean) => {
    const nib = writing(o, pressed);
    return rows.map(([x1, x2, y]) => qalamStroke([pt(x1!, y!), pt(x2!, y!)], nib)).join('');
  };
  return framed(frame.pts, frame.radii, o, lines(false), lines(true));
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
  const head = (k: number) => nibOval(cx, cy, along * k, across * k);
  const stemNib = (pressed: boolean) => nibFor(o.id, (pressed ? o.swOn : o.sw) * 0.86, 1.2);
  const stemX = 11.25;
  const stem = (nib: Nib) => qalamStroke([pt(stemX, 15.55), pt(stemX, 3.55)], nib);
  const flag = (nib: Nib) => qalamQuad(pt(stemX, 3.75), pt(18.85, 6.55), pt(14.85, 10.85), nib);
  return {
    off: marks(ink(head(1)), ink(stem(stemNib(false))), ink(flag(stemNib(false)))),
    on: marks(ink(head(1.08)), ink(stem(stemNib(true))), ink(flag(stemNib(true)))),
  };
}

/** A pennant with a deep swallowtail. The staff ends are the nib. */
function pennant(o: Spec): Glyph {
  const cloth = [pt(7.5, 3.7), pt(20.5, 3.7), pt(11.6, 9.3), pt(20.5, 14.9), pt(7.5, 14.9)];
  const radii = [0.45, 0.3, 0.2, 0.3, 0.45];
  const staff = (nib: Nib) => qalamStroke([pt(5.35, 2.7), pt(5.35, 21.2)], nib);
  const nib = key(o);
  const ring = qalamRoundLoop(cloth, radii, nib);
  return {
    off: marks(ink(staff(nib)), ink(ring)),
    on: marks(ink(staff(key(o, true))), ink(roundPoly(cloth, radii)), ink(ring)),
  };
}

/** About the song. A pen-drawn ring, a stem, a nuqta. No extra spur. */
function about(o: Spec): Glyph {
  const r = 8.35;
  const nib = key(o);
  const ring = qalamCircle(12, 12, r, nib);
  const stem = qalamStroke([pt(12, 10.35), pt(12, 16.15)], writing(o));
  const dot = nuqta(12, 6.95, o.id <= 16 ? 1.35 : 1.5);
  const cut = stem + dot;
  return {
    off: marks(ink(ring), ink(cut)),
    on: marks(ink(circle(12, 12, r)), ink(ring), hole(cut)),
  };
}

/**
 * Volume. The cone is a plate. The waves are arcs, a lighter pen than
 * the keyline: a full keyline on this radius turned into two bites at 20 px.
 * Ending each arc along the nib makes the terminal the short side, and at
 * 20 px those strokes read as slashes rather than sound. The arc stays a
 * wave. Its ends are still the nib.
 */
function horn(o: Spec): Glyph {
  const body = [pt(3.15, 9.4), pt(6.4, 9.4), pt(10.55, 6.2), pt(10.55, 17.8), pt(6.4, 14.6), pt(3.15, 14.6)];
  const arcNib = (pressed: boolean) => nibFor(o.id, (pressed ? o.swOn : o.sw) * 0.66, 1.08);
  const arcs = (nib: Nib) =>
    qalamArc(11.05, 12, 3.15, -0.78, 0.72, nib) + qalamArc(11.05, 12, 5.55, -0.92, 0.86, nib);
  const nib = key(o);
  const ring = qalamRoundLoop(body, 0.8, nib);
  return {
    off: marks(ink(ring), ink(arcs(arcNib(false)))),
    on: marks(ink(roundPoly(body, 0.8)), ink(ring), ink(arcs(arcNib(true)))),
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
  const ring = (nib: Nib) => qalamCircle(c.x, c.y, radius, nib);
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
  const ring = qalamCircle(12, 12, radius, key(o));
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
  const cut = petals + extra;
  return {
    off: marks(ink(ring), ink(cut)),
    on: marks(ink(circle(12, 12, radius)), ink(ring), hole(cut)),
  };
}

/**
 * Methodology. One open codex: pages rise into a shared gutter, the valley
 * is rounded so the fold is not a notch, and a spine sits inside the ring.
 * From 24, a nuqta bookmark on the right page. Pressing thickens the ink.
 * Pressing washes the whole inner contour in the second tone, one book,
 * and thickens the ring. It does not paint two black page slabs.
 */
function codex(o: Spec): Glyph {
  const cover = [
    pt(2.85, 8.35),
    pt(8.35, 4.7),
    pt(12, 7.7),
    pt(15.65, 4.7),
    pt(21.15, 8.35),
    pt(21.15, 19.35),
    pt(14.85, 16.85),
    pt(12, 18.05),
    pt(9.15, 16.85),
    pt(2.85, 19.35),
  ];
  const radii = [1.35, 0.7, 1.65, 0.7, 1.35, 1.35, 0.85, 1.7, 0.85, 1.35];
  const off = framePlate(cover, radii, frameWidth(o, false), uOf(o));
  const on = framePlate(cover, radii, frameWidth(o, true), uOf(o));
  // Shorter than the counter, and a lighter pen, so the nib caps stay
  // inside the ring instead of pinching the valley or the bottom fold.
  const spine = (nib: Nib) => qalamStroke([pt(12, 11.15), pt(12, 14.85)], nib);
  const mark = (scale: number) =>
    penDetail(o.id) > 0 ? nuqta(17.15, 11.15, (penDetail(o.id) === 2 ? 1.12 : 0.98) * scale) : '';
  return {
    off: marks(ink(off.ring), ink(spine(writing(o))), ink(mark(1))),
    on: marks(wash(on.plate), ink(on.ring), ink(spine(writing(o, true))), ink(mark(1.12))),
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
  if (px <= 26) return 24;
  if (px <= 30) return 28;
  return 32;
}

/**
 * `renderPx` is the CSS size the outline is snapped to.
 * It defaults to the optical master, which is also the size the screen asks for
 * at 16, 20, 24 and 28. A size between masters (the header at 22) snaps to itself
 * and keeps the nearer master's pen.
 */
/**
 * Play and pause options for the owner's board. Not cached as the site glyph.
 * A is what `glyphAt('play')` already returns.
 */
export function glyphTransport(
  variant: TransportVariant,
  name: 'play' | 'pause',
  optical: Optical,
  renderPx: number = optical,
): Glyph {
  beginGlyph(pixelUnit(renderPx));
  try {
    return transportGlyph(variant, name, SPECS[optical]);
  } finally {
    endGlyph();
  }
}

export function glyphAt(name: IconName, optical: Optical, renderPx: number = optical): Glyph {
  const keyName = `${name}:${optical}:${renderPx}`;
  const hit = cache.get(keyName);
  if (hit) return hit;
  beginGlyph(pixelUnit(renderPx));
  try {
    const glyph = draw(name, SPECS[optical]);
    cache.set(keyName, glyph);
    return glyph;
  } finally {
    endGlyph();
  }
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
