// Public reference frames for the frozen critique.
// Same viewports and file names as the studio sheets (scripts/tools/studio-capture.mjs
// on site/studio-pass) and DESIGN_SHEETS / MOTION_SHEETS in critique.py.
//
//   node scripts/review/capture_reference.mjs
//   node scripts/review/capture_reference.mjs --brand apple --part sheets
//
// Does not log in and does not pass a login wall, a paywall, or a bot check.
// A visible cookie banner is dismissed. Anything else (storefront sheet, upsell,
// sign-in) stays in the picture. Screenshots go to work/ref/<brand>/, which is git-ignored.
//
// Apple Music is opened on music.apple.com/uz/. From this network the /us/ URL paints
// a "choose another country" sheet over the page and offers Uzbekistan; that sheet is
// not a cookie banner, so it is not clicked. /uz/ is the public page without that sheet,
// and the mini player is on screen. Spotify ignores prefers-color-scheme; light frames
// are whatever the site paints, and the notes say so.
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Viewport, density and the mobile flag match studio-capture.mjs. Motion uses
// density 2, same as the studio contact pass, not the density-3 stills.
const devices = {
  se: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  se375: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  iphone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  'land-15': { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  ipad: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  wide: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
};

const phoneMotion = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
};

// Names are DESIGN_SHEETS in scripts/review/critique.py. Keep the two lists together.
const sheets = [
  ['iphone-dark-song', 'iphone', 'dark', 'song'],
  ['iphone-light-song', 'iphone', 'light', 'song'],
  ['iphone-dark-library', 'iphone', 'dark', 'library'],
  ['iphone-light-library', 'iphone', 'light', 'library'],
  ['se-light-song', 'se', 'light', 'song'],
  ['se375-dark-song', 'se375', 'dark', 'song'],
  ['land-15-dark-song', 'land-15', 'dark', 'song'],
  ['ipad-light-song', 'ipad', 'light', 'song'],
  ['desk-dark-song', 'desk', 'dark', 'song'],
  ['desk-light-library', 'desk', 'light', 'library'],
  ['wide-dark-library', 'wide', 'dark', 'library'],
  ['wide-light-song', 'wide', 'light', 'song'],
];

const brands = {
  apple: {
    library: 'https://music.apple.com/uz/new',
    libraryFallback: 'https://music.apple.com/us/new',
    song: 'https://music.apple.com/uz/song/things-we-said-today/1441164427',
    songNote:
      'Public song page with a lyrics excerpt. Full lyrics sit behind Sign in, which was not opened. ' +
      'The id 1441164427 is Things We Said Today, not Come Together.',
  },
  spotify: {
    library: 'https://open.spotify.com/',
    song: 'https://open.spotify.com/track/2EqlS6tkEnglzr7tkKAAYD',
    songNote:
      'Public track page for Come Together. Lyrics and the full track sit behind Sign in, which was not opened. ' +
      'Play starts a preview and shows the now-playing bar.',
  },
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const onlyBrand = args.brand && args.brand !== 'true' ? args.brand : '';
const part = args.part && args.part !== 'true' ? args.part : 'all';
const onlyFlows = args.flow && args.flow !== 'true' ? args.flow.split(',') : null;
const onlyNames = args.name && args.name !== 'true' ? new Set(args.name.split(',')) : null;

function outDir(brand) {
  return `work/ref/${brand}`;
}

const COOKIE_SENTENCE = /we and our partners use cookies/i;

async function cookieVisible(page) {
  const dialog = page.getByRole('dialog').filter({ hasText: COOKIE_SENTENCE }).first();
  if (await dialog.isVisible().catch(() => false)) return true;
  return page.getByText(COOKIE_SENTENCE).first().isVisible().catch(() => false);
}

async function dismissCookies(page) {
  // Trusted click on Close next to the cookie sentence only. The Premium
  // card, the signup bar and Apple's red upsell also have a close control;
  // they do not carry this sentence.
  if (!(await cookieVisible(page))) return '';
  const hostBox = await page.getByText(COOKIE_SENTENCE).first().boundingBox().catch(() => null);
  const buttons = page.getByRole('button', { name: /^close$/i });
  const count = Math.min(await buttons.count(), 8);
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const box = await button.boundingBox().catch(() => null);
    if (!box || !hostBox) continue;
    // The desktop banner puts Close on the far end of a full-width row.
    const dy = Math.abs(box.y + box.height / 2 - (hostBox.y + hostBox.height / 2));
    if (dy > 220) continue;
    await button.click({ timeout: 2500 }).catch(() => {});
    clicked = true;
    await page.waitForTimeout(400);
    if (!(await cookieVisible(page))) return 'cookie-dismissed';
  }
  return clicked ? 'cookie-still-visible' : 'cookie-visible-no-button';
}

async function settleCookies(page) {
  // The banner often arrives a few seconds after the first paint.
  let last = '';
  let clear = 0;
  for (let i = 0; i < 8; i++) {
    const state = await dismissCookies(page);
    if (state) last = state;
    if (await cookieVisible(page)) clear = 0;
    else if (++clear >= 3) return last || 'clear';
    await page.waitForTimeout(500);
  }
  return last || ((await cookieVisible(page)) ? 'cookie-still-visible' : 'clear');
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const bot = /verify you are human|captcha|are you a robot/i.test(text);
    return {
      title: document.title,
      url: location.href,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bot,
      sample: text.slice(0, 240),
    };
  });
}

async function gotoPage(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const status = res ? res.status() : 0;
  if (status >= 400) throw new Error(`http ${status} for ${url}`);
  await page.waitForTimeout(1600);
  const cookie = await dismissCookies(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return cookie;
}

async function coverPoint(page) {
  // Artwork is often a shadow-DOM image, not an <img> inside the anchor.
  // Prefer a large picture in the viewport, then a large album or playlist card.
  const images = page.locator('img');
  const imageCount = Math.min(await images.count(), 50);
  let best = null;
  for (let i = 0; i < imageCount; i++) {
    const box = await images.nth(i).boundingBox().catch(() => null);
    if (!box || box.width < 100 || box.height < 100 || box.y < 70 || box.y > 760) continue;
    if (!best || box.width * box.height > best.width * best.height) best = box;
  }
  if (best) return { ...best, kind: 'image' };
  const links = page.locator('a[href*="/album/"], a[href*="/playlist/"], a[href*="/track/"], a[href*="/song/"]');
  const linkCount = Math.min(await links.count(), 40);
  for (let i = 0; i < linkCount; i++) {
    const box = await links.nth(i).boundingBox().catch(() => null);
    if (!box || box.width < 160 || box.height < 80 || box.y < 70) continue;
    if (!best || box.width * box.height > best.width * best.height) best = { ...box, kind: 'link' };
  }
  return best;
}

async function waitForCovers(page) {
  const images = page.locator('img');
  const start = Date.now();
  let ready = 0;
  while (Date.now() - start < 8000) {
    const count = Math.min(await images.count(), 24);
    ready = 0;
    for (let i = 0; i < count; i++) {
      const ok = await images.nth(i).evaluate((img) => {
        const box = img.getBoundingClientRect();
        return img.naturalWidth > 40 && box.width > 60 && box.top < window.innerHeight;
      }).catch(() => false);
      if (ok) ready += 1;
    }
    if (ready >= 4) return ready;
    await page.waitForTimeout(400);
  }
  return ready;
}

async function openLibrary(page, brand) {
  const spec = brands[brand];
  const finish = async (cookie, url, extra) => {
    await page.locator('img').first().waitFor({ state: 'visible', timeout: 15000 });
    const covers = await waitForCovers(page);
    const settled = await settleCookies(page);
    return { cookie: settled || cookie, covers, url, ...extra };
  };
  try {
    const cookie = await gotoPage(page, spec.library);
    return await finish(cookie, spec.library, { fallback: false });
  } catch (err) {
    if (!spec.libraryFallback) throw err;
    const cookie = await gotoPage(page, spec.libraryFallback);
    return await finish(cookie, spec.libraryFallback, { fallback: true, error: String(err).split('\n')[0] });
  }
}

async function openSong(page, brand) {
  const cookie = await gotoPage(page, brands[brand].song);
  const ready = brand === 'apple'
    ? '[data-testid="mini-player"], [data-testid="player-bar"]'
    : '[data-testid="play-button"], [data-testid="track-page"]';
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  const again = await settleCookies(page);
  return again || cookie;
}

async function showSpotifyBar(page) {
  const play = page.locator('[data-testid="play-button"]').first();
  const label = (await play.getAttribute('aria-label').catch(() => '')) || '';
  if ((await play.isVisible().catch(() => false)) && !/pause/i.test(label)) {
    await play.click({ timeout: 5000 });
    await page.waitForTimeout(800);
  }
  const bar = page.locator('[data-testid="floating-now-playing-bar"], [data-testid="now-playing-bar"]').first();
  if (await bar.isVisible().catch(() => false)) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    return 'bar';
  }
  return 'no-bar';
}

async function openSpotifyPlayer(page) {
  await showSpotifyBar(page);
  const floating = page.locator('[data-testid="floating-now-playing-bar"]').first();
  const box = await floating.boundingBox({ timeout: 3000 }).catch(() => null);
  if (box) {
    // The pause control sits on the right of the bar. The title is the expand hit.
    await page.mouse.click(box.x + Math.min(box.width * 0.35, 140), box.y + box.height / 2);
    await page.waitForTimeout(900);
    return 'expanded-bar';
  }
  return 'no-floating-bar';
}

async function findTimeline(page) {
  const selectors = ['[data-testid="progress-bar"]', '[data-testid*="scrub"]', '[role="slider"]', 'input[type="range"]'];
  for (const selector of selectors) {
    const loc = page.locator(selector);
    const count = Math.min(await loc.count(), 8);
    for (let i = 0; i < count; i++) {
      const item = loc.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const box = await item.boundingBox({ timeout: 2000 }).catch(() => null);
      if (box && box.width > 80 && box.height > 2 && box.y > 0) return { selector, box };
    }
  }
  return null;
}

async function dragBox(page, box) {
  const y = box.y + Math.min(box.height / 2, 12);
  const x0 = box.x + box.width * 0.08;
  const x1 = box.x + box.width * 0.72;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function sample(page, body) {
  const frames = [];
  const started = Date.now();
  let on = true;
  const pump = (async () => {
    while (on && Date.now() - started < 12000) {
      const t = Date.now();
      const buf = await page.screenshot({ type: 'jpeg', quality: 35, animations: 'disabled' }).catch(() => null);
      if (buf) frames.push(buf);
      const wait = 100 - (Date.now() - t);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();
  let error = '';
  try {
    await body();
  } catch (err) {
    error = String(err.message || err).split('\n')[0];
  } finally {
    on = false;
    await pump;
  }
  return { frames, error };
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
  return { frames: frames.length, width: cols * cellW, height: rows * cellH };
}

async function shootSheets(browser, brand, notes) {
  const dir = `${outDir(brand)}/sheets`;
  mkdirSync(dir, { recursive: true });
  const groups = new Map();
  for (const sheet of sheets) {
    const key = `${sheet[1]}|${sheet[2]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sheet);
  }
  for (const [key, group] of groups) {
    const todo = group.filter(([name]) => !onlyNames || onlyNames.has(name));
    if (!todo.length) continue;
    const [deviceName, scheme] = key.split('|');
    const context = await browser.newContext({ ...devices[deviceName], colorScheme: scheme, locale: 'en-US' });
    const page = await context.newPage();
    for (const [name, , , which] of todo) {
      const file = `${dir}/round0-${name}.png`;
      const row = { file, name, scheme, device: deviceName, page: which };
      try {
        if (which === 'library') {
          row.open = await openLibrary(page, brand);
        } else {
          row.cookie = await openSong(page, brand);
          if (brand === 'spotify') row.player = await showSpotifyBar(page).catch((err) => `no-bar: ${String(err).split('\n')[0]}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
        await page.waitForTimeout(400);
        Object.assign(row, await pageFacts(page));
        await page.screenshot({ path: file });
        const meta = await sharp(file).metadata();
        row.pixels = `${meta.width}x${meta.height}`;
        console.log(file, row.pixels, row.bg);
      } catch (err) {
        row.error = String(err.message || err).split('\n')[0];
        console.log('FAIL', file, row.error);
      }
      notes.sheets.push(row);
    }
    await context.close();
  }
}

async function shootBoard(browser, brand, notes) {
  const context = await browser.newContext({ ...devices.iphone, colorScheme: 'dark', locale: 'en-US' });
  const page = await context.newPage();
  const dest = `${outDir(brand)}/board0-player-3x.png`;
  const row = { file: dest };
  try {
    row.cookie = await openSong(page, brand);
    if (brand === 'spotify') row.player = await showSpotifyBar(page);
    const selectors = brand === 'apple'
      ? ['[data-testid="mini-player"]', '[data-testid="mini-player-container"]', '[data-testid="player-bar"]']
      : ['[data-testid="floating-now-playing-bar"]', '[data-testid="now-playing-bar"]'];
    const viewH = page.viewportSize()?.height || 852;
    let best = null;
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      const box = await loc.boundingBox({ timeout: 2000 }).catch(() => null);
      if (!box || box.width < 200) continue;
      const onScreenBottom = box.y + Math.min(box.height, 80) > viewH - 160;
      const score = (onScreenBottom ? 1000000 : 0) + box.width - box.y;
      if (!best || score > best.score) best = { loc, score, selector, box };
    }
    if (!best) throw new Error('player row not found');
    await dismissCookies(page);
    const box = await best.loc.boundingBox({ timeout: 3000 }).catch(() => null);
    if (!box) throw new Error('player row has no box');
    // Clip the viewport. An element screenshot scrolls the credits strip.
    await page.screenshot({
      path: dest,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 160) },
    });
    const meta = await sharp(dest).metadata();
    row.selector = best.selector;
    row.box = best.box;
    row.pixels = `${meta.width}x${meta.height}`;
    console.log(dest, row.selector, row.pixels);
  } catch (err) {
    row.error = String(err.message || err).split('\n')[0];
    console.log('FAIL', dest, row.error);
  }
  notes.board = row;
  await context.close();
}

function gestures(brand) {
  return [
    {
      name: 'library-song',
      prepare: async (page) => openLibrary(page, brand),
      go: async (page) => {
        const cover = await coverPoint(page);
        if (!cover) throw new Error('no cover link');
        await page.mouse.click(cover.x + cover.width / 2, cover.y + Math.min(cover.height / 2, 80));
        await page.waitForURL((url) => url.href !== brands[brand].library && !url.href.endsWith('/new'), { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(700);
        const cookie = await dismissCookies(page);
        await page.waitForTimeout(500);
        return { kind: cover.kind, landed: page.url(), cookie };
      },
    },
    {
      name: 'scrub',
      prepare: async (page, note) => {
        await openSong(page, brand);
        if (brand === 'spotify') {
          note.player = await openSpotifyPlayer(page);
        } else {
          await page.locator('[data-testid="mini-player"]').first().click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(700);
          const preview = page.getByRole('button', { name: /^preview$/i }).first();
          if (!(await findTimeline(page)) && (await preview.isVisible().catch(() => false))) {
            await preview.click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1200);
            note.preview = 'clicked';
          }
        }
        note.timeline = await findTimeline(page);
        note.facts = await pageFacts(page);
      },
      go: async (page, note) => {
        const timeline = note.timeline || (await findTimeline(page));
        if (timeline) {
          await dragBox(page, timeline.box);
          return { dragged: timeline.selector, timeline: true };
        }
        const bar = page.locator(brand === 'apple' ? '[data-testid="mini-player"]' : '[data-testid="floating-now-playing-bar"]').first();
        const box = await bar.boundingBox({ timeout: 3000 }).catch(() => null);
        if (!box) throw new Error('no timeline and no player bar');
        await dragBox(page, box);
        return { dragged: 'player-bar', timeline: false };
      },
    },
    {
      name: 'settings',
      prepare: async (page) => openSong(page, brand),
      go: async (page) => {
        if (brand === 'apple') {
          const menu = page.locator('[data-testid="menuicon"]').first();
          await menu.click({ timeout: 5000 });
          await page.waitForTimeout(800);
          const label = await menu.getAttribute('aria-label').catch(() => '');
          return { opened: label || 'menuicon' };
        }
        await page.locator('[data-testid="preview-menu-button"]').first().click({ timeout: 5000 });
        await page.getByText(/^log in$/i).first().waitFor({ state: 'visible', timeout: 6000 });
        await page.waitForTimeout(500);
        return { opened: 'preview-menu' };
      },
    },
    {
      name: 'play',
      prepare: async (page) => openSong(page, brand),
      go: async (page) => {
        if (brand === 'apple') {
          const play = page.locator('[data-testid="mini-player-controls"] button').first();
          const box = await play.boundingBox({ timeout: 4000 }).catch(() => null);
          if (!box) {
            const preview = page.getByRole('button', { name: /^preview$/i }).first();
            const previewBox = await preview.boundingBox({ timeout: 2000 }).catch(() => null);
            if (!previewBox) throw new Error('no play control');
            await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
            await page.waitForTimeout(1500);
            return { pressed: 'preview', again: false };
          }
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          await page.mouse.click(x, y);
          await page.waitForTimeout(1500);
          await page.mouse.click(x, y);
          await page.waitForTimeout(800);
          return { pressed: 'mini-player', again: true };
        }
        const button = page.locator('[data-testid="play-button"]').first();
        await button.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        if (await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 5000 });
          await page.waitForTimeout(800);
        }
        return { pressed: 'play', again: true };
      },
    },
  ];
}

async function shootMotion(engineName, browser, brand, notes) {
  const dir = `${outDir(brand)}/video0`;
  mkdirSync(dir, { recursive: true });
  for (const step of gestures(brand)) {
    if (onlyFlows && !onlyFlows.includes(step.name)) continue;
    const dest = `${dir}/${engineName}-${step.name}-contact.png`;
    const note = { file: dest, engine: engineName, flow: step.name };
    const context = await browser.newContext({ ...phoneMotion, colorScheme: 'dark', locale: 'en-US' });
    const page = await context.newPage();
    try {
      note.prepared = await step.prepare(page, note);
      const { frames, error } = await sample(page, async () => {
        await page.waitForTimeout(1000);
        note.action = await step.go(page, note);
        await page.waitForTimeout(1000);
      });
      if (error) note.error = error;
      note.sheet = await contactSheet(frames, dest);
      note.factsAfter = await pageFacts(page);
      console.log(dest, note.sheet.frames, 'frames', note.action || note.error || '');
    } catch (err) {
      note.error = String(err.message || err).split('\n')[0];
      console.log('FAIL', dest, note.error);
    }
    notes.motion.push(note);
    await context.close();
  }
}

function frozenFiles(brand) {
  const root = outDir(brand);
  const files = [
    ...sheets.map(([name]) => `${root}/sheets/round0-${name}.png`),
    `${root}/board0-player-3x.png`,
  ];
  for (const engine of ['chromium', 'webkit']) {
    for (const flow of ['library-song', 'scrub', 'settings', 'play']) {
      files.push(`${root}/video0/${engine}-${flow}-contact.png`);
    }
  }
  return files;
}

function expected(brand) {
  const root = outDir(brand);
  const files = [];
  if (part === 'all' || part === 'sheets') {
    files.push(...sheets.filter(([name]) => !onlyNames || onlyNames.has(name)).map(([name]) => `${root}/sheets/round0-${name}.png`));
  }
  if (part === 'all' || part === 'board') files.push(`${root}/board0-player-3x.png`);
  if (part === 'all' || part === 'motion') {
    for (const engine of ['chromium', 'webkit']) {
      for (const flow of ['library-song', 'scrub', 'settings', 'play']) {
        if (onlyFlows && !onlyFlows.includes(flow)) continue;
        files.push(`${root}/video0/${engine}-${flow}-contact.png`);
      }
    }
  }
  return files;
}

async function captureBrand(brand) {
  const notes = {
    brand,
    captured: new Date().toISOString(),
    pages: {
      library: brands[brand].library,
      song: brands[brand].song,
      songNote: brands[brand].songNote,
    },
    storefront: brand === 'apple'
      ? 'music.apple.com/uz/ because /us/ shows a country sheet on this network. The sheet was not dismissed. The red upsell banner was left in place.'
      : 'open.spotify.com. Cookie banner dismissed when it was visible. The Premium card on the home page was left in place.',
    colourScheme: brand === 'apple'
      ? 'emulated prefers-color-scheme. Recorded body background is in each sheet row.'
      : 'emulated prefers-color-scheme. Spotify has previously ignored it and stayed dark; compare sheet bg values.',
    sheets: [],
    motion: [],
    viewportNote:
      'Stills are the viewport, not the full page. The public browse is many screens long; the studio library is only slightly taller than one screen.',
  };
  mkdirSync(outDir(brand), { recursive: true });
  if (part === 'all' || part === 'sheets') {
    const browser = await chromium.launch({ headless: true });
    await shootSheets(browser, brand, notes);
    await browser.close();
  }
  if (part === 'all' || part === 'board') {
    const browser = await chromium.launch({ headless: true });
    await shootBoard(browser, brand, notes);
    await browser.close();
  }
  if (part === 'all' || part === 'motion') {
    const chrome = await chromium.launch({ headless: true });
    await shootMotion('chromium', chrome, brand, notes);
    await chrome.close();
    try {
      const kit = await webkit.launch({ headless: true });
      await shootMotion('webkit', kit, brand, notes);
      await kit.close();
    } catch (err) {
      notes.webkitLaunch = String(err.message || err).split('\n')[0];
      console.log('FAIL webkit launch', notes.webkitLaunch);
    }
  }
  const previousPath = `${outDir(brand)}/capture-notes.json`;
  if (part !== 'all' && existsSync(previousPath)) {
    const previous = JSON.parse(readFileSync(previousPath, 'utf8'));
    if (part !== 'sheets') notes.sheets = previous.sheets || [];
    else if (onlyNames) {
      const kept = (previous.sheets || []).filter((row) => !onlyNames.has(row.name));
      notes.sheets = [...kept, ...notes.sheets];
    }
    if (part !== 'board') notes.board = previous.board || null;
    if (part !== 'motion') notes.motion = previous.motion || [];
    else if (onlyFlows) {
      const kept = (previous.motion || []).filter((row) => !onlyFlows.includes(row.flow));
      notes.motion = [...kept, ...notes.motion];
    }
    const names = onlyNames ? [...onlyNames].join(',') : '';
    notes.partial = `${part}${onlyFlows ? `:${onlyFlows.join(',')}` : ''}${names ? `:${names}` : ''}`;
  }
  const partMissing = expected(brand).filter((file) => !existsSync(file));
  notes.missing = frozenFiles(brand).filter((file) => !existsSync(file));
  writeFileSync(previousPath, JSON.stringify(notes, null, 2));
  console.log(brand, 'missing', notes.missing.length);
  return partMissing;
}

const wanted = onlyBrand ? [onlyBrand] : ['apple', 'spotify'];
const missing = [];
for (const brand of wanted) {
  if (!brands[brand]) {
    console.error('unknown brand', brand);
    process.exit(1);
  }
  missing.push(...(await captureBrand(brand)));
}
if (missing.length) {
  console.error('missing files:\n  ' + missing.join('\n  '));
  process.exit(1);
}
