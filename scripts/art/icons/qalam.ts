/**
 * Qalam — the Living Lyrics icon family.
 *
 * Built from the instrument engravings (scripts/art/lib.mjs): one round
 * monoline, field hatch at 35°, the nay's shade along the reed
 * (90° in the reed's own frame). Light from the upper left.
 * The second tone is that hatch, not a flat translucent fill.
 * A pressed surface keeps the same outer path and inverts: ink lines
 * become paper grooves cut out of the plate.
 *
 * Optical masters are 16, 20, 24 and 32 on a shared 24 grid. Stroke widths
 * below are in grid units, chosen so the rendered stroke stays at least
 * about 1.15 px (see docs/design/t28-icons.md).
 */
import { ICON_NAMES, type Glyph, type IconName, type IconSet, type Mark } from '../../../src/ui/icons/types';
import {
  capsule,
  circle,
  diamond,
  elbow,
  hatch,
  insetPoly,
  joinCapsules,
  joinLines,
  line,
  pt,
  rrect,
  rrectPoly,
  roundPoly,
  roundPolyPoints,
  tick,
  type Pt,
} from './pen';

export const OPTICAL = [16, 20, 24, 32] as const;
export type Optical = (typeof OPTICAL)[number];

type Spec = {
  id: Optical;
  /** Contour, grid units. */
  sw: number;
  /** Hatch stroke and the matching groove. */
  hw: number;
  /** Hatch spacing, centre to centre. */
  gap: number;
  /** Serifs, the play groove, the codex stitches. */
  detail: boolean;
  rad: number;
};

/**
 * Rendered pixels = grid units × (master / 24).
 * Contour targets ≈ 1.65 / 1.72 / 1.78 / 1.90 px.
 * Hatch targets ≈ 1.20 px, with a clear gap of about 1.05 px.
 */
const SPECS: Record<Optical, Spec> = {
  16: { id: 16, sw: 2.48, hw: 1.8, gap: 3.38, detail: false, rad: 1.55 },
  20: { id: 20, sw: 2.06, hw: 1.5, gap: 2.76, detail: false, rad: 1.45 },
  24: { id: 24, sw: 1.78, hw: 1.2, gap: 2.3, detail: true, rad: 1.35 },
  32: { id: 32, sw: 1.43, hw: 0.9, gap: 1.69, detail: true, rad: 1.2 },
};

/** Field hatch. `shade()` in the engraving library defaults to 35°. */
const FIELD = 35;

function stroke(d: string, sw: number): Mark {
  return { d, draw: 'stroke', sw };
}

function fill(d: string): Mark {
  return { d, draw: 'fill', rule: 'evenodd' };
}

/** Same outer edge in both states: the stroke is centred on the path. */
function plate(shape: string, poly: Pt[], o: Spec, angle = FIELD): { off: Mark[]; on: Mark[] } {
  const inner = insetPoly(poly, o.sw * 0.45 + o.hw * 0.35);
  const lines = hatch(inner, angle, o.gap);
  const ink = joinLines(lines);
  const cuts = joinCapsules(lines, o.hw * 0.92);
  const off: Mark[] = [];
  if (ink) off.push(stroke(ink, o.hw));
  off.push(stroke(shape, o.sw));
  const on: Mark[] = [fill(cuts ? shape + cuts : shape), stroke(shape, o.sw)];
  return { off, on };
}

function rule(x1: number, y1: number, x2: number, y2: number, w: number): { ink: Mark; cut: string } {
  return { ink: stroke(line(pt(x1, y1), pt(x2, y2)), w), cut: capsule(x1, y1, x2, y2, w) };
}

/**
 * Bare stroke. At 16 and 20 the active state is a heavier stroke:
 * a tick shorter than the stroke cannot escape the round cap.
 * From 24 up, medallion ticks sit past the cap.
 */
function bare(d: string, o: Spec, ends: { at: Pt; dir: Pt }[]): Glyph {
  const onW = o.id <= 20 ? o.sw * 1.62 : o.sw * 1.22;
  const on: Mark[] = [stroke(d, onW)];
  if (o.detail) {
    const ticks = ends.map((end) => tick(end.at, end.dir, 2.35)).join('');
    on.push(stroke(ticks, Math.max(o.hw, 1.15)));
  }
  return { off: [stroke(d, o.sw * 1.06)], on };
}

function chevron(dir: 'left' | 'right' | 'down' | 'up', o: Spec): Glyph {
  const elbowR = o.id === 16 ? 2.05 : 2.35;
  const map = {
    left: { a: pt(15.7, 6.15), tip: pt(8.15, 12), b: pt(15.7, 17.85) },
    right: { a: pt(8.3, 6.15), tip: pt(15.85, 12), b: pt(8.3, 17.85) },
    down: { a: pt(6.15, 8.3), tip: pt(12, 15.85), b: pt(17.85, 8.3) },
    up: { a: pt(6.15, 15.7), tip: pt(12, 8.15), b: pt(17.85, 15.7) },
  }[dir];
  return bare(elbow(map.a, map.tip, map.b, elbowR), o, [
    { at: map.a, dir: { x: map.a.x - map.tip.x, y: map.a.y - map.tip.y } },
    { at: map.b, dir: { x: map.b.x - map.tip.x, y: map.b.y - map.tip.y } },
  ]);
}

/** One cross. A monoline join stays readable; end ticks would read as a star. */
function closeMark(o: Spec): Glyph {
  const a = 7.35;
  const b = 16.65;
  const d = `M${a} ${a}L${b} ${b}M${b} ${a}L${a} ${b}`;
  const onW = o.id <= 20 ? o.sw * 1.62 : o.sw * 1.32;
  return { off: [stroke(d, o.sw * 1.08)], on: [stroke(d, onW)] };
}

function play(o: Spec): Glyph {
  // Centre of mass sits on the optical centre, not the bounding-box centre.
  const back = 6.55;
  const tip = 20.55;
  const top = 4.05;
  const bot = 19.95;
  const pts = [pt(back, top), pt(tip, 12), pt(back, bot)];
  const rad = [o.rad + 0.35, o.rad * 0.72, o.rad + 0.35];
  const shape = roundPoly(pts, rad);
  const poly = roundPolyPoints(pts, rad);
  if (o.id === 16) {
    return { off: [fill(shape)], on: [fill(shape)] };
  }
  const inner = insetPoly(poly, o.sw * 0.55);
  const groove = hatch(inner, FIELD, 6.4)[0];
  const cut = groove ? capsule(groove[0].x, groove[0].y, groove[1].x, groove[1].y, Math.max(o.hw * 1.55, 2.05)) : '';
  const solid = fill(shape);
  const cutMark = fill(shape + cut);
  return { off: [cut ? cutMark : solid], on: [solid] };
}

function pause(o: Spec): Glyph {
  const w = 4.55;
  const h = 15.7;
  const y = 4.15;
  const left = 5.55;
  const right = 13.9;
  const shape = rrect(left, y, w, h, o.rad + 0.45) + rrect(right, y, w, h, o.rad + 0.45);
  // 16 is solid: a groove there is under a pixel. From 20 up the groove is the idle state.
  if (o.id === 16) return { off: [fill(shape)], on: [fill(shape)] };
  const groove = (x: number) => capsule(x, y + 2.35, x, y + h - 2.35, Math.max(o.hw, o.detail ? 1.05 : 1.45));
  const cut = groove(left + w / 2) + groove(right + w / 2);
  return { off: [fill(shape + cut)], on: [fill(shape)] };
}

function skip(dir: 'back' | 'fwd', o: Spec): Glyph {
  const barW = 2.35;
  const bar = dir === 'back' ? rrect(3.45, 5.15, barW, 13.7, 1.15) : rrect(18.2, 5.15, barW, 13.7, 1.15);
  const tri =
    dir === 'back'
      ? [pt(8.15, 12), pt(17.15, 5.35), pt(17.15, 18.65)]
      : [pt(15.85, 12), pt(6.85, 5.35), pt(6.85, 18.65)];
  const rad = o.rad;
  const shape = roundPoly(tri, rad);
  const poly = roundPolyPoints(tri, rad);
  const body = plate(shape, poly, o);
  const barMark = fill(bar);
  return { off: [...body.off, barMark], on: [...body.on, barMark] };
}

/**
 * Translation: two scripts, side by side.
 * Left is a naskh beh — one pen stroke and a diamond below it.
 * Right is a Latin A. The acute appears from 24 up.
 * Three teeth of a seen collapsed into a crown at 20 px, so they are gone.
 */
function scripts(o: Spec): Glyph {
  // Long and thin: a pen stroke, not an oval. The nib is the right-hand swell.
  const beh = `M1.85 10.55C3.4 9.35 7.1 9.15 10.15 9.55C11.15 9.7 11.4 10.85 10.45 11.25C8.15 11.55 4.3 11.5 2.15 11.35C1.35 11.3 1.25 10.85 1.85 10.55Z`;
  const behPoly: Pt[] = [
    pt(1.85, 10.55),
    pt(5.2, 9.3),
    pt(9.4, 9.45),
    pt(11.2, 10.2),
    pt(10.45, 11.25),
    pt(6.2, 11.5),
    pt(2.4, 11.35),
  ];
  const body = plate(beh, behPoly, o);
  const dot = fill(diamond(6.35, 16.45, o.id === 16 ? 1.35 : 1.5));
  const letter = `M17.9 6.05L14.15 18.2M17.9 6.05L21.65 18.2M15.35 13.5H20.45`;
  const latinW = o.id === 16 ? 1.72 : o.id === 20 ? 1.58 : o.sw * 0.8;
  const latin = stroke(letter, latinW);
  const latinOn = stroke(letter, Math.min(latinW + 0.34, o.sw));
  const off: Mark[] = [...body.off, dot, latin];
  const on: Mark[] = [...body.on, dot, latinOn];
  if (o.detail) {
    const acute = stroke(line(pt(16.4, 3.85), pt(19.55, 2.2)), Math.max(o.sw * 0.68, 1.15));
    off.push(acute);
    on.push(acute);
  }
  return { off, on };
}

/**
 * A page and a gloss in the margin. The note is three ragged lines.
 * No rule joins them: at 20 px a bracket fused with the page and read as a plug.
 * Pressed, the page is a plate and its writing is left as paper.
 */
function gloss(o: Spec): Glyph {
  const shape = rrect(1.85, 2.5, 10.7, 19.0, o.rad);
  const wLine = o.id <= 20 ? Math.min(o.hw, o.sw * 0.72) : o.hw;
  const top = rule(3.5, 7.9, 10.65, 7.9, wLine);
  const bot = rule(3.5, 12.15, 8.7, 12.15, wLine);
  const nw = o.sw * 0.9;
  const note = (x2: number, y: number, w: number) => stroke(line(pt(16.85, y), pt(x2, y)), w);
  return {
    off: [top.ink, bot.ink, stroke(shape, o.sw), note(21.9, 7.65, nw), note(21.15, 11.15, nw), note(19.9, 14.65, nw)],
    on: [
      fill(shape + top.cut + bot.cut),
      stroke(shape, o.sw),
      note(21.9, 7.65, o.sw),
      note(21.15, 11.15, o.sw),
      note(19.9, 14.65, o.sw),
    ],
  };
}

/** A manuscript page: a margin rule and a ragged stanza. Not a bullet list. */
function manuscript(o: Spec): Glyph {
  const x = 3.15;
  const y = 2.7;
  const w = 17.7;
  const h = 18.55;
  const shape = rrect(x, y, w, h, o.rad);
  const lw = o.id === 16 ? o.sw * 0.78 : Math.max(o.hw, 1.15);
  const lines = [
    rule(7.55, 6.35, 18.55, 6.35, o.sw * 0.95),
    rule(7.55, 10.05, 16.15, 10.05, lw),
    rule(7.55, 13.7, 17.65, 13.7, lw),
    rule(7.55, 17.3, 13.4, 17.3, lw),
  ];
  const margin = rule(6.15, 5.15, 6.15, 18.85, o.sw * 0.95);
  const cuts = lines.map((item) => item.cut).join('') + margin.cut;
  return {
    off: [...lines.map((item) => item.ink), margin.ink, stroke(shape, o.sw)],
    on: [fill(shape + cuts), stroke(shape, o.sw)],
  };
}

/** Three engraved grooves. The knob is a ring, the rosette reduced to a dot. */
function grooves(o: Spec): Glyph {
  const rows = [
    { y: 6.15, cx: 15.35 },
    { y: 12, cx: 8.85 },
    { y: 17.85, cx: 13.15 },
  ];
  const knobR = o.id === 16 ? 1.85 : 2.15;
  const trackW = o.id === 16 ? o.sw * 0.72 : o.hw;
  const off: Mark[] = [];
  const on: Mark[] = [];
  for (const row of rows) {
    const hole = knobR + o.sw * 0.55;
    const left = line(pt(3.45, row.y), pt(row.cx - hole, row.y));
    const right = line(pt(row.cx + hole, row.y), pt(20.55, row.y));
    off.push(stroke(left + right, trackW));
    on.push(stroke(left + right, o.sw));
    const ring = circle(row.cx, row.y, knobR);
    if (o.id < 24) {
      off.push(fill(circle(row.cx, row.y, knobR * 0.72)));
      on.push(fill(circle(row.cx, row.y, knobR * 0.95)));
    } else {
      off.push(stroke(ring, o.sw), fill(circle(row.cx, row.y, o.id === 32 ? 0.7 : 0.78)));
      on.push(fill(circle(row.cx, row.y, knobR)));
    }
  }
  return { off, on };
}

/** Screen-space rotation. Negative degrees swing the top of a vertical reed to the left. */
function spin(p: Pt, deg: number, c: Pt): Pt {
  const a = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const co = Math.cos(a);
  const si = Math.sin(a);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}

/**
 * The nay, leaned the way it is held. The mouth is a notch in the lip,
 * not a slot cut into the body (a slot read as a plug). Breath does not touch the reed.
 */
function nay(o: Spec): Glyph {
  const c = pt(13.6, 12.2);
  const tube = o.id === 16 ? 4.7 : 5.05;
  const flare = tube + 3.35;
  const top = 3.4;
  const neck = 7.7;
  const bot = 20.15;
  const lean = -32;
  // Open lip: a wide flat mouth. A notch in the lip read as a pen slit.
  const raw = [
    pt(c.x - flare / 2, top),
    pt(c.x + flare / 2, top),
    pt(c.x + tube / 2, neck),
    pt(c.x + tube / 2, bot - 0.7),
    pt(c.x, bot + 0.15),
    pt(c.x - tube / 2, bot - 0.7),
    pt(c.x - tube / 2, neck),
  ];
  const pts = raw.map((p) => spin(p, lean, c));
  const rad = [0.4, 0.4, 0.5, 0.45, 0.55, 0.45, 0.5];
  const shape = roundPoly(pts, rad);
  const poly = roundPolyPoints(pts, rad);
  const holeR = o.id === 16 ? 0.78 : 1.02;
  const holeYs = o.id === 16 ? [15.3] : [12.4, 16.25];
  const dots = holeYs
    .map((y) => {
      const h = spin(pt(c.x - 0.12, y), lean, c);
      return circle(h.x, h.y, holeR);
    })
    .join('');
  const breathD = `M3.55 2.85Q1.55 4.05 3.05 5.45M3.15 6.2Q1.25 7.35 2.7 8.75`;
  const breath = stroke(breathD, o.sw * 0.8);
  const breathOn = stroke(breathD, Math.min(o.sw * 0.95, o.sw));
  const mouth = spin(pt(c.x, top), lean, c);
  const foot = spin(pt(c.x, bot), lean, c);
  const axis = (Math.atan2(foot.y - mouth.y, foot.x - mouth.x) * 180) / Math.PI;
  const inner = insetPoly(poly, o.sw * 0.48);
  const lines = o.id === 16 ? [] : hatch(inner, axis, Math.max(tube * 0.85, o.gap));
  let shade = lines[0];
  for (const seg of lines) {
    const score = (s: [Pt, Pt]) => (s[0].x + s[1].x + s[0].y + s[1].y) / 2;
    if (shade && score(seg) > score(shade)) shade = seg;
  }
  const ink = shade ? joinLines([shade]) : '';
  const cut = shade ? joinCapsules([shade], Math.min(o.hw, 1.2)) : '';
  const off: Mark[] = [];
  if (ink) off.push(stroke(ink, Math.min(o.hw, 1.15)));
  off.push(stroke(shape, o.sw), fill(dots), breath);
  const on: Mark[] = [fill(shape + dots + cut), stroke(shape, o.sw), breathOn];
  return { off, on };
}

/** A proof pennant: short staff, swallowtail, hatch on the cloth. */
function pennant(o: Spec): Glyph {
  const cloth: Pt[] = [pt(6.15, 4.15), pt(17.7, 4.15), pt(12.15, 8.2), pt(17.7, 12.25), pt(6.15, 12.25)];
  const shape = roundPoly(cloth, [0.65, 0.5, 0.4, 0.5, 0.65]);
  const poly = roundPolyPoints(cloth, [0.65, 0.5, 0.4, 0.5, 0.65]);
  const body = plate(shape, poly, o);
  const staff = stroke(line(pt(6.35, 3.35), pt(6.35, 20.45)), o.sw * 1.05);
  return { off: [staff, ...body.off], on: [staff, ...body.on] };
}

/** Medallion ring and a serif i. The dot is a naskh diamond. */
function about(o: Spec): Glyph {
  const r = 8.35 - o.sw * 0.15;
  const ring = circle(12, 12, r);
  const stemW = o.sw * 0.95;
  // The foot is a stroke only. An open curve inside the evenodd disc leaks.
  const stemD = o.detail ? `M12 10.85V15.65M10.4 15.65Q12 16.65 13.6 15.65` : line(pt(12, 10.7), pt(12, 16.15));
  const stem = stroke(stemD, stemW);
  const stemCut = capsule(12, o.detail ? 10.85 : 10.7, 12, o.detail ? 15.65 : 16.15, stemW);
  const dotR = o.id === 16 ? 1.12 : 1.28;
  const dot = fill(diamond(12, 7.15, dotR));
  const disc = circle(12, 12, r - o.sw * 0.48);
  // Pressed: the medallion is inked and the i is left as paper.
  return {
    off: [stroke(ring, o.sw), stem, dot],
    on: [fill(disc + stemCut + diamond(12, 7.15, dotR)), stroke(ring, o.sw)],
  };
}

function circlePoly(cx: number, cy: number, r: number, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function horn(o: Spec): Glyph {
  const body: Pt[] = [pt(3.7, 9.25), pt(7.15, 9.25), pt(11.15, 6.15), pt(11.15, 17.85), pt(7.15, 14.75), pt(3.7, 14.75)];
  const shape = roundPoly(body, 0.85);
  const poly = roundPolyPoints(body, 0.85);
  const plateBody = plate(shape, poly, { ...o, gap: o.gap * 1.15 });
  const near = stroke(`M14.15 8.85a4.05 4.05 0 0 1 0 6.3`, o.sw);
  const farW = o.id === 16 ? o.sw * 0.85 : o.hw;
  const far = stroke(`M16.85 6.55a7.15 7.15 0 0 1 0 10.9`, farW);
  const farOn = stroke(`M16.85 6.55a7.15 7.15 0 0 1 0 10.9`, o.sw);
  return {
    off: [...plateBody.off, near, far],
    on: [...plateBody.on, near, farOn],
  };
}

/** Arrow into an engraved tray. The head is a nib, not a fat triangle. */
function bring(o: Spec): Glyph {
  const tray = rrect(4.35, 13.15, 15.3, 6.15, o.rad);
  const poly = rrectPoly(4.35, 13.15, 15.3, 6.15, o.rad);
  const body = plate(tray, poly, o);
  const stem = stroke(line(pt(12, 3.15), pt(12, 8.55)), o.sw);
  const nib = stroke(elbow(pt(8.15, 7.15), pt(12, 10.85), pt(15.85, 7.15), 0.7), o.sw);
  return { off: [...body.off, stem, nib], on: [...body.on, stem, nib] };
}

function search(o: Spec): Glyph {
  const c = pt(10.35, 10.35);
  const r = 6.15;
  const ring = circle(c.x, c.y, r);
  const poly = circlePoly(c.x, c.y, r - o.sw * 0.72);
  const lines = hatch(poly, FIELD, o.gap);
  const ink = joinLines(lines);
  const cuts = joinCapsules(lines, o.hw * 0.9);
  const handle = stroke(line(pt(14.85, 14.85), pt(20.15, 20.15)), o.sw * 1.05);
  const off: Mark[] = [];
  if (ink) off.push(stroke(ink, o.hw));
  off.push(stroke(ring, o.sw), handle);
  const on: Mark[] = [];
  if (cuts) on.push(fill(circle(c.x, c.y, r - o.sw * 0.42) + cuts));
  on.push(stroke(ring, o.sw), handle);
  return { off, on };
}

/** Four plates. Two are inked, on the diagonal the engravings shade. */
function plates(o: Spec): Glyph {
  const s = 7.55;
  const g = 1.7;
  const x0 = (24 - s * 2 - g) / 2;
  const cells = [
    { x: x0, y: x0, inked: true },
    { x: x0 + s + g, y: x0, inked: false },
    { x: x0, y: x0 + s + g, inked: false },
    { x: x0 + s + g, y: x0 + s + g, inked: true },
  ];
  const off: Mark[] = [];
  const on: Mark[] = [];
  for (const cell of cells) {
    const shape = rrect(cell.x, cell.y, s, s, o.rad);
    const poly = rrectPoly(cell.x, cell.y, s, s, o.rad);
    const body = plate(shape, poly, o);
    off.push(...(cell.inked ? body.off : [stroke(shape, o.sw)]));
    on.push(...body.on);
  }
  return { off, on };
}

/** Open codex. The gutter is stitched. The right page carries the shade. */
function codex(o: Spec): Glyph {
  const left = `M12 5.85C8.55 4.55 5.35 4.75 3.45 6.25V18.15C5.45 16.85 8.65 16.7 12 17.85V5.85Z`;
  const right = `M12 5.85C15.45 4.55 18.65 4.75 20.55 6.25V18.15C18.55 16.85 15.35 16.7 12 17.85V5.85Z`;
  const rightPoly: Pt[] = [pt(12, 5.85), pt(16.2, 4.7), pt(20.55, 6.25), pt(20.55, 18.15), pt(16.4, 16.9), pt(12, 17.85)];
  const shade = plate(right, rightPoly, o);
  const textW = o.id === 16 ? o.sw * 0.8 : o.hw;
  const t1 = stroke(line(pt(5.15, 9.35), pt(10.15, 8.85)), textW);
  const t2 = stroke(line(pt(5.15, 12.7), pt(9.55, 12.35)), textW);
  const t1on = stroke(line(pt(5.15, 9.35), pt(10.15, 8.85)), o.sw * 0.95);
  const t2on = stroke(line(pt(5.15, 12.7), pt(9.55, 12.35)), o.sw * 0.95);
  const gutter = stroke(line(pt(12, 5.7), pt(12, 18.05)), o.sw);
  const stitches =
    o.id === 16
      ? ''
      : [9.2, 12, 14.8].map((y) => line(pt(11.15, y), pt(12.85, y))).join('');
  const stitchMark = stitches ? stroke(stitches, o.hw) : null;
  const off = [...shade.off, stroke(left, o.sw), t1, t2, gutter];
  const on = [...shade.on, stroke(left, o.sw), t1on, t2on, gutter];
  if (stitchMark) {
    off.push(stitchMark);
    on.push(stitchMark);
  }
  return { off, on };
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
      return scripts(o);
    case 'book.closed':
      return gloss(o);
    case 'list.bullet':
      return manuscript(o);
    case 'slider.horizontal.3':
      return grooves(o);
    case 'music.note':
      return nay(o);
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
