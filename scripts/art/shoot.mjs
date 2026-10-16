// Renders work/art/preview.html to PNGs (one per figure) for visual review.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const out = process.argv[2] || 'work/art';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve('work/art/preview.html')).href);
const figs = await page.$$('figure');
let i = 0;
for (const f of figs) {
  const cls = await f.getAttribute('class');
  const name = await f.$eval('figcaption', (e) => e.textContent);
  await f.screenshot({ path: `${out}/${name}-${cls}.png` });
  i++;
}
console.log(`${i} figures`);
await browser.close();
