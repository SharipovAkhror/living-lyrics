// Sheets and motion recordings for the studio pass.
// Sheets: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --tag round10 --sheets work/studio/sheets10
// Videos: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --videos work/studio/video10
// Each clip is at least 6s, with a 1s hold before and after the action.
// Chromium slows CSS through CDP (playback rate 0.25). Both engines slow springs with ?slowmo=4.
// WebKit also sets ?anims=4, because it has no CDP playback rate. Contact sheets are a second, unscaled pass.
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { installResolvedAudio, installWebKitClock, prepareAudio } from '../perf/lib.mjs';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function audioKeyPresent() {
  if (!existsSync('.env.local')) return false;
  return /^AUDIO_KEY=\S+/m.test(readFileSync('.env.local', 'utf8'));
}

const standIn = !audioKeyPresent();
const durations = new Map();
if (standIn) {
  for (const slug of readdirSync('content/songs')) {
    const file = `content/songs/${slug}/song.json`;
    if (!existsSync(file)) continue;
    const song = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof song.duration === 'number' && song.duration > 1) durations.set(slug, song.duration);
  }
}
const silence = new Map();

function silenceFor(url) {
  const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
  const seconds = durations.get(slug);
  if (!seconds) return null;
  const key = String(seconds);
  let hit = silence.get(key);
  if (!hit) {
    hit = prepareAudio(seconds, 'work/studio/silence');
    silence.set(key, hit);
    console.log(`${slug}: ${hit.label}`);
  }
  return hit;
}

async function installSilence(context) {
  if (!standIn) return;
  await installResolvedAudio(context, silenceFor);
  // Chromium plays the WAV. This WebKit build errors on every payload, so the
  // element is clocked and the load banner never fires.
  const engine = context.browser() ? context.browser().browserType().name() : '';
  if (engine === 'webkit') await installWebKitClock(context, Object.fromEntries(durations));
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const tag = args.tag || 'round9';
const only = args.only && args.only !== 'true' ? args.only : '';
const engineOnly = args.engine && args.engine !== 'true' ? args.engine : '';
const sheetDir = args.sheets && args.sheets !== 'true' ? args.sheets : '';
const videoDir = args.videos && args.videos !== 'true' ? args.videos : '';

const devices = [
  { name: 'se', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  { name: 'se375', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  { name: 'iphone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  { name: 'land-se', viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  { name: 'land-15', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  { name: 'ipad', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desk', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'wide', viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
];

const pages = [
  { name: 'library', path: '/' },
  { name: 'song', path: '/song/karitas?t=42' },
];

function slowUrl(path, browserName) {
  const url = new URL(path, base);
  // Contact sheets are the unscaled pass. `plain` leaves the clock alone.
  if (browserName === 'plain') return url.toString();
  url.searchParams.set('slowmo', '4');
  if (browserName === 'webkit') url.searchParams.set('anims', '4');
  return url.toString();
}

function dropHashVideos(dir) {
  for (const name of readdirSync(dir)) {
    if (/^[a-f0-9]{32}\.webm$/.test(name)) unlinkSync(`${dir}/${name}`);
  }
}

async function shoot(browser, device) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ ...device, colorScheme: scheme });
    await installSilence(context);
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror', device.name, err.message));
    for (const target of pages) {
      await page.goto(base + target.path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700);
      const file = `${sheetDir}/${tag}-${device.name}-${scheme}-${target.name}.png`;
      await page.screenshot({ path: file, fullPage: target.name === 'library' });
      console.log(file);
    }
    await context.close();
  }
}

async function sheetInView(page) {
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const box = dialog.getBoundingClientRect();
      return box.height > 120 && box.top < window.innerHeight - 40 && box.bottom > 80;
    },
    { timeout: 8000 },
  );
}

async function record(browserName, browser, device, name, run) {
  const context = await browser.newContext({
    ...device,
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: device.viewport.width, height: device.viewport.height } },
  });
  await installSilence(context);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('pageerror', name, err.message));
  if (browserName === 'chromium') {
    const client = await context.newCDPSession(page);
    await client.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
  }
  const started = Date.now();
  await run(page);
  const rest = 6000 - (Date.now() - started);
  if (rest > 0) await page.waitForTimeout(rest);
  const video = page.video();
  await page.close();
  await context.close();
  const dest = `${videoDir}/${browserName}-${name}-slow.webm`;
  const src = video ? await video.path() : '';
  if (video) await video.saveAs(dest);
  if (src) {
    try {
      unlinkSync(src);
    } catch {
      /* the named copy is the one we keep */
    }
  }
  dropHashVideos(videoDir);
  console.log(dest, `${Date.now() - started}ms`);
}

function stageProbe() {
  const stage = document.querySelector('.scene-stage');
  const play = document.querySelector('button.btn-xl');
  if (!stage) return { kind: 'empty', lines: 0, arts: 0, dragging: false, time: '', play: play?.getAttribute('aria-label') || '' };
  const box = stage.getBoundingClientRect();
  const seen = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (!(Number(style.opacity) > 0.04)) return false;
      const root = node.getRootNode();
      const next = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
      if (!next || next === node) break;
      node = next;
    }
    const rect = el.getBoundingClientRect();
    const top = Math.max(rect.top, box.top);
    const bottom = Math.min(rect.bottom, box.bottom);
    const left = Math.max(rect.left, box.left);
    const right = Math.min(rect.right, box.right);
    return bottom - top > 8 && right - left > 8;
  };
  let lines = 0;
  let arts = 0;
  const textOf = '.scene-view .fb--line .fb-orig, .scene-depart .fb--line .fb-orig, .scene-view .fb--intro .intro-title, .scene-depart .fb--intro .intro-title';
  for (const el of stage.querySelectorAll(textOf)) {
    const text = (el.textContent || '').replace(/\u200b/g, '').trim();
    if (text && seen(el)) lines += 1;
  }
  const walk = (root) => {
    for (const el of root.querySelectorAll('.ist-art, .ist-art-mount')) {
      if (el.classList.contains('ist-art') && seen(el)) arts += 1;
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(stage);
  const dragging = !!document.querySelector('.song.is-scrubbing');
  const time = document.querySelector('.scrub-now')?.textContent?.trim() || '';
  const kind = arts > 0 ? 'art' : lines > 0 ? 'line' : 'empty';
  let views = 0;
  for (const el of stage.querySelectorAll('.stage-view')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (Number(style.opacity) > 0.05) views += 1;
  }
  return { kind, lines, arts, views, dragging, time, play: play?.getAttribute('aria-label') || '' };
}

async function sample(page, body, watch) {
  const frames = [];
  const notes = [];
  let on = true;
  const pump = (async () => {
    while (on) {
      const t = Date.now();
      const buf = await page.screenshot({ type: 'jpeg', quality: 35, animations: 'disabled' }).catch(() => null);
      if (buf) {
        frames.push(buf);
        if (watch) notes.push(await page.evaluate(watch).catch((err) => ({ error: String(err && err.message ? err.message : err) })));
      }
      const wait = 100 - (Date.now() - t);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();
  try {
    await body();
  } finally {
    on = false;
    await pump;
  }
  return { frames, notes };
}

async function meanDiff(a, b, box, scale) {
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  const cut = async (buf) => {
    const meta = await sharp(buf).metadata();
    const w = Math.min(width, (meta.width || width) - left);
    const h = Math.min(height, (meta.height || height) - top);
    return sharp(buf).extract({ left, top, width: Math.max(1, w), height: Math.max(1, h) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const leftShot = await cut(a);
  const rightShot = await cut(b);
  const n = Math.min(leftShot.data.length, rightShot.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(leftShot.data[i] - rightShot.data[i]);
  return { mean: n ? sum / n : 0, pixels: Math.round(n / 3) };
}

async function compareSeek(page, browserName) {
  await page.evaluate(() => {
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
  });
  await page.waitForTimeout(120);
  const box = await page.locator('.scene-stage').boundingBox();
  const released = await page.evaluate(() => {
    const track = document.querySelector('.scrub-track');
    const exact = Number(track?.getAttribute('data-t'));
    const rounded = Number(track?.getAttribute('aria-valuenow'));
    return {
      now: Number.isFinite(exact) ? exact : rounded,
      label: document.querySelector('.scrub-now')?.textContent?.trim() || '',
    };
  });
  const releasedPng = await page.screenshot({ type: 'png', animations: 'disabled' });
  const seconds = Number.isFinite(released.now) ? released.now : 705;
  await page.goto(`${base}/song/karitas?t=${seconds}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // The halo arrives with features.json, about a second after the page mounts.
  await page
    .waitForFunction(
      () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/features.json') && entry.responseEnd > 0),
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
  });
  await page.waitForTimeout(120);
  const seekPng = await page.screenshot({ type: 'png', animations: 'disabled' });
  await writeFileSync(`${videoDir}/${browserName}-scrub-released.png`, releasedPng);
  await writeFileSync(`${videoDir}/${browserName}-scrub-seek.png`, seekPng);
  let diff = { mean: null, pixels: 0 };
  if (box) diff = await meanDiff(releasedPng, seekPng, box, 2);
  const report = { seconds, label: released.label, mean: diff.mean, pixels: diff.pixels };
  writeFileSync(`${videoDir}/${browserName}-scrub-diff.json`, JSON.stringify(report, null, 2));
  console.log(`${browserName} scrub released ${released.label} (${seconds}s) mean pixel diff ${diff.mean}`);
  return report;
}

async function contactSheet(frames, dest) {
  if (!frames.length) throw new Error(`no frames for ${dest}`);
  const meta = await sharp(frames[0]).metadata();
  const cols = 10;
  const cellW = 180;
  const cellH = Math.max(1, Math.round((cellW * (meta.height || 1)) / (meta.width || 1)));
  const rows = Math.ceil(frames.length / cols);
  const tiles = [];
  for (let i = 0; i < frames.length; i++) {
    tiles.push({
      input: await sharp(frames[i]).resize(cellW, cellH, { fit: 'fill' }).png().toBuffer(),
      left: (i % cols) * cellW,
      top: Math.floor(i / cols) * cellH,
    });
  }
  await sharp({
    create: { width: cols * cellW, height: rows * cellH, channels: 3, background: { r: 7, g: 6, b: 12 } },
  })
    .composite(tiles)
    .png()
    .toFile(dest);
  console.log(dest, `${frames.length} frames`);
}

function clips(browserName) {
  return [
    {
      name: 'library-song',
      prepare: async (page) => {
        await page.goto(slowUrl('/', browserName), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      },
      go: async (page) => {
        await page.locator('.lib-hero').click();
        await page.waitForURL('**/song/**');
        await page.waitForTimeout(2200);
      },
    },
    {
      name: 'settings',
      prepare: async (page) => {
        await page.goto(slowUrl('/song/karitas?t=42', browserName), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      },
      go: async (page) => {
        await page.locator('button[aria-label="Настройки"]').click();
        await sheetInView(page);
        await page.waitForTimeout(1800);
      },
    },
    {
      name: 'scrub',
      prepare: async (page) => {
        await page.goto(slowUrl('/song/karitas?t=42', browserName), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      },
      go: async (page) => {
        const track = page.locator('.scrub-track').first();
        const box = await track.boundingBox();
        if (!box) return;
        const y = box.y + box.height / 2;
        const x0 = box.x + 8;
        // 705s is 11:45, the qanun break. A fast last step would coast past it.
        const x1 = box.x + box.width * (705 / 977);
        await page.mouse.move(x0, y);
        await page.mouse.down();
        const steps = 24;
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
          await page.waitForTimeout(50);
          // One dwell, so the sheet can show a single crossfade. The other steps stay faster than 250 ms.
          if (i === 8) await page.waitForTimeout(420);
        }
        await page.waitForTimeout(80);
        await page.mouse.move(x1 + 1, y);
        await page.waitForTimeout(120);
        await page.mouse.move(x1, y);
        await page.waitForTimeout(80);
        await page.mouse.up();
        await page.waitForTimeout(1200);
      },
    },
    {
      name: 'play',
      prepare: async (page) => {
        await page.goto(slowUrl('/song/karitas?t=42', browserName), { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
      },
      go: async (page) => {
        const button = page.locator('button.btn-xl').first();
        await button.click();
        // Hold play long enough for the clock and the next line. The old 1.5 s
        // second click was the pause the sheet read as the song stopping.
        await page.waitForTimeout(5600);
        await button.click();
        await page.waitForTimeout(400);
      },
    },
  ];
}

async function videosOf(browserName, browser, device) {
  for (const clip of clips(browserName)) {
    if (only && clip.name !== only) continue;
    await record(browserName, browser, device, clip.name, async (page) => {
      await clip.prepare(page);
      await page.waitForTimeout(1000);
      await clip.go(page);
      await page.waitForTimeout(1000);
    });
  }
}

function writeScrubViews(browserName, notes) {
  writeFileSync(`${videoDir}/${browserName}-scrub-frames.json`, JSON.stringify(notes, null, 2));
  const changes = [];
  let released = null;
  let wasDragging = false;
  notes.forEach((note, i) => {
    const prev = notes[i - 1];
    if (prev && note.kind !== prev.kind) changes.push({ frame: i + 1, from: prev.kind, to: note.kind, time: note.time });
    if (wasDragging && note && !note.dragging && released == null) released = { frame: i + 1, ...note };
    if (note?.dragging) wasDragging = true;
  });
  const empty = notes.map((note, i) => (note?.kind === 'empty' ? i + 1 : 0)).filter(Boolean);
  const crossfade = notes.map((note, i) => (note?.views > 1 ? i + 1 : 0)).filter(Boolean);
  const stacked = notes.map((note, i) => (note?.views > 2 ? i + 1 : 0)).filter(Boolean);
  writeFileSync(
    `${videoDir}/${browserName}-scrub-views.json`,
    JSON.stringify({ changes, released, empty, crossfade, stacked, frames: notes.length }, null, 2),
  );
  console.log(`${browserName} scrub views`, JSON.stringify({ changes, released, emptyCount: empty.length, crossfade, stacked }));
}

/** WebKit screenshots stall the frame clock, so a 50 ms step looks like a dwell. Step the same gesture on the clock. */
async function sampleScrubClock(page) {
  const frames = [];
  const notes = [];
  const shot = async () => {
    frames.push(await page.screenshot({ type: 'jpeg', quality: 35, animations: 'allow' }));
    notes.push(await page.evaluate(stageProbe));
  };
  const track = page.locator('.scrub-track').first();
  const box = await track.boundingBox();
  if (!box) return { frames, notes };
  const y = box.y + box.height / 2;
  const x0 = box.x + 8;
  const x1 = box.x + box.width * (705 / 977);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now);
  await shot();
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.clock.runFor(40);
  await shot();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    if (i === 8) {
      await page.clock.runFor(420);
      await shot();
    } else if (i === 9) {
      // The depart is created on the frame after the move. The second shot is the crossfade.
      await page.clock.runFor(16);
      await shot();
      await page.clock.runFor(80);
      await shot();
    } else {
      await page.clock.runFor(40);
      await shot();
    }
  }
  await page.mouse.up();
  await page.clock.runFor(240);
  await shot();
  await page.clock.runFor(400);
  await shot();
  return { frames, notes };
}

/**
 * Round 21: the engine's own screencast, one cell per drawn frame, in real time.
 * The 100 ms screenshot pump held a second before the tap and WebKit's screenshots
 * were slower than its frames, so "frames 1-11 identical" was the recorder's clock.
 * Each cell is stamped with its time from the tap, the same clock as D28.
 */
async function castSample(page, body) {
  await page.evaluate(() => {
    window.__tapAt = null;
    addEventListener('pointerdown', () => {
      if (window.__tapAt == null) window.__tapAt = performance.timeOrigin + performance.now();
    }, { capture: true });
  });
  const impl = page._connection.toImpl(page);
  const frames = [];
  const onFrame = (f) => frames.push({ t: f.frameSwapWallTime || Date.now(), buf: f.buffer });
  impl.on('screencastframe', onFrame);
  await impl.delegate.setScreencastOptions({ width: 393, height: 852, quality: 80 });
  await page.waitForTimeout(300);
  await body();
  await impl.delegate.setScreencastOptions(null).catch(() => {});
  impl.off('screencastframe', onFrame);
  const tapAt = await page.evaluate(() => window.__tapAt);
  // From the last frame before the tap; nothing before it moves.
  const first = Math.max(0, frames.findIndex((f) => tapAt != null && f.t >= tapAt) - 1);
  return { frames: frames.slice(first), tapAt };
}

async function stampedSheet(cast, dest) {
  const { frames, tapAt } = cast;
  if (!frames.length) throw new Error(`no frames for ${dest}`);
  const cols = 10;
  const cellW = 180;
  const cellH = Math.round((cellW * 852) / 393);
  const tiles = [];
  for (let i = 0; i < frames.length; i++) {
    const ms = tapAt == null ? 0 : Math.round(frames[i].t - tapAt);
    const label = ms < 0 ? 'до касания' : `+${ms} мс`;
    const svg = Buffer.from(
      `<svg width="${cellW}" height="22" xmlns="http://www.w3.org/2000/svg"><rect width="${cellW}" height="22" fill="rgba(0,0,0,0.72)"/><text x="6" y="16" fill="#fff" font-family="Segoe UI, sans-serif" font-size="13">${i + 1} · ${label}</text></svg>`,
    );
    const cell = await sharp(frames[i].buf).resize(cellW, cellH, { fit: 'fill' }).composite([{ input: svg, left: 0, top: cellH - 22 }]).png().toBuffer();
    tiles.push({ input: cell, left: (i % cols) * cellW, top: Math.floor(i / cols) * cellH });
  }
  await sharp({ create: { width: cols * cellW, height: Math.ceil(frames.length / cols) * cellH, channels: 3, background: { r: 7, g: 6, b: 12 } } })
    .composite(tiles)
    .png()
    .toFile(dest);
  console.log(dest, `${frames.length} frames, tap stamped`);
}

async function contactsOf(browserName, browser, device) {
  for (const step of clips('plain')) {
    if (only && step.name !== only) continue;
    const context = await browser.newContext({ ...device, colorScheme: 'dark' });
    await installSilence(context);
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror', step.name, err.message));
    // Real time. No slowmo, no CDP. The sheet is one frame per 100 ms around the action.
    // Chromium's screenshot gap is longer than the flight, so that one sheet steps the same spring by 100 ms.
    // WebKit's screenshot gap is longer than a dwell, so the scrub sheet steps the finger on the clock.
    if (browserName === 'webkit' && step.name === 'scrub') {
      await page.clock.install({ time: Date.now() });
    }
    await step.prepare(page);
    if (browserName === 'webkit' && step.name === 'scrub') {
      const { frames, notes } = await sampleScrubClock(page);
      await contactSheet(frames, `${videoDir}/${browserName}-${step.name}-contact.png`);
      writeScrubViews(browserName, notes);
      await context.close();
      continue;
    }
    if (step.name === 'library-song' || step.name === 'settings') {
      const cast = await castSample(page, async () => {
        await step.go(page);
      });
      await stampedSheet(cast, `${videoDir}/${browserName}-${step.name}-contact.png`);
      await context.close();
      continue;
    }
    const watch = step.name === 'scrub' || step.name === 'play' ? stageProbe : null;
    const { frames, notes } = await sample(page, async () => {
      await page.waitForTimeout(1000);
      await step.go(page);
      await page.waitForTimeout(1000);
    }, watch);
    await contactSheet(frames, `${videoDir}/${browserName}-${step.name}-contact.png`);
    if (step.name === 'scrub') {
      writeScrubViews(browserName, notes);
      await compareSeek(page, browserName);
    }
    if (step.name === 'play') {
      writeFileSync(`${videoDir}/${browserName}-play-frames.json`, JSON.stringify(notes, null, 2));
    }
    await context.close();
  }
}

if (sheetDir && !only) {
  mkdirSync(sheetDir, { recursive: true });
  const browser = await chromium.launch();
  for (const device of devices) await shoot(browser, device);
  await browser.close();
}

if (videoDir) {
  mkdirSync(videoDir, { recursive: true });
  // Both engines, phone 393×852, density 2. A desktop Chromium pass was the round-13 mismatch.
  const phone = {
    name: 'iphone',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  };
  if (standIn) console.log('AUDIO_KEY missing: recorder serves silent audio of each song length');
  if (!engineOnly || engineOnly === 'chromium') {
    const chrome = await chromium.launch();
    if (args.skipvideo !== 'true') await videosOf('chromium', chrome, phone);
    await contactsOf('chromium', chrome, phone);
    await chrome.close();
  }
  if (!engineOnly || engineOnly === 'webkit') {
    const kit = await webkit.launch();
    if (args.skipvideo !== 'true') await videosOf('webkit', kit, phone);
    await contactsOf('webkit', kit, phone);
    await kit.close();
  }
  dropHashVideos(videoDir);
}

if (!sheetDir && !videoDir) {
  console.error('Pass --sheets <dir> and/or --videos <dir>');
  process.exit(1);
}
