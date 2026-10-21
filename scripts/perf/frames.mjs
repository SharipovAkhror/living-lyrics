// rAF intervals and long-animation-frame entries. No recordVideo: that path drops frames on this machine.
// node scripts/perf/frames.mjs --base http://127.0.0.1:4176
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const outDir = args.out || 'work/studio';

const phone = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

function stats(deltas) {
  const d = deltas.slice(1).filter((n) => n >= 0 && n < 500);
  const s = [...d].sort((a, b) => a - b);
  const pick = (q) => (s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null);
  const round = (n) => (n == null ? null : Math.round(n * 10) / 10);
  return {
    n: d.length,
    p50: round(pick(0.5)),
    p95: round(pick(0.95)),
    max: round(s[s.length - 1] ?? null),
    over20: d.filter((n) => n > 20).length,
    over33: d.filter((n) => n > 33.4).length,
  };
}

async function ready(page, path) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function begin(page) {
  await page.evaluate(() => {
    const deltas = [];
    const longs = [];
    let supported = true;
    let reason = '';
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longs.push({
            duration: Math.round(entry.duration * 10) / 10,
            blocking: Math.round((entry.blockingDuration || 0) * 10) / 10,
          });
        }
      });
      obs.observe({ type: 'long-animation-frame', buffered: true });
      window.__longObs = obs;
    } catch (err) {
      supported = false;
      reason = String(err && err.message ? err.message : err);
    }
    let last = performance.now();
    const loop = (now) => {
      deltas.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(loop);
    };
    window.__deltas = deltas;
    window.__longs = longs;
    window.__longOk = supported;
    window.__longReason = reason;
    window.__raf = requestAnimationFrame(loop);
  });
}

async function end(page) {
  const raw = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    window.__longObs?.disconnect();
    return {
      deltas: window.__deltas,
      longs: window.__longs,
      supported: window.__longOk,
      reason: window.__longReason,
    };
  });
  const report = stats(raw.deltas || []);
  const longs = raw.longs || [];
  const durations = longs.map((entry) => entry.duration).sort((a, b) => a - b);
  report.longFrames = longs.length;
  report.longMax = durations.length ? durations[durations.length - 1] : 0;
  report.longSupported = !!raw.supported;
  if (!raw.supported) report.longReason = raw.reason;
  return report;
}

async function flow(page, name) {
  if (name === 'library-song') {
    await ready(page, '/');
    await page.locator('.lib-hero').waitFor();
    await begin(page);
    await page.locator('.lib-hero').click();
    await page.waitForURL('**/song/**');
    await page.waitForTimeout(900);
    return;
  }
  await ready(page, '/song/karitas?t=42');
  await page.locator('button.btn-xl').waitFor();
  await begin(page);
  if (name === 'settings') {
    await page.locator('button[aria-label="Настройки"]').click();
    await page.waitForTimeout(900);
    return;
  }
  if (name === 'scrub') {
    const track = page.locator('.scrub-track').first();
    const box = await track.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    return;
  }
  const button = page.locator('button.btn-xl').first();
  await button.click();
  await page.waitForTimeout(350);
  await button.click();
  await page.waitForTimeout(350);
}

const profiles = [
  ['chromium', 'desktop', desk],
  ['chromium', 'phone', phone],
  ['webkit', 'desktop', desk],
  ['webkit', 'phone', phone],
];
const flows = ['library-song', 'settings', 'scrub', 'play'];

const chrome = await chromium.launch();
const kit = await webkit.launch();
const browsers = { chromium: chrome, webkit: kit };
const rows = [];

for (const [browserName, deviceName, device] of profiles) {
  for (const name of flows) {
    const context = await browsers[browserName].newContext({ ...device, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror', browserName, deviceName, name, err.message));
    let report;
    try {
      await flow(page, name);
      report = await end(page);
    } catch (err) {
      report = { error: String(err && err.message ? err.message : err) };
    }
    const row = { browser: browserName, device: deviceName, flow: name, ...report };
    rows.push(row);
    console.log(`${browserName} ${deviceName} ${name} ${JSON.stringify(report)}`);
    await context.close();
  }
}

await chrome.close();
await kit.close();

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/frames8.json`;
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log(file);
