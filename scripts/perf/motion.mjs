// Motion rows of docs/design/fixed-defects.md (D28–D32). Every number is read from drawn frames:
// the engine's own screencast (Chromium Page.startScreencast, WebKit Screencast.startScreencast),
// one frame per composited frame, in real time. No page clock, no DOM state, no schedules.
// The DOM is used only to find where a region is before the gesture.
// node scripts/perf/motion.mjs --base http://127.0.0.1:4176 [--engine webkit] [--only D28] [--dump dir]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { installResolvedAudio, installWebKitClock, prepareAudio } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);
const base = args.base || 'http://127.0.0.1:4176';
const only = args.only && args.only !== 'true' ? args.only : '';
const engineOnly = args.engine && args.engine !== 'true' ? args.engine : '';
const dump = args.dump && args.dump !== 'true' ? args.dump : '';
// Self-test faults, to see the rows bite: --inject stall (a 400 ms block 150 ms into each tap)
// or --inject blank (the floor undrawn for 150 ms, 700 ms into the scrub).
const inject = args.inject && args.inject !== 'true' ? args.inject : '';
if (dump) mkdirSync(dump, { recursive: true });

const W = 393;
const H = 852;
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Thresholds. Each is named in its row of fixed-defects.md. */
const LIMIT = {
  tapMs: 100,
  /** A pixel moved: one channel changed by more than this (0–255). */
  pixelDelta: 24,
  /** A region moved: this many of its pixels (CSS px) moved. A lit tab label is about 300. */
  regionPixels: 200,
  /** Drawn piece: its ink (pixels off the piece median by > 40 luma) against its median over the run. */
  inkKeep: 0.25,
  /** Dark flat rectangle: share of the viewport. */
  darkRect: 0.05,
  /** Continuity: a frame whose step in and step out both exceed N x the sequence median, while its neighbours agree. */
  spikeN: 3,
  /** Continuity: no new frame for longer than this many median gaps while motion is expected. */
  stallGaps: 3,
  stallFloorMs: 120,
  /** Two transport rows: both the outgoing and the arriving edges kept above this share. */
  doubleShare: 0.35,
  /** Engraving: internal edge share of the plate box, floor and engine ratio. */
  edgeFloor: 0.3,
  edgeRatio: 1.5,
};

const results = [];
function note(name, ok, detail = '') {
  if (only && !name.includes(only)) return;
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

function songDurations() {
  const map = {};
  for (const slug of readdirSync('content/songs')) {
    const file = `content/songs/${slug}/song.json`;
    if (!existsSync(file)) continue;
    const song = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof song.duration === 'number' && song.duration > 1) map[slug] = song.duration;
  }
  return map;
}

async function newPhone(browser, browserName) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    colorScheme: 'dark',
  });
  const map = songDurations();
  const cache = new Map();
  await installResolvedAudio(context, (url) => {
    const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
    const seconds = map[slug];
    if (!seconds) return null;
    if (!cache.has(seconds)) cache.set(seconds, prepareAudio(seconds, 'work/studio/silence'));
    return cache.get(seconds);
  });
  if (browserName === 'webkit') await installWebKitClock(context, map);
  // The tap is stamped in the page on the wall clock, the same clock the frames carry.
  await context.addInitScript(() => {
    window.__taps = [];
    window.__ups = [];
    addEventListener(
      'pointerdown',
      () => {
        window.__taps.push(performance.timeOrigin + performance.now());
        // A 6 px mark in the bottom right corner, drawn by the first frame after the tap.
        if (!window.__mark) return;
        const old = document.getElementById('tap-mark');
        const d = old || document.createElement('div');
        d.id = 'tap-mark';
        const c = window.__mark;
        d.style.cssText = `position:fixed;right:0;bottom:0;width:6px;height:6px;z-index:2147483647;pointer-events:none;background:rgb(${c.join(',')})`;
        if (!old) document.body.append(d);
      },
      { capture: true },
    );
    addEventListener('pointerup', () => window.__ups.push(performance.timeOrigin + performance.now()), { capture: true });
  });
  if (inject) {
    await context.addInitScript((kind) => {
      addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (kind === 'stall' && !target?.closest('.scrub-track')) {
            setTimeout(() => {
              const end = performance.now() + 400;
              while (performance.now() < end) {
                /* the injected stall */
              }
            }, 150);
          }
          if (kind === 'blank' && target?.closest('.scrub-track')) {
            setTimeout(() => {
              const floor = document.querySelector('.player');
              if (floor instanceof HTMLElement) floor.style.visibility = 'hidden';
              setTimeout(() => {
                if (floor instanceof HTMLElement) floor.style.visibility = '';
              }, 150);
            }, 700);
          }
        },
        { capture: true },
      );
    }, inject);
  }
  return context;
}

/**
 * The engine's screencast. Chromium stamps each frame with its swap time.
 * WebKit sends no stamp, so a frame gets its arrival time: later than the
 * paint, which only makes the tap rows stricter.
 */
async function startCast(page) {
  const impl = page._connection.toImpl(page);
  const frames = [];
  const onFrame = (f) => frames.push({ t: f.frameSwapWallTime || Date.now(), buf: f.buffer });
  impl.on('screencastframe', onFrame);
  await impl.delegate.setScreencastOptions({ width: W, height: H, quality: 80 });
  return {
    frames,
    async stop() {
      await impl.delegate.setScreencastOptions(null).catch(() => {});
      impl.off('screencastframe', onFrame);
    },
  };
}

/** RGB at CSS size, cached on the frame. */
async function rgbOf(frame) {
  if (!frame.rgb) {
    frame.rgb = await sharp(frame.buf).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  }
  return frame.rgb;
}
function lumaAt(rgb, i) {
  return 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
}
function clampBox(box) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.w));
  const y1 = Math.min(H, Math.ceil(box.y + box.h));
  return { x0, y0, x1, y1, n: Math.max(1, (x1 - x0) * (y1 - y0)) };
}
/** Share of the region's pixels where some channel moved by more than pixelDelta. */
function movedShare(a, b, box) {
  const r = clampBox(box);
  let moved = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = (y * W + x) * 3;
      if (
        Math.abs(a[i] - b[i]) > LIMIT.pixelDelta ||
        Math.abs(a[i + 1] - b[i + 1]) > LIMIT.pixelDelta ||
        Math.abs(a[i + 2] - b[i + 2]) > LIMIT.pixelDelta
      )
        moved += 1;
    }
  }
  return moved / r.n;
}
/** Mean absolute channel step over the whole frame, every second pixel. */
function meanStep(a, b) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 3;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}
/** Share of the box drawn as glyphs or edges: luma off the box median by more than 40. */
function inkShare(rgb, box) {
  const r = clampBox(box);
  const hist = new Uint32Array(256);
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) hist[Math.round(lumaAt(rgb, (y * W + x) * 3))] += 1;
  let acc = 0;
  let median = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= r.n / 2) {
      median = v;
      break;
    }
  }
  let ink = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (Math.abs(lumaAt(rgb, (y * W + x) * 3) - median) > 40) ink += 1;
  return ink / r.n;
}
/** Largest 4-connected patch of flat near-black 6 px cells inside the box, as a share of the viewport. */
function darkRect(rgb, box) {
  const c = 6;
  const r = clampBox(box);
  const cols = Math.floor((r.x1 - r.x0) / c);
  const rows = Math.floor((r.y1 - r.y0) / c);
  const flat = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let lo = 255;
      let hi = 0;
      let top = 0;
      for (let y = 0; y < c; y++) {
        for (let x = 0; x < c; x++) {
          const i = ((r.y0 + gy * c + y) * W + r.x0 + gx * c + x) * 3;
          const v = lumaAt(rgb, i);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          top = Math.max(top, rgb[i], rgb[i + 1], rgb[i + 2]);
        }
      }
      flat[gy * cols + gx] = top <= 14 && hi - lo <= 4 ? 1 : 0;
    }
  }
  let best = 0;
  const seen = new Uint8Array(cols * rows);
  for (let s = 0; s < flat.length; s++) {
    if (!flat[s] || seen[s]) continue;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop();
      size += 1;
      const gx = k % cols;
      const gy = (k - gx) / cols;
      for (const [nx, ny] of [[gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const q = ny * cols + nx;
        if (flat[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    best = Math.max(best, size);
  }
  return (best * c * c) / (W * H);
}
/**
 * D29 on a run of frames. The player box is cut in four (left/right, top/bottom) and the
 * header kept whole; each piece must keep at least inkKeep of its own median ink over the
 * run, and no flat near-black patch may cover darkRect of the viewport under the header.
 * The median is the run's, not the first frame's: a note card over the floor in frame 1
 * made the reference itself low.
 */
function judgeDrawn(list, player, header) {
  const halfW = player.w / 2;
  const halfH = player.h / 2;
  const pieces = [
    ['player-tl', { x: player.x, y: player.y, w: halfW, h: halfH }],
    ['player-tr', { x: player.x + halfW, y: player.y, w: halfW, h: halfH }],
    ['player-bl', { x: player.x, y: player.y + halfH, w: halfW, h: halfH }],
    ['player-br', { x: player.x + halfW, y: player.y + halfH, w: halfW, h: halfH }],
    ['header', header],
  ];
  const below = { x: 0, y: header.y + header.h, w: W, h: H - header.y - header.h };
  const shares = list.map((rgb) => pieces.map(([, box]) => inkShare(rgb, box)));
  const medians = pieces.map((_, k) => {
    const v = shares.map((row) => row[k]).sort((a, b) => a - b);
    return Math.max(1e-6, v[v.length >> 1]);
  });
  const bad = [];
  let worstDark = 0;
  list.forEach((rgb, i) => {
    const keep = shares[i].map((v, k) => v / medians[k]);
    if (process.env.MOTION_DEBUG) console.log(i + 1, shares[i].map((v) => v.toFixed(3)).join(' '), medians.map((v) => v.toFixed(3)).join(' '));
    const lows = [];
    keep.forEach((v, k) => {
      if (v < LIMIT.inkKeep) lows.push(`${pieces[k][0]} ${v.toFixed(2)}`);
    });
    const dark = darkRect(rgb, below);
    worstDark = Math.max(worstDark, dark);
    if (lows.length || dark >= LIMIT.darkRect) bad.push({ frame: i + 1, undrawn: lows.join(', '), dark: +dark.toFixed(3) });
  });
  return { bad, worstDark };
}

/** Edge map: luma step to the right or below larger than 30. */
function edges(rgb, box) {
  const r = clampBox(box);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const map = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = ((r.y0 + y) * W + r.x0 + x) * 3;
      const v = lumaAt(rgb, i);
      const dx = Math.abs(v - lumaAt(rgb, i + 3));
      const dy = Math.abs(v - lumaAt(rgb, i + W * 3));
      if (dx + dy > 30) map[y * w + x] = 1;
    }
  }
  return { map, w, h };
}
function dilate(e) {
  const out = new Uint8Array(e.map.length);
  for (let y = 0; y < e.h; y++) {
    for (let x = 0; x < e.w; x++) {
      if (!e.map[y * e.w + x]) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < e.w && ny < e.h) out[ny * e.w + nx] = 1;
        }
    }
  }
  return out;
}

async function saveStrip(frames, name, from = 0) {
  if (!dump || !frames.length) return;
  const pick = frames.slice(from, from + 30);
  const cellW = 131;
  const cellH = 284;
  const cols = 10;
  const tiles = [];
  for (let i = 0; i < pick.length; i++) {
    tiles.push({
      input: await sharp(pick[i].buf).resize(cellW, cellH, { fit: 'fill' }).png().toBuffer(),
      left: (i % cols) * cellW,
      top: Math.floor(i / cols) * cellH,
    });
  }
  await sharp({ create: { width: cols * cellW, height: Math.ceil(pick.length / cols) * cellH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(tiles)
    .png()
    .toFile(`${dump}/${name}.png`);
}

/** The first frame after the tap that moved in the region, in ms after the tap. */
async function firstMoved(frames, tapAt, box) {
  const before = frames.filter((f) => f.t < tapAt).pop();
  if (!before) return { ms: null, why: 'no frame before the tap' };
  const ref = await rgbOf(before);
  for (const f of frames.filter((fr) => fr.t >= tapAt)) {
    const share = movedShare(ref, await rgbOf(f), box);
    if (share * clampBox(box).n >= LIMIT.regionPixels) return { ms: f.t - tapAt, share, frame: f };
  }
  return { ms: null, why: 'nothing moved' };
}

/** Spikes and stalls inside a window of frames where motion is expected. */
async function continuity(frames) {
  const out = { n: frames.length, spikes: [], stalls: [], median: 0, gap: 0 };
  if (frames.length < 4) return out;
  const steps = [];
  for (let i = 1; i < frames.length; i++) steps.push(meanStep(await rgbOf(frames[i - 1]), await rgbOf(frames[i])));
  const moving = steps.filter((s) => s > 0.05).sort((a, b) => a - b);
  out.median = moving.length ? moving[moving.length >> 1] : 0;
  for (let i = 1; i < frames.length - 1; i++) {
    const inStep = steps[i - 1];
    const outStep = steps[i];
    const across = meanStep(await rgbOf(frames[i - 1]), await rgbOf(frames[i + 1]));
    if (process.env.MOTION_FLASH && across < 0.5 * Math.min(inStep, outStep) && out.median > 0) console.log('flash', i, (Math.min(inStep, outStep) / out.median).toFixed(2), inStep.toFixed(1), outStep.toFixed(1), across.toFixed(1));
    if (out.median > 0 && Math.min(inStep, outStep) > LIMIT.spikeN * out.median && across < 0.5 * Math.min(inStep, outStep)) {
      out.spikes.push({ frame: i, in: +inStep.toFixed(2), out: +outStep.toFixed(2), across: +across.toFixed(2) });
    }
  }
  // Motion is expected from the first step to the last visible step (mean channel step > 1).
  // The spring tail moves a pixel at a time and the cast sends those frames sparsely.
  let last = steps.length - 1;
  while (last > 0 && steps[last] <= 1) last -= 1;
  const gaps = [];
  for (let i = 1; i <= last + 1 && i < frames.length; i++) gaps.push(frames[i].t - frames[i - 1].t);
  const sorted = [...gaps].sort((a, b) => a - b);
  out.gap = sorted.length ? sorted[sorted.length >> 1] : 0;
  const limit = Math.max(LIMIT.stallFloorMs, LIMIT.stallGaps * out.gap);
  // A stall is a hole inside motion: the picture moved visibly into the frame before
  // the hole and out of it. A late single change after the picture had stopped is not one.
  gaps.forEach((g, i) => {
    const before = i === 0 ? true : steps[i - 1] > 1;
    const after = steps[i] > 1;
    if (g > limit && before && after) out.stalls.push({ frame: i + 1, ms: Math.round(g) });
  });
  out.limit = Math.round(limit);
  if (process.env.MOTION_DEBUG) console.log('steps', steps.map((v) => v.toFixed(1)).join(','), 'gaps', gaps.map(Math.round).join(','));
  return out;
}

/** Colours for the tap mark, one per tap so each tap has its own first frame. */
const MARKS = [
  [255, 0, 255],
  [0, 255, 0],
  [0, 255, 255],
  [255, 255, 0],
];
let markIndex = 0;

/** The first frame after the tap: the first one that carries this tap's mark. */
async function markFrame(frames, tapAt, color) {
  for (const f of frames) {
    if (f.t < tapAt) continue;
    const rgb = await rgbOf(f);
    const i = ((H - 2) * W + (W - 2)) * 3;
    if (Math.abs(rgb[i] - color[0]) < 70 && Math.abs(rgb[i + 1] - color[1]) < 70 && Math.abs(rgb[i + 2] - color[2]) < 70) return f;
  }
  return null;
}

/**
 * Tap time judged against the first frame the engine drew after the tap.
 * Playwright WebKit on Windows paints in software and delivers a frame 45 ms
 * (blank page) to 150 ms (library, density 2) after any change, so the wall
 * time from the tap mixes the app with the harness. The pointerdown puts a
 * 6 px mark in the corner; the frame that first carries it is the first frame
 * after the tap. The row is the time from that frame to the first moved frame.
 * Both wall times are printed.
 */
async function tapRow(browserName, label, frames, tap, box) {
  const hit = await firstMoved(frames, tap.at, box);
  const first = await markFrame(frames, tap.at, tap.mark);
  if (hit.ms == null || !first) {
    note(`${browserName} D28 tap-to-motion`, false, `${label} ${hit.ms == null ? hit.why : 'no frame with the tap mark'}`);
    return { hit, app: null };
  }
  const firstMs = first.t - tap.at;
  const app = Math.max(0, hit.ms - firstMs);
  note(`${browserName} D28 tap-to-motion`, app <= LIMIT.tapMs, `${label} ${Math.round(app)} ms after the first frame (moved at ${Math.round(hit.ms)} ms, first frame at ${Math.round(firstMs)} ms of wall time)`);
  return { hit, app, firstMs };
}

async function tapCenter(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no ${selector}`);
  const mark = MARKS[markIndex++ % MARKS.length];
  await page.evaluate((c) => {
    window.__mark = c;
  }, mark);
  const before = await page.evaluate(() => window.__taps.length);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const at = await page.evaluate((n) => window.__taps[n] ?? null, before);
  const up = await page.evaluate((n) => window.__ups[n] ?? null, before);
  if (process.env.MOTION_DEBUG) console.log(`tap ${selector} down->up ${up != null && at != null ? Math.round(up - at) : '?'} ms`);
  return { at, up, mark, box: { x: box.x, y: box.y, w: box.width, h: box.height } };
}

async function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function openSong(page, t = 42) {
  await page.goto(`${base}/song/karitas?t=${t}`, { waitUntil: 'networkidle' });
  await page.locator('.player').waitFor({ timeout: 8000 });
  await settle(page);
}

const report = {};

async function runLibrarySong(browser, browserName) {
  const context = await newPhone(browser, browserName);
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await settle(page);
  const cast = await startCast(page);
  await page.waitForTimeout(400);
  const tap = await tapCenter(page, '.lib-hero');
  await page.waitForTimeout(1600);
  const player = await boxOf(page, '.player');
  await cast.stop();
  const frames = cast.frames;
  const heroArt = tap.box;
  // The flight region: the card the cover leaves and the header band it lands in.
  const region = { x: 0, y: 0, w: W, h: Math.min(H, heroArt.y + heroArt.h) };
  const row = await tapRow(browserName, 'library-song', frames, tap, region);
  const after = frames.filter((f) => f.t >= tap.at);
  report[`${browserName}-library-song`] = { tap: row.hit.ms, first: row.firstMs, app: row.app, frames: after.length };
  await saveStrip(after, `${browserName}-library-song`);
  // Continuity of the flight.
  const flight = after.filter((f) => f.t <= tap.at + 1400);
  const c = await continuity(flight);
  // Two transport rows: the outgoing library and the arriving floor drawn in the same box at once.
  let double = { worst: 0, frame: -1 };
  const pre = frames.filter((f) => f.t < tap.at).pop();
  const last = frames[frames.length - 1];
  if (pre && last && player) {
    const box = { x: player.x, y: player.y, w: player.w, h: player.h };
    const L = edges(await rgbOf(pre), box);
    const P = edges(await rgbOf(last), box);
    const nearL = dilate(L);
    const nearP = dilate(P);
    const onlyL = [];
    const onlyP = [];
    for (let k = 0; k < L.map.length; k++) {
      if (L.map[k] && !nearP[k]) onlyL.push(k);
      if (P.map[k] && !nearL[k]) onlyP.push(k);
    }
    for (let i = 0; i < flight.length; i++) {
      const F = dilate(edges(await rgbOf(flight[i]), box));
      const keepL = onlyL.length ? onlyL.filter((k) => F[k]).length / onlyL.length : 0;
      const keepP = onlyP.length ? onlyP.filter((k) => F[k]).length / onlyP.length : 0;
      const both = Math.min(keepL, keepP);
      if (both > double.worst) double = { worst: both, frame: i + 1, keepL, keepP };
    }
  }
  report[`${browserName}-library-song`].continuity = c;
  if (process.env.MOTION_DEBUG) {
    const gaps = flight.slice(1).map((f, i) => Math.round(f.t - flight[i].t));
    console.log(`${browserName} flight gaps ${gaps.join(',')}`);
  }
  report[`${browserName}-library-song`].double = double;
  return { c, double, context };
}

async function runPlayAndLine(browser, browserName) {
  const context = await newPhone(browser, browserName);
  const page = await context.newPage();
  // 0.8 s before the next sung line (46.82 s), so the line changes while the cast runs.
  await openSong(page, 46);
  const cast = await startCast(page);
  await page.waitForTimeout(400);
  const stage = await boxOf(page, '.scene-stage');
  const disc = await boxOf(page, '.player .btn-ring');
  if (!disc || !stage) throw new Error('no disc or stage');
  const play = await tapCenter(page, '.player .btn-ring');
  await page.waitForTimeout(2200);
  const pause = await tapCenter(page, '.player .btn-ring');
  await page.waitForTimeout(800);
  await cast.stop();
  const frames = cast.frames;
  // The response to the tap is drawn on the disc first: the press, then the glyph.
  const box = { x: disc.x - 10, y: disc.y - 10, w: disc.w + 20, h: disc.h + 20 };
  const playRow = await tapRow(browserName, 'play', frames, play, box);
  const pauseRow = await tapRow(browserName, 'pause', frames, pause, box);
  const stageHit = await firstMoved(frames, play.at, stage);
  // The line change, between the two taps.
  const lineFrames = frames.filter((f) => f.t >= play.at && f.t < pause.at);
  const c = await continuity(lineFrames);
  report[`${browserName}-play`] = { play: playRow.app, pause: pauseRow.app, stage: stageHit.ms, continuity: c };
  await saveStrip(lineFrames, `${browserName}-play`);
  await context.close();
  return c;
}

async function runSettings(browser, browserName) {
  const context = await newPhone(browser, browserName);
  const page = await context.newPage();
  await openSong(page);
  const player = await boxOf(page, '.player');
  const cast = await startCast(page);
  await page.waitForTimeout(400);
  const tap = await tapCenter(page, 'button[aria-label="Настройки"]');
  await page.waitForTimeout(1400);
  await cast.stop();
  const frames = cast.frames;
  const region = { x: 0, y: H * 0.35, w: W, h: H * 0.65 };
  // The sheet is up when a quarter of the band over the floor has changed.
  const pre = frames.filter((f) => f.t < tap.at).pop();
  let up = null;
  if (pre && player) {
    const band = { x: 0, y: H * 0.45, w: W, h: Math.max(40, player.y - H * 0.45) };
    const ref = await rgbOf(pre);
    for (const f of frames.filter((fr) => fr.t >= tap.at)) {
      if (movedShare(ref, await rgbOf(f), band) >= 0.25) {
        up = f.t - tap.at;
        break;
      }
    }
  }
  const row = await tapRow(browserName, `settings (sheet up at ${up == null ? 'never' : Math.round(up) + ' ms'} of wall time)`, frames, tap, region);
  report[`${browserName}-settings`] = { tap: row.hit.ms, first: row.firstMs, app: row.app, sheetUp: up };
  await saveStrip(frames.filter((f) => f.t >= tap.at), `${browserName}-settings`);
  await context.close();
}

async function runScrub(browser, browserName) {
  const context = await newPhone(browser, browserName);
  const page = await context.newPage();
  await openSong(page);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('audio')) {
      try {
        el.pause();
      } catch {
        /* not playing */
      }
    }
  });
  const track = await boxOf(page, '.scrub-track');
  const player = await boxOf(page, '.player');
  const header = await boxOf(page, '.topbar');
  if (!track || !player || !header) {
    note(`${browserName} D29 scrub-no-blank`, false, 'no track, player or header');
    await context.close();
    return null;
  }
  const cast = await startCast(page);
  await page.waitForTimeout(400);
  const y = track.y + track.h / 2;
  const x0 = track.x + 6;
  const x1 = track.x + track.w * 0.97;
  const positions = 36;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const downAt = Date.now();
  for (let i = 1; i <= positions; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / positions, y);
    await page.waitForTimeout(i % 9 === 0 ? 320 : 70);
  }
  // Back to the qanun break and let go there.
  const xq = track.x + track.w * (705 / 977);
  await page.mouse.move(xq, y, { steps: 4 });
  await page.waitForTimeout(160);
  const upAt = Date.now();
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await cast.stop();
  const frames = cast.frames.filter((f) => f.t >= downAt - 20);
  const pre = cast.frames.filter((f) => f.t < downAt).pop();
  if (!pre || frames.length < 10) {
    note(`${browserName} D29 scrub-no-blank`, false, `frames ${frames.length}`);
    await context.close();
    return null;
  }
  const list = [];
  for (const f of frames) list.push(await rgbOf(f));
  const { bad, worstDark } = judgeDrawn(list, player, header);
  report[`${browserName}-scrub`] = { frames: frames.length, positions, bad, worstDark };
  note(
    `${browserName} D29 scrub-no-blank`,
    bad.length === 0,
    `frames ${frames.length} positions ${positions} undrawn ${bad.length} dark ${worstDark.toFixed(3)}${bad[0] ? ' first ' + JSON.stringify(bad[0]) : ''}`,
  );
  await saveStrip(frames, `${browserName}-scrub`);
  if (bad.length && dump) await sharp(frames[bad[0].frame - 1].buf).toFile(`${dump}/${browserName}-scrub-bad.png`);
  const settleFrames = cast.frames.filter((f) => f.t >= upAt - 1 && f.t <= upAt + 1200);
  const before = cast.frames.filter((f) => f.t < upAt).pop();
  const c = await continuity([before, ...settleFrames].filter(Boolean));
  report[`${browserName}-scrub`].continuity = c;
  await context.close();
  return c;
}

/** The settled engraving at 11:45 (qanun): edges inside its plate box. */
async function engravingEdges(browser, browserName) {
  const context = await newPhone(browser, browserName);
  const page = await context.newPage();
  await openSong(page, 705);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('audio')) {
      try {
        el.pause();
      } catch {
        /* not playing */
      }
    }
  });
  await page.waitForTimeout(900);
  const box = await page.evaluate(() => {
    let best = null;
    for (const el of document.querySelectorAll('.scene-view .ist-art-mount, .scene-view .ist-art')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (!best || r.width * r.height > best.w * best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return best;
  });
  if (!box) {
    await context.close();
    return null;
  }
  const shot = await page.screenshot({ type: 'png' });
  if (dump) await sharp(shot).toFile(`${dump}/${browserName}-engraving.png`);
  const rgb = await sharp(shot).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  // Inside the silhouette only: the bright pixels and their neighbours. A flat fill has edges on its rim only.
  const r = clampBox(box);
  let bright = 0;
  let inner = 0;
  for (let y = r.y0 + 1; y < r.y1 - 1; y++) {
    for (let x = r.x0 + 1; x < r.x1 - 1; x++) {
      const i = (y * W + x) * 3;
      const v = lumaAt(rgb, i);
      if (v < 110) continue;
      bright += 1;
      const around = [i - 3, i + 3, i - W * 3, i + W * 3].map((k) => lumaAt(rgb, k));
      if (around.some((u) => Math.abs(u - v) > 30)) inner += 1;
    }
  }
  await context.close();
  return { density: bright ? inner / bright : 0, bright };
}

/**
 * D29's judge on a recorded contact sheet (cells 180 px wide, 10 per row), for frames
 * that cannot be replayed: --contact work/studio/video19/chromium-scrub-contact.png.
 * Header and player are the phone bands (top 60, bottom 188 of 852); cell 1 is the reference.
 */
async function judgeContact(file) {
  const meta = await sharp(file).metadata();
  const cellW = 180;
  const cellH = Math.round((cellW * H) / W);
  const cols = 10;
  const rows = Math.floor((meta.height || 0) / cellH);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const buf = await sharp(file).extract({ left: c * cellW, top: r * cellH, width: cellW, height: cellH }).toBuffer();
      const rgb = await sharp(buf).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      // An empty cell after the last frame is the sheet's own background.
      if (inkShare(rgb, { x: 0, y: 0, w: W, h: H }) < 0.002) continue;
      cells.push(rgb);
    }
  }
  const header = { x: 0, y: 0, w: W, h: 60 };
  const player = { x: 0, y: H - 188, w: W, h: 188 };
  const { bad } = judgeDrawn(cells, player, header);
  // D30 on the same cells. The sheet is one frame per ~100 ms, so only spikes are judged here.
  const seq = cells.map((rgb, i) => ({ t: i * 100, rgb }));
  const c = await continuity(seq);
  note(`contact D30 continuity`, c.spikes.length === 0, `${file} frames ${c.n} median step ${c.median.toFixed(2)} spikes ${c.spikes.length} ${c.spikes.map((x) => JSON.stringify(x)).join(' ')}`);
  note(`contact D29 scrub-no-blank`, bad.length === 0, `${file} frames ${cells.length} undrawn ${bad.length} ${bad.map((b) => JSON.stringify(b)).join(' ')}`);
}

if (args.contact) {
  await judgeContact(args.contact);
  const failedContact = results.filter((row) => !row.ok);
  process.exit(failedContact.length ? 1 : 0);
}

const engines = [];
if (!engineOnly || engineOnly === 'chromium') engines.push(['chromium', chromium]);
if (!engineOnly || engineOnly === 'webkit') engines.push(['webkit', webkit]);
const edgesBy = {};
for (const [name, type] of engines) {
  const browser = await type.launch();
  try {
    if (!only || only === 'D28' || only === 'D30' || only === 'D31') {
      const flight = await runLibrarySong(browser, name);
      await flight.context.close();
      note(
        `${name} D31 one-transport-row`,
        flight.double.worst <= LIMIT.doubleShare,
        `worst ${flight.double.worst.toFixed(2)}${flight.double.frame > 0 ? ' frame ' + flight.double.frame + ' (library ' + flight.double.keepL.toFixed(2) + ', floor ' + flight.double.keepP.toFixed(2) + ')' : ''}`,
      );
      const line = only === 'D31' ? null : await runPlayAndLine(browser, name);
      if (only !== 'D31') await runSettings(browser, name);
      const scrub = only === 'D31' ? null : await runScrub(browser, name);
      const rows = [
        ['flight', flight.c],
        ['line', line],
        ['scrub-settle', scrub],
      ].filter(([, c]) => c);
      for (const [label, c] of rows) {
        note(
          `${name} D30 continuity`,
          c.spikes.length === 0 && c.stalls.length === 0,
          `${label} frames ${c.n} median step ${c.median.toFixed(2)} gap ${Math.round(c.gap)} ms spikes ${c.spikes.length} stalls ${c.stalls.length}${c.stalls[0] ? ' (' + c.stalls.map((s) => s.ms).join(',') + ' ms > ' + c.limit + ')' : ''}${c.spikes[0] ? ' ' + JSON.stringify(c.spikes[0]) : ''}`,
        );
      }
    } else if (only === 'D29') {
      await runScrub(browser, name);
    }
    if (!only || only === 'D32') edgesBy[name] = await engravingEdges(browser, name);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    note(`${name} D-motion crash`, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await browser.close();
}
if (!only || only === 'D32') {
  const values = Object.entries(edgesBy);
  const ds = values.map(([, v]) => (v ? v.density : 0));
  const ratio = ds.length === 2 && Math.min(...ds) > 0 ? Math.max(...ds) / Math.min(...ds) : ds.length === 2 ? 99 : 1;
  for (const [name, v] of values) {
    note(
      `${name} D32 engraving-edges-match`,
      !!v && v.density >= LIMIT.edgeFloor && ratio <= LIMIT.edgeRatio,
      v ? `inner edges ${v.density.toFixed(3)} of ${v.bright} lit px, engine ratio ${ratio.toFixed(2)}` : 'no engraving',
    );
  }
}
if (dump) writeFileSync(`${dump}/motion.json`, JSON.stringify(report, (k, v) => (k === 'rgb' || k === 'buf' ? undefined : v), 2));
const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} motion checks passed`);
if (failed.length) process.exit(1);
