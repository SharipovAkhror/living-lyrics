// Square song covers for the lock screen and CarPlay.
// Same painting as the library card: palette.field and coverGlyph, no title and no artist.
//   npm run art -- covers
//   node scripts/art/covers.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = [96, 192, 512, 1024];
const ARABIC = /[\u0600-\u06FF]/;

function fileUrl(path) {
  return pathToFileURL(path).href;
}

function songs() {
  const dir = join(root, 'content/songs');
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((slug) => JSON.parse(readFileSync(join(dir, slug, 'song.json'), 'utf8')))
    .filter((song) => Array.isArray(song.palette?.field) && song.palette.field.length >= 3);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function coverHtml(song, size) {
  const [a, b, c, d] = song.palette.field;
  const base = d ?? c;
  const glyph = song.coverGlyph ?? song.title;
  const arabic = ARABIC.test(glyph);
  const serif = fileUrl(join(root, 'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2'));
  const hafs = fileUrl(join(root, 'public/fonts/KFGQPC-Uthmanic-Script-HAFS.otf'));
  const face = arabic ? 'f-mushaf' : 'f-serif';
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: 'Source Serif 4'; src: url('${serif}') format('woff2'); font-weight: 600; font-style: normal; }
    @font-face { font-family: 'KFGQPC Hafs'; src: url('${hafs}') format('opentype'); font-weight: 400; }
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${base}; }
    .cover {
      width: ${size}px; height: ${size}px; position: relative; overflow: hidden; border-radius: 0;
      display: flex; align-items: center; justify-content: center;
      background:
        radial-gradient(120% 90% at 15% 10%, ${a} 0%, transparent 60%),
        radial-gradient(110% 90% at 90% 20%, ${b} 0%, transparent 55%),
        radial-gradient(120% 110% at 60% 100%, ${c} 0%, transparent 60%),
        ${base};
    }
    .cover-grain {
      position: absolute; inset: 0; opacity: 0.12; mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .cover-glyph {
      position: relative; padding: 0 10%; color: rgba(255, 255, 255, 0.94);
      font-family: 'Source Serif 4', Palatino, Georgia, serif; font-weight: 600;
      font-size: ${Math.round(size * 0.18)}px; line-height: 1.05; text-align: center;
      text-shadow: 0 2px 22px rgba(0, 0, 0, 0.28);
    }
    .cover-glyph.f-mushaf {
      font-family: 'KFGQPC Hafs', serif; font-weight: 400;
      font-size: ${Math.round(size * 0.15)}px; line-height: 1.6; white-space: nowrap;
    }
  </style>
  <div class="cover"><div class="cover-grain"></div><span class="cover-glyph ${face}" dir="${arabic ? 'rtl' : 'ltr'}">${escapeHtml(glyph)}</span></div>`;
}

/** True when every pixel of a PNG is opaque. */
async function isOpaque(page, png) {
  const b64 = png.toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 16) if (data[i] !== 255) return false;
    return canvas.width > 0;
  }, `data:image/png;base64,${b64}`);
}

export async function buildCovers() {
  const list = songs();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const song of list) {
    const dir = join(root, 'public/covers', song.slug);
    mkdirSync(dir, { recursive: true });
    for (const size of SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(coverHtml(song, size), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
      const out = join(dir, `${size}.png`);
      writeFileSync(out, png);
      if (!(await isOpaque(page, png))) throw new Error(`${song.slug}/${size}.png has transparent pixels`);
      console.log(`${song.slug}/${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
    }
  }
  await browser.close();
  console.log(`covers: ${list.length} songs, ${SIZES.join(' ')}`);
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) await buildCovers();
