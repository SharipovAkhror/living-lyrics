/**
 * Creates content/songs/<slug>/ with a minimal valid song.json, lyrics.json and sources.md.
 *   npm run new-song -- <slug> "Title" "Artist"
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [slug, title, artist = 'Sami Yusuf'] = process.argv.slice(2);
if (!slug || !title || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: npm run new-song -- <slug: a-z0-9-> "Title" "Artist"');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'content/songs', slug);
if (existsSync(dir)) {
  console.error(`content/songs/${slug} уже существует`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const song = {
  $schema: '../../../docs/schema/song.schema.json',
  slug,
  title,
  artist,
  languages: ['en'],
  duration: 1,
  palette: { accent: '#3A5BA0', accentDark: '#8FB2FF', field: ['#3A5BA0', '#7C4DBA', '#2A8C8C'] },
  audio: { status: 'missing' },
  timing: { status: 'draft', method: 'none' },
  review: ['Опознать запись (01-intake).', 'Получить аудио (02-audio).', 'Разметить секции (03-structure).', 'Записать текст как поётся (04-text).'],
};
const lyrics = {
  $schema: '../../../docs/schema/lyrics.schema.json',
  sections: [
    {
      id: 'intro',
      kind: 'instrumental',
      start: 0,
      end: 1,
      label: 'Вступление',
      instruments: ['ensemble'],
      flags: ['timing-draft', 'attribution-unverified'],
    },
  ],
};
writeFileSync(join(dir, 'song.json'), JSON.stringify(song, null, 2) + '\n');
writeFileSync(join(dir, 'lyrics.json'), JSON.stringify(lyrics, null, 2) + '\n');
writeFileSync(
  join(dir, 'sources.md'),
  `# ${title} — источники и статус проверки\n\n## Запись\n- Ссылка / файл:\n- Версия (студия / live, где и когда):\n- Длительность:\n\n## Тексты\n| Часть | Автор | Источник | Статус |\n|---|---|---|---|\n\n## Исполнители\n\n## Тайм-коды\n`,
);
console.log(`content/songs/${slug}/ создана. Дальше: docs/methodology/02-audio.md`);
