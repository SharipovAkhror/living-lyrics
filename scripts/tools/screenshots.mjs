// Visual QA: captures pages at iPhone and desktop sizes, light and dark.
// Usage: npm run shots -- [baseUrl] [outDir] [path?t=..]...
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173', out = 'work/shots', ...paths] = process.argv.slice(2);
const targets = paths.length ? paths : ['/', '/song/karitas?t=50', '/song/karitas?t=20', '/method'];
const devices = [
  { name: 'iphone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
for (const d of devices) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...d, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
    for (const p of targets) {
      await page.goto(base + p, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      const file = `${out}/${d.name}-${scheme}-${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
