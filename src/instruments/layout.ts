/**
 * Layout of several instrument engravings in one box. Pure functions, no DOM, no React:
 * the scene, the gallery playground and the tests all call `layoutInstruments`.
 *
 * Every instrument sits on a plate: the drawing (fitted to its viewBox aspect, never stretched)
 * with a caption under it (or beside it in `stack`). The engine picks a mode from the count and the box,
 * never lets a drawing fall below a readable size. What does not fit is left out: there is no «+N» chip.
 * Automatic layout is prominence on every screen, including the short wide car page.
 * A phone (narrow box) keeps three in one row, or four in two rows of two. The car page's
 * chrome (lyric, comment, player) is CSS, not a second instrument layout.
 * Rules in prose: docs/methodology/09-instruments.md.
 */

export const LAYOUT_MODES = ['single', 'pair-sides', 'pair-diagonal', 'stack', 'fan', 'hero-insets', 'grid', 'prominence'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const LAYOUT_NAMES: Record<LayoutMode, string> = {
  single: 'Один крупно',
  'pair-sides': 'Пара по сторонам',
  'pair-diagonal': 'Пара по диагонали',
  stack: 'Столбиком',
  fan: 'Веером',
  'hero-insets': 'Главный и вставки',
  grid: 'Сетка',
  prominence: 'По главности',
};

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caption size tier; the stylesheet uses the same metrics (src/styles/instruments.css). */
export type LabelTier = 's' | 'm' | 'l';

export interface LabelBox extends Rect {
  align: 'center' | 'start' | 'end';
  tier: LabelTier;
}

export interface Slot {
  /** Index into the instrument list; −1 for the «+N» chip. */
  index: number;
  kind: 'instrument' | 'more';
  role: 'solo' | 'side' | 'main' | 'inset' | 'card' | 'row' | 'cell' | 'more';
  /** Plate rectangle in px inside the box (before `rotate`, which turns it about its centre). */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** 2D rotation in degrees, about the plate centre. */
  rotate?: number;
  /** Turn about the vertical axis in degrees (CSS rotateY): positive turns the plate to face right. */
  turn?: number;
  opacity?: number;
  /** Drawing rectangle relative to the plate; its aspect is the drawing's viewBox aspect. */
  art: Rect;
  /** Caption rectangle relative to the plate. */
  label: LabelBox;
  /** For the chip: how many instruments it stands for. */
  more?: number;
}

export interface Layout {
  mode: LayoutMode;
  box: Size;
  slots: Slot[];
  /** Indices of instruments not drawn. */
  hidden: number[];
  /** Smallest drawing side among the visible instruments, px. */
  minArt: number;
  /** Readable minimum used for this box, px. */
  threshold: number;
  /** True when a requested mode could not be honoured and the automatic choice was used instead. */
  fallback: boolean;
}

export interface LayoutOptions {
  /** Requested mode; 'auto' or undefined lets the engine choose. */
  mode?: LayoutMode | 'auto';
  /** Width / height of each drawing's viewBox (default 1). */
  aspects?: number[];
  /** Caption lines under each drawing: 1 (name), 2 (name + native name), 3 (+ performer). Default 2. */
  lines?: number;
  /** Readable minimum side of a drawing, px. Default is `readableMin`. */
  minArt?: number;
  /** Largest drawing side, px. Default 540. */
  maxArt?: number;
  /**
   * Accepted so an older caller can still pass it. It does not change the layout:
   * the stage is prominence, and equal rows are not drawn.
   */
  uniform?: boolean;
  /** Show at most this many plates. What does not fit is left out. */
  maxShown?: number;
  /**
   * Song stage only. Draw every plate in the roster. The gallery keeps the width cap.
   * More than four plates use a grid; four or fewer stay a prominence row when it fits.
   */
  fitRoster?: boolean;
}

/* ---------- Caption metrics (keep in sync with src/styles/instruments.css) ---------- */

export const LABEL_METRICS: Record<LabelTier, { name: number; nameLH: number; sub: number; subLH: number; pad: number; gap: number; minW: number }> = {
  l: { name: 20, nameLH: 25, sub: 15, subLH: 20, pad: 16, gap: 8, minW: 200 },
  m: { name: 17, nameLH: 22, sub: 13, subLH: 18, pad: 12, gap: 6, minW: 150 },
  s: { name: 13, nameLH: 17, sub: 11, subLH: 14, pad: 8, gap: 4, minW: 100 },
};
/** A drawing at least this big gets the tier's captions. */
const TIER_MIN: Record<LabelTier, number> = { l: 240, m: 140, s: 0 };
const TIERS: LabelTier[] = ['l', 'm', 's'];
/** Old chip size. The engine does not draw a chip; tests still read the constant. */
export const CHIP = { w: 56, h: 34 };

export function labelHeight(tier: LabelTier, lines: number) {
  const m = LABEL_METRICS[tier];
  return m.nameLH + Math.max(0, lines - 1) * m.subLH;
}

/** Default readable minimum for a box. */
export function readableMin(box: Size) {
  // The phone shows three or four, so the floor is a recognisable medallion, not a reason to drop to one.
  // A wider stage can hold the smaller steps (about 0.65 of the lead) in a low row.
  const phone = box.w < 560;
  const floor = phone ? 44 : 56;
  const share = phone ? 0.11 : 0.2;
  return Math.round(Math.min(150, Math.max(floor, Math.min(box.w, box.h) * share)));
}

/* ---------- Plate fitting ---------- */

interface Plate {
  w: number;
  h: number;
  art: Rect;
  label: LabelBox;
  side: number;
}

/** Biggest plate with the caption below the drawing that fits in a cell. */
function plateBelow(cw: number, ch: number, aspect: number, lines: number, maxArt: number): Plate {
  for (const tier of TIERS) {
    const m = LABEL_METRICS[tier];
    const lh = labelHeight(tier, lines);
    let ah = Math.min(ch - 2 * m.pad - m.gap - lh, (cw - 2 * m.pad) / aspect, maxArt / Math.max(1, aspect), maxArt);
    ah = Math.max(0, ah);
    const aw = ah * aspect;
    const side = Math.min(aw, ah);
    if (side < TIER_MIN[tier] && tier !== 's') continue;
    const w = Math.min(cw, Math.max(aw + 2 * m.pad, m.minW + 2 * m.pad));
    const h = ah + 2 * m.pad + m.gap + lh;
    return {
      w,
      h,
      side,
      art: { x: (w - aw) / 2, y: m.pad, w: aw, h: ah },
      label: { x: m.pad, y: m.pad + ah + m.gap, w: w - 2 * m.pad, h: lh, align: 'center', tier },
    };
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}

/** Plate with the drawing on the left and the caption beside it (rows of `stack`). */
function plateBeside(cw: number, ch: number, aspect: number, lines: number, maxArt: number): Plate | null {
  for (const tier of TIERS) {
    const m = LABEL_METRICS[tier];
    const lh = labelHeight(tier, lines);
    let ah = Math.min(ch - 2 * m.pad, maxArt / Math.max(1, aspect), maxArt);
    let aw = ah * aspect;
    const room = cw - 2 * m.pad - 2 * m.gap - aw;
    if (room < m.minW) {
      aw = cw - 2 * m.pad - 2 * m.gap - m.minW;
      ah = aw / aspect;
    }
    if (ah < lh || aw <= 0) continue;
    const side = Math.min(aw, ah);
    if (side < TIER_MIN[tier] && tier !== 's') continue;
    const labelW = Math.min(cw - 2 * m.pad - 2 * m.gap - aw, m.minW * 1.7);
    const w = 2 * m.pad + aw + 2 * m.gap + labelW;
    const h = ah + 2 * m.pad;
    return {
      w,
      h,
      side,
      art: { x: m.pad, y: m.pad, w: aw, h: ah },
      label: { x: m.pad + aw + 2 * m.gap, y: (h - lh) / 2, w: labelW, h: lh, align: 'start', tier },
    };
  }
  return null;
}

/** Bounding box size of a w×h rectangle rotated by `deg`. */
function rotatedSize(w: number, h: number, deg: number) {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return { w: w * Math.cos(r) + h * Math.sin(r), h: w * Math.sin(r) + h * Math.cos(r) };
}

/** Largest value in [lo, hi] for which `ok` holds (ok must be monotone: true below some limit). */
function search(lo: number, hi: number, ok: (v: number) => boolean) {
  if (!ok(lo)) return lo;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const gapFor = (box: Size) => Math.round(Math.min(20, Math.max(8, Math.min(box.w, box.h) * 0.025)));

/* ---------- Modes ---------- */

interface Ctx {
  box: Size;
  aspects: number[];
  lines: number;
  maxArt: number;
  gap: number;
  /** Skip a column count whose cell is narrower than this, so a name can sit on the plate. */
  minCell?: number;
}

type Built = { slots: Slot[]; visibility: number };

function instrumentSlot(index: number, role: Slot['role'], x: number, y: number, p: Plate, z: number, extra: Partial<Slot> = {}): Slot {
  return { index, kind: 'instrument', role, x, y, w: p.w, h: p.h, z, art: p.art, label: p.label, ...extra };
}

function single(c: Ctx, idx: number[], more: number): Built {
  void more;
  const { box } = c;
  const p = plateBelow(box.w, box.h, c.aspects[idx[0]], c.lines, c.maxArt);
  const x = (box.w - p.w) / 2;
  const y = (box.h - p.h) / 2;
  return { slots: [instrumentSlot(idx[0], 'solo', x, y, p, 1)], visibility: 1 };
}

function pairSides(c: Ctx, idx: number[]): Built {
  const { box, gap } = c;
  const turn = 9;
  // A turned plate looks narrower by cos(turn); keep the flat size for the fit.
  const cw = (box.w - gap) / 2;
  const plates = idx.map((i) => plateBelow(cw, box.h, c.aspects[i], c.lines, c.maxArt));
  const side = Math.min(...plates.map((p) => p.side));
  const ps = idx.map((i) => plateBelow(cw, box.h, c.aspects[i], c.lines, Math.min(c.maxArt, side * Math.max(1, c.aspects[i]))));
  const total = ps[0].w + gap + ps[1].w;
  const x0 = (box.w - total) / 2;
  return {
    slots: [
      instrumentSlot(idx[0], 'side', x0, (box.h - ps[0].h) / 2, ps[0], 2, { turn }),
      instrumentSlot(idx[1], 'side', x0 + ps[0].w + gap, (box.h - ps[1].h) / 2, ps[1], 1, { turn: -turn }),
    ],
    visibility: 1,
  };
}

function pairDiagonal(c: Ctx, idx: number[]): Built {
  const { box } = c;
  const ov = 0.1; // overlap as a share of the plate
  const rot = 1.5;
  const fits = (s: number) => {
    const ps = idx.map((i) => plateBelow(1e6, 1e6, c.aspects[i], c.lines, s));
    const r = ps.map((p) => rotatedSize(p.w, p.h, rot));
    return r[0].w + r[1].w * (1 - ov) <= box.w && r[0].h + r[1].h * (1 - ov) <= box.h;
  };
  const s = search(10, c.maxArt, fits);
  const ps = idx.map((i) => plateBelow(1e6, 1e6, c.aspects[i], c.lines, s));
  const r = ps.map((p) => rotatedSize(p.w, p.h, rot));
  const totalW = r[0].w + r[1].w * (1 - ov);
  const totalH = r[0].h + r[1].h * (1 - ov);
  const ox = (box.w - totalW) / 2;
  const oy = (box.h - totalH) / 2;
  // Rotated plates: place by their bounding boxes, then convert to the unrotated rect.
  const at = (i: number, bx: number, by: number) => ({ x: bx + (r[i].w - ps[i].w) / 2, y: by + (r[i].h - ps[i].h) / 2 });
  const a = at(0, ox, oy);
  const b = at(1, ox + totalW - r[1].w, oy + totalH - r[1].h);
  return {
    slots: [instrumentSlot(idx[0], 'main', a.x, a.y, ps[0], 2, { rotate: -rot }), instrumentSlot(idx[1], 'side', b.x, b.y, ps[1], 1, { rotate: rot })],
    visibility: 1 - ov * ov,
  };
}

function stack(c: Ctx, idx: number[], more: number): Built | null {
  void more;
  const { box, gap } = c;
  const n = idx.length;
  const rh = (box.h - (n - 1) * gap) / n;
  if (rh <= 0) return null;
  // Same art size on every row, so the column reads as one list.
  let plates = idx.map((i) => plateBeside(box.w, rh, c.aspects[i], c.lines, c.maxArt));
  let beside = plates.every(Boolean);
  if (beside) {
    const side = Math.min(...plates.map((p) => p!.side));
    plates = idx.map((i) => plateBeside(box.w, rh, c.aspects[i], c.lines, Math.min(c.maxArt, side * Math.max(1, c.aspects[i]))));
    beside = plates.every(Boolean);
  }
  let ps: Plate[];
  if (beside) ps = plates as Plate[];
  else {
    const first = idx.map((i) => plateBelow(box.w, rh, c.aspects[i], c.lines, c.maxArt));
    const side = Math.min(...first.map((p) => p.side));
    ps = idx.map((i) => plateBelow(box.w, rh, c.aspects[i], c.lines, Math.min(c.maxArt, side * Math.max(1, c.aspects[i]))));
  }
  // Rows share one width so captions line up
  const w = Math.max(...ps.map((p) => p.w));
  const used = ps.reduce((s, p) => s + p.h, 0) + (n - 1) * gap;
  let y = (box.h - used) / 2;
  const x = (box.w - w) / 2;
  const slots: Slot[] = ps.map((p, k) => {
    const plate = beside ? { ...p, w, label: { ...p.label, w: w - p.label.x - LABEL_METRICS[p.label.tier].pad } } : { ...p, w, art: { ...p.art, x: (w - p.art.w) / 2 }, label: { ...p.label, w: w - 2 * LABEL_METRICS[p.label.tier].pad } };
    const s = instrumentSlot(idx[k], 'row', x, y, plate, n - k);
    y += p.h + gap;
    return s;
  });
  return { slots, visibility: 1 };
}

function fan(c: Ctx, idx: number[]): Built {
  const { box } = c;
  const n = idx.length;
  const show = 0.52; // visible share of each card behind
  const k = 0.9; // scale per level
  const rotStep = 4;
  const lift = 0.05; // cards behind sit a little higher
  const geometry = (s: number) => {
    const plates = idx.map((i, j) => {
      const L = Math.ceil(j / 2);
      return plateBelow(1e6, 1e6, c.aspects[i], c.lines, s * Math.pow(k, L));
    });
    // x of each card's centre relative to the front card's centre
    const cx: number[] = [0];
    const cy: number[] = [0];
    for (let j = 1; j < n; j++) {
      const L = Math.ceil(j / 2);
      const dir = j % 2 ? -1 : 1;
      const prev = j <= 2 ? 0 : j - 2;
      const pPrev = plates[prev];
      const p = plates[j];
      cx[j] = cx[prev] + dir * (pPrev.w / 2 + p.w * (show - 0.5));
      cy[j] = -L * lift * plates[0].h;
    }
    const boxes = plates.map((p, j) => {
      const r = rotatedSize(p.w, p.h, Math.ceil(j / 2) * rotStep);
      return { x0: cx[j] - r.w / 2, x1: cx[j] + r.w / 2, y0: cy[j] - r.h / 2, y1: cy[j] + r.h / 2 };
    });
    const minX = Math.min(...boxes.map((b) => b.x0));
    const maxX = Math.max(...boxes.map((b) => b.x1));
    const minY = Math.min(...boxes.map((b) => b.y0));
    const maxY = Math.max(...boxes.map((b) => b.y1));
    return { plates, cx, cy, minX, maxX, minY, maxY };
  };
  const s = search(10, c.maxArt, (v) => {
    const g = geometry(v);
    return g.maxX - g.minX <= box.w && g.maxY - g.minY <= box.h;
  });
  const g = geometry(s);
  const ox = (box.w - (g.maxX - g.minX)) / 2 - g.minX;
  const oy = (box.h - (g.maxY - g.minY)) / 2 - g.minY;
  const slots = g.plates.map((p, j) => {
    const L = Math.ceil(j / 2);
    const dir = j === 0 ? 0 : j % 2 ? -1 : 1;
    // Caption of a card behind moves to its visible edge
    const m = LABEL_METRICS[p.label.tier];
    const visW = j === 0 ? p.w : p.w * show;
    const label: LabelBox = j === 0 ? p.label : { ...p.label, x: dir < 0 ? m.pad : p.w - visW + m.pad * 0.5, w: visW - m.pad * 1.5, align: dir < 0 ? 'start' : 'end' };
    return instrumentSlot(idx[j], j === 0 ? 'main' : 'card', ox + g.cx[j] - p.w / 2, oy + g.cy[j] - p.h / 2, { ...p, label }, n - j, {
      rotate: dir * L * rotStep,
      opacity: j === 0 ? 1 : 0.97,
    });
  });
  return { slots, visibility: show };
}

function heroInsets(c: Ctx, idx: number[], more: number): Built | null {
  void more;
  const { box } = c;
  const insetCount = idx.length - 1;
  if (insetCount < 1 || insetCount > 3) return null;
  const heroAspect = c.aspects[idx[0]];
  // (ax, ay) place the main drawing and its caption inside the frame: 0.5 centres it, 0 / 1 push it
  // to one side so the insets on the other side can grow.
  const tryHero = (S: number, ax: number, ay: number) => {
    const hero = plateBelow(box.w, box.h, heroAspect, c.lines, S);
    // The hero plate is the whole frame; its drawing and caption sit inside it.
    const frame: Plate = { ...hero, w: box.w, h: box.h };
    const x0 = (box.w - hero.w) * ax;
    const y0 = (box.h - hero.h) * ay;
    const art = { x: x0 + hero.art.x, y: y0 + hero.art.y, w: hero.art.w, h: hero.art.h };
    const label = { ...hero.label, x: x0 + hero.label.x, y: y0 + hero.label.y };
    // Engravings live inside a medallion of radius 0.465 of the viewBox: the corners stay free.
    const C = { x: art.x + art.w / 2, y: art.y + art.h / 2 };
    const R = 0.47 * Math.min(art.w, art.h);
    const margin = Math.max(6, c.gap * 0.6);
    const corners = [
      { name: 'tr', fx: 1, fy: 0 },
      { name: 'tl', fx: 0, fy: 0 },
      { name: 'br', fx: 1, fy: 1 },
      { name: 'bl', fx: 0, fy: 1 },
    ];
    const rectAt = (fx: number, fy: number, w: number, h: number) => ({ x: fx ? box.w - margin - w : margin, y: fy ? box.h - margin - h : margin, w, h });
    const clearOf = (r: Rect) => {
      const nx = Math.max(r.x, Math.min(C.x, r.x + r.w));
      const ny = Math.max(r.y, Math.min(C.y, r.y + r.h));
      if (Math.hypot(nx - C.x, ny - C.y) < R) return false;
      const L = label;
      return r.x + r.w <= L.x || r.x >= L.x + L.w || r.y + r.h <= L.y || r.y >= L.y + L.h;
    };
    const insetAspect = (j: number) => (j < idx.length - 1 ? c.aspects[idx[j + 1]] : 1);
    const sized = corners.map((k) => {
      const s = search(0, c.maxArt, (v) => {
        const p = plateBelow(1e6, 1e6, 1, c.lines, v);
        return p.w <= box.w / 2 - margin - c.gap / 2 && p.h <= box.h / 2 - margin - c.gap / 2 && clearOf(rectAt(k.fx, k.fy, p.w, p.h));
      });
      return { ...k, s };
    });
    const chosen = sized.slice().sort((a, b) => b.s - a.s || corners.indexOf(a) - corners.indexOf(b)).slice(0, insetCount);
    // Insets stay clearly smaller than the main drawing
    const s = Math.min(...chosen.map((k) => k.s), hero.side * 0.6);
    return { frame, art, label, s, chosen, rectAt, insetAspect, side: hero.side };
  };
  const heroMax = plateBelow(box.w, box.h, heroAspect, c.lines, c.maxArt).side;
  let best: ReturnType<typeof tryHero> | null = null;
  let bestScore = -1;
  const anchors = box.h > box.w * 1.1 ? [[0.5, 0.5], [0.5, 1], [0.5, 0]] : box.w > box.h * 1.1 ? [[0.5, 0.5], [0, 0.5], [1, 0.5]] : [[0.5, 0.5], [0.5, 1], [0, 0.5], [1, 0.5], [0.5, 0]];
  for (const [ax, ay] of anchors) {
    for (let f = 1; f >= 0.499; f -= 0.05) {
      const t = tryHero(heroMax * f, ax, ay);
      const score = Math.min(t.side * 0.55, t.s);
      if (score > bestScore + 0.5) {
        best = t;
        bestScore = score;
      }
    }
  }
  if (!best || best.s < 20) return null;
  const { frame, art, label, chosen, rectAt, insetAspect, s } = best;
  const heroPlate: Plate = { ...frame, art, label };
  const slots: Slot[] = [instrumentSlot(idx[0], 'main', 0, 0, heroPlate, 1)];
  // Order corners for reading: top row first, then bottom, left to right
  const order = chosen.slice().sort((a, b) => a.fy - b.fy || a.fx - b.fx);
  order.forEach((k, j) => {
    if (j < idx.length - 1) {
      const p = plateBelow(1e6, 1e6, insetAspect(j), c.lines, s);
      const r = rectAt(k.fx, k.fy, p.w, p.h);
      slots.push(instrumentSlot(idx[j + 1], 'inset', r.x, r.y, p, 2 + j));
    }
  });
  return { slots, visibility: 1 };
}

function grid(c: Ctx, idx: number[], more: number): Built {
  void more;
  const { box, gap } = c;
  const cells = idx.length;
  let best: { cols: number; rows: number; side: number; score: number } | null = null;
  for (let cols = 1; cols <= cells; cols++) {
    const rows = Math.ceil(cells / cols);
    const cw = (box.w - (cols - 1) * gap) / cols;
    const ch = (box.h - (rows - 1) * gap) / rows;
    if (cw <= 0 || ch <= 0) continue;
    if (c.minCell && cols > 1 && cw < c.minCell) continue;
    const side = Math.min(...idx.map((i) => plateBelow(cw, ch, c.aspects[i], c.lines, c.maxArt).side));
    const empty = cols * rows - cells;
    const score = side * (1 - 0.04 * empty) * (rows > 1 && empty >= cols ? 0.5 : 1);
    if (!best || score > best.score + 0.5) best = { cols, rows, side, score };
  }
  const { cols, rows, side } = best ?? { cols: cells, rows: 1, side: 0 };
  const cw = (box.w - (cols - 1) * gap) / cols;
  const ch = (box.h - (rows - 1) * gap) / rows;
  const ps = idx.map((i) => plateBelow(cw, ch, c.aspects[i], c.lines, Math.min(c.maxArt, side * Math.max(1, c.aspects[i]))));
  const pw = Math.max(...ps.map((p) => p.w));
  const ph = Math.max(...ps.map((p) => p.h));
  // Pack the plates (not the cells) and centre the block, so a grid of small plates stays together.
  const usedW = cols * pw + (cols - 1) * gap;
  const usedH = rows * ph + (rows - 1) * gap;
  const ox = (box.w - Math.min(usedW, box.w)) / 2;
  const oy = (box.h - Math.min(usedH, box.h)) / 2;
  const slots: Slot[] = [];
  for (let j = 0; j < cells; j++) {
    const row = Math.floor(j / cols);
    const inRow = row === rows - 1 ? cells - row * cols : cols;
    const col = j - row * cols;
    const rowX = ox + ((cols - inRow) * (pw + gap)) / 2;
    const x = rowX + col * (pw + gap);
    const y = oy + row * (ph + gap);
    if (j < idx.length) {
      const p = ps[j];
      const plate = { ...p, w: pw, h: ph, art: { ...p.art, x: (pw - p.art.w) / 2 }, label: { ...p.label, w: pw - 2 * LABEL_METRICS[p.label.tier].pad } };
      slots.push(instrumentSlot(idx[j], 'cell', x, y, plate, 1));
    }
  }
  return { slots, visibility: 1 };
}

/* ---------- Prominence ---------- */

/** Drawing scale by rank. The first instrument is the lead. */
export const PROMINENCE_SCALE = [1, 0.8, 0.7, 0.65];

/**
 * How many plates a box may hold. A phone (under 560 CSS px) holds four: three in a row,
 * or two rows of two. Under 1000 the car and other medium boxes hold three. A wide box holds four.
 */
export function prominenceLimit(width: number) {
  if (width < 560) return 4;
  return width < 1000 ? 3 : 4;
}

/** A plate whose width is the drawing plus equal side padding, so the gaps between drawings stay even. */
function prominencePlate(aspect: number, lines: number, maxSide: number, tier: LabelTier, compact: boolean): Plate {
  const m = LABEL_METRICS[tier];
  const pad = compact ? 4 : m.pad;
  const lh = labelHeight(tier, lines);
  const aw = aspect >= 1 ? maxSide : maxSide * aspect;
  const ah = aw / aspect;
  // Narrow drawings still need a caption: «Ансамбль» does not fit in a 60px line.
  const labelW = Math.max(84, aw);
  const w = labelW + 2 * pad;
  const h = ah + 2 * pad + m.gap + lh;
  return {
    w,
    h,
    side: Math.min(aw, ah),
    art: { x: (w - aw) / 2, y: pad, w: aw, h: ah },
    label: { x: pad, y: pad + ah + m.gap, w: labelW, h: lh, align: 'center', tier },
  };
}

/**
 * Four plates on a phone: two rows of two. Each row shares an art baseline.
 * Rank still sets the drawing size, and the lead stays the first plate.
 */
function phoneQuad(c: Ctx, idx: number[]): Built | null {
  if (idx.length !== 4) return null;
  const scales = idx.map((_, i) => PROMINENCE_SCALE[Math.min(i, PROMINENCE_SCALE.length - 1)]);
  const tierFor = (side: number): LabelTier => (side >= TIER_MIN.l ? 'l' : side >= TIER_MIN.m ? 'm' : 's');
  const rowOf = (plates: Plate[], a: number, b: number) => {
    const pa = plates[a];
    const pb = plates[b];
    const yRelA = -(pa.art.y + pa.art.h);
    const yRelB = -(pb.art.y + pb.art.h);
    const top = Math.min(yRelA, yRelB);
    const bottom = Math.max(yRelA + pa.h, yRelB + pb.h);
    return { yRel: [yRelA, yRelB] as const, top, height: bottom - top, width: pa.w + c.gap + pb.w };
  };
  const placed = (lead: number) => {
    const tier = tierFor(lead);
    const plates = idx.map((i, j) => prominencePlate(c.aspects[i], c.lines, Math.max(1, lead * scales[j]), tier, true));
    const r0 = rowOf(plates, 0, 1);
    const r1 = rowOf(plates, 2, 3);
    const width = Math.max(r0.width, r1.width);
    const height = r0.height + c.gap + r1.height;
    return { plates, r0, r1, width, height, ok: width <= c.box.w + 0.01 && height <= c.box.h + 0.01 };
  };
  if (!placed(8).ok) return null;
  const lead = search(8, c.maxArt, (v) => placed(v).ok);
  const g = placed(lead);
  if (!g.ok) return null;
  const oy = (c.box.h - g.height) / 2;
  const placeRow = (row: ReturnType<typeof rowOf>, which: [number, number], y: number, slots: Slot[]) => {
    let x = (c.box.w - row.width) / 2;
    which.forEach((j, k) => {
      const p = g.plates[j];
      slots.push(instrumentSlot(idx[j], j === 0 ? 'main' : 'side', x, y + row.yRel[k] - row.top, p, 4 - j));
      x += p.w + c.gap;
    });
  };
  const slots: Slot[] = [];
  placeRow(g.r0, [0, 1], oy, slots);
  placeRow(g.r1, [2, 3], oy + g.r0.height + c.gap, slots);
  return { slots, visibility: 1 };
}

/** Plates in a row, art bottoms on one line, even gaps, scale by rank. Four on a phone stack into two rows. */
function prominence(c: Ctx, idx: number[]): Built | null {
  if (idx.length === 4 && c.box.w < 560) return phoneQuad(c, idx);
  const n = idx.length;
  if (!n) return null;
  const scales = idx.map((_, i) => PROMINENCE_SCALE[Math.min(i, PROMINENCE_SCALE.length - 1)]);
  const tierFor = (side: number): LabelTier => (side >= TIER_MIN.l ? 'l' : side >= TIER_MIN.m ? 'm' : 's');
  // A low wide row spends its height on the drawing. A phone row does the same so three still fit.
  const compact = c.box.w < 560 || (c.box.w >= 560 && c.box.h < 200);
  const placed = (lead: number) => {
    const tier = tierFor(lead);
    const plates = idx.map((i, j) => prominencePlate(c.aspects[i], c.lines, Math.max(1, lead * scales[j]), tier, compact));
    if (n === 1 && plates[0].label.w < 220 && c.box.w > plates[0].w + 24) {
      const p = plates[0];
      const want = Math.min(240, c.box.w - 32);
      const extra = want - p.w;
      plates[0] = {
        ...p,
        w: p.w + extra,
        art: { ...p.art, x: p.art.x + extra / 2 },
        label: { ...p.label, w: p.label.w + extra },
      };
    }
    const yRel = plates.map((p) => -(p.art.y + p.art.h));
    const top = Math.min(...yRel);
    const bottom = Math.max(...plates.map((p, j) => yRel[j] + p.h));
    const width = plates.reduce((sum, p) => sum + p.w, 0) + c.gap * Math.max(0, n - 1);
    const height = bottom - top;
    return { plates, yRel, top, width, height, ok: width <= c.box.w + 0.01 && height <= c.box.h + 0.01 };
  };
  if (!placed(8).ok) return null;
  const lead = search(8, c.maxArt, (v) => placed(v).ok);
  const g = placed(lead);
  if (!g.ok) return null;
  const ox = (c.box.w - g.width) / 2;
  const oy = (c.box.h - g.height) / 2 - g.top;
  let x = ox;
  const slots = g.plates.map((p, j) => {
    const slot = instrumentSlot(idx[j], j === 0 ? 'main' : 'side', x, oy + g.yRel[j], p, n - j);
    x += p.w + c.gap;
    return slot;
  });
  return { slots, visibility: 1 };
}

/* ---------- Choice ---------- */

/** How many instruments each mode is made for (inclusive). Shared with the validator. */
export const MODE_COUNTS: Record<LayoutMode, { min: number; max: number; chip: boolean }> = {
  single: { min: 1, max: 1, chip: false },
  'pair-sides': { min: 2, max: 2, chip: false },
  'pair-diagonal': { min: 2, max: 2, chip: false },
  stack: { min: 2, max: 4, chip: false },
  fan: { min: 3, max: 5, chip: false },
  'hero-insets': { min: 2, max: 4, chip: false },
  grid: { min: 3, max: Infinity, chip: false },
  prominence: { min: 1, max: 4, chip: false },
};
const ALLOWED = Object.fromEntries(LAYOUT_MODES.map((m) => [m, (n: number) => n >= MODE_COUNTS[m].min && n <= MODE_COUNTS[m].max])) as Record<LayoutMode, (n: number) => boolean>;

/**
 * What happens when a section asks for `mode` with `n` instruments:
 * 'ok' — as asked; 'chip' — the extras go to «+N»; 'auto' — the mode does not fit and the engine chooses.
 * (On a small screen a mode may still give way to a readable one.)
 */
export function modeFit(mode: LayoutMode, n: number): 'ok' | 'chip' | 'auto' {
  const c = MODE_COUNTS[mode];
  if (n >= c.min && n <= c.max) return 'ok';
  return n > c.max && c.chip ? 'chip' : 'auto';
}

/** How well a mode suits a count and a box shape (aspect = w / h). */
function preference(mode: LayoutMode, n: number, aspect: number): number {
  const wide = aspect >= 1.25;
  const tall = aspect <= 0.8;
  switch (mode) {
    case 'single':
      return 1;
    case 'pair-sides':
      return wide ? 1 : tall ? 0.6 : 0.9;
    case 'pair-diagonal':
      return !wide && !tall ? 1 : 0.8;
    case 'stack':
      return tall ? 1 : aspect < 1 ? 0.8 : 0.55;
    case 'fan':
      return aspect >= 1.15 ? (n === 3 ? 0.95 : 0.85) : 0.5;
    case 'hero-insets':
      return n === 4 ? 1 : n === 3 ? 0.9 : 0.7;
    case 'grid':
      return n >= 5 ? 1 : 0.9;
    case 'prominence':
      return 1;
  }
}

function build(mode: LayoutMode, c: Ctx, idx: number[], more: number): Built | null {
  switch (mode) {
    case 'single':
      return single(c, idx, more);
    case 'pair-sides':
      return more ? null : pairSides(c, idx);
    case 'pair-diagonal':
      return more ? null : pairDiagonal(c, idx);
    case 'stack':
      return stack(c, idx, more);
    case 'fan':
      return more ? null : fan(c, idx);
    case 'hero-insets':
      return heroInsets(c, idx, more);
    case 'grid':
      return grid(c, idx, more);
    case 'prominence':
      return prominence(c, idx);
  }
}

function measure(b: Built) {
  const arts = b.slots.filter((s) => s.kind === 'instrument').map((s) => Math.min(s.art.w, s.art.h));
  return { min: Math.min(...arts), mean: arts.reduce((x, y) => x + y, 0) / arts.length };
}

/**
 * Lay out `count` instruments in a box of `box.w × box.h` CSS px.
 * The first instrument is the lead. Automatic layout is one prominence row.
 */
export function layoutInstruments(count: number, box: Size, opts: LayoutOptions = {}): Layout {
  const n = Math.max(1, Math.floor(count));
  const c: Ctx = {
    box: { w: Math.max(1, box.w), h: Math.max(1, box.h) },
    aspects: Array.from({ length: n }, (_, i) => opts.aspects?.[i] || 1),
    lines: opts.lines ?? 2,
    maxArt: opts.maxArt ?? 540,
    gap: gapFor(box),
    minCell: opts.fitRoster ? 150 : undefined,
  };
  const threshold = opts.minArt ?? readableMin(c.box);
  const aspect = c.box.w / c.box.h;
  const all = Array.from({ length: n }, (_, i) => i);
  const limit = Math.max(1, Math.min(n, opts.maxShown != null && opts.maxShown > 0 ? Math.floor(opts.maxShown) : n));
  void opts.uniform;

  const result = (mode: LayoutMode, b: Built, visible: number, fallback: boolean): Layout => ({
    mode,
    box: c.box,
    slots: b.slots.map(round),
    hidden: all.slice(visible),
    minArt: Math.round(measure(b).min),
    threshold,
    fallback,
  });

  // The song stage asks for the whole roster. Width does not choose a different set:
  // the cast is already the section's standing plates. A short box cannot hold every
  // caption, and a grid that ran past the box left the next line sitting on «Рик».
  // Draw as many as stay inside, largest first. A smaller screen may show fewer at once.
  if (opts.fitRoster) {
    const idx = all.slice(0, limit);
    const inside = (b: Built) =>
      b.slots.every((s) => s.x >= -0.5 && s.y >= -0.5 && s.x + s.w <= c.box.w + 0.5 && s.y + s.h <= c.box.h + 0.5);
    const artOf = (b: Built) => {
      const arts = b.slots.filter((s) => s.kind === 'instrument').map((s) => Math.min(s.art.w, s.art.h));
      return arts.length ? Math.min(...arts) : 0;
    };
    let tight: { mode: LayoutMode; b: Built; shown: number } | null = null;
    for (let k = limit; k >= 1; k--) {
      const row = k <= 4 ? prominence(c, idx.slice(0, k)) : null;
      const b = row ?? grid(c, idx.slice(0, k), 0);
      if (!inside(b)) continue;
      const mode: LayoutMode = row ? 'prominence' : 'grid';
      if (artOf(b) >= 24) return result(mode, b, k, k < limit);
      if (!tight) tight = { mode, b, shown: k };
    }
    if (tight) return result(tight.mode, tight.b, tight.shown, tight.shown < limit);
    return result('single', single(c, idx.slice(0, 1), limit - 1), 1, true);
  }

  // A requested mode is honoured when it can show the instruments readably.
  // Extras are not drawn. Prominence also keeps to the box cap.
  const wanted = opts.mode && opts.mode !== 'auto' ? opts.mode : null;
  if (wanted) {
    const shown = wanted === 'prominence' ? Math.min(limit, prominenceLimit(c.box.w)) : limit;
    for (let k = shown; k >= 1; k--) {
      if (!ALLOWED[wanted](k) && !(wanted === 'single' && k === 1)) continue;
      const b = build(wanted, c, all.slice(0, k), n - k);
      if (b && (k === 1 || measure(b).min >= threshold)) return result(wanted, b, k, false);
    }
  }

  // Automatic: one row, largest first, never more than the cap, and never a chip.
  const autoCap = Math.min(limit, prominenceLimit(c.box.w));
  for (let k = autoCap; k >= 1; k--) {
    const b = prominence(c, all.slice(0, k));
    if (!b) continue;
    if (k > 1 && measure(b).min < threshold) continue;
    return result('prominence', b, k, Boolean(wanted));
  }

  // Legacy sweep kept for an explicit mode that could not be placed above.
  for (let k = limit; k >= 1; k--) {
    const more = n - k;
    let best: { mode: LayoutMode; b: Built; score: number } | null = null;
    for (const mode of LAYOUT_MODES) {
      if (!ALLOWED[mode](k)) continue;
      const b = build(mode, c, all.slice(0, k), more);
      if (!b) continue;
      const m = measure(b);
      if (m.min < threshold) continue;
      const score = (m.min * b.visibility + 0.25 * m.mean) * preference(mode, k, aspect);
      if (!best || score > best.score) best = { mode, b, score };
    }
    if (best) return result(best.mode, best.b, k, Boolean(wanted));
  }
  // Nothing is readable (a very small box): one drawing as large as it gets.
  return result('single', single(c, [0], n - 1), 1, Boolean(wanted));
}

const r1 = (v: number) => Math.round(v * 10) / 10;
function round(s: Slot): Slot {
  return {
    ...s,
    x: r1(s.x),
    y: r1(s.y),
    w: r1(s.w),
    h: r1(s.h),
    art: { x: r1(s.art.x), y: r1(s.art.y), w: r1(s.art.w), h: r1(s.art.h) },
    label: { ...s.label, x: r1(s.label.x), y: r1(s.label.y), w: r1(s.label.w), h: r1(s.label.h) },
  };
}

export function isLayoutMode(v: unknown): v is LayoutMode {
  return typeof v === 'string' && (LAYOUT_MODES as readonly string[]).includes(v);
}
