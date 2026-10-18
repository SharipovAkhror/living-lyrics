/**
 * Creates content/songs/<slug>/ from docs/methodology/templates/.
 *   npm run new-song -- <slug> "Title" "Artist"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [slug, title, artist] = process.argv.slice(2);
if (!slug || !title || !artist || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: npm run new-song -- <slug: a-z0-9-> "Title" "Artist"');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'content/songs', slug);
if (existsSync(dir)) {
  console.error(`content/songs/${slug} уже существует`);
  process.exit(1);
}

const templates = join(root, 'docs/methodology/templates');

function fill(name: string, json: boolean) {
  const raw = readFileSync(join(templates, name), 'utf8');
  const value = (text: string) => (json ? JSON.stringify(text).slice(1, -1) : text);
  return raw
    .replaceAll('{{slug}}', value(slug))
    .replaceAll('{{title}}', value(title))
    .replaceAll('{{artist}}', value(artist));
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
console.log('В sources.md запишите адрес официального видео или строку «Файл: имя.m4a». «Файл: нет» источником не считается.');
console.log('Команда:');
console.log(`  npm run song-status -- ${slug}`);
console.log('Дальше: docs/methodology/01-intake.md');
