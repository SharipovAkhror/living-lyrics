/**
 * Where a song is on the onboarding route, and the single next command.
 *   npm run song-status -- <slug>
 *
 * The route is docs/methodology/README.md. This script only reads the song folder.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LyricsSchema, SongSchema, type Lyrics, type Song } from '../../src/data/schema.ts';
import { INSTRUMENTS } from '../../src/instruments/list.ts';
import { ARABIC_SCRIPTS, CPS_OK, letters, readingCps } from './validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
const instrumentKeys = new Set(INSTRUMENTS.map((i) => i.key));
const TEMPLATE = '<!-- пустой шаблон';

type Row = { n: string; name: string; state: string; detail: string };
type Next = { row: string; file: string; command: string; because: string };

function hasBin(name: string) {
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true });
  return found.status === 0;
}

const python = hasBin('python') ? 'python' : hasBin('python3') ? 'python3' : '';
const ffmpeg = hasBin('ffmpeg');
const pipeline = existsSync(join(root, '.github/workflows/pipeline.yml'));

function readText(path: string) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function short(text: string) {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 48 ? `${one.slice(0, 48)}…` : one;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!slug) {
  const songs = readdirSync(join(root, 'content/songs')).filter((name) => !name.startsWith('.'));
  fail(`Укажите песню.\n  npm run song-status -- <slug>\nСейчас в библиотеке: ${songs.join(', ') || 'пусто'}`);
}
if (!/^[a-z0-9-]+$/.test(slug)) fail('slug — только строчные латинские буквы, цифры и дефис');

const dir = join(root, 'content/songs', slug);
if (!existsSync(dir)) {
  fail(
    `Папки content/songs/${slug} нет.\nКоманда:\n  npm run new-song -- ${slug} "Название" "Исполнитель"\nДальше: docs/methodology/01-intake.md`,
  );
}

const songParsed = SongSchema.safeParse(JSON.parse(readText(join(dir, 'song.json')) || 'null'));
if (!songParsed.success) {
  const first = songParsed.error.issues[0];
  fail(
    `${slug}: song.json не читается (${first?.path.join('.')}: ${first?.message}).\nКоманда:\n  npm run validate -- ${slug}\nДальше: docs/methodology/01-intake.md`,
  );
}
const song: Song = songParsed.data;
const lyricsParsed = LyricsSchema.safeParse(JSON.parse(readText(join(dir, 'lyrics.json')) || 'null'));
if (!lyricsParsed.success) {
  const first = lyricsParsed.error.issues[0];
  fail(
    `${slug}: lyrics.json не читается (${first?.path.join('.')}: ${first?.message}).\nКоманда:\n  npm run validate -- ${slug}\nДальше: docs/methodology/04-text.md`,
  );
}
const lyrics: Lyrics = lyricsParsed.data;

const sources = readText(join(dir, 'sources.md'));
const canonText = readText(join(dir, 'canon.md'));
const canonLetters = canonText ? letters(canonText) : '';
const enc = existsSync(join(root, 'content/audio-enc', slug, 'high.m4a.enc'));
const plain = existsSync(join(root, 'public/audio', slug, 'high.m4a'));
const sourceFile = existsSync(join(root, 'work', slug))
  ? readdirSync(join(root, 'work', slug)).some((name) => name.startsWith('source.') && !name.endsWith('.json'))
  : false;

const vocal = lyrics.sections.filter((s) => s.kind === 'vocal');
const lines = vocal.flatMap((s) => s.lines);
const missingCanon = canonLetters
  ? lines.filter((line) => !canonLetters.includes(letters(line.words.map((w) => w.w).join(' '))))
  : lines;
const slow = lines
  .map((line) => ({ id: line.id, ...readingCps(line.tr.ru, line.words) }))
  .filter((line) => line.cps > CPS_OK);
const emLines = lines.filter((line) => line.words.some((w) => w.em));
const emWithoutComment = emLines.filter((line) => !line.comment?.trim());
const sectionsWithoutComment = lyrics.sections.filter((s) => !s.comment?.trim());
const noTranslit = lines.filter((line) => ARABIC_SCRIPTS.has(line.script) && !line.translit?.trim());
const unknownInstruments = lyrics.sections.flatMap((s) =>
  s.kind === 'instrumental' ? s.instruments.filter((key) => !instrumentKeys.has(key)) : [],
);
const flags = new Map<string, number>();
for (const section of lyrics.sections) {
  for (const flag of section.flags ?? []) flags.set(flag, (flags.get(flag) ?? 0) + 1);
  if (section.kind === 'vocal') {
    for (const line of section.lines) for (const flag of line.flags ?? []) flags.set(flag, (flags.get(flag) ?? 0) + 1);
  }
}
const flagCount = [...flags.values()].reduce((sum, n) => sum + n, 0);
const review = song.review ?? [];

const sourcesReady = !!sources && !sources.includes(TEMPLATE) && (/https?:\/\//.test(sources) || /файл:\s*\S+/i.test(sources));
const audioReady = song.audio.status === 'ready' && (enc || plain) && !!song.audio.provenance && song.duration > 1;
const structureReady = vocal.length > 0 && lines.length > 0;
const canonReady = !!canonText && !canonText.includes(TEMPLATE) && (/https?:\/\//.test(canonText) || /Подтверждено:\s*[1-9]/.test(canonText));
const textReady = canonReady && missingCanon.length === 0;
const timingReady = song.timing.status === 'aligned' || song.timing.status === 'verified';
const translationReady = lines.every((line) => line.tr.ru.trim()) && slow.length === 0;
const commentsReady = emWithoutComment.length === 0 && sectionsWithoutComment.length === 0;
const translitReady = noTranslit.length === 0;
const instrumentsReady = unknownInstruments.length === 0;
const qaReady = flagCount === 0 && review.length === 0;

const rows: Row[] = [
  { n: '1', name: 'приём', state: sourcesReady ? 'да' : 'нет', detail: sourcesReady ? 'song.json и sources.md со ссылкой или файлом' : 'sources.md ещё шаблон или без источника' },
  {
    n: '2',
    name: 'запись',
    state: audioReady ? 'да' : 'нет',
    detail: audioReady
      ? `${enc ? 'зашифрована' : 'открытый файл'}, ${song.duration} с`
      : enc || plain
        ? 'файл есть, но audio.status, provenance или duration не закрыты'
        : 'файла записи нет',
  },
  {
    n: '3',
    name: 'структура',
    state: structureReady ? 'да' : 'нет',
    detail: structureReady ? `секций ${lyrics.sections.length}, вокальных строк ${lines.length}` : 'нет вокальных строк',
  },
  {
    n: '4',
    name: 'текст',
    state: textReady ? 'да' : 'нет',
    detail: !canonText
      ? 'нет canon.md'
      : !canonReady
        ? 'canon.md ещё шаблон или без источника'
        : missingCanon.length
          ? `не найдены в canon.md: ${missingCanon.length}`
          : 'все строки есть в canon.md',
  },
  {
    n: '5',
    name: 'тайм-коды',
    state: timingReady ? 'да' : pipeline ? 'черновик' : 'отложено',
    detail: timingReady
      ? `${song.timing.status}, ${song.timing.method}`
      : pipeline
        ? `timing.status = ${song.timing.status}`
        : `timing.status = ${song.timing.status}; конвейера .github/workflows/pipeline.yml на ветке нет`,
  },
  {
    n: '6',
    name: 'перевод',
    state: lines.length === 0 ? 'рано' : translationReady ? 'да' : 'нет',
    detail: lines.length === 0 ? 'строк ещё нет' : slow.length ? `быстрее ${CPS_OK} зн/с: ${slow.length}` : 'скорость в норме',
  },
  {
    n: '7',
    name: 'пояснения',
    state: lines.length === 0 ? 'рано' : commentsReady ? 'да' : 'нет',
    detail: `без пояснения: строки с em ${emWithoutComment.length}, секции ${sectionsWithoutComment.length}`,
  },
  {
    n: '8',
    name: 'транскрипция',
    state: translitReady ? 'да' : 'нет',
    detail: noTranslit.length ? `без translit: ${noTranslit.length}` : 'арабское письмо закрыто',
  },
  {
    n: '9',
    name: 'инструменты',
    state: instrumentsReady ? 'да' : 'нет',
    detail: instrumentsReady ? 'ключи есть в каталоге' : `нет в каталоге: ${[...new Set(unknownInstruments)].join(', ')}`,
  },
  { n: '10', name: 'сцена', state: 'да', detail: 'код под песню не нужен: поток строк сам' },
  {
    n: '11',
    name: 'проверка',
    state: qaReady ? 'да' : 'открыто',
    detail: qaReady ? 'флагов и вопросов нет' : `флаги ${flagCount}, вопросы ${review.length}`,
  },
  { n: '12', name: 'публикация', state: 'рано', detail: 'после того как строки 1–11 закрыты' },
];

function audioNext(): Next {
  if (python && ffmpeg && sourceFile) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `${python} scripts/pipeline/process_audio.py ${slug}`,
      because: 'Исходник уже лежит в work/' + slug + '/source.*. Скрипт соберёт high.m4a, saver.m4a и peaks.json. Потом снова song-status: следующая команда будет шифрование.',
    };
  }
  if (plain && !enc) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `npm run audio:encrypt -- ${slug}`,
      because: 'Открытый m4a в репозиторий не коммитится. Нужен AUDIO_KEY в .env.local (64 шестнадцатеричных знака).',
    };
  }
  if (python && ffmpeg) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `npm run song-status -- ${slug}`,
      because: `Скопируйте файл владельца в work/${slug}/source.m4a. Ссылку на YouTube не скачивайте: облако её не достанет, а эта команда её не качает. Когда файл лежит в work, song-status даст process_audio.py.`,
    };
  }
  return {
    row: '2',
    file: 'docs/methodology/02-audio.md',
    command: `npm run song-status -- ${slug}`,
    because: 'Команды, которая достанет запись, нет. Файл присылает владелец. С YouTube не скачивайте. Пока файла нет, песню не обрабатывайте. Параллельно можно собирать canon.md по docs/methodology/04-text.md. Когда файл будет в work/' + slug + '/source.m4a и на машине появятся Python и ffmpeg, та же команда перейдёт к обработке.',
  };
}

function timingNext(): Next {
  return {
    row: '5',
    file: 'docs/methodology/05-alignment.md',
    command: `git add jobs/${slug}.json`,
    because:
      `Создайте jobs/${slug}.json ровно так:\n{\n  "slug": "${slug}",\n  "stages": ["separate", "align", "qa"]\n}\nОтправьте ветку. Задание запускает .github/workflows/pipeline.yml, результат придёт коммитом, файл задания исчезнет. Время слов руками не двигайте.`,
  };
}

function publishNext(): Next {
  const status = song.timing.status;
  return {
    row: '12',
    file: 'docs/methodology/12-publish.md',
    command: `git add content/songs/${slug} content/audio-enc/${slug}`,
    because: `Коммит в свою ветку. В main не сливать. Открытый m4a не добавлять. Сообщение: Add ${song.title}: text, translation, commentary, timing (${status}). work/ не коммитить.`,
  };
}

let next: Next | null = null;
if (!sourcesReady) {
  next = {
    row: '1',
    file: 'docs/methodology/01-intake.md',
    command: `npm run song-status -- ${slug}`,
    because: 'Заполните song.json только подтверждёнными фактами и sources.md со ссылкой или именем файла. Строку «пустой шаблон» удалите. С YouTube ничего не скачивайте.',
  };
} else if (!audioReady) {
  next = audioNext();
} else if (!structureReady && python && ffmpeg) {
  next = {
    row: '3',
    file: 'docs/methodology/03-structure.md',
    command: `${python} scripts/pipeline/separate.py ${slug}`,
    because: `После него: ${python} scripts/pipeline/sections.py ${slug}. Черновик границ — work/${slug}/sections.suggested.json. Секунды из него перенесите в lyrics.json и проверьте на слух. Повтор song-status.`,
  };
} else if (!structureReady && pipeline) {
  next = {
    row: '3',
    file: 'docs/methodology/03-structure.md',
    command: `git add jobs/${slug}.json`,
    because: `Создайте jobs/${slug}.json: {"slug":"${slug}","stages":["separate","sections"]}. Ответ коммита сейчас не включает sections.suggested.json (он остаётся в work/ на раннере). Границы без этого файла не выдумывайте.`,
  };
} else if (!textReady) {
  if (!structureReady) {
    rows[2] = { n: '3', name: 'структура', state: 'отложено', detail: 'границы не выдуманы: нет ни Python с ffmpeg, ни конвейера на ветке' };
  }
  const shown = missingCanon.slice(0, 8);
  const more = missingCanon.length - shown.length;
  const sample = shown.map((line) => `  ${line.id} — ${short(line.words.map((w) => w.w).join(' '))}`).join('\n');
  next = {
    row: '4',
    file: 'docs/methodology/04-text.md',
    command: `npm run validate -- ${slug}`,
    because: canonReady
      ? `Эти строки не найдены в canon.md:\n${sample}${more > 0 ? `\n  … и ещё ${more}` : ''}\nПриведите lyrics.json к эталону или объясните расхождение в разделе «Расхождения и вопросы». Канон не переписывайте по слуху.`
      : 'Соберите canon.md по шаблону docs/methodology/templates/canon.md: фрагмент, источник, пометка «подтверждено 1» или «подтверждено 2», затем «Последовательность в записи» и «Расхождения и вопросы». Строку «пустой шаблон» удалите.',
  };
} else if (!timingReady && pipeline) {
  next = timingNext();
} else if (!translationReady) {
  const sample = slow.slice(0, 5).map((line) => `  ${line.id} — ${line.cps.toFixed(0)} зн/с при ${line.sung.toFixed(1)} с`).join('\n');
  next = {
    row: '6',
    file: 'docs/methodology/06-translation.md',
    command: `npm run validate -- ${slug}`,
    because: slow.length
      ? `Сократите перевод, пока скорость не станет ≤ ${CPS_OK} зн/с. Считает строка как поётся (конец последнего слова минус начало первого), не пауза после неё:\n${sample}`
      : 'У вокальной строки пустой перевод.',
  };
} else if (!commentsReady) {
  const sample = [
    ...emWithoutComment.slice(0, 4).map((line) => `  строка ${line.id}`),
    ...sectionsWithoutComment.slice(0, 4).map((section) => `  секция ${section.id}`),
  ].join('\n');
  next = {
    row: '7',
    file: 'docs/methodology/07-comment.md',
    command: `npm run song-status -- ${slug}`,
    because: `Пояснение нужно строке с em и каждой секции. Сцена не подставит его сама.\n${sample}`,
  };
} else if (!translitReady) {
  const sample = noTranslit.slice(0, 5).map((line) => `  ${line.id}`).join('\n');
  next = {
    row: '8',
    file: 'docs/methodology/08-transliteration.md',
    command: `npm run validate -- ${slug}`,
    because: `Для арабского письма заполните translit кириллицей, как поётся:\n${sample}`,
  };
} else if (!instrumentsReady) {
  next = {
    row: '9',
    file: 'docs/methodology/09-instruments.md',
    command: `npm run validate -- ${slug}`,
    because: `Ключей нет в src/instruments/list.ts: ${[...new Set(unknownInstruments)].join(', ')}. Новый инструмент — запись в каталоге и гравюра по рецепту стадии 9, не отдельный модуль песни. Пока инструмент не опознан, ставьте ensemble и флаг attribution-unverified.`,
  };
} else if (!qaReady) {
  const flagText = [...flags.entries()].map(([name, n]) => `${name} ${n}`).join(', ');
  const questions = review.slice(0, 3).map((item) => `  — ${short(item)}`).join('\n');
  next = {
    row: '11',
    file: 'docs/methodology/11-qa.md',
    command: `npm run validate -- ${slug}`,
    because: `Флаги (${flagText || 'нет'}) снимайте только после проверки. Вопросы в review:\n${questions || '  — нет'}\nДля финала: npm run validate -- --strict ${slug}. Предупреждения на старых песнях — не повод стирать чужой текст.`,
  };
} else if (!timingReady) {
  next = {
    row: '5',
    file: 'docs/methodology/05-alignment.md',
    command: `npm run song-status -- ${slug}`,
    because: 'Текст, перевод и пояснения закрыты, но время слов всё ещё черновик, а конвейера на ветке нет. Публиковать рано: пословную заливку сайт при draft не включает. Когда появится .github/workflows/pipeline.yml, эта команда сменится на задание jobs/' + slug + '.json. Секунды руками не ставьте.',
  };
} else {
  rows[11] = { n: '12', name: 'публикация', state: 'да', detail: 'можно коммитить' };
  next = publishNext();
}

const width = 14;
console.log(`${slug} — ${song.title} / ${song.artist}`);
console.log('');
for (const row of rows) {
  console.log(`${row.n.padEnd(3)} ${row.name.padEnd(width)} ${row.state.padEnd(10)} ${row.detail}`);
}
console.log('');
console.log(`Дальше одна команда. Стадия ${next.row}, файл ${next.file}`);
console.log(next.because);
console.log('Команда:');
console.log(`  ${next.command}`);
