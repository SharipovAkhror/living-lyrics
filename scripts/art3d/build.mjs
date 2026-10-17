/**
 * Build instrument GLBs. `npm run art3d` builds daf and oud; `npm run art3d -- daf` builds one.
 * Writes public/instruments/3d/<key>.glb, <key>.json and index.json.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTris, normalizeTree, writeInstrument } from './lib.mjs';
import { buildDaf } from './daf.mjs';
import { buildOud } from './oud.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'instruments', '3d');
const TRI_MAX = 60_000;
const BYTE_MAX = Math.floor(1.5 * 1024 * 1024);

const BUILDERS = {
  daf: {
    build: buildDaf,
    manifest(notes, report) {
      return {
        key: 'daf',
        name: 'Даф',
        native: 'دف',
        parts: [
          { node: 'part-skin', morph: 'hit', drive: ['pulse'] },
          { node: 'part-jingles', drive: ['pulse'], motion: 'offset along extras.axis' },
        ],
        clips: ['idle'],
        triangles: report.tris,
        bytes: report.bytes,
        cameras: {
          // Direction from the target. The renderer fits the distance so the whole
          // instrument stays in frame. This one looks down into the hoop.
          hero: { position: [0.58, 0.5, 0.64], target: [0, 0, 0], fov: 36 },
          close: { position: [0.72, 0.28, 0.5], target: [0, -0.02, 0], fov: 32 },
        },
        materials: { wood: '#6b3e22', skin: '#d6c29e', metal: '#c7a159', leather: '#734728' },
        author: 'Living Lyrics',
        license: 'project',
        proportions: notes,
        sources: [
          'https://www.nasehpour.com/daf-iranian-frame-drum',
          'https://wmic.net/iran-daf-frame-drum/',
          'https://www.iranicaonline.org/articles/daff-and-dayera-daf-ar/',
          'https://www.coopermanframedrums.com/products/daf',
        ],
      };
    },
  },
  oud: {
    build: buildOud,
    manifest(notes, report) {
      const parts = [];
      for (let i = 1; i <= notes.strings; i++) parts.push({ node: `part-string-${i}`, morph: 'vibrate', drive: ['sustain', 'pulse'] });
      return {
        key: 'oud',
        name: 'Уд',
        native: 'عود',
        kind: 'arabic-concert',
        parts,
        clips: ['idle'],
        triangles: report.tris,
        bytes: report.bytes,
        cameras: {
          // Three-quarter: bowl ribs on the side, pegbox bending back. Distance is fitted.
          hero: { position: [0.62, 0.3, 0.72], target: [0, 0, 0], fov: 38 },
          close: { position: [0.78, 0.16, 0.48], target: [0, -0.08, 0], fov: 32 },
        },
        materials: { wood: '#6b3e22', spruce: '#e6d2a8', ebony: '#2a211c', string: '#f2efe6', metal: '#c7a159', guard: '#8a4b22' },
        author: 'Living Lyrics',
        license: 'project',
        proportions: notes,
        sources: [
          'https://www.metmuseum.org/art/collection/search/503203',
          'https://www.metmuseum.org/art/collection/search/776535',
          'https://www.thomann.co.uk/hannabach_2511_arabic_oud_11_strings_set.htm',
          'https://www.youtube.com/watch?v=afRYiI-gWmI',
          'https://www.youtube.com/watch?v=n89kCR7uymQ',
        ],
      };
    },
  },
};

function assertContract(key, tree, report) {
  const fail = (msg) => {
    throw new Error(`${key}: ${msg}`);
  };
  if (tree.name !== 'instrument') fail('root must be named instrument');
  if (!report.clips.includes('idle')) fail('missing idle clip');
  if (report.tris > TRI_MAX) fail(`${report.tris} triangles, budget ${TRI_MAX}`);
  if (report.bytes > BYTE_MAX) fail(`${report.bytes} bytes, budget ${BYTE_MAX}`);
  if (Math.abs(report.height - 1) > 0.02) fail(`height ${report.height}, expected 1`);
  const cx = (report.min[0] + report.max[0]) / 2;
  const cy = (report.min[1] + report.max[1]) / 2;
  const cz = (report.min[2] + report.max[2]) / 2;
  if (Math.hypot(cx, cy, cz) > 0.02) fail(`centre offset ${cx.toFixed(3)}, ${cy.toFixed(3)}, ${cz.toFixed(3)}`);
  const names = new Set(report.names);
  if (key === 'daf') {
    if (!names.has('part-skin') || !names.has('part-jingles')) fail('missing skin or jingles');
    if (!report.morphs.some((m) => m.includes('hit'))) fail('skin morph hit missing');
  }
  if (key === 'oud') {
    for (let i = 1; i <= 11; i++) if (!names.has(`part-string-${i}`)) fail(`missing part-string-${i}`);
    if (names.has('part-string-12')) fail('unexpected twelfth string');
    const vibrating = report.morphs.filter((m) => m.includes('vibrate'));
    if (vibrating.length !== 11) fail(`vibrate morphs ${vibrating.length}, expected 11`);
  }
}

async function buildOne(key) {
  const spec = BUILDERS[key];
  if (!spec) throw new Error(`unknown instrument ${key}`);
  const tree = spec.build();
  const notes = tree.notes ?? {};
  delete tree.notes;
  const before = countTris(tree);
  const norm = normalizeTree(tree);
  console.log(`${key}: ${before} tris, raw height ${norm.height.toFixed(2)} cm, scale ${norm.scale.toFixed(5)}`);
  const glbPath = join(outDir, `${key}.glb`);
  const report = await writeInstrument(tree, glbPath, notes);
  assertContract(key, tree, report);
  const manifest = spec.manifest(notes, report);
  writeFileSync(join(outDir, `${key}.json`), JSON.stringify(manifest, null, 2));
  console.log(`${key}: ${report.tris} tris, ${(report.bytes / 1024).toFixed(1)} KB, height ${report.height.toFixed(4)}`);
  console.log(`  nodes: ${report.names.filter(Boolean).join(', ')}`);
  console.log(`  morphs: ${report.morphs.join(' | ') || '(none)'}`);
  if (notes && Object.keys(notes).length) console.log(`  notes: ${JSON.stringify(notes)}`);
}

function writeIndex() {
  const keys = readdirSync(outDir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ instruments: keys }, null, 2)}\n`);
  console.log(`index: ${keys.join(', ')}`);
}

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const keys = asked.length ? asked : Object.keys(BUILDERS);
mkdirSync(outDir, { recursive: true });
for (const key of keys) await buildOne(key);
writeIndex();
