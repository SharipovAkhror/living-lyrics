// Square song covers for the lock screen and CarPlay.
// A still frame of the song's living field: palette.field only, no letters and no marks.
//   npm run art -- covers
//   node scripts/art/covers.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

/** Fine grain, inlined so the screenshot does not depend on a second file loading. */
const GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = [96, 192, 512, 1024];

function songs() {
  const dir = join(root, 'content/songs');
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((slug) => JSON.parse(readFileSync(join(dir, slug, 'song.json'), 'utf8')))
    .filter((song) => Array.isArray(song.palette?.field) && song.palette.field.length >= 3);
}

/** Same motion as src/scene/Field.tsx, frozen at one second so every cover is one settled frame. */
function skyAt(t) {
  const a = t * 0.011;
  return {
    x1: 50 + Math.sin(a) * 18,
    y1: 38 + Math.cos(a * 0.73) * 16,
    x2: 70 + Math.sin(a * 0.51 + 1.4) * 16,
    y2: 64 + Math.cos(a * 0.44 + 0.5) * 14,
    x3: 26 + Math.sin(a * 0.36 + 2.2) * 12,
    y3: 76 + Math.cos(a * 0.66 + 1) * 10,
  };
}

function lin(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function mix(hex, toward, amount) {
  const n = parseInt(hex.slice(1), 16);
  const m = parseInt(toward.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - amount) + ((m >> shift) & 255) * amount);
  const h = (v) => v.toString(16).padStart(2, '0');
  return `#${h(ch(16))}${h(ch(8))}${h(ch(0))}`;
}

/**
 * Colour field only. `coverGlyph` is intentionally unread: the word is no longer drawn.
 * Washes sit where the living sky sits at t = 380s, spread across the square.
 * The lightest stop is a fourth bloom and a small glow, so each song stays its own colour.
 */
export function coverHtml(song, size) {
  const colors = song.palette.field.slice();
  const ranked = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const darkest = ranked[0];
  const lightest = ranked[ranked.length - 1];
  const [c1, c2, c3, c4] = colors;
  const third = c4 ?? c3;
  const glow = mix(lightest, '#ffffff', 0.22);
  const p = skyAt(380);
  const blur = Math.max(8, Math.round(size * 0.085));
  const spots = [
    { x: p.x1, y: p.y1, w: 62, h: 50, color: c1 },
    { x: p.x2, y: p.y2, w: 56, h: 48, color: c2 },
    { x: p.x3, y: p.y3, w: 52, h: 44, color: third },
    { x: 82, y: 28, w: 46, h: 40, color: lightest },
  ];
  const blobs = spots
    .map(
      (s) =>
        `<i class="blob" style="left:${s.x.toFixed(1)}%;top:${s.y.toFixed(1)}%;width:${s.w}%;height:${s.h}%;background:${s.color}"></i>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${darkest}; }
    .cover { width: ${size}px; height: ${size}px; position: relative; overflow: hidden; background: ${darkest}; }
    .blob {
      position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
      filter: blur(${blur}px);
    }
    .glow {
      position: absolute; left: 78%; top: 22%; width: 42%; height: 36%;
      border-radius: 50%; transform: translate(-50%, -50%);
      background: radial-gradient(closest-side, ${glow} 0%, transparent 70%);
      filter: blur(${Math.round(blur * 0.55)}px);
      opacity: 0.9;
    }
    .veil {
      position: absolute; inset: 0;
      background: radial-gradient(85% 78% at 46% 42%, transparent 42%, ${darkest} 100%);
      opacity: 0.22;
    }
    .grain {
      position: absolute; inset: 0; opacity: 0.2; mix-blend-mode: overlay;
      background-image: url("${GRAIN}");
      background-size: ${Math.max(64, Math.round(size * 0.18))}px;
    }
  </style>
  <div class="cover">${blobs}<div class="glow"></div><div class="veil"></div><div class="grain"></div></div>`;
}

/** True when every sampled pixel of a PNG is opaque. */
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
