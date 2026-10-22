// Drawn checks for docs/design/fixed-defects.md. One named check per row.
// DOM counts and animation schedules are not checks. D20 is the vite build in gate.mjs.
// node scripts/perf/defects.mjs --base http://127.0.0.1:4176
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { corpusFor, sampleInPage } from './drawn.mjs';
import { installResolvedAudio, installWebKitClock, prepareAudio } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const only = args.only && args.only !== 'true' ? args.only : '';
const corpus = corpusFor('karitas');
const iphoneUa =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const results = [];
function note(name, ok, detail = '') {
  if (only && !name.includes(only)) return;
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

function songDurations() {
  const map = {};
  for (const slug of readdirSync('content/songs')) {
    const file = `content/songs/${slug}/song.json`;
    if (!existsSync(file)) continue;
    const song = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof song.duration === 'number' && song.duration > 1) map[slug] = song.duration;
  }
  return map;
}

async function installSilence(context, browserName) {
  const map = songDurations();
  const cache = new Map();
  await installResolvedAudio(context, (url) => {
    const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
    const seconds = map[slug];
    if (!seconds) return null;
    const key = String(seconds);
    if (!cache.has(key)) cache.set(key, prepareAudio(seconds, 'work/studio/silence'));
    return cache.get(key);
  });
  if (browserName === 'webkit') await installWebKitClock(context, map);
}

function phone(width = 393, height = 852) {
  return {
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUa,
  };
}

function lin(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luma(rgb) {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
function contrast(a, b) {
  const hi = Math.max(luma(a), luma(b));
  const lo = Math.min(luma(a), luma(b));
  return (hi + 0.05) / (lo + 0.05);
}
function near(rgb, target) {
  return Math.hypot(rgb[0] - target[0], rgb[1] - target[1], rgb[2] - target[2]);
}

async function paintOf(buffer) {
  const { data, info } = await sharp(buffer).resize(32, 18, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  const sum = [0, 0, 0];
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] < 3 && data[i + 1] < 3 && data[i + 2] < 3) black += 1;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  return { rgb: sum.map((v) => Math.round(v / n)), blackPct: black / n };
}

async function meanDiff(a, b, box, scale) {
  if (!box) return 99;
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  const cut = async (buf) => {
    const meta = await sharp(buf).metadata();
    const w = Math.min(width, (meta.width || width) - left);
    const h = Math.min(height, (meta.height || height) - top);
    return sharp(buf).extract({ left, top, width: Math.max(1, w), height: Math.max(1, h) }).removeAlpha().raw().toBuffer();
  };
  const leftBuf = await cut(a);
  const rightBuf = await cut(b);
  const n = Math.min(leftBuf.length, rightBuf.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(leftBuf[i] - rightBuf[i]);
  return n ? sum / n : 99;
}

function frameFacts() {
  const chain = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!(Number(style.opacity) > 0.05)) return false;
      }
      const root = node.getRootNode();
      const next = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
      if (!next || next === node) break;
      node = next;
    }
    return true;
  };
  const header = document.querySelector('.topbar');
  const stage = document.querySelector('.scene-stage');
  let underHeader = false;
  if (header && stage) {
    const h = header.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    for (const el of stage.querySelectorAll('.fb-orig .w, .fb-tr, .intro-title')) {
      if (!chain(el)) continue;
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, s.top);
      const bottom = Math.min(r.bottom, s.bottom);
      const left = Math.max(r.left, s.left);
      const right = Math.min(r.right, s.right);
      if (bottom - top < 2 || right - left < 2) continue;
      const x = Math.min(right, h.right) - Math.max(left, h.left);
      const y = Math.min(bottom, h.bottom) - Math.max(top, h.top);
      if (x > 2 && y > 2) underHeader = true;
    }
  }
  const card = document.querySelector('.note-card');
  return {
    dragging: !!document.querySelector('.song.is-scrubbing'),
    card: card ? Number(getComputedStyle(card).opacity) : null,
    underHeader,
  };
}

async function openSong(page, query = 't=42') {
  await page.goto(`${base}/song/karitas?${query}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.scene').waitFor({ timeout: 8000 });
  await page.waitForFunction(
    () => {
      const song = document.querySelector('.song');
      const raw = song ? getComputedStyle(song).getPropertyValue('--player-h') : '';
      return parseFloat(raw) > 40 && document.querySelector('.fb--line, .fb--intro, .ist-art, .ist-art-mount');
    },
    { timeout: 8000 },
  );
}

async function runFirstPaint(browser, browserName) {
  for (const scheme of ['dark', 'light']) {
    const context = await browser.newContext({ ...phone(), colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'commit' });
    const shot = await page.screenshot({ type: 'png', animations: 'disabled' });
    const paint = await paintOf(shot);
    const target = scheme === 'dark' ? [7, 6, 12] : [239, 230, 218];
    const dist = near(paint.rgb, target);
    note(
      `${browserName} D1 first-paint-theme`,
      paint.blackPct < 0.05 && dist < 48,
      `${scheme} rgb=${paint.rgb.join(',')} black=${paint.blackPct.toFixed(3)} dist=${Math.round(dist)}`,
    );
    await context.close();
  }
}

async function runFlight(browser, browserName) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const hero = document.querySelector('.lib-hero');
        if (!hero) {
          resolve([]);
          return;
        }
        const rows = [];
        hero.addEventListener(
          'click',
          () => {
            const t0 = performance.now();
            const sample = () => {
              const cover = document.querySelector('.morph-cover');
              const art = document.querySelector('.now-art');
              const title = document.querySelector('.lib-hero-title');
              const go = document.querySelector('.lib-hero-go');
              const box = (el) => {
                if (!(el instanceof HTMLElement)) return null;
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return null;
                return { w: Math.round(r.width), h: Math.round(r.height) };
              };
              const coverBox = cover instanceof HTMLElement ? cover.getBoundingClientRect() : null;
              rows.push({
                cover: coverBox ? Math.round(coverBox.width) : 0,
                flying: !!document.querySelector('.song.is-flying'),
                art: art instanceof HTMLElement ? Number(getComputedStyle(art).opacity) : null,
                title: box(title),
                go: box(go),
              });
              if (performance.now() - t0 < 900) requestAnimationFrame(sample);
              else resolve(rows);
            };
            requestAnimationFrame(sample);
          },
          { once: true },
        );
        hero.click();
      }),
  );
  const flying = (samples || []).filter((row) => row.flying);
  const shownArt = flying.filter((row) => row.art != null && row.art > 0.05);
  note(
    `${browserName} D2 header-thumb-hidden-in-flight`,
    flying.length > 0 && shownArt.length === 0,
    `flying ${flying.length} thumb ${shownArt.length}`,
  );
  const captions = (samples || []).filter((row) => row.title && row.go);
  const span = (key, side) => {
    const values = captions.map((row) => row[key][side]);
    return values.length ? Math.max(...values) - Math.min(...values) : 99;
  };
  note(
    `${browserName} D3 caption-boxes-stable`,
    captions.length >= 2 && span('title', 'w') <= 2 && span('title', 'h') <= 2 && span('go', 'w') <= 2 && span('go', 'h') <= 2,
    `n ${captions.length} title ${span('title', 'w')}x${span('title', 'h')} go ${span('go', 'w')}x${span('go', 'h')}`,
  );
  const widths = [...new Set((samples || []).filter((row) => row.cover > 24).map((row) => Math.round(row.cover / 8) * 8))];
  note(`${browserName} D14 flight-intermediate-widths`, widths.length >= 4, `widths ${widths.join(',')}`);
  await context.close();
}

async function scrubClock(page) {
  const frames = [];
  const track = page.locator('.scrub-track').first();
  const box = await track.boundingBox();
  if (!box) return frames;
  const y = box.y + box.height / 2;
  const x0 = box.x + 8;
  const x1 = box.x + box.width * (705 / 977);
  const read = async () => {
    const drawn = await page.evaluate(sampleInPage, corpus);
    const facts = await page.evaluate(frameFacts);
    frames.push({ drawn, facts });
  };
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now);
  await read();
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.clock.runFor(40);
  await read();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 24, y);
    if (i === 8) await page.clock.runFor(420);
    else if (i === 9) {
      await page.clock.runFor(16);
      await read();
      await page.clock.runFor(80);
    } else await page.clock.runFor(40);
    await read();
  }
  await page.mouse.up();
  await page.clock.runFor(240);
  await read();
  await page.clock.runFor(400);
  await read();
  return frames;
}

function judgeScrub(browserName, frames) {
  const empty = frames.filter((frame) => frame.facts.dragging && (frame.drawn?.bad || []).includes('empty'));
  const textOverlap = frames.filter((frame) => (frame.drawn?.overlap || []).some((row) => !String(row).startsWith('engraving')));
  const corpusBad = frames.filter((frame) => (frame.drawn?.bad || []).some((row) => row !== 'empty'));
  const artOverlap = frames.filter((frame) => (frame.drawn?.overlap || []).some((row) => String(row).startsWith('engraving')));
  const under = frames.filter((frame) => frame.facts.underHeader);
  const held = frames.filter((frame) => frame.facts.dragging && frame.facts.card != null).map((frame) => frame.facts.card);
  let rose = false;
  for (let i = 1; i < held.length; i++) if (held[i] > held[i - 1] + 0.05) rose = true;
  note(`${browserName} D7 note-opacity-monotonic`, held.length >= 3 && !rose, `n ${held.length} rose ${rose}`);
  note(`${browserName} D8 scrub-frame-not-empty`, frames.length > 8 && empty.length === 0, `frames ${frames.length} empty ${empty.length}`);
  note(`${browserName} D9 drawn-text-no-overlap`, textOverlap.length === 0, textOverlap[0] ? textOverlap[0].drawn.overlap.join(' | ') : `frames ${frames.length}`);
  note(`${browserName} D10 drawn-text-in-corpus`, corpusBad.length === 0, corpusBad[0] ? corpusBad[0].drawn.bad.join(' | ') : `frames ${frames.length}`);
  note(`${browserName} D11 no-text-under-header`, under.length === 0, `under ${under.length}`);
  note(
    `${browserName} D21 engraving-text-no-overlap`,
    frames.length > 8 && artOverlap.length === 0,
    artOverlap[0] ? `overlap ${artOverlap.length}` : `frames ${frames.length}`,
  );
}

async function releaseMatch(context, page, browserName) {
  // The page clock freezes the scene. A real audio element does not, so a
  // second page opened in the same context stayed black and the finger's
  // picture was compared with an empty stage.
  await page.clock.runFor(200);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('audio')) {
      try { el.pause(); } catch { /* already quiet */ }
    }
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
    const bubble = document.querySelector('.scrub-preview');
    if (bubble instanceof HTMLElement) bubble.style.visibility = 'hidden';
  });
  const box = await page.locator('.scene-stage').boundingBox();
  const scale = await page.evaluate(() => window.devicePixelRatio || 1);
  const seconds = await page.evaluate(() => {
    const track = document.querySelector('.scrub-track');
    const exact = Number(track?.getAttribute('data-t'));
    const rounded = Number(track?.getAttribute('aria-valuenow'));
    return Number.isFinite(exact) ? exact : rounded;
  });
  const released = await page.screenshot({ type: 'png', animations: 'disabled' });
  const browser = context.browser();
  const fresh = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(fresh, browserName);
  const other = await fresh.newPage();
  await other.goto(`${base}/song/karitas?t=${seconds}`, { waitUntil: 'networkidle' });
  await other.evaluate(() => document.fonts.ready);
  await other.waitForFunction(
    (target) => {
      const drawn = document.querySelector('.fb--line .w, .intro-title, .ist-art, .ist-art-mount');
      const exact = Number(document.querySelector('.scrub-track')?.getAttribute('data-t'));
      return !!drawn && Number.isFinite(exact) && Math.abs(exact - target) < 0.75;
    },
    seconds,
    { timeout: 12000 },
  );
  await other
    .waitForFunction(
      () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/features.json') && entry.responseEnd > 0),
      { timeout: 8000 },
    )
    .catch(() => {});
  await other.evaluate(() => {
    for (const el of document.querySelectorAll('audio')) {
      try { el.pause(); } catch { /* already quiet */ }
    }
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
  });
  await other.waitForTimeout(180);
  const sought = await other.screenshot({ type: 'png', animations: 'disabled' });
  const mean = await meanDiff(released, sought, box, scale);
  if (mean >= 1) {
    const stamp = await other.evaluate(() => ({
      data: document.querySelector('.scrub-track')?.getAttribute('data-t') || '',
      line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' ').slice(0, 80),
      depart: document.querySelectorAll('.scene-depart').length,
    }));
    const held = await page.evaluate(() => ({
      line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' ').slice(0, 80),
      depart: document.querySelectorAll('.scene-depart').length,
    }));
    mkdirSync('work/studio/r19-debug', { recursive: true });
    writeFileSync('work/studio/r19-debug/d15-released.png', released);
    writeFileSync('work/studio/r19-debug/d15-seek.png', sought);
    console.log(`D15 debug target ${seconds} seek ${JSON.stringify(stamp)} held ${JSON.stringify(held)}`);
  }
  await fresh.close();
  return mean;
}

async function runScrub(browser, browserName) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  await page.clock.install({ time: Date.now() });
  await openSong(page);
  // Real media time ignores the page clock and walks off the finger.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('audio')) {
      try { el.pause(); } catch { /* not playing yet */ }
    }
  });
  const frames = await scrubClock(page);
  judgeScrub(browserName, frames);
  let mean = 99;
  try {
    mean = await releaseMatch(context, page, browserName);
  } catch (err) {
    mean = 99;
    note(`${browserName} D15 release-matches-seek`, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  if (mean !== 99 || results.every((row) => !row.name.includes(`${browserName} D15`))) {
    note(`${browserName} D15 release-matches-seek`, mean < 1, `mean ${mean.toFixed(3)}`);
  }
  await context.close();
}

async function runPress(browser, browserName) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  await openSong(page);
  const play = page.locator('.player .btn-ring').first();
  const box = await play.boundingBox();
  if (!box) {
    note(`${browserName} D6 play-release-peak`, false, 'no disc');
  } else {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(180);
    await page.mouse.up();
    // The disc holds 0.80 for 150 ms, then the release spring peaks near 1.027.
    // WebKit delivers that peak about 850 ms after pointerup when the sampler
    // is also in the page, so a 420 ms window stopped on the way up.
    const scales = [];
    const start = Date.now();
    while (Date.now() - start < 1100) {
      const scale = await page.evaluate(() => {
        const el = document.querySelector('.player .btn-ring');
        if (!(el instanceof HTMLElement)) return 1;
        const inline = /scale\(([^)]+)\)/.exec(el.style.transform);
        if (inline) return Number(inline[1]);
        const transform = getComputedStyle(el).transform;
        const match = /matrix\(([^)]+)\)/.exec(transform);
        if (!match) return 1;
        return Number(match[1].split(',')[0]);
      });
      scales.push(scale);
      await page.waitForTimeout(16);
    }
    const peak = scales.length ? Math.max(...scales) : 0;
    note(`${browserName} D6 play-release-peak`, peak >= 1.02 && peak <= 1.035, `peak ${peak.toFixed(3)}`);
  }
  await context.close();
}

async function runPlay(browser, browserName) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  await openSong(page);
  const before = await page.evaluate(() => ({
    clock: document.querySelector('.scrub-now')?.textContent || '',
    line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' '),
  }));
  await page.locator('.player .btn-ring').first().click();
  const playing = await page
    .waitForFunction(() => document.querySelector('.player .btn-ring')?.getAttribute('aria-label') === 'Пауза', null, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(5200);
  const after = await page.evaluate(() => ({
    clock: document.querySelector('.scrub-now')?.textContent || '',
    line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' '),
    label: document.querySelector('.player .btn-ring')?.getAttribute('aria-label') || '',
  }));
  const clockOf = (text) => {
    const hit = /(\d+):(\d{2})/.exec(text || '');
    return hit ? Number(hit[1]) * 60 + Number(hit[2]) : Number.NaN;
  };
  const clock = clockOf(after.clock) - clockOf(before.clock);
  const moved = after.line.trim() !== before.line.trim() && after.line.trim().length > 0;
  note(
    `${browserName} D16 play-clock-advances`,
    playing && after.label === 'Пауза' && clock >= 3 && moved,
    `clock ${before.clock}->${after.clock} (${clock}) line ${moved} glyph=${after.label}`,
  );
  await context.close();
}

function watchSheet() {
  return new Promise((resolve) => {
    const rows = [];
    const hit = (a, b) => {
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return x > 2 && y > 2;
    };
    const read = () => {
      const sheet = document.querySelector('.sheet');
      const card = document.querySelector('.note-card');
      const sb = sheet instanceof HTMLElement ? sheet.getBoundingClientRect() : null;
      const cb = card instanceof HTMLElement ? card.getBoundingClientRect() : null;
      const body = document.querySelector('.sheet-body');
      const bb = body instanceof HTMLElement ? body.getBoundingClientRect() : null;
      const bodyShown = bb ? Math.min(bb.bottom, window.innerHeight) - Math.max(bb.top, 0) : 0;
      // The grabber enters before any row. The empty-body defect is a body that
      // is already on screen while its rows are still transparent.
      const visible = bodyShown >= 72;
      const sheetOn = !!(sb && sb.height > 80 && sb.top < window.innerHeight - 40 && sb.bottom > 40);
      const rowBoxes = body
        ? [...body.querySelectorAll('.row')].filter((el) => {
            const r = el.getBoundingClientRect();
            const op = Number(getComputedStyle(el).opacity);
            return op > 0.05 && r.height > 8 && r.width > 8 && r.top < window.innerHeight && r.bottom > (bb ? bb.top : 0);
          }).length
        : 0;
      const cardOp = card instanceof HTMLElement ? Number(getComputedStyle(card).opacity) : null;
      rows.push({
        visible,
        rowBoxes,
        cardOp,
        overlap: !!(sheetOn && cb && cardOp != null && cardOp > 0.05 && sb && hit(sb, cb)),
        sheetTop: sb ? sb.top : null,
        cardTop: cb ? cb.top : null,
      });
    };
    const button = document.querySelector('button[aria-label="Настройки"]');
    if (!button) {
      resolve([]);
      return;
    }
    button.click();
    const tick = () => {
      read();
      if (rows.length < 72) requestAnimationFrame(tick);
      else resolve(rows);
    };
    requestAnimationFrame(tick);
  });
}

async function runSheet(browser, browserName) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  await openSong(page);
  const rows = await page.evaluate(watchSheet);
  const first = (rows || []).find((row) => row.visible);
  note(
    `${browserName} D4 sheet-rows-on-first-visible-frame`,
    !!first && first.rowBoxes >= 1,
    first ? `rows ${first.rowBoxes}` : 'sheet never visible',
  );
  const crossed = (rows || []).filter((row) => row.overlap);
  note(`${browserName} D5 note-sheet-no-overlap`, (rows || []).length > 4 && crossed.length === 0, `overlap ${crossed.length}`);
  const fade = (rows || []).map((row) => row.cardOp).filter((n) => n != null);
  const steps = [];
  for (const value of fade) {
    const bucket = Math.round(value * 20) / 20;
    if (!steps.length || Math.abs(steps[steps.length - 1] - bucket) > 0.04) steps.push(bucket);
  }
  const decreasing = steps.every((value, i) => i === 0 || value <= steps[i - 1] + 0.001);
  const passed = (rows || []).find((row) => row.sheetTop != null && row.cardTop != null && row.sheetTop <= row.cardTop);
  const goneBefore = passed
    ? passed.cardOp <= 0.05
    : (rows || []).some((row) => row.cardOp != null && row.cardOp <= 0.05 && row.sheetTop != null && row.cardTop != null && row.sheetTop > row.cardTop);
  note(
    `${browserName} D22 note-fade-before-sheet`,
    steps.length >= 3 && decreasing && goneBefore,
    `steps ${steps.join('>')} before ${goneBefore}`,
  );
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('.sheet');
      if (!(dialog instanceof HTMLElement)) return false;
      const box = dialog.getBoundingClientRect();
      return box.height > 120 && box.top < window.innerHeight - 40;
    },
    { timeout: 5000 },
  );
  const hug = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    if (!(sheet instanceof HTMLElement)) return null;
    const sb = sheet.getBoundingClientRect();
    const rows = [...sheet.querySelectorAll('.row')];
    const last = rows[rows.length - 1];
    const lb = last instanceof HTMLElement ? last.getBoundingClientRect() : null;
    return {
      ratio: sb.height / window.innerHeight,
      gap: lb ? sb.bottom - lb.bottom : 999,
      rows: rows.length,
    };
  });
  note(
    `${browserName} D23 sheet-hugs-content`,
    !!hug && hug.rows >= 3 && hug.ratio < 0.62 && hug.gap < 96,
    hug ? `ratio ${hug.ratio.toFixed(2)} gap ${Math.round(hug.gap)} rows ${hug.rows}` : 'no sheet',
  );
  await context.close();
}

async function runNoteClearance(browser) {
  for (const width of [320, 375, 393]) {
    const context = await browser.newContext({ ...phone(width, width === 320 ? 568 : width === 375 ? 667 : 852), colorScheme: 'dark' });
    await installSilence(context, 'chromium');
    const page = await context.newPage();
    await openSong(page);
    const gap = await page.evaluate(() => {
      const card = document.querySelector('.note-card');
      const player = document.querySelector('.player');
      if (!(card instanceof HTMLElement) || !(player instanceof HTMLElement)) return null;
      const c = card.getBoundingClientRect();
      const p = player.getBoundingClientRect();
      return { card: Math.round(c.bottom), player: Math.round(p.top), ok: c.bottom <= p.top + 0.5 && c.height > 32 };
    });
    note(`chromium D17 note-above-player`, !!gap && gap.ok, gap ? `${width} card ${gap.card} player ${gap.player}` : `${width} missing`);
    await context.close();
  }
}

async function runColumn(browser) {
  for (const [width, height, scheme] of [
    [1440, 900, 'dark'],
    [2560, 1440, 'light'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme });
    await installSilence(context, 'chromium');
    const page = await context.newPage();
    await openSong(page);
    const column = await page.evaluate(() => {
      const header = document.querySelector('.topbar');
      const stage = document.querySelector('.scene-stage');
      const player = document.querySelector('.player');
      if (!(header instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(player instanceof HTMLElement)) return null;
      const h = header.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      const p = player.getBoundingClientRect();
      return { header: Math.round(h.width), stage: Math.round(s.width), player: Math.round(p.width) };
    });
    const ok = !!column && column.header <= 920 && column.stage <= 920 && column.player <= 920;
    note(`chromium D18 column-width-cap`, ok, column ? `${width} header ${column.header} stage ${column.stage} player ${column.player}` : `${width} missing`);
    await context.close();
  }
}

async function runPressed(browser) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  await openSong(page);
  const button = page.locator('.player .util', { hasText: 'Перевод' }).first();
  await button.click();
  await page.waitForTimeout(80);
  const sample = await page.evaluate(() => {
    const pressed = document.querySelector('.player .util[aria-pressed="true"]');
    const player = document.querySelector('.player');
    if (!(pressed instanceof HTMLElement) || !(player instanceof HTMLElement)) return null;
    const b = pressed.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    const spots = [
      [b.x + b.width / 2, b.y - 8],
      [b.x - 6, b.y + b.height / 2],
      [b.x + b.width + 6, b.y + 6],
      [p.x + 18, b.y + 8],
    ];
    let spot = { x: p.x + 18, y: Math.max(p.y + 8, b.y - 8) };
    for (const [x, y] of spots) {
      const hit = document.elementFromPoint(x, y);
      if (!(hit instanceof Element)) continue;
      if (hit.closest('.util, .btn, .scrub-now, .scrub-remain, .scrub-track')) continue;
      spot = { x, y };
      break;
    }
    return {
      button: { x: b.x, y: b.y, w: b.width, h: b.height },
      spot,
    };
  });
  if (!sample) {
    note('chromium D19 pressed-tab-no-fill', false, 'no pressed tab');
  } else {
    const shot = await page.screenshot({ type: 'png' });
    const scale = await page.evaluate(() => window.devicePixelRatio || 1);
    const pixel = async (x, y) => {
      const left = Math.max(0, Math.round(x * scale));
      const top = Math.max(0, Math.round(y * scale));
      const { data } = await sharp(shot).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    // The glyph and the label are accent-coloured. A filled plate would shift
    // the median of the button; the glass around the glyph matches the floor
    // beside it. The top edge of the player is a different band of the same glass.
    const grid = [];
    const cols = 5;
    const rowsN = 3;
    for (let iy = 0; iy < rowsN; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const x = sample.button.x + (sample.button.w * (ix + 0.5)) / cols;
        const y = sample.button.y + (sample.button.h * (iy + 0.5)) / rowsN;
        grid.push(await pixel(x, y));
      }
    }
    const dock = await pixel(sample.spot.x, sample.spot.y);
    const close = grid.filter((rgb) => near(rgb, dock) < 48).length;
    note('chromium D19 pressed-tab-no-fill', close >= 6, `floor pixels ${close}/15`);
  }
  await context.close();
}

async function runIntro(browser) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  await openSong(page, 't=0');
  await page.waitForTimeout(400);
  const art = await page.evaluate(() => {
    const stage = document.querySelector('.scene-stage');
    if (!stage) return 0;
    const chain = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (!(Number(style.opacity) > 0.05)) return false;
        }
        const root = node.getRootNode();
        const next = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
        if (!next || next === node) break;
        node = next;
      }
      const box = el.getBoundingClientRect();
      return box.width > 8 && box.height > 8;
    };
    let n = 0;
    const walk = (root) => {
      for (const el of root.querySelectorAll('.ist-art, .ist-art-mount')) {
        if (el.classList.contains('ist-art') && chain(el)) n += 1;
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(stage);
    return n;
  });
  note('chromium D13 intro-engraving', art >= 1, `arts ${art}`);
  const title = await page.evaluate(() => {
    const el = document.querySelector('.intro-title');
    const stage = document.querySelector('.scene-stage');
    if (!(el instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
    const t = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      x: t.x, y: t.y, w: t.width, h: t.height,
      field: { x: s.x + 12, y: s.y + 28 },
      inStage: t.top >= s.top + 2 && t.bottom <= s.bottom + 2,
    };
  });
  if (!title) {
    note('chromium D12 intro-title-contrast', false, 'no title');
  } else {
    const shot = await page.screenshot({ type: 'png' });
    const scale = await page.evaluate(() => window.devicePixelRatio || 1);
    const pixel = async (x, y) => {
      const left = Math.max(0, Math.round(x * scale));
      const top = Math.max(0, Math.round(y * scale));
      const { data } = await sharp(shot).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    const field = await pixel(title.field.x, title.field.y);
    let best = 1;
    const cols = 8;
    const rowsN = 3;
    for (let iy = 0; iy < rowsN; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const rgb = await pixel(
          title.x + (title.w * (ix + 0.5)) / cols,
          title.y + (title.h * (iy + 0.5)) / rowsN,
        );
        const ratio = contrast(rgb, field);
        if (ratio > best) best = ratio;
      }
    }
    note('chromium D12 intro-title-contrast', title.inStage && best >= 4.5, `contrast ${best.toFixed(2)} inStage ${title.inStage}`);
  }
  await context.close();
}

async function runLandscape(browser) {
  const context = await browser.newContext({ ...phone(852, 393), colorScheme: 'dark' });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  await openSong(page);
  const land = await page.evaluate(() => {
    const stage = document.querySelector('.scene-stage');
    if (!(stage instanceof HTMLElement)) return null;
    const s = stage.getBoundingClientRect();
    const mid = s.top + s.height * 0.5;
    const shown = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || !(Number(style.opacity) > 0.05)) return false;
        }
        node = node.parentElement;
      }
      return true;
    };
    let lower = false;
    for (const el of document.querySelectorAll('.fb--line:not(.is-current) .fb-orig')) {
      if (!(el instanceof HTMLElement) || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      if (r.height > 8 && center >= mid && center <= s.bottom && r.top < s.bottom - 8 && r.bottom > s.top) lower = true;
    }
    const label = document.querySelector('.util-label');
    const lb = label instanceof HTMLElement ? label.getBoundingClientRect() : null;
    return { lower, label: lb ? Math.round(lb.width) : 0, stage: Math.round(s.height) };
  });
  note(
    'chromium D24 landscape-next-line-labels',
    !!land && land.lower && land.label > 8,
    land ? `lower ${land.lower} label ${land.label} stage ${land.stage}` : 'missing',
  );
  await context.close();
}

async function runDisc(browser) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  await openSong(page);
  const quiet = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('.scrub-seg')];
    const visible = marks.filter((el) => el instanceof HTMLElement && Number(getComputedStyle(el).opacity) > 0.05);
    return { total: marks.length, visible: visible.length };
  });
  const disc = await page.locator('.player .btn-ring').first().screenshot();
  const meta = await sharp(disc).metadata();
  const band = async (top, height) => {
    const { data, info } = await sharp(disc)
      .extract({ left: 0, top, width: meta.width || 1, height })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    const n = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / n;
  };
  const h = meta.height || 1;
  const quarter = Math.max(1, Math.round(h / 4));
  const top = await band(1, quarter);
  const bottom = await band(h - quarter - 1, quarter);
  const flat = Math.abs(top - bottom) < 14;
  note(
    'chromium D25 ticks-near-thumb-flat-disc',
    quiet.total >= 1 && quiet.visible <= 4 && flat,
    `ticks ${quiet.visible}/${quiet.total} disc ${top.toFixed(1)} vs ${bottom.toFixed(1)}`,
  );
  await context.close();
}

function parseHex(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function runAccentRest(browser) {
  const context = await browser.newContext({ ...phone(), colorScheme: 'dark' });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  await openSong(page);
  const spots = await page.evaluate(() => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--song-accent-dark').trim();
    const box = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const word = document.querySelector('.fb--line.is-current .w:not(.is-filling)');
    return {
      hex,
      disc: box(document.querySelector('.player .btn-ring')),
      rail: box(document.querySelector('.scrub-rail')),
      label: box(document.querySelector('.player .util-label')),
      title: box(document.querySelector('.topbar-song')),
      word: box(word),
    };
  });
  const accent = parseHex(spots && spots.hex);
  if (!accent || !spots?.disc) {
    note('chromium D26 play-disc-only-accent', false, 'no disc or accent');
  } else {
    const discShot = await page.locator('.player .btn-ring').first().screenshot();
    const discMeta = await sharp(discShot).metadata();
    const dw = discMeta.width || 1;
    const dh = discMeta.height || 1;
    const discPixel = async (x, y) => {
      const left = Math.max(0, Math.min(dw - 1, Math.round(x)));
      const top = Math.max(0, Math.min(dh - 1, Math.round(y)));
      const { data } = await sharp(discShot).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    const discPoints = [
      [dw * 0.5, dh * 0.18],
      [dw * 0.5, dh * 0.82],
      [dw * 0.18, dh * 0.5],
      [dw * 0.82, dh * 0.5],
    ];
    let discHits = 0;
    for (const [x, y] of discPoints) {
      if (near(await discPixel(x, y), accent) < 40) discHits += 1;
    }
    const pageShot = await page.screenshot({ type: 'png' });
    const scale = await page.evaluate(() => window.devicePixelRatio || 1);
    const pagePixel = async (x, y) => {
      const left = Math.max(0, Math.round(x * scale));
      const top = Math.max(0, Math.round(y * scale));
      const { data } = await sharp(pageShot).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    const quiet = [];
    for (const key of ['rail', 'label', 'title', 'word']) {
      const b = spots[key];
      if (!b) continue;
      quiet.push(near(await pagePixel(b.x + b.w / 2, b.y + b.h / 2), accent));
    }
    const leaked = quiet.filter((d) => d < 48).length;
    note(
      'chromium D26 play-disc-only-accent',
      discHits >= 3 && leaked === 0 && quiet.length >= 3,
      `disc ${discHits}/4 quiet ${quiet.map((d) => Math.round(d)).join(',')}`,
    );
  }
  await context.close();
}

async function runFootnote(browser) {
  for (const width of [320, 375, 393]) {
    const height = width === 320 ? 568 : width === 375 ? 667 : 852;
    const context = await browser.newContext({ ...phone(width, height), colorScheme: 'dark' });
    await installSilence(context, 'chromium');
    const page = await context.newPage();
    await openSong(page);
    await page.waitForFunction(() => {
      const song = document.querySelector('.song');
      const foot = song ? getComputedStyle(song).getPropertyValue('--note-foot').trim() : '';
      return foot.length > 0 && document.querySelector('.note-card');
    }, { timeout: 8000 }).catch(() => {});
    const gap = await page.evaluate(() => {
      const card = document.querySelector('.note-card');
      const line = document.querySelector('.fb--line.is-current');
      if (!(card instanceof HTMLElement) || !(line instanceof HTMLElement)) return null;
      const c = card.getBoundingClientRect();
      const l = line.getBoundingClientRect();
      const overlapX = Math.min(c.right, l.right) - Math.max(c.left, l.left);
      const overlapY = Math.min(c.bottom, l.bottom) - Math.max(c.top, l.top);
      const overlap = overlapX > 0 && overlapY > 0 ? overlapY : 0;
      return {
        overlap: Math.round(overlap * 10) / 10,
        top: Math.round(c.top),
        lineBottom: Math.round(l.bottom),
        h: Math.round(c.height),
        w: Math.round(c.width),
        ok: overlap <= 2 && c.top >= l.bottom - 2 && c.height > 32 && c.height <= 52 && c.width > 40,
      };
    });
    note(
      'chromium D27 phone-note-clear',
      !!gap && gap.ok,
      gap ? `${width} overlap ${gap.overlap} top ${gap.top} line ${gap.lineBottom} h ${gap.h}` : `${width} missing`,
    );
    await context.close();
  }
}

const chrome = await chromium.launch();
const kit = await webkit.launch();
try {
  if (only !== 'D15') {
    await runFirstPaint(chrome, 'chromium');
    await runFirstPaint(kit, 'webkit');
    await runFlight(chrome, 'chromium');
    await runFlight(kit, 'webkit');
    await runPress(chrome, 'chromium');
    await runPress(kit, 'webkit');
  }
  await runScrub(chrome, 'chromium');
  await runScrub(kit, 'webkit');
  if (only === 'D15') {
    const failedEarly = results.some((row) => !row.ok);
    console.log(`${results.filter((row) => row.ok).length}/${results.length} defect checks passed`);
    await chrome.close();
    await kit.close();
    process.exit(failedEarly ? 1 : 0);
  }
  await runSheet(chrome, 'chromium');
  await runSheet(kit, 'webkit');
  await runPlay(chrome, 'chromium');
  await runPlay(kit, 'webkit');
  await runNoteClearance(chrome);
  await runColumn(chrome);
  await runPressed(chrome);
  await runIntro(chrome);
  await runLandscape(chrome);
  await runDisc(chrome);
  await runAccentRest(chrome);
  await runFootnote(chrome);
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  note('D-gate crash', false, String(err && err.stack ? err.stack : err).split('\n')[0]);
}
await chrome.close();
await kit.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} defect checks passed`);
if (failed.length) process.exit(1);
