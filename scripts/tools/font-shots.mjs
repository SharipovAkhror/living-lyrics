// Photographs the default font set and two alternates on classical lines.
// Choices are the saved settings (living-lyrics.settings.v2), not a query.
// iPhone shots use Playwright WebKit. Desktop shots use Chromium.
// Usage: node scripts/tools/font-shots.mjs [baseUrl] [outDir] [--only=rumi,eckhart]
//
// Audio is not required. A failed or missing file does not move the scene,
// so this script keeps a seekable clock on the media element. The line comes
// from ?t=. Output stays in work/ (not committed).
import { chromium, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
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

const variants = [
  { id: 'classic', settings: null },
  { id: 'was', settings: { fontPersian: 'nastaliq', fontOriginal: 'cormorant', fontTranslation: 'inter' } },
  { id: 'clear', settings: { fontPersian: 'scheherazade', fontOriginal: 'eb-garamond', fontTranslation: 'inter' } },
];
// Persian, Azerbaijani latin-ext, German, and Arabic (Mushaf, no choice).
const shotScenes = ['rumi', 'fuzuli', 'eckhart', 'shushtari'];

function expectFamily(variant, scene) {
  if (scene.pale === 'ar') return 'KFGQPC';
  const persian = scene.pale === 'fa';
  if (persian) {
    if (variant.id === 'was') return 'Nastaliq';
    if (variant.id === 'clear') return 'Scheherazade';
    return 'Amiri';
  }
  if (variant.id === 'was') return 'Cormorant';
  if (variant.id === 'clear') return 'EB Garamond';
  return 'Source Serif';
}
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

async function seek(page, t) {
  // The page already seeks from ?t=. Setting the element clock again covers a
  // lost seek when the file never loads. Do not also click the scrubber:
  // on iPhone that click landed early and pulled Hildegard back into Fuzuli.
  await page.evaluate((time) => {
    for (const el of document.querySelectorAll('audio')) {
      try {
        el.currentTime = time;
      } catch {
        /* the stand-in clock in the init script keeps the value */
      }
    }
  }, t);
  await page.waitForTimeout(400);
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
      fonts: document.documentElement.style.getPropertyValue('--font-persian'),
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

async function applyVariant(page, settings) {
  // Set storage on the app origin before the song document boots, so the
  // catalog reads the choice on its first paint.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((value) => {
    const key = 'living-lyrics.settings.v2';
    if (value == null) {
      localStorage.removeItem(key);
      return;
    }
    let prev = {};
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prev = parsed;
    } catch {
      prev = {};
    }
    localStorage.setItem(key, JSON.stringify({ ...prev, ...value }));
  }, settings);
}

async function openScene(page, scene, variant) {
  const url = `${base}${scene.path}?t=${scene.t}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.fb-orig', { timeout: 20000 });
  const family = expectFamily(variant, scene);
  await page
    .waitForFunction(
      (needle) => {
        const el = document.querySelector('.fb.is-current .fb-orig');
        return !!el && getComputedStyle(el).fontFamily.includes(needle);
      },
      family,
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await seek(page, scene.t);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function runDevice(name, browserType, device) {
  const browser = await browserType.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ ...device, colorScheme: scheme });
      await prepare(context);
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error('pageerror', e.message));
      const wanted = scenes.filter((scene) => (only ? only.includes(scene.id) : shotScenes.includes(scene.id)));
      for (const variant of variants) {
        await applyVariant(page, variant.settings);
        for (const scene of wanted) {
          await openScene(page, scene, variant);
          const file = `${out}/${name}-${scheme}-${variant.id}-${scene.id}.png`;
          await page.screenshot({ path: file });
          const info = await readStage(page);
          notes.push({ file, variant: variant.id, info });
          console.log(file, info.section, info.orig?.family);
          if (info.section !== scene.label) console.error('  wrong section, wanted', scene.label);
          const needle = expectFamily(variant, scene);
          if (info.orig && !info.orig.family.includes(needle)) console.error('  wrong family, wanted', needle);
        }
      }
      await context.close();
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

writeFileSync(`${out}/notes-settings.json`, JSON.stringify(notes, null, 2));
console.log('notes', `${out}/notes-settings.json`);
