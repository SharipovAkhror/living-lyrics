// Sheets and motion recordings for the studio pass.
// Sheets: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --tag round8 --sheets work/studio/sheets8
// Videos: node scripts/tools/studio-capture.mjs --base http://127.0.0.1:4176 --videos work/studio/video8
// Frame numbers are a separate run (scripts/perf/frames.mjs). recordVideo drops frames on this machine.
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
const tag = args.tag || 'round8';
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

async function sheetInView(page) {
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const box = dialog.getBoundingClientRect();
      return box.height > 120 && box.top < window.innerHeight - 40 && box.bottom > 80;
    },
    { timeout: 5000 },
  );
}

async function videosOf(browserName, browser, device) {
  await record(browserName, browser, device, 'library-song', async (page) => {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.locator('.lib-hero').click();
    await page.waitForURL('**/song/**');
    await page.waitForTimeout(1100);
  });

  await record(browserName, browser, device, 'settings', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="Настройки"]').click();
    await sheetInView(page);
    await page.waitForTimeout(800);
  });

  await record(browserName, browser, device, 'scrub', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const track = page.locator('.scrub-track').first();
    const box = await track.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  });

  await record(browserName, browser, device, 'play', async (page) => {
    await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const button = page.locator('button.btn-xl').first();
    await button.click();
    await page.waitForTimeout(500);
    await button.click();
    await page.waitForTimeout(400);
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
