/**
 * Stills for the T6 pilot. Spawns its own Vite (the app server is not assumed).
 * Writes work/shots/t6/ and does not commit that directory.
 *
 *   node scripts/art3d/shots.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const out = 'work/shots/t6';
const port = 4179;
const base = `http://127.0.0.1:${port}`;
const instruments = ['daf', 'oud'];
const styles = ['engraving', 'materials'];
const themes = ['light', 'dark'];

mkdirSync(out, { recursive: true });

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: process.cwd(),
});
let viteLog = '';
vite.stdout.on('data', (chunk) => {
  viteLog += chunk;
});
vite.stderr.on('data', (chunk) => {
  viteLog += chunk;
});

function stopVite() {
  if (!vite.pid || vite.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { shell: true, stdio: 'ignore' });
  } else {
    vite.kill();
  }
}
process.on('exit', stopVite);

async function waitForServer() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/instruments');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(400);
  }
  throw new Error(`vite did not start\n${viteLog.slice(-2500)}`);
}

async function launch(kind, name, options) {
  try {
    return await kind.launch(options);
  } catch (err) {
    console.log(`installing playwright browsers after ${name} failed: ${err instanceof Error ? err.message : err}`);
    await new Promise((resolve, reject) => {
      const child = spawn('npx', ['playwright', 'install', 'chromium', 'webkit'], { shell: true, stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`playwright install exited ${code}`))));
    });
    return kind.launch(options);
  }
}

function applySettings(context, theme, instrumentStyle, motion) {
  return context.addInitScript(
    (stored) => {
      localStorage.setItem('living-lyrics.settings.v2', JSON.stringify(stored));
    },
    {
      theme,
      instrumentStyle,
      motion,
      showTranslation: true,
      showTranslit: false,
      showAlt: false,
      showComment: true,
      commentOpen: false,
      textScale: 1,
      persianStyle: 'naskh',
      pauseAfterLine: false,
      quality: 'high',
      rate: 1,
      volume: 1,
      normalize: true,
      eqEnabled: false,
      eqPreset: 'flat',
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eqPreamp: 0,
    },
  );
}

function watch(page) {
  page.on('pageerror', (err) => console.error('pageerror', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console', msg.text());
  });
}

async function shootCard(page, key) {
  const art = page.locator(`[data-instrument="${key}"]`).first();
  await art.scrollIntoViewIfNeeded();
  await page.waitForSelector(`[data-instrument="${key}"][data-ready="1"]`, { timeout: 30000 });
  await page.waitForTimeout(400);
  const card = page.locator(`article.ig-card:has([data-instrument="${key}"])`);
  return card;
}

const iphone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

await waitForServer();
console.log('vite ready');

const webkitBrowser = await launch(webkit, 'webkit');
const chromiumBrowser = await launch(chromium, 'chromium', {
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

try {
  for (const theme of themes) {
    for (const style of styles) {
      for (const key of instruments) {
        const contexts = [
          ['iphone-webkit', webkitBrowser, iphone],
          ['desktop-chromium', chromiumBrowser, desktop],
        ];
        for (const [label, browser, device] of contexts) {
          const context = await browser.newContext({ ...device, colorScheme: theme });
          await applySettings(context, theme, style, 'full');
          const page = await context.newPage();
          watch(page);
          await page.goto(`${base}/instruments`, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          const card = await shootCard(page, key);
          const file = `${out}/${label}-${theme}-${style}-${key}.png`;
          await card.screenshot({ path: file });
          console.log(file);
          await context.close();
        }
      }
    }
  }

  const fallbackContext = await chromiumBrowser.newContext({ ...desktop, colorScheme: 'light' });
  await applySettings(fallbackContext, 'light', 'engraving', 'off');
  const fallbackPage = await fallbackContext.newPage();
  watch(fallbackPage);
  await fallbackPage.goto(`${base}/instruments`, { waitUntil: 'networkidle' });
  const fallbackArt = fallbackPage.locator('[data-instrument="daf"]').first();
  await fallbackArt.scrollIntoViewIfNeeded();
  await fallbackPage.waitForTimeout(800);
  const fallbackReady = await fallbackPage.locator('[data-instrument="daf"][data-ready="1"]').count();
  const fallbackSvg = await fallbackArt.locator('svg').count();
  const fallbackFile = `${out}/desktop-chromium-light-engraving-daf-motion-off.png`;
  await fallbackPage.locator('article.ig-card:has([data-instrument="daf"])').screenshot({ path: fallbackFile });
  console.log(fallbackFile, { ready: fallbackReady, svg: fallbackSvg });
  await fallbackContext.close();

  for (const style of styles) {
    for (const key of instruments) {
      for (const level of [0, 0.5, 1]) {
        const context = await chromiumBrowser.newContext({ ...desktop, colorScheme: 'light' });
        await applySettings(context, 'light', style, 'full');
        const page = await context.newPage();
        watch(page);
        await page.goto(`${base}/instruments?t6frame=${key}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.t6-frame[data-ready="1"]', { timeout: 30000 });
        await page.evaluate((value) => window.__t6?.pose(0, value), level);
        await page.waitForTimeout(200);
        const file = `${out}/desktop-chromium-light-${style}-${key}-drive-${level}.png`;
        await page.locator('.t6-frame canvas').screenshot({ path: file });
        console.log(file);
        await context.close();
      }
    }
  }

  const benchContext = await chromiumBrowser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
  });
  await applySettings(benchContext, 'light', 'engraving', 'full');
  const benchPage = await benchContext.newPage();
  watch(benchPage);
  await benchPage.goto(`${base}/instruments?t6bench=1`, { waitUntil: 'networkidle' });
  await benchPage.waitForSelector('.t6-bench-stage[data-ready="1"]', { timeout: 30000 });
  await benchPage.waitForTimeout(400);
  const seek = await benchPage.evaluate(() => window.__t6?.seek?.() ?? { ok: false, max: -1, width: 0, height: 0, reason: 'no api' });
  console.log('seek', seek);
  const client = await benchContext.newCDPSession(benchPage);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const fps = await benchPage.evaluate(async () => window.__t6?.fps?.(2000) ?? null);
  console.log('fps', fps);
  const report = {
    seek,
    fps,
    fallback: { ready: fallbackReady, svg: fallbackSvg, file: fallbackFile },
    note: 'FPS is Chromium with software WebGL (SwiftShader) and Emulation.setCPUThrottlingRate 4, deviceScaleFactor 1, stage 390×780 CSS px. Not a measured iPhone 12. The third instrument is a second daf.',
  };
  writeFileSync(`${out}/bench.json`, JSON.stringify(report, null, 2));
  console.log(`${out}/bench.json`);
  await benchContext.close();
} finally {
  await webkitBrowser.close();
  await chromiumBrowser.close();
  stopVite();
}
