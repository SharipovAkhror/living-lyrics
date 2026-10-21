// Sheets and motion recordings for the studio pass.
// Sheets: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --tag after --sheets work/studio/sheets6
// Videos: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --videos work/studio/video6
import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const tag = args.tag || 'after';
const sheetDir = args.sheets && args.sheets !== 'true' ? args.sheets : '';
const videoDir = args.videos && args.videos !== 'true' ? args.videos : '';

const devices = [
  { name: 'se', viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'se375', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'iphone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'land-se', viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'land-15', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'ipad', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desk', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: 'wide', viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
];

const pages = [
  { name: 'library', path: '/' },
  { name: 'song', path: '/song/karitas?t=42' },
];

function stats(deltas) {
  const d = deltas.slice(1).filter((n) => n >= 0 && n < 500);
  const s = [...d].sort((a, b) => a - b);
  const pick = (q) => (s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null);
  const long = d.filter((n) => n > 16.7);
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
  return {
    n: d.length,
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(s[s.length - 1] ?? null),
    long: long.length,
    longMax: round(long.length ? Math.max(...long) : 0),
    over20: d.filter((n) => n > 20).length,
    over33: d.filter((n) => n > 33.4).length,
  };
}

function durStats(values) {
  const s = values.filter((n) => n >= 0 && n < 500).sort((a, b) => a - b);
  const pick = (q) => (s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null);
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
  return {
    n: s.length,
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(s[s.length - 1] ?? null),
  };
}

async function shoot(browser, device) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ ...device, colorScheme: scheme });
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

async function beginFrames(page) {
  await page.evaluate(() => {
    const deltas = [];
    let last = performance.now();
    const loop = (now) => {
      deltas.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(loop);
    };
    window.__deltas = deltas;
    window.__raf = requestAnimationFrame(loop);
  });
}

async function endFrames(page) {
  const deltas = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__deltas;
  });
  return stats(deltas);
}

async function record(browserName, browser, device, name, run) {
  const context = await browser.newContext({
    ...device,
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: device.viewport.width, height: device.viewport.height } },
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('pageerror', name, err.message));
  await run(page);
  const video = page.video();
  await page.close();
  await context.close();
  const dest = `${videoDir}/${browserName}-${name}.webm`;
  await video.saveAs(dest);
  console.log(dest);
}

async function measure(page, name, action) {
  const chromium = page.context().browser()?.browserType().name() === 'chromium';
  const chunks = [];
  let session = null;
  let traceDone = null;
  if (chromium) {
    session = await page.context().newCDPSession(page);
    session.on('Tracing.dataCollected', (event) => {
      if (event.value) chunks.push(...event.value);
    });
    traceDone = new Promise((resolve) => session.on('Tracing.tracingComplete', resolve));
    await session.send('Tracing.start', {
      traceConfig: {
        includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame'],
      },
    });
  }
  await beginFrames(page);
  await action();
  await page.waitForTimeout(900);
  const report = await endFrames(page);
  if (session) {
    await session.send('Tracing.end');
    await traceDone;
    await session.detach().catch(() => {});
    const renders = chunks
      .filter((event) => event.name === 'AnimationFrame::Render')
      .map((event) => (typeof event.dur === 'number' ? event.dur / 1000 : null))
      .filter((n) => n != null);
    const scripts = chunks
      .filter((event) => event.ph === 'X' && event.name === 'FireAnimationFrame' && typeof event.dur === 'number')
      .map((event) => event.dur / 1000);
    report.work = durStats(renders);
    report.script = durStats(scripts);
  }
  const file = `${videoDir}/${name}.json`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, JSON.stringify({ name, ...report }, null, 2));
  console.log(name, JSON.stringify(report));
}

async function videosOf(browserName, browser, device) {
  await record(browserName, browser, device, 'library-song', async (page) => {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await measure(page, `${browserName}-library-song`, async () => {
      await page.locator('.lib-hero').click();
      await page.waitForURL('**/song/**');
    });
  });

  await record(browserName, browser, device, 'settings', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await measure(page, `${browserName}-settings`, async () => {
      await page.locator('button[aria-label="Настройки"]').click();
    });
  });

  await record(browserName, browser, device, 'scrub', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await measure(page, `${browserName}-scrub`, async () => {
      const track = page.locator('.scrub-track').first();
      const box = await track.boundingBox();
      if (!box) return;
      await page.mouse.move(box.x + 8, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
    });
  });

  await record(browserName, browser, device, 'play', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await measure(page, `${browserName}-play`, async () => {
      const button = page.locator('button.btn-xl').first();
      await button.click();
      await page.waitForTimeout(350);
      await button.click();
    });
  });
}

if (sheetDir) {
  mkdirSync(sheetDir, { recursive: true });
  const browser = await chromium.launch();
  for (const device of devices) await shoot(browser, device);
  await browser.close();
}

if (videoDir) {
  mkdirSync(videoDir, { recursive: true });
  const desk = { name: 'desk', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const phone = { name: 'iphone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const chrome = await chromium.launch();
  await videosOf('chromium', chrome, desk);
  await chrome.close();
  const kit = await webkit.launch();
  await videosOf('webkit', kit, phone);
  await kit.close();
}

if (!sheetDir && !videoDir) {
  console.error('Pass --sheets <dir> and/or --videos <dir>');
  process.exit(1);
}
