/**
 * Creates content/songs/<slug>/ from docs/methodology/templates/.
 *   npm run new-song -- <slug> "Title" "Artist" <live|studio|single|other> "Version label"
 *
 * The label is the short Russian caption shown with the title. It has to come from
 * the official video the owner sent. See docs/methodology/01-intake.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = ['live', 'studio', 'single', 'other'] as const;
type Kind = (typeof KINDS)[number];

const usage = [
  'Usage: npm run new-song -- <slug: a-z0-9-> "Title" "Artist" <live|studio|single|other> "Подпись версии"',
  'Подпись — короткая строка по-русски из фактов официального видео, которое прислал владелец.',
  'Концерт: «Концерт <название>, <город> <год>». Студия: «Студийная, <альбом> <год>».',
  'Та же песня в другой версии — новый slug с суффиксом, например karitas-amsterdam-2022.',
  'Дальше: docs/methodology/01-intake.md',
].join('\n');

const [slug, title, artist, kind, label] = process.argv.slice(2);
const versionKind = KINDS.find((item) => item === kind);
const versionLabel = label?.trim() ?? '';
if (!slug || !title || !artist || !versionKind || !versionLabel || !/^[a-z0-9-]+$/.test(slug)) {
  console.error(usage);
  process.exit(1);
}
const chosenKind: Kind = versionKind;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'content/songs', slug);
if (existsSync(dir)) {
  console.error(`content/songs/${slug} уже существует`);
  process.exit(1);
}

const songsDir = join(root, 'content/songs');
const sameTitle: string[] = [];
if (existsSync(songsDir)) {
  for (const name of readdirSync(songsDir)) {
    if (name.startsWith('.') || name === slug) continue;
    const file = join(songsDir, name, 'song.json');
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { title?: unknown };
      if (typeof data.title === 'string' && data.title.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0) {
        sameTitle.push(name);
      }
    } catch {
      /* a broken neighbour is not this song's problem */
    }
  }
}

const templates = join(root, 'docs/methodology/templates');

function fill(name: string, json: boolean) {
  const raw = readFileSync(join(templates, name), 'utf8');
  const value = (text: string) => (json ? JSON.stringify(text).slice(1, -1) : text);
  return raw
    .replaceAll('{{slug}}', value(slug))
    .replaceAll('{{title}}', value(title))
    .replaceAll('{{artist}}', value(artist))
    .replaceAll('{{kind}}', value(chosenKind))
    .replaceAll('{{label}}', value(versionLabel));
}

mkdirSync(dir, { recursive: true });
const song = fill('song.json', true);
const lyrics = fill('lyrics.json', true);
JSON.parse(song);
JSON.parse(lyrics);
writeFileSync(join(dir, 'song.json'), song.endsWith('\n') ? song : song + '\n');
writeFileSync(join(dir, 'lyrics.json'), lyrics.endsWith('\n') ? lyrics : lyrics + '\n');
writeFileSync(join(dir, 'sources.md'), fill('sources.md', false));
writeFileSync(join(dir, 'canon.md'), fill('canon.md', false));
console.log(`content/songs/${slug}/ создана по docs/methodology/templates/.`);
console.log(`версия: ${chosenKind} · ${versionLabel}`);
if (sameTitle.length) {
  console.log(
    `Уже есть песня с таким названием: ${sameTitle.join(', ')}. Если это другая версия, slug с суффиксом, например karitas-amsterdam-2022. Старую папку не переименовывайте.`,
  );
}
if (!/\b(?:1\d{3}|20\d{2})\b/.test(versionLabel)) {
  console.log('В подписи нет года. Если год написан у официального видео, добавьте его в version.label. Если нет — вопрос в review, год не выдумывайте.');
}
console.log('В sources.md запишите адрес официального видео или строку «Файл: имя.m4a». «Файл: нет» источником не считается.');
console.log('Команда:');
console.log(`  npm run song-status -- ${slug}`);
console.log('Дальше: docs/methodology/01-intake.md');
