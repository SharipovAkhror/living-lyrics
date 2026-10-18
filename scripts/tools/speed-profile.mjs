/**
 * Profile opening a song and switching to the next one.
 *
 *   node scripts/tools/speed-profile.mjs --url http://127.0.0.1:4173 --out work/profile/before.json
 *   node scripts/tools/speed-profile.mjs --url http://127.0.0.1:4173 --out work/profile/after.json --shots work/shots/t19/after
 *
 * iPhone-sized viewport, CPU ×4. Two networks, both documented in the report:
 *   4G — 9 Mbit/s down, 1.5 Mbit/s up, 40 ms RTT, navigator.connection 4g
 *   3G — 1.6 Mbit/s down, 750 Kbit/s up, 150 ms RTT, navigator.connection 3g
 * CDP throttles bytes only, so the script also sets navigator.connection.
 *
 * Cold = a new browser context. Warm = the same context, opened again.
 * Audio timing is recorded only when the recording actually responds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const url = flag('--url', 'http://127.0.0.1:4173');
const outPath = flag('--out', 'work/profile/profile.json');
const shotsDir = flag('--shots', '');
const fromSlug = flag('--from', 'karitas');
const toSlug = flag('--to', 'one');
const check = args.includes('--check');

/** Warm 4G: the sky is in the first paint, and heavy files do not start ahead of it. */
const WARM_4G_SKY_MS = 200;

/** Bytes per second. */
const NETS = {
  '4g': { down: (9 * 1000 * 1000) / 8, up: (1.5 * 1000 * 1000) / 8, rtt: 40 },
  '3g': { down: (1.6 * 1000 * 1000) / 8, up: (750 * 1000) / 8, rtt: 150 },
};

/** Vite names a chunk `name-HASH`, and the hash is eight characters that may contain a hyphen. */
function chunkBase(file) {
  const m = file.match(/\/([^/]+)\.js$/);
  if (!m) return '';
  return m[1].replace(/-([A-Za-z0-9_-]{8})$/, '');
}

function kindOf(raw) {
  const u = raw.split('?')[0];
  if (/\/audio\/[^/]+\/(high|saver)\.(m4a|mp3)/.test(u)) return 'audio';
  if (u.includes('features.json')) return 'features';
  if (u.includes('peaks.json')) return 'peaks';
  if (u.includes('/fonts/') || /\.(woff2|woff|otf|ttf)$/.test(u)) return 'font';
  if (u.includes('/instruments/3d/') || u.endsWith('.glb')) return '3d';
  if (u.includes('/instruments/') && u.endsWith('.svg')) return 'engraving';
  if (u.endsWith('.css')) return 'css';
  if (u.endsWith('.js')) {
    const base = chunkBase(u);
    if (base.startsWith('lyrics')) return 'lyrics';
    if (base === 'three' || base === 'three.module' || base.startsWith('GLTF') || base.startsWith('meshopt')) return '3d';
    if (base === 'index' || base === 'InstrumentsPage' || base === 'MethodPage') return 'js';
    if (base) return 'engraving';
    return 'js';
  }
  if (u.endsWith('.json')) return 'json';
  if (/\.(png|svg|webp|ico)$/.test(u)) return 'image';
  return 'other';
}

async function throttle(page, net) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: net.down,
    uploadThroughput: net.up,
    latency: net.rtt,
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return client;
}

async function resources(page) {
  return page.evaluate(() =>
    performance.getEntriesByType('resource').map((e) => ({
      name: e.name,
      start: Math.round(e.startTime),
      dur: Math.round(e.duration),
      transfer: e.transferSize,
      encoded: e.encodedBodySize,
      decoded: e.decodedBodySize,
    })),
  );
}

async function marks(page) {
  return page.evaluate(() => {
    const audio = document.querySelector('audio');
    const sky = document.querySelector('.song .field, .song .field-sky');
    const line = document.querySelector('.song .fb-orig, .song .intro-title');
    const err = document.querySelector('.song .player-alert, .song .load-error');
    return {
      sky: !!sky,
      line: !!line,
      lineText: (line?.textContent ?? '').trim().slice(0, 80),
      audioSrc: audio?.currentSrc || audio?.src || '',
      readyState: audio?.readyState ?? null,
      error: err?.textContent?.trim().slice(0, 140) ?? '',
    };
  });
}

/**
 * Click an in-app link and time the first sky and the first lyric line.
 * `since` is performance.now() just before the click, taken inside the page.
 */
async function openSong(page, slug) {
  const link = page.locator(`a[href="/song/${slug}"]`);
  await link.waitFor({ state: 'visible', timeout: 20000 });
  // One animation frame records the sky, the title and the sung line on the same clock.
  // Separate Playwright waits add a frame of CPU throttle and made the sky look late.
  await page.evaluate(() => {
    performance.clearResourceTimings();
    const marks = { t0: 0, chrome: 0, sky: 0, line: 0, lyric: 0 };
    window.__llOpen = marks;
    const scan = () => {
      const m = window.__llOpen;
      if (!m) return;
      if (!m.t0) {
        requestAnimationFrame(scan);
        return;
      }
      const now = performance.now();
      if (!m.chrome && document.querySelector('.song .topbar-song')) m.chrome = now;
      if (!m.sky && document.querySelector('.song .field')) m.sky = now;
      if (!m.line && document.querySelector('.song .intro-title')) m.line = now;
      if (!m.lyric && document.querySelector('.song .fb-orig')) m.lyric = now;
      if (!m.lyric && now - m.t0 < 8000) requestAnimationFrame(scan);
    };
    document.addEventListener(
      'click',
      () => {
        marks.t0 = performance.now();
      },
      { capture: true, once: true },
    );
    requestAnimationFrame(scan);
  });
  await link.click();
  await page.waitForFunction(() => window.__llOpen && window.__llOpen.sky > 0, { timeout: 30000 });
  const audioAt = await page
    .waitForFunction(
      () => {
        const a = document.querySelector('audio');
        if (!a || !a.src) return false;
        return a.readyState >= 3 || a.error != null;
      },
      { timeout: 8000 },
    )
    .then(async () => page.evaluate(() => performance.now()))
    .catch(() => null);
  await page.waitForFunction(() => window.__llOpen.lyric > 0, { timeout: 4000 }).catch(() => null);
  // Peaks, features and engravings start from an idle callback (timeout 1.5 s). Read them after that.
  await page.waitForTimeout(1700);
  const seen = await page.evaluate(() => window.__llOpen);
  const t0 = seen.t0 || 0;
  const snap = await marks(page);
  const list = await resources(page);
  const rel = (t) => (!t ? null : Math.round(t - t0));
  return {
    slug,
    chromeMs: rel(seen.chrome),
    skyMs: rel(seen.sky),
    lineMs: rel(seen.line),
    lyricMs: rel(seen.lyric),
    audioReadyMs: rel(audioAt),
    snap,
    resources: list
      .filter((r) => r.start >= t0 - 30)
      .map((r) => ({ ...r, start: Math.round(r.start - t0), kind: kindOf(r.name) })),
  };
}

async function pressPlay(page) {
  const btn = page.locator('.song .btn-ring');
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => {
    const el = document.querySelector('.song .btn-ring');
    const seen = [];
    const note = () => seen.push(el?.getAttribute('aria-label') ?? '');
    note();
    if (el) new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ['aria-label'] });
    window.__llLabels = seen;
  });
  const t0 = await page.evaluate(() => performance.now());
  await btn.click();
  const done = await page
    .waitForFunction(
      () => {
        const a = document.querySelector('audio');
        if (!a) return false;
        if (a.error) return true;
        return !a.paused && a.readyState >= 3;
      },
      { timeout: 20000 },
    )
    .then(async () => page.evaluate(() => performance.now()))
    .catch(() => null);
  const state = await page.evaluate(() => {
    const a = document.querySelector('audio');
    const label = document.querySelector('.song .btn-ring')?.getAttribute('aria-label') ?? '';
    let buffered = 0;
    if (a) {
      for (let i = 0; i < a.buffered.length; i++) buffered += a.buffered.end(i) - a.buffered.start(i);
    }
    return {
      paused: a?.paused ?? null,
      readyState: a?.readyState ?? null,
      error: a?.error?.code ?? null,
      current: a?.currentTime ?? null,
      buffered: Math.round(buffered * 10) / 10,
      duration: a?.duration ?? null,
      label,
    };
  });
  const labels = await page.evaluate(() => window.__llLabels ?? []);
  return { playMs: done == null ? null : Math.round(done - t0), state, labels };
}

/** Song to song without a document reload, so the leaving sky can be seen. */
async function clientSwitch(page, slug) {
  const before = await page.locator('.topbar-song').innerText();
  await page.evaluate((to) => {
    const samples = [];
    const t0 = performance.now();
    let frames = 0;
    const sample = () => {
      frames += 1;
      samples.push({
        t: Math.round(performance.now() - t0),
        fields: document.querySelectorAll('.song .field').length,
        leave: !!document.querySelector('.sky-leave'),
        title: document.querySelector('.topbar-song')?.textContent ?? '',
        hold: !!document.querySelector('.scene--hold'),
      });
      if (frames < 36) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__llSwitch = samples;
    history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/song/${slug}`);
  await page
    .waitForFunction(
      (prev) => {
        const t = document.querySelector('.topbar-song')?.textContent ?? '';
        return t.length > 0 && t !== prev;
      },
      before,
      { timeout: 10000 },
    )
    .catch(() => null);
  await page.waitForTimeout(900);
  const samples = await page.evaluate(() => window.__llSwitch ?? []);
  const titleAt = samples.find((s) => s.title && s.title !== before);
  return {
    slug,
    fromTitle: before,
    titleMs: titleAt ? titleAt.t : null,
    paperFrames: samples.filter((s) => s.fields === 0).length,
    sawLeave: samples.some((s) => s.leave),
    frames: samples.length,
  };
}

async function shotSeries(page, dir, slug) {
  if (!dir) return [];
  mkdirSync(dir, { recursive: true });
  const files = [];
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) {
    const name = `${slug}-${String(i).padStart(2, '0')}.png`;
    const file = `${dir}/${name}`;
    await page.screenshot({ path: file, animations: 'allow' });
    files.push({ file: name, atMs: Date.now() - t0 });
    await page.waitForTimeout(150);
  }
  return files;
}

async function runCase(browser, netName, cache) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  // CDP throttles bytes only. The page reads navigator.connection, so say which profile this is.
  await page.addInitScript((type) => {
    const conn = {
      effectiveType: type,
      saveData: false,
      downlink: type === '3g' ? 1.6 : 9,
      rtt: type === '3g' ? 150 : 40,
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => conn });
  }, netName);
  await throttle(page, NETS[netName]);
  const started = Date.now();
  await page.goto(url + '/', { waitUntil: 'load', timeout: 60000 });
  const libraryMs = Date.now() - started;
  const libraryPaint = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = Math.round(p.startTime);
    return {
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      ...paints,
    };
  });
  await page.waitForSelector('.lib-band', { timeout: 20000 });

  let warmNote = null;
  if (cache === 'warm') {
    // Fill the HTTP cache, then open the song as a returning reader.
    await openSong(page, fromSlug);
    await page.goto(url + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('.lib-band');
    warmNote = 'second open in the same context';
  }

  const open = await openSong(page, fromSlug);
  const play = await pressPlay(page);
  await page.goBack({ waitUntil: 'load' }).catch(async () => {
    await page.goto(url + '/', { waitUntil: 'load' });
  });
  await page.waitForSelector('.lib-band', { timeout: 20000 });
  const next = await openSong(page, toSlug);
  const switched = await clientSwitch(page, fromSlug);

  await context.close();
  return { net: netName, cache, libraryMs, libraryPaint, warmNote, open, play, next, switched };
}

async function unthrottledShots(browser, dir) {
  if (!dir) return null;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(url + '/', { waitUntil: 'load' });
  await page.waitForSelector('.lib-band');
  // Warm the route once so the series shows the transition, not the first download.
  await page.locator(`a[href="/song/${fromSlug}"]`).click();
  await page.waitForSelector('.song .topbar-song');
  await page.waitForTimeout(400);
  await page.goto(url + '/', { waitUntil: 'load' });
  await page.waitForSelector('.lib-band');
  const click = page.locator(`a[href="/song/${fromSlug}"]`).click();
  const frames = await shotSeries(page, `${dir}/open-${fromSlug}`, 'open');
  await click;
  await page.waitForTimeout(400);
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/song/${toSlug}`);
  await page.waitForSelector('.song .topbar-song');
  await page.waitForTimeout(500);
  // Client-side return: the song route stays mounted and the previous sky fades out.
  const back = page.evaluate((to) => {
    history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/song/${fromSlug}`);
  const framesSwitch = await shotSeries(page, `${dir}/switch-${toSlug}-to-${fromSlug}`, 'switch');
  await back;
  await context.close();
  return { open: frames, switch: framesSwitch };
}

const browser = await chromium.launch({ headless: true });
const cases = [];
for (const net of ['4g', '3g']) {
  for (const cache of ['cold', 'warm']) {
    process.stderr.write(`profile ${net} ${cache}\n`);
    cases.push(await runCase(browser, net, cache));
  }
}
const shots = await unthrottledShots(browser, shotsDir);
await browser.close();

const report = {
  at: new Date().toISOString(),
  url,
  viewport: '390x844 @2x, CPU ×4',
  nets: {
    '4g': '9 Mbit/s down, 1.5 Mbit/s up, 40 ms',
    '3g': '1.6 Mbit/s down, 750 Kbit/s up, 150 ms',
  },
  fromSlug,
  toSlug,
  cases,
  shots,
};

function budgetFails(report) {
  const fails = [];
  const warm = report.cases.find((c) => c.net === '4g' && c.cache === 'warm');
  if (!warm) return ['missing warm 4g case'];
  const sky = warm.open.skyMs;
  const line = warm.open.lineMs;
  if (sky == null || sky > WARM_4G_SKY_MS) fails.push(`warm 4g sky ${sky} ms > ${WARM_4G_SKY_MS}`);
  if (sky != null && line != null && sky > line) fails.push(`warm 4g sky ${sky} ms is after the title ${line} ms`);
  const heavy = (warm.open.resources ?? []).filter((r) => r.kind === 'features' || r.kind === 'peaks' || r.kind === 'engraving');
  for (const r of heavy) {
    if (sky != null && r.start < sky - 30) fails.push(`${r.kind} started at ${r.start} ms, before the sky at ${sky} ms`);
  }
  if (warm.switched && warm.switched.paperFrames > 0) fails.push(`warm 4g switch had ${warm.switched.paperFrames} frames with no sky`);
  return fails;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
for (const c of cases) {
  const sum = {};
  for (const r of c.open.resources) {
    const row = sum[r.kind] ?? { n: 0, transfer: 0, first: r.start };
    row.n += 1;
    row.transfer += r.transfer;
    row.first = Math.min(row.first, r.start);
    sum[r.kind] = row;
  }
  process.stderr.write(
    `${c.net} ${c.cache} lib ${c.libraryMs} paint ${JSON.stringify(c.libraryPaint)} open chrome ${c.open.chromeMs} sky ${c.open.skyMs} line ${c.open.lineMs} lyric ${c.open.lyricMs} audio ${c.open.audioReadyMs} play ${c.play.playMs} labels ${JSON.stringify(c.play.labels)}\n`,
  );
  process.stderr.write(
    `  next chrome ${c.next.chromeMs} sky ${c.next.skyMs} line ${c.next.lineMs} lyric ${c.next.lyricMs} switch title ${c.switched.titleMs} paper ${c.switched.paperFrames} leave ${c.switched.sawLeave}\n`,
  );
  process.stderr.write(`  open ${JSON.stringify(sum)}\n`);
}
process.stderr.write(`wrote ${outPath}\n`);
if (check) {
  const fails = budgetFails(report);
  if (fails.length) {
    process.stderr.write(`budget failed:\n${fails.map((f) => `- ${f}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stderr.write('budget ok\n');
}
