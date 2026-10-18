// Builds src/instruments/svg/*.svg from the generators in scripts/art/instruments/.
// Usage: npm run art            → writes all SVGs and work/art/preview.html
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(root, 'src', 'instruments', 'svg');
const previewDir = join(root, 'work', 'art');
mkdirSync(outDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

const args = process.argv.slice(2);
const wantCovers = args.includes('covers');
const only = args.filter((name) => name !== 'covers');
// `covers` alone paints the song squares and leaves the engravings alone.
const skipInstruments = wantCovers && only.length === 0;
const files = readdirSync(join(here, 'instruments')).filter((f) => f.endsWith('.mjs'));
const built = [];
for (const file of files) {
  const key = file.replace(/\.mjs$/, '');
  if (skipInstruments || (only.length && !only.includes(key))) continue;
  const mod = await import(pathToFileURL(join(here, 'instruments', file)).href);
  const svg = mod.default();
  writeFileSync(join(outDir, `${key}.svg`), svg);
  built.push({ key, svg });
  console.log(`${key}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
}

// Manifest of every engraving's viewBox (all files, not only the ones just built), so the stage can lay
// drawings out by their aspect before the SVGs themselves are loaded. Read by src/instruments/catalog.ts.
if (!skipInstruments) {
  const meta = {};
  for (const file of readdirSync(outDir).filter((f) => f.endsWith('.svg')).sort()) {
    const svg = readFileSync(join(outDir, file), 'utf8');
    const vb = svg.match(/viewBox="([^"]+)"/)?.[1].split(/[\s,]+/).map(Number) ?? [0, 0, 400, 400];
    meta[file.replace(/\.svg$/, '')] = { w: vb[2], h: vb[3] };
  }
  writeFileSync(
    join(root, 'src', 'instruments', 'art.json'),
    `{\n${Object.entries(meta).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`,
  );

  // Preview sheet: light and dark, so contrast can be checked by eye.
  const tiles = (theme) =>
    built
      .map(
        ({ key, svg }) =>
          `<figure class="${theme}"><div class="art">${svg}</div><figcaption>${key}</figcaption></figure>`,
      )
      .join('');
  writeFileSync(
    join(previewDir, 'preview.html'),
    `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:13px -apple-system,system-ui;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:0}
figure{margin:0;padding:12px;display:flex;flex-direction:column;align-items:center}
.light{background:#faf8f4;color:#7a5512}.dark{background:#0b0b0e;color:#e7b654}
.art{width:400px;height:400px}.art svg{width:100%;height:100%}
figcaption{color:#888;margin-top:4px}
.fillin{opacity:.12}
</style>${tiles('light')}${tiles('dark')}`,
  );
  console.log(`preview: work/art/preview.html`);
}

if (wantCovers) {
  const { buildCovers } = await import('./covers.mjs');
  await buildCovers();
}
