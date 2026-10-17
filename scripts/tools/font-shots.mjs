// Photographs the font fitting sets on classical lines.
// iPhone shots use Playwright WebKit. Desktop shots use Chromium.
// Usage: node scripts/tools/font-shots.mjs [baseUrl] [outDir] [--zoom-only]
//
// Audio is not required. A failed or missing file does not move the scene,
// so this script keeps a seekable clock on the media element and then
// drags the scrubber to the line. Output stays in work/ (not committed).
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const zoomOnly = process.argv.includes('--zoom-only');
const [base = 'http://localhost:5173', out = 'work/shots/t4'] = args;

const scenes = [
  { id: 'rumi', path: '/song/i-have-come-alive', t: 134, duration: 580.06, label: 'Руми, первый бейт', pale: 'fa' },
  // rumi-3-1 starts at 436.45. The word at lyrics.json:1965 contains U+200C.
  { id: 'rumi3', path: '/song/i-have-come-alive', t: 438, duration: 580.06, label: 'Руми: всё благодарит', pale: 'fa' },
  { id: 'fuzuli', path: '/song/karitas', t: 108, duration: 977.05, label: 'Физули, бейт 3' },
  { id: 'hildegard', path: '/song/karitas', t: 136, duration: 977.05, label: 'Хильдегарда Бингенская, антифон' },
  { id: 'eckhart', path: '/song/one', t: 8, duration: 828.05, label: 'Майстер Экхарт' },
  { id: 'shushtari', path: '/song/one', t: 60, duration: 828.05, label: 'Аш-Шуштари', pale: 'ar' },
];

const sets = ['a', 'b', 'c'];
const phone = devices['iPhone 14 Pro'] ?? devices['iPhone 13'] ?? {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

mkdirSync(out, { recursive: true });

const notes = [];

async function prepare(context) {
  await context.addInitScript(() => {
    const proto = HTMLMediaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    if (!desc?.get || !desc.set) return;
    const fake = new WeakMap();
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get() {
        if (this.readyState >= 1) {
          try {
            return desc.get.call(this);
          } catch {
            /* use the stand-in clock */
          }
        }
        return fake.get(this) ?? 0;
      },
      set(v) {
        fake.set(this, Number(v) || 0);
        try {
          desc.set.call(this, v);
        } catch {
          /* no media data: the stand-in clock is enough for the scene */
        }
      },
    });
  });
  await context.route('**/*.{m4a,mp3,flac,aac}', (route) => route.abort());
}

async function seek(page, t, duration) {
  await page.evaluate((time) => {
    for (const el of document.querySelectorAll('audio')) {
      try {
        el.currentTime = time;
      } catch {
        /* the stand-in clock in the init script keeps the value */
      }
    }
  }, t);
  const track = page.locator('.scrub-track');
  await track.waitFor({ timeout: 20000 });
  const box = await track.boundingBox();
  if (!box) throw new Error('scrubber has no box');
  const ratio = Math.min(0.98, Math.max(0.01, t / duration));
  const x = box.x + box.width * ratio;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
}

async function readStage(page) {
  return page.evaluate(() => {
    const css = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        family: s.fontFamily,
        weight: s.fontWeight,
        style: s.fontStyle,
        size: s.fontSize,
        lineHeight: s.lineHeight,
      };
    };
    const paleWord = (lang) => {
      const block = [...document.querySelectorAll(`.fb[lang="${lang}"]`)].find(
        (n) => !n.classList.contains('is-current') && getComputedStyle(n).visibility !== 'hidden',
      );
      const word = block?.querySelector('.w');
      if (!word) return null;
      const s = getComputedStyle(word);
      return { opacity: s.opacity, color: s.color, family: getComputedStyle(block.querySelector('.fb-orig')).fontFamily };
    };
    const current = document.querySelector('.fb.is-current');
    return {
      preview: document.documentElement.dataset.fontPreview ?? '',
      section: document.querySelector('.topbar-section')?.textContent ?? '',
      lang: current?.getAttribute('lang') ?? '',
      orig: css(current?.querySelector('.fb-orig') ?? null),
      tr: css(current?.querySelector('.fb-tr') ?? null),
      paleFa: paleWord('fa'),
      paleAr: paleWord('ar'),
      translit: css(current?.querySelector('.fb-translit') ?? null),
    };
  });
}

async function shootPale(page, lang, file) {
  // Hide the chrome, scale the pale line, then clip the page. A zoomed element
  // screenshot was clipping Nastaliq swashes and including the comment bar.
  const clip = await page.evaluate((code) => {
    const block = [...document.querySelectorAll(`.fb[lang="${code}"]`)].find((n) => {
      if (n.classList.contains('is-current')) return false;
      const s = getComputedStyle(n);
      return s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.2;
    });
    const orig = block?.querySelector('.fb-orig');
    if (!(orig instanceof HTMLElement)) return null;
    for (const el of document.querySelectorAll('.comment, .player, .font-fit, .hint, .topbar')) {
      if (el instanceof HTMLElement) el.style.visibility = 'hidden';
    }
    orig.style.transform = 'scale(2.4)';
    orig.style.transformOrigin = 'center center';
    const r = orig.getBoundingClientRect();
    const pad = 16;
    return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  }, lang);
  if (!clip) {
    console.error('no pale line', lang, file);
    return false;
  }
  const viewport = page.viewportSize() ?? { width: clip.width, height: clip.height };
  const x = Math.max(0, clip.x);
  const y = Math.max(0, clip.y);
  const width = Math.min(clip.width - (x - clip.x), viewport.width - x);
  const height = Math.min(clip.height - (y - clip.y), viewport.height - y);
  if (width < 40 || height < 40) {
    console.error('pale clip too small', lang, file, clip);
    return false;
  }
  await page.screenshot({ path: file, clip: { x, y, width, height } });
  return true;
}

async function openScene(page, scene, query) {
  const url = `${base}${scene.path}?${query}${query ? '&' : ''}t=${scene.t}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.fb-orig', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await seek(page, scene.t, scene.duration);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

async function runDevice(name, browserType, device) {
  const browser = await browserType.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ ...device, colorScheme: scheme });
      await prepare(context);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error('pageerror', e.message));

      if (!zoomOnly && scheme === 'light') {
        await openScene(page, scenes[0], '');
        const file = `${out}/${name}-${scheme}-default-rumi.png`;
        await page.screenshot({ path: file });
        const info = await readStage(page);
        notes.push({ file, info });
        console.log(file, info.section, info.preview || 'default');
      }

      for (const set of sets) {
        for (const scene of scenes) {
          if (zoomOnly && !scene.pale) continue;
          await openScene(page, scene, `fonts=${set}`);
          const file = `${out}/${name}-${scheme}-${set}-${scene.id}.png`;
          if (!zoomOnly) {
            await page.screenshot({ path: file });
            const info = await readStage(page);
            notes.push({ file, info });
            console.log(file, info.section, info.orig?.family);
            if (info.section !== scene.label) console.error('  wrong section, wanted', scene.label);
          }
          if (scene.pale) {
            const zoom = `${out}/zoom-${name}-${scheme}-${set}-${scene.id}.png`;
            const ok = await shootPale(page, scene.pale, zoom);
            if (ok) console.log(zoom);
          }
        }
      }

      await context.close();

      // Transliteration is the only italic line in the scene today. One light pass per device.
      if (!zoomOnly && scheme === 'light') {
        const context2 = await browser.newContext({ ...device, colorScheme: 'light' });
        await prepare(context2);
        await context2.addInitScript(() => {
          localStorage.setItem('living-lyrics.settings.v2', JSON.stringify({ showTranslit: true }));
        });
        const page2 = await context2.newPage();
        for (const set of sets) {
          await openScene(page2, scenes[0], `fonts=${set}`);
          const file = `${out}/${name}-light-${set}-rumi-translit.png`;
          await page2.screenshot({ path: file });
          const info = await readStage(page2);
          notes.push({ file, info });
          console.log(file, info.section);
        }
        await context2.close();
      }
    }
  } finally {
    await browser.close();
  }
}

await runDevice('iphone', webkit, phone);
await runDevice('desktop', chromium, {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

if (!zoomOnly) {
  writeFileSync(`${out}/notes.json`, JSON.stringify(notes, null, 2));
  console.log('notes', `${out}/notes.json`);
}
