/**
 * The player and the lyric column keep one place for a whole song.
 *
 * Seeks with a step of 1 s (For True Lovers and Alive), at 1440×900 and 390×844,
 * with commentary on and off. The column is `.scene-stage`. A jump is anything
 * over 0.01 px between neighbouring samples in the player box or the column box:
 * that is float noise, not a visible step. The current line travels vertically
 * inside the column and scales as it becomes current; those axes are not read.
 * What is read for it is the horizontal centre of its block, which stays in the
 * middle of the column. 0:04 and 0:40 are read again after the playhead has
 * settled, and those two frames must match.
 *
 * Three instrumental notes (Karitas intro, ONE inst-1, I Have Come Alive
 * inst-tanbur) are opened at 1100, 1280, 1440 and 1920. The comment card and
 * the engraving, its caption and the section note must not meet. The engraving
 * box is read again on a neighbouring passage that has no note of its own:
 * its horizontal place must be the same, so the card appearing does not move it.
 * Frames for 1100 and 1440 land in `_artifacts/t38-steady/after2/`.
 *
 *   npm run test:position
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;

const SONGS = [
  { slug: 'for-true-lovers', step: 1 },
  { slug: 'alive', step: 1 },
] as const;

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

const MODES = [
  { name: 'comment-on', showComment: true },
  { name: 'comment-off', showComment: false },
] as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Sample {
  player: Box;
  stage: Box;
  cx: number | null;
  overlap: number;
  playerOverlap: number;
  hasComment: boolean;
}

interface Sweep {
  jumps: { t: number; from: number; deltas: string[] }[];
  worst: number;
  worstWhere: string;
  marks: Record<string, Sample>;
  count: number;
  maxOverlap: number;
  maxPlayerOverlap: number;
}

/** Past this, a player or column edge has moved. Smaller differences are float noise. */
const JUMP = 0.01;

interface ArtBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EngravingFrame {
  overlap: number;
  which: string;
  hasComment: boolean;
  ist: ArtBox | null;
  stageW: number;
}

const ENGRAVINGS = [
  { slug: 'karitas', section: 'intro', t: 1, neighbour: 8 },
  { slug: 'one', section: 'inst-1', t: 270, neighbour: 329 },
  { slug: 'i-have-come-alive', section: 'inst-tanbur', t: 40, neighbour: 15 },
] as const;

const ENGRAVING_WIDTHS = [1100, 1280, 1440, 1920] as const;
const SHOT_DIR = join('_artifacts', 't38-steady', 'after2');

/**
 * Runs in the page. Kept as a string so tsx does not inject `__name` into the
 * function Playwright serialises for the browser.
 */
const sweepInPage = eval(`(async function sweepInPage(stepSize) {
  const track = document.querySelector('.scrub-track');
  if (!(track instanceof HTMLElement)) throw new Error('no scrubber');
  const fiberKey = Object.keys(track).find((k) => k.startsWith('__reactFiber$'));
  let fiber = fiberKey ? track[fiberKey] : null;
  let onSeek = null;
  const seen = new Set();
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    if (typeof fiber.memoizedProps?.onSeek === 'function') onSeek = fiber.memoizedProps.onSeek;
    fiber = fiber.return || null;
  }
  if (!onSeek) throw new Error('scrubber onSeek was not found');
  const max = Number(track.getAttribute('aria-valuemax'));
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const overlapOf = (a, b) => {
    if (!a || !b || a.width < 1 || b.width < 1) return 0;
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 0 && y > 0 ? Math.min(x, y) : 0;
  };
  const read = () => {
    const playerEl = document.querySelector('.player');
    const stageEl = document.querySelector('.scene-stage');
    if (!(playerEl instanceof HTMLElement) || !(stageEl instanceof HTMLElement)) throw new Error('player or stage missing');
    const player = playerEl.getBoundingClientRect();
    const stage = stageEl.getBoundingClientRect();
    const blocks = [...document.querySelectorAll('.fb--line, .fb--inst, .fb--intro')];
    let cur = null;
    let best = -1;
    for (const el of blocks) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const op = parseFloat(cs.opacity);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (op > best) {
        best = op;
        cur = el;
      }
    }
    const cr = cur ? cur.getBoundingClientRect() : null;
    const comment = document.querySelector('.comment');
    const commentR = comment ? comment.getBoundingClientRect() : null;
    const pieces = cur ? [...cur.querySelectorAll('.fb-orig, .fb-subs, .ist, .fb-inst-art')] : [];
    let contentOverlap = 0;
    for (const piece of pieces) contentOverlap = Math.max(contentOverlap, overlapOf(commentR, piece.getBoundingClientRect()));
    return {
      player: { x: player.x, y: player.y, w: player.width, h: player.height },
      stage: { x: stage.x, y: stage.y, w: stage.width, h: stage.height },
      cx: cr ? cr.x + cr.width / 2 : null,
      overlap: contentOverlap,
      playerOverlap: overlapOf(commentR, player),
      hasComment: document.querySelector('.song')?.classList.contains('has-comment') ?? false,
    };
  };
  const JUMP = 0.01;
  const jumps = [];
  let worst = 0;
  let worstWhere = '';
  const note = (name, delta) => {
    if (delta > worst) {
      worst = delta;
      worstWhere = name;
    }
  };
  let maxOverlap = 0;
  let maxPlayerOverlap = 0;
  const marks = {};
  let prev = null;
  const last = Math.max(0, Math.floor(max - 1));
  for (let t = 0; t <= last; t += stepSize) {
    onSeek(t);
    await frames();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const sample = read();
    maxOverlap = Math.max(maxOverlap, sample.overlap);
    maxPlayerOverlap = Math.max(maxPlayerOverlap, sample.playerOverlap);
    if (t === 4 || t === 40) marks[String(t)] = sample;
    if (prev) {
      const deltas = [];
      for (const key of ['x', 'y', 'w', 'h']) {
        const dp = Math.abs(sample.player[key] - prev.player[key]);
        const ds = Math.abs(sample.stage[key] - prev.stage[key]);
        if (dp > JUMP) deltas.push('player.' + key + ' ' + prev.player[key].toFixed(2) + ' → ' + sample.player[key].toFixed(2));
        if (ds > JUMP) deltas.push('stage.' + key + ' ' + prev.stage[key].toFixed(2) + ' → ' + sample.stage[key].toFixed(2));
        note('player.' + key, dp);
        note('stage.' + key, ds);
      }
      if (sample.cx != null && prev.cx != null) {
        const dc = Math.abs(sample.cx - prev.cx);
        if (dc > JUMP) deltas.push('line.cx ' + prev.cx.toFixed(2) + ' → ' + sample.cx.toFixed(2));
        note('line.cx', dc);
      } else if (sample.cx == null || prev.cx == null) {
        deltas.push('line missing');
        note('line.missing', 1);
      }
      if (deltas.length) jumps.push({ t, from: t - stepSize, deltas });
    }
    prev = sample;
    if (t % 120 === 0) console.log('  t=' + t);
  }
  const settle = async (t) => {
    onSeek(t);
    await frames();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await frames();
    return read();
  };
  if (last >= 40) {
    const a = await settle(4);
    const b = await settle(40);
    marks['4'] = a;
    marks['40'] = b;
    maxOverlap = Math.max(maxOverlap, a.overlap, b.overlap);
    maxPlayerOverlap = Math.max(maxPlayerOverlap, a.playerOverlap, b.playerOverlap);
    const deltas = [];
    for (const key of ['x', 'y', 'w', 'h']) {
      const dp = Math.abs(b.player[key] - a.player[key]);
      const ds = Math.abs(b.stage[key] - a.stage[key]);
      if (dp > JUMP) deltas.push('settled player.' + key + ' ' + a.player[key].toFixed(2) + ' → ' + b.player[key].toFixed(2));
      if (ds > JUMP) deltas.push('settled stage.' + key + ' ' + a.stage[key].toFixed(2) + ' → ' + b.stage[key].toFixed(2));
      note('settled player.' + key, dp);
      note('settled stage.' + key, ds);
    }
    if (a.cx != null && b.cx != null) {
      const dc = Math.abs(b.cx - a.cx);
      if (dc > JUMP) deltas.push('settled line.cx ' + a.cx.toFixed(2) + ' → ' + b.cx.toFixed(2));
      note('settled line.cx', dc);
    } else {
      deltas.push('settled line missing');
      note('settled line.missing', 1);
    }
    if (deltas.length) jumps.push({ t: 40, from: 4, deltas });
  }
  return { jumps, worst, worstWhere, marks, count: Math.floor(last / stepSize) + 1, maxOverlap, maxPlayerOverlap };
})`) as (stepSize: number) => Promise<Sweep>;

/**
 * Comment card against the engraving at two times. The second time is a
 * neighbouring passage with no note of its own. Kept as a string so tsx does
 * not inject `__name` into the function Playwright serialises.
 */
const engravingInPage = eval(`(async function engravingInPage(times) {
  const track = document.querySelector('.scrub-track');
  if (!(track instanceof HTMLElement)) throw new Error('no scrubber');
  const fiberKey = Object.keys(track).find((k) => k.startsWith('__reactFiber$'));
  let fiber = fiberKey ? track[fiberKey] : null;
  let onSeek = null;
  const seen = new Set();
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    if (typeof fiber.memoizedProps?.onSeek === 'function') onSeek = fiber.memoizedProps.onSeek;
    fiber = fiber.return || null;
  }
  if (!onSeek) throw new Error('scrubber onSeek was not found');
  const overlapOf = (a, b) => {
    if (!a || !b || a.width < 1 || b.width < 1) return 0;
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return x > 0 && y > 0 ? Math.min(x, y) : 0;
  };
  const read = () => {
    const blocks = [...document.querySelectorAll('.fb--line, .fb--inst, .fb--intro')];
    let cur = null;
    let best = -1;
    for (const el of blocks) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const op = parseFloat(cs.opacity);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (op > best) {
        best = op;
        cur = el;
      }
    }
    const comment = document.querySelector('.comment');
    const commentR = comment ? comment.getBoundingClientRect() : null;
    const pieces = cur ? [...cur.querySelectorAll('.eng, .ist-label, .ist-plate, .fb-inst-text')] : [];
    let overlap = 0;
    let which = '';
    for (const piece of pieces) {
      const n = overlapOf(commentR, piece.getBoundingClientRect());
      if (n > overlap) {
        overlap = n;
        which = piece.className && piece.className.baseVal !== undefined ? 'svg' : String(piece.className || piece.tagName);
      }
    }
    const ist = cur ? cur.querySelector('.ist') : document.querySelector('.ist');
    const ir = ist ? ist.getBoundingClientRect() : null;
    const stage = document.querySelector('.scene-stage');
    return {
      overlap,
      which,
      hasComment: document.querySelector('.song')?.classList.contains('has-comment') ?? false,
      ist: ir ? { x: ir.x, y: ir.y, w: ir.width, h: ir.height } : null,
      stageW: stage ? stage.getBoundingClientRect().width : 0,
    };
  };
  const currentBlock = () => {
    const blocks = [...document.querySelectorAll('.fb--line, .fb--inst, .fb--intro')];
    let cur = null;
    let best = -1;
    for (const el of blocks) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const op = parseFloat(cs.opacity);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (op > best) {
        best = op;
        cur = el;
      }
    }
    return cur;
  };
  const settle = async (t) => {
    onSeek(t);
    // The passage we just left still has its plate for a frame. Wait until the
    // block that is current now holds one, and that stays true for a few frames.
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const cur = currentBlock();
      const plate = cur ? cur.querySelector('.ist-plate') : null;
      const ready = !!(plate && plate.getBoundingClientRect().height > 20);
      stable = ready ? stable + 1 : 0;
      if (stable >= 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    return read();
  };
  const here = await settle(times.t);
  const there = await settle(times.neighbour);
  await settle(times.t);
  return { here, there };
})`) as (times: { t: number; neighbour: number }) => Promise<{ here: EngravingFrame; there: EngravingFrame }>;

function startVite(): ChildProcess {
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(child: ChildProcess) {
  const started = Date.now();
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  while (Date.now() - started < 30_000) {
    if (child.exitCode != null) throw new Error(`vite exited ${child.exitCode}\n${log}`);
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite did not start\n${log}`);
}

function stopVite(child: ChildProcess) {
  if (child.exitCode != null) return;
  child.kill();
}

function sweep(page: Page, step: number): Promise<Sweep> {
  return page.evaluate(sweepInPage, step);
}

function boxLine(label: string, box: Box | undefined) {
  if (!box) return `${label}: —`;
  const n = (v: number) => v.toFixed(1);
  return `${label}: x=${n(box.x)} y=${n(box.y)} w=${n(box.w)} h=${n(box.h)}`;
}

async function main() {
  const vite = startVite();
  let browser: Browser | null = null;
  let failed = 0;
  try {
    await waitForServer(vite);
    browser = await chromium.launch();
    for (const viewport of VIEWPORTS) {
      for (const mode of MODES) {
        for (const song of SONGS) {
          const title = `${song.slug} ${viewport.name}×${viewport.height} ${mode.name} step ${song.step}s`;
          console.log(`\n${title}`);
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: 'light',
          });
          await context.addInitScript((on: boolean) => {
            localStorage.setItem(
              'living-lyrics.settings.v2',
              JSON.stringify({ showComment: on, commentOpen: false, textAlign: 'center', lineEntrance: 'settle' }),
            );
          }, mode.showComment);
          const page = await context.newPage();
          page.on('console', (msg) => {
            if (msg.text().startsWith('  t=')) console.log(msg.text());
          });
          await page.route('**/*.m4a', (route) => route.abort());
          await page.goto(`${BASE}/song/${song.slug}?t=0`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.scrub-track', { timeout: 20_000 });
          await page.evaluate(() => document.fonts.ready);
          const result = await sweep(page, song.step);
          const at4 = result.marks['4'];
          const at40 = result.marks['40'];
          if (song.slug === 'for-true-lovers') {
            console.log(`  0:04 ${boxLine('player', at4?.player)} | ${boxLine('stage', at4?.stage)} cx=${at4?.cx?.toFixed(1) ?? '—'} comment=${at4?.hasComment ?? '—'}`);
            console.log(`  0:40 ${boxLine('player', at40?.player)} | ${boxLine('stage', at40?.stage)} cx=${at40?.cx?.toFixed(1) ?? '—'} comment=${at40?.hasComment ?? '—'}`);
          }
          console.log(`  samples=${result.count} jumps=${result.jumps.length} worst=${result.worst.toFixed(3)}px (${result.worstWhere || '—'}) overlap=${result.maxOverlap.toFixed(1)} playerOverlap=${result.maxPlayerOverlap.toFixed(1)}`);
          for (const jump of result.jumps.slice(0, 8)) {
            console.log(`  jump ${jump.from}s → ${jump.t}s: ${jump.deltas.join('; ')}`);
          }
          if (result.jumps.length > 8) console.log(`  … ${result.jumps.length - 8} more jumps`);
          const overlap = result.maxOverlap >= 1 || result.maxPlayerOverlap >= 1;
          if (result.jumps.length || overlap) {
            failed += 1;
            console.log(`  FAIL`);
          } else {
            console.log(`  PASS`);
          }
          await context.close();
        }
      }
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    for (const width of ENGRAVING_WIDTHS) {
      for (const song of ENGRAVINGS) {
        const title = `${song.slug} ${song.section} ${width}×900 t=${song.t}s`;
        console.log(`\n${title}`);
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
        await context.addInitScript(() => {
          localStorage.setItem(
            'living-lyrics.settings.v2',
            JSON.stringify({ showComment: true, commentOpen: false, textAlign: 'center', lineEntrance: 'settle' }),
          );
        });
        const page = await context.newPage();
        await page.route('**/*.m4a', (route) => route.abort());
        await page.goto(`${BASE}/song/${song.slug}?t=${song.t}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.scrub-track', { timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready);
        const frames = await page.evaluate(engravingInPage, { t: song.t, neighbour: song.neighbour });
        const here = frames.here;
        const there = frames.there;
        const n = (v: number) => v.toFixed(2);
        console.log(`  card overlap=${n(here.overlap)}px (${here.which || '—'}) comment=${here.hasComment} stage=${n(here.stageW)} art=${here.ist ? `x=${n(here.ist.x)} w=${n(here.ist.w)}` : '—'}`);
        console.log(`  neighbour t=${song.neighbour}s art=${there.ist ? `x=${n(there.ist.x)} w=${n(there.ist.w)}` : '—'} comment=${there.hasComment}`);
        if (width === 1100 || width === 1440) {
          const file = join(SHOT_DIR, `${song.slug}-${song.section}-${width}.png`);
          await page.screenshot({ path: file });
          console.log(`  shot ${file}`);
        }
        const dx = here.ist && there.ist ? Math.abs(here.ist.x - there.ist.x) : Infinity;
        const dw = here.ist && there.ist ? Math.abs(here.ist.w - there.ist.w) : Infinity;
        console.log(`  art shift x=${dx === Infinity ? '—' : n(dx)}px w=${dw === Infinity ? '—' : n(dw)}px`);
        const overlap = here.overlap > 0 || !here.hasComment || !here.ist || !there.ist || dx > JUMP || dw > JUMP;
        if (overlap) {
          failed += 1;
          console.log('  FAIL');
        } else {
          console.log('  PASS');
        }
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    stopVite(vite);
  }
  if (failed) {
    console.error(`\n${failed} run(s) failed`);
    process.exit(1);
  }
  console.log('\nall runs held their place');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
