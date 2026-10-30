/**
 * Where a song is on the onboarding route, and the single next command.
 *   npm run song-status -- <slug>
 *
 * The route is docs/methodology/README.md. Reads the song folder and docs/analysis.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LyricsSchema, SongSchema, type Lyrics, type Song } from '../../src/data/schema.ts';
import { INSTRUMENTS } from '../../src/instruments/list.ts';
import { ARABIC_SCRIPTS, CPS_OK, letters, readingCps } from './validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** First YouTube video in a citation, as a watch URL. Empty when there is none. */
function youtubeUrl(text: string) {
  const match = text.match(/(?:youtube\.com\/(?:watch\?[^\s)]*?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : '';
}

/** Line id as a whole token. `fuzuli-f1` does not match `fuzuli-f1-1`. */
function idInText(id: string, text: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(text);
}

const CUE_KEYS = new Set(['line', 'cue', 'lang', 'start', 'end']);

/** Empty string when the cue file has only line, cue, lang, start and end. */
function cueProblem(json: unknown) {
  if (!Array.isArray(json)) return 'cues.json не массив';
  const seen = new Set<string>();
  for (const item of json) {
    if (!item || typeof item !== 'object') return 'в cues.json есть не объект';
    const record = item as Record<string, unknown>;
    const extra = Object.keys(record).filter((key) => !CUE_KEYS.has(key));
    if (extra.length) return `в cues.json лишние поля (${extra.join(', ')}): текста реплики быть не должно`;
    const { line, cue, lang, start, end } = record;
    if (typeof line !== 'string' || !line) return 'у реплики нет line';
    if (seen.has(line)) return `реплика ${line} повторяется`;
    seen.add(line);
    if (typeof cue !== 'number' || typeof start !== 'number' || typeof end !== 'number') {
      return `реплика ${line}: cue, start и end — числа`;
    }
    if (typeof lang !== 'string' || !lang.trim()) return `реплика ${line}: нет lang`;
    if (!(start < end)) return `реплика ${line}: start не меньше end`;
  }
  return '';
}

/** Cipher is a table row. It blocks only the commit at stage 12, never the stages before it. */
function cipherRow(hasEnc: boolean, hasPlain: boolean, hasKey: boolean): { state: string; detail: string } {
  if (hasEnc) return { state: 'да', detail: 'шифр есть' };
  if (hasPlain && !hasKey) return { state: 'ждёт ключа', detail: 'шифр: ждёт ключа' };
  if (hasPlain) return { state: 'нет', detail: 'ключ есть; шифр перед коммитом на стадии 12' };
  return { state: 'рано', detail: 'открытого файла ещё нет' };
}

/** True only when stage 12 encrypts a measured open file and the key is already here. */
function encryptIsNext(atPublish: boolean, hasEnc: boolean, hasPlain: boolean, hasKey: boolean): boolean {
  return atPublish && !hasEnc && hasPlain && hasKey;
}

type WitnessStep = 'download-video' | 'lyric-frames' | 'read-captions' | 'whisper' | 'done';

/** What to do once official subtitles are known to be missing. */
function witnessStep(input: {
  subsUnavailable: boolean;
  videoOnDisk: boolean;
  canDownloadVideo: boolean;
  framesIndex: boolean;
  captionsOk: boolean;
  ffmpeg: boolean;
  vocalStem: boolean;
  transcript: boolean;
  python: boolean;
}): WitnessStep {
  if (!input.subsUnavailable) return 'done';
  if (!input.videoOnDisk && input.canDownloadVideo) return 'download-video';
  if (input.videoOnDisk && !input.framesIndex && input.ffmpeg && input.python) return 'lyric-frames';
  if (input.videoOnDisk && !input.captionsOk) return 'read-captions';
  if (input.vocalStem && !input.transcript && input.python) return 'whisper';
  return 'done';
}

/** The agy line song-status prints. Grok does not run it; Claude · Lead does. */
function agyInvoke(slugName: string, schema: string, promptFile: string, task: string) {
  return `python "$(python -c "import sys; sys.path.insert(0, 'scripts/tools'); from aos_home import aos_home; print(aos_home(), end='')")/ops/agents/agy_run.py" . gemini-3.8-flash-high - 2350s scripts/instrument_id/schema/${schema} work/${slugName}/${promptFile} --task "${task}"`;
}

function selfCheck() {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };
  check(
    youtubeUrl('дорожка https://www.youtube.com/watch?v=xWwMzfGVikA') === 'https://www.youtube.com/watch?v=xWwMzfGVikA',
    'youtube url',
  );
  check(youtubeUrl('https://youtu.be/BcSnZ-RuwyI') === 'https://www.youtube.com/watch?v=BcSnZ-RuwyI', 'short url');
  check(!youtubeUrl('https://ganjoor.net/hafez'), 'not youtube');
  check(!idInText('fuzuli-f1', 'fuzuli-f1-1'), 'id prefix');
  check(idInText('fuzuli-f1-1', 'Строки: fuzuli-f1-1, fuzuli-f1-2'), 'id exact');
  check(cueProblem([{ line: 'a', cue: 1, lang: 'en', start: 0, end: 1, text: 'нет' }]).includes('лишние'), 'cue text');
  check(cueProblem([{ line: 'a', cue: 1, lang: 'en', start: 0, end: 1 }]) === '', 'cue ok');
  check(cueProblem([{ line: 'a', cue: 1, lang: 'en', start: 2, end: 1 }]).includes('start'), 'cue order');
  check(cipherRow(false, true, false).detail === 'шифр: ждёт ключа', 'cipher waits');
  check(cipherRow(false, true, false).state === 'ждёт ключа', 'cipher state');
  check(cipherRow(true, true, false).state === 'да', 'cipher done');
  check(cipherRow(false, true, true).state === 'нет', 'cipher key present');
  check(cipherRow(false, false, false).state === 'рано', 'cipher early');
  check(encryptIsNext(false, false, true, false) === false, 'cipher does not block the route');
  check(encryptIsNext(true, false, true, true) === true, 'encrypt at publish when the key is here');
  check(encryptIsNext(true, false, true, false) === false, 'publish waits without a key');
  check(encryptIsNext(true, true, true, true) === false, 'encrypted file is not encrypted again');
  const witnessBase = {
    subsUnavailable: true,
    videoOnDisk: false,
    canDownloadVideo: true,
    framesIndex: false,
    captionsOk: false,
    ffmpeg: true,
    vocalStem: false,
    transcript: false,
    python: true,
  };
  check(witnessStep({ ...witnessBase, subsUnavailable: false }) === 'done', 'subs still in play');
  check(witnessStep(witnessBase) === 'download-video', 'video before captions');
  check(witnessStep({ ...witnessBase, videoOnDisk: true, canDownloadVideo: false }) === 'lyric-frames', 'cheap frames');
  check(witnessStep({ ...witnessBase, videoOnDisk: true, framesIndex: true }) === 'read-captions', 'read captions');
  check(witnessStep({ ...witnessBase, videoOnDisk: true, ffmpeg: false }) === 'read-captions', 'no ffmpeg still reads');
  check(
    witnessStep({ ...witnessBase, videoOnDisk: true, framesIndex: true, captionsOk: true, vocalStem: true }) === 'whisper',
    'whisper on the stem',
  );
  check(witnessStep({ ...witnessBase, videoOnDisk: false, canDownloadVideo: false, vocalStem: true }) === 'whisper', 'whisper without video');
  check(witnessStep({ ...witnessBase, videoOnDisk: false, canDownloadVideo: false }) === 'done', 'no witness left');
  const agy = agyInvoke('demo', 'captions.json', 'captions-prompt.md', 'read-captions demo');
  check(agy.includes('gemini-3.8-flash-high'), 'agy model');
  check(agy.includes('scripts/instrument_id/schema/captions.json'), 'agy captions schema');
  check(agy.includes('read-captions demo'), 'agy captions task');
  const visionSchema = JSON.parse(readFileSync(join(root, 'scripts/instrument_id/schema/vision.json'), 'utf8')) as {
    required?: string[];
    properties?: { video_type?: { enum?: string[] } };
  };
  check(!visionSchema.required?.includes('video_type'), 'video_type is optional');
  check(visionSchema.properties?.video_type?.enum?.join(',') === 'concert,lyric_video,static,other', 'video_type enum');
  const captionSchema = JSON.parse(readFileSync(join(root, 'scripts/instrument_id/schema/captions.json'), 'utf8')) as {
    required?: string[];
    properties?: { captions?: { items?: { required?: string[] } } };
  };
  check(captionSchema.required?.includes('video_type') === true, 'captions require a video type');
  const captionFields = captionSchema.properties?.captions?.items?.required ?? [];
  for (const key of ['first_s', 'last_s', 'script', 'role', 'text', 'confidence']) {
    check(captionFields.includes(key), `caption field ${key}`);
  }
  for (const name of ['karitas', 'one', 'i-have-come-alive']) {
    const vision = JSON.parse(readFileSync(join(root, 'docs/analysis', name, 'vision.json'), 'utf8')) as {
      frames?: unknown;
      video_type?: string;
    };
    check(Array.isArray(vision.frames) && vision.frames.length > 0, `${name} vision frames`);
    check(vision.video_type === undefined, `${name} old vision has no video_type`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('song-status self-check ok');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
  process.exit(0);
}

const slugArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
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

if (!slugArg) {
  const songs = readdirSync(join(root, 'content/songs')).filter((name) => !name.startsWith('.'));
  fail(`Укажите песню.\n  npm run song-status -- <slug>\nСейчас в библиотеке: ${songs.join(', ') || 'пусто'}`);
}
if (!/^[a-z0-9-]+$/.test(slugArg)) fail('slug — только строчные латинские буквы, цифры и дефис');
const slug = slugArg;

const dir = join(root, 'content/songs', slug);
if (!existsSync(dir)) {
  fail(
    `Папки content/songs/${slug} нет.\nКоманда:\n  npm run new-song -- ${slug} "Название" "Исполнитель" <live|studio|single|other> "Подпись версии"\nДальше: docs/methodology/01-intake.md`,
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
const lineIds = lines.map((line) => line.id);

function mentioned(phrase: string) {
  return review.some((item) => item.includes(phrase));
}

/** One failed download is recorded in review. song-status must not ask for the same command again. */
const videoStopped = mentioned('официальное видео: yt-dlp 429') || mentioned('официальное видео: просит войти');
const subsStopped = mentioned('официальные субтитры: yt-dlp 429') || mentioned('официальные субтитры: пусто');
const backWait = mentioned('обратный перевод: ждёт Gemini');
const officialUrl = youtubeUrl(sources) || youtubeUrl(song.audio.provenance?.ref ?? '');

function walkFiles(dir: string, depth: number, hit: (name: string) => boolean): boolean {
  if (depth < 0 || !existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (walkFiles(join(dir, entry.name), depth - 1, hit)) return true;
    } else if (hit(entry.name)) return true;
  }
  return false;
}

const workDir = join(root, 'work', slug);
const subsOnDisk = walkFiles(workDir, 3, (name) => /\.(vtt|srt|json3)$/i.test(name));
const videoOnDisk = walkFiles(workDir, 1, (name) => /^video\./i.test(name) && !name.endsWith('.json'));
const videoName = existsSync(workDir)
  ? (readdirSync(workDir).find((name) => /^video\./i.test(name) && !name.endsWith('.json')) ?? '')
  : '';
const videoRel = videoName ? `work/${slug}/${videoName}` : '';
const lyricFramesIndex = existsSync(join(workDir, 'lyric-frames', 'index.json'));
const transcriptOnDisk = existsSync(join(workDir, 'transcript.json'));
const vocalStem = existsSync(join(workDir, 'stems', 'vocals.wav'));
const subsUnavailable = subsStopped || (!officialUrl && !subsOnDisk);

/** 64 hex characters in the environment or in .env.local. The key itself is never printed. */
function hasAudioKey() {
  const fromEnv = process.env.AUDIO_KEY?.trim() ?? '';
  if (/^[0-9a-f]{64}$/i.test(fromEnv)) return true;
  const envFile = join(root, '.env.local');
  if (!existsSync(envFile)) return false;
  return Boolean(readFileSync(envFile, 'utf8').match(/^AUDIO_KEY=([0-9a-f]{64})\s*$/m));
}

const audioKey = hasAudioKey();

function loadCues(): { rows: { line: string }[] | null; problem: string } {
  const path = join(root, 'docs/analysis', slug, 'cues.json');
  if (!existsSync(path)) return { rows: null, problem: '' };
  try {
    const json = JSON.parse(readText(path)) as unknown;
    const problem = cueProblem(json);
    if (problem) return { rows: null, problem };
    return { rows: json as { line: string }[], problem: '' };
  } catch {
    return { rows: null, problem: 'cues.json не читается' };
  }
}

function loadCaptions(): { ok: boolean; count: number; problem: string } {
  const path = join(root, 'docs/analysis', slug, 'captions.json');
  if (!existsSync(path)) return { ok: false, count: 0, problem: '' };
  try {
    const json = JSON.parse(readText(path)) as { captions?: unknown };
    if (!json || typeof json !== 'object' || !Array.isArray(json.captions)) {
      return { ok: false, count: 0, problem: 'captions.json без массива captions' };
    }
    return { ok: true, count: json.captions.length, problem: '' };
  } catch {
    return { ok: false, count: 0, problem: 'captions.json не читается' };
  }
}

const cuesLoaded = loadCues();
const captionsLoaded = loadCaptions();
const cueIds = new Set((cuesLoaded.rows ?? []).map((row) => row.line));
const missingCues = lineIds.filter((id) => !cueIds.has(id));
const extraCues = [...cueIds].filter((id) => !lineIds.includes(id));

function currentWitness(): WitnessStep {
  return witnessStep({
    subsUnavailable,
    videoOnDisk,
    canDownloadVideo: Boolean(officialUrl) && !videoStopped,
    framesIndex: lyricFramesIndex,
    captionsOk: captionsLoaded.ok,
    ffmpeg,
    vocalStem,
    transcript: transcriptOnDisk,
    python: Boolean(python),
  });
}

let cuesState = 'нет';
let cuesDetail = '';
if (lines.length === 0) {
  cuesState = 'рано';
  cuesDetail = 'строк ещё нет: реплики пишутся после id в lyrics.json';
} else if (cuesLoaded.problem) {
  cuesDetail = cuesLoaded.problem;
} else if (!cuesLoaded.rows) {
  if (subsOnDisk) {
    cuesDetail = 'субтитры лежат в work, cues.json ещё нет';
  } else if (!subsUnavailable && officialUrl) {
    cuesDetail = `нет docs/analysis/${slug}/cues.json`;
  } else if (currentWitness() !== 'done') {
    cuesDetail = 'официальных субтитров нет; дальше титры экрана и Whisper';
  } else if (!subsStopped) {
    cuesDetail = 'в review ещё нет фразы «официальные субтитры: пусто»';
  } else {
    cuesState = 'отложено';
    const heard = [
      captionsLoaded.ok ? `титров экрана ${captionsLoaded.count}` : videoOnDisk ? 'титры экрана не прочитались' : 'видео для титров нет',
      transcriptOnDisk ? 'Whisper есть' : vocalStem ? 'Whisper ещё не снят' : 'вокального стема для Whisper нет',
    ].join(', ');
    cuesDetail = `официальных субтитров нет (${heard}); повторно yt-dlp не запускать`;
  }
} else if (extraCues.length || missingCues.length) {
  cuesDetail = [missingCues.length ? `нет реплики: ${missingCues.length}` : '', extraCues.length ? `чужие id: ${extraCues.length}` : '']
    .filter(Boolean)
    .join(', ');
} else {
  cuesState = 'да';
  cuesDetail = `${cuesLoaded.rows.length} реплик, без текста`;
}

function partCoverage() {
  const vocal: { id: string; sectionId: string }[] = [];
  for (const section of lyrics.sections) {
    if (section.kind !== 'vocal') continue;
    for (const line of section.lines) vocal.push({ id: line.id, sectionId: section.id });
  }
  const owner = new Map<string, string>();
  const dup: string[] = [];
  for (const part of song.parts ?? []) {
    const claim = (id: string) => {
      const prev = owner.get(id);
      if (prev && prev !== part.id) dup.push(id);
      else if (!prev) owner.set(id, part.id);
    };
    for (const sid of part.sections ?? []) {
      for (const line of vocal) if (line.sectionId === sid) claim(line.id);
    }
    for (const lid of part.lines ?? []) claim(lid);
  }
  return { missing: vocal.filter((line) => !owner.has(line.id)).map((line) => line.id), dup };
}

const partsCov = partCoverage();
let partsState = lines.length === 0 ? 'рано' : 'нет';
let partsDetail = lines.length === 0 ? 'строк ещё нет' : '';
if (lines.length) {
  if (!song.parts?.length) partsDetail = 'нет поля parts';
  else if (partsCov.dup.length) partsDetail = `строка в двух частях: ${partsCov.dup.length}`;
  else if (partsCov.missing.length) partsDetail = `не входят в состав: ${partsCov.missing.length}`;
  else {
    partsState = 'да';
    partsDetail = `частей ${song.parts.length}, все строки входят`;
  }
}

const dossierPath = join(root, 'docs/analysis/translation', `${slug}.md`);
const dossier = readText(dossierPath);
const missingDossier = lineIds.filter((id) => !idInText(id, dossier));

function backNoted() {
  if (dossier.includes('Обратный перевод')) return true;
  const dir = join(root, 'docs/analysis/translation');
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!/^review-.*\.md$/.test(name)) continue;
    const text = readText(join(dir, name));
    if (!text.includes('Обратный перевод')) continue;
    if (text.includes(slug) || (song.title.length >= 3 && text.includes(song.title))) return true;
  }
  return false;
}

let dossierState = lines.length === 0 ? 'рано' : 'нет';
let dossierDetail = lines.length === 0 ? 'строк ещё нет' : '';
if (lines.length) {
  if (!dossier) dossierDetail = `нет docs/analysis/translation/${slug}.md`;
  else if (!dossier.includes('Источник') || !dossier.includes('Принято')) dossierDetail = 'в досье нет «Источник» или «Принято»';
  else if (missingDossier.length) dossierDetail = `нет id строк: ${missingDossier.length}`;
  else if (backWait) {
    dossierState = 'ждёт';
    dossierDetail = 'текст досье есть; обратный перевод ждёт Gemini и записан в review';
  } else if (!backNoted()) dossierDetail = 'нет пометы обратного перевода';
  else {
    dossierState = 'да';
    dossierDetail = 'все id, источник, принято, обратный перевод отмечен';
  }
}

const visionPath = join(root, 'docs/analysis', slug, 'vision.json');
const fusionOk = existsSync(join(root, 'docs/analysis', slug, 'fusion.json'));
const entriesOk = existsSync(join(root, 'docs/analysis', slug, 'entries.md'));
let visionFrames = 0;
let visionProblem = '';
if (existsSync(visionPath)) {
  try {
    const vision = JSON.parse(readText(visionPath)) as { frames?: unknown };
    visionFrames = Array.isArray(vision.frames) ? vision.frames.length : 0;
    if (!visionFrames) visionProblem = 'vision.json без кадров';
  } catch {
    visionProblem = 'vision.json не читается';
  }
}

let videoState = 'нет';
let videoDetail = '';
if (visionFrames > 0 && fusionOk && entriesOk && !visionProblem) {
  videoState = 'да';
  videoDetail = `кадров ${visionFrames}, сведение и вступления есть`;
} else if (!visionFrames && (videoStopped || (!videoOnDisk && !officialUrl))) {
  videoState = 'отложено';
  videoDetail = videoStopped
    ? 'в review отмечено, что официальное видео не скачалось; повторно yt-dlp не запускать'
    : `нет ссылки на официальное видео и нет work/${slug}/video.*`;
} else if (visionProblem) videoDetail = visionProblem;
else if (!visionFrames) videoDetail = videoOnDisk ? 'видео лежит в work, vision.json ещё нет' : 'нет vision.json';
else if (!fusionOk) videoDetail = 'нет fusion.json';
else videoDetail = 'нет entries.md';

function closed(state: string) {
  return state === 'да' || state === 'отложено' || state === 'ждёт';
}

/** A url, or a line `Файл: name.m4a`. `Файл: нет` is not a citation. */
function citesWork(text: string) {
  if (/https?:\/\//.test(text)) return true;
  return /файл:\s*\S+\.[A-Za-z0-9]{2,5}\b/i.test(text);
}

const languageStub =
  song.languages.length === 1 &&
  song.languages[0] === 'en' &&
  review.some((item) => /заглушка/.test(item) && /\ben\b/.test(item));
const sourcesReady = !!sources && !sources.includes(TEMPLATE) && citesWork(sources) && !languageStub;
const audioReady = song.audio.status === 'ready' && (enc || plain) && !!song.audio.provenance && song.duration > 1;
const structureReady = vocal.length > 0 && lines.length > 0;
const canonReady =
  !!canonText && !canonText.includes(TEMPLATE) && (citesWork(canonText) || /Подтверждено:\s*[1-9]/.test(canonText));
const textReady = canonReady && lines.length > 0 && missingCanon.length === 0;

/**
 * One ## block before «Последовательность» / «Расхождения» is one fragment
 * (a poem, a bayt, a prayer, a refrain). Sung text is read from code fences,
 * labels (F1, H2, S1) and numbered or indented poem lines. Russian prose
 * and tables are not sung text: a fragment that only retells the poem
 * in Russian stays invisible, and so does a line shorter than 8 letters.
 */
function cyrillicHeavy(text: string) {
  const cyr = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const all = text.match(/\p{L}/gu)?.length ?? 0;
  return all > 0 && cyr / all > 0.5;
}

function canonFragments(canon: string) {
  // `\b` is ASCII-only and the `i` flag does not fold Cyrillic, so the heading is matched by letters.
  const skip = /^(последовательность|расхождения)(?:\s|$)/iu;
  const labelRe = /^[-*]\s+(\S{1,12})\.\s+(\S.*?)\s*$/;
  const out: { title: string; pools: string[] }[] = [];
  for (const part of canon.split(/^## /m).slice(1)) {
    const breakAt = part.indexOf('\n');
    const title = (breakAt === -1 ? part : part.slice(0, breakAt)).trim();
    if (skip.test(title)) continue;
    const body = breakAt === -1 ? '' : part.slice(breakAt + 1);
    const pools: string[] = [];
    let inFence = false;
    for (const row of body.split(/\r?\n/)) {
      if (/^```/.test(row.trim())) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        const pool = letters(row);
        if (pool.length >= 8) pools.push(pool);
        continue;
      }
      if (/^\s*\|/.test(row) || /^#{1,6}\s/.test(row)) continue;
      const labelled = row.match(labelRe);
      if (labelled && /^[A-Za-zА-Яа-яЁё]{1,4}\d/.test(labelled[1])) {
        const pool = letters(labelled[2].split(/\s+—\s+/)[0]);
        if (pool.length >= 8) pools.push(pool);
        continue;
      }
      const numbered = row.match(/^\d+\.\s+(\S.*?)\s*$/);
      if (numbered && !cyrillicHeavy(numbered[1]) && !/https?:\/\//i.test(numbered[1])) {
        const pool = letters(numbered[1].split(/\s+—\s+/)[0]);
        if (pool.length >= 8) pools.push(pool);
        continue;
      }
      const indented = row.match(/^[ \t]{2,}(\S.*?)\s*$/);
      if (indented && !/^[-—]/.test(indented[1]) && !cyrillicHeavy(indented[1])) {
        const pool = letters(indented[1].split(/\s+—\s+/)[0]);
        if (pool.length >= 8) pools.push(pool);
      }
    }
    if (pools.length) out.push({ title, pools });
  }
  return out;
}

const VOICE_KEYS = new Set(['voice', 'choir']);
const fragments = canonFragments(canonText);
const fragmentSeen = new Set<string>();
const fragmentsWithoutComment: { title: string; sectionId: string }[] = [];
for (const section of vocal) {
  let best: { title: string; score: number; slack: number } | null = null;
  for (const fragment of fragments) {
    let score = 0;
    let slack = Infinity;
    for (const line of section.lines) {
      const got = letters(line.words.map((word) => word.w).join(' '));
      if (got.length < 8) continue;
      for (const pool of fragment.pools) {
        if (!pool.includes(got) && !got.includes(pool)) continue;
        const nextScore = Math.min(got.length, pool.length);
        const nextSlack = Math.abs(got.length - pool.length);
        if (nextScore > score || (nextScore === score && nextSlack < slack)) {
          score = nextScore;
          slack = nextSlack;
        }
      }
    }
    if (score < 8) continue;
    if (!best || score > best.score || (score === best.score && slack < best.slack)) {
      best = { title: fragment.title, score, slack };
    }
  }
  const opening = section.comment?.trim() || section.lines[0]?.comment?.trim();
  if (!best || fragmentSeen.has(best.title)) continue;
  fragmentSeen.add(best.title);
  if (!opening) fragmentsWithoutComment.push({ title: best.title, sectionId: section.id });
}
const bareInstrumentals = lyrics.sections.filter(
  (section) =>
    section.kind === 'instrumental' &&
    !section.instruments.every((key) => VOICE_KEYS.has(key)) &&
    !section.note?.trim(),
);
const timingReady = song.timing.status === 'aligned' || song.timing.status === 'verified';
const translationReady = lines.every((line) => line.tr.ru.trim()) && slow.length === 0;
const commentsReady = lines.length > 0 && fragmentsWithoutComment.length === 0 && bareInstrumentals.length === 0;
const translitReady = noTranslit.length === 0;
const instrumentsReady = unknownInstruments.length === 0;
const qaReady = flagCount === 0 && review.length === 0;
const coverFileExt = song.cover?.ext === 'jpg' ? 'jpg' : 'png';
const coverReady = [96, 192, 512, 1024].every((size) =>
  existsSync(join(root, 'public/covers', slug, `${size}.${coverFileExt}`)),
);

const rows: Row[] = [
  {
    n: '—',
    name: 'версия',
    state: 'да',
    detail: `${song.version.kind} · ${song.version.label}`,
  },
  {
    n: '1',
    name: 'приём',
    state: sourcesReady ? 'да' : 'нет',
    detail: sourcesReady
      ? 'song.json и sources.md со ссылкой или файлом'
      : !sources || sources.includes(TEMPLATE) || !citesWork(sources)
        ? 'sources.md ещё шаблон или без источника'
        : 'в song.json всё ещё язык-заглушка en',
  },
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
    n: '2б',
    name: 'шифр',
    state: cipherRow(enc, plain, audioKey).state,
    detail: enc ? `content/audio-enc/${slug}/high.m4a.enc` : cipherRow(enc, plain, audioKey).detail,
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
        : lines.length === 0
          ? 'вокальных строк ещё нет'
          : missingCanon.length
            ? `не найдены в canon.md: ${missingCanon.length}`
            : 'все строки есть в canon.md',
  },
  { n: '4б', name: 'состав', state: partsState, detail: partsDetail },
  { n: '4в', name: 'реплики', state: cuesState, detail: cuesDetail },
  {
    n: '6',
    name: 'перевод',
    state: lines.length === 0 ? 'рано' : translationReady ? 'да' : 'нет',
    detail: lines.length === 0 ? 'строк ещё нет' : slow.length ? `быстрее ${CPS_OK} зн/с: ${slow.length}` : 'скорость в норме',
  },
  { n: '6б', name: 'досье', state: dossierState, detail: dossierDetail },
  {
    n: '7',
    name: 'пояснения',
    state: lines.length === 0 ? 'рано' : commentsReady ? 'да' : 'нет',
    detail:
      lines.length === 0
        ? 'строк ещё нет'
        : commentsReady
          ? 'у фрагмента есть пояснение, у проигрыша — заметка'
          : `фрагмент без пояснения: ${fragmentsWithoutComment.length}, проигрыш без заметки: ${bareInstrumentals.length}`,
  },
  {
    n: '8',
    name: 'транскрипция',
    state: translitReady ? 'да' : 'нет',
    detail: noTranslit.length ? `без translit: ${noTranslit.length}` : 'арабское письмо закрыто',
  },
  { n: '9б', name: 'видео', state: videoState, detail: videoDetail },
  {
    n: '9',
    name: 'инструменты',
    state: instrumentsReady ? 'да' : 'нет',
    detail: instrumentsReady ? 'ключи есть в каталоге' : `нет в каталоге: ${[...new Set(unknownInstruments)].join(', ')}`,
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
  { n: '10', name: 'сцена', state: 'да', detail: 'код под песню не нужен: поток строк сам' },
  {
    n: '—',
    name: 'обложка',
    state: coverReady ? 'да' : 'нет',
    detail: coverReady ? `public/covers: 96, 192, 512, 1024.${coverFileExt}` : 'нет файла — npm run art -- covers',
  },
  {
    n: '11',
    name: 'проверка',
    state: qaReady ? 'да' : 'открыто',
    detail: qaReady ? 'флагов и вопросов нет' : `флаги ${flagCount}, вопросы ${review.length}`,
  },
  { n: '12', name: 'публикация', state: 'рано', detail: 'после того как строки 1–11 закрыты' },
];

function ytInvoke(format: string, output: string, url: string) {
  return `python -m yt_dlp --no-playlist --js-runtimes node --extractor-args "youtube:player_client=tv,web_embedded" -f ${format} -o "${output}" "${url}"`;
}

function audioNext(): Next {
  if (!sourceFile && !plain && !enc && officialUrl && !videoStopped) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: ytInvoke('140', `work/${slug}/source.m4a`, officialUrl),
      because: `Одна попытка на машине владельца: звук дорожки 140 того же ролика, что и видео. Каталог work/ в git не входит. Если ответ 429, допишите в review ровно: официальное видео: yt-dlp 429. Если просит войти — официальное видео: просит войти. Повторять команду, менять клиент и брать другой ролик не нужно: дальше файл присылает владелец. Когда source.m4a лежит в work/${slug}, song-status даст process_audio.py. Видео 360p эта команда не качает.`,
    };
  }
  if (python && ffmpeg && sourceFile) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `${python} scripts/pipeline/process_audio.py ${slug}`,
      because:
        'Исходник уже лежит в work/' +
        slug +
        '/source.*. Скрипт соберёт high.m4a, saver.m4a и peaks.json. Потом снова song-status. Шифр — отдельная строка таблицы: без AUDIO_KEY она «шифр: ждёт ключа», и команда идёт на следующую стадию. Шифр нужен только к коммиту на стадии 12. Открытый m4a в git не класть.',
    };
  }
  if (plain && !enc) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `npm run song-status -- ${slug}`,
      because:
        'Открытый high.m4a уже лежит в public/audio. Шифр маршрут не держит: строка «шифр» в таблице, команда шифрования — только на стадии 12. Пока audio.status, provenance или duration не закрыты, запись не «да». Числа пишет process_audio.py; если файл уже измерен, повторно его не запускать, а поправить song.json по 02-audio.md. Открытый m4a в git не класть.',
    };
  }
  if (python && ffmpeg) {
    return {
      row: '2',
      file: 'docs/methodology/02-audio.md',
      command: `npm run song-status -- ${slug}`,
      because: videoStopped
        ? `Скачивание официального видео остановлено фразой в review. Положите файл владельца в work/${slug}/source.m4a и запустите команду снова.`
        : `Положите файл владельца в work/${slug}/source.m4a или запишите ссылку на официальное видео в sources.md. Чужой ролик не берите. Когда файл лежит в work, song-status даст process_audio.py.`,
    };
  }
  const missingTool = !python && !ffmpeg ? 'нет ни Python, ни ffmpeg' : !ffmpeg ? 'нет ffmpeg' : 'нет Python';
  return {
    row: '2',
    file: 'docs/methodology/02-audio.md',
    command: `npm run song-status -- ${slug}`,
    because: videoStopped
      ? `Скачивание остановлено фразой в review (${missingTool}). Положите файл владельца в work/${slug}/source.m4a. scripts/pipeline/fetch_audio.sh не запускать.`
      : `Обработать файл нечем (${missingTool}). Если ссылка на официальное видео уже в sources.md, команду yt-dlp печатает эта стадия на машине, где есть Python. Иначе положите файл владельца в work/${slug}/source.m4a. scripts/pipeline/fetch_audio.sh не запускать: он берёт другую дорожку. Когда файл лежит в work и есть и Python, и ffmpeg, эта команда сменится на process_audio.py.`,
  };
}

function witnessNext(): Next | null {
  const step = currentWitness();
  if (step === 'done') return null;
  const videoPath = videoRel || `work/${slug}/video.mp4`;
  const agy = agyInvoke(slug, 'captions.json', 'captions-prompt.md', `read-captions ${slug}`);
  const agyHow = `Титры на экране читает Gemini, не Grok. Скопируйте scripts/instrument_id/prompts/read-captions.md в work/${slug}/captions-prompt.md и подставьте путь видео вместо {{VIDEO}} (${videoPath}). Запуск из корня репозитория (agy только через agy_run.py настройки владельца):\n  ${agy}\nОтвет structured_output запишите в docs/analysis/${slug}/captions.json. Если вы не Claude · Lead, напишите в отчёте, что титры ждут просмотра, и agy не вызывайте.`;
  const letters =
    'Буквы строк — из canon.md. Порядок и время — по этим свидетелям. Расхождения — в review и в «Расхождения и вопросы». В lyrics.json текст распознавания не копировать.';
  if (step === 'download-video') {
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: ytInvoke('18', `work/${slug}/video.mp4`, officialUrl),
      because: `Официальных субтитров нет. Для текста на экране нужен тот же ролик, формат 18 (360p), одна попытка. Если 429 или вход — те же фразы review, что у записи. Когда файл лежит, song-status напечатает команду чтения титров. ${letters}`,
    };
  }
  if (step === 'lyric-frames') {
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: `${python} scripts/pipeline/lyric_frames.py ${slug}`,
      because: `Дешёвая проверка кадров любого видеофайла. По умолчанию work/${slug}/video.*; другой файл — тот же скрипт с --video <путь>. Кадры лягут в work/${slug}/lyric-frames/ и в git не входят. Буквы скрипт не читает.\n${agyHow}\n${letters}`,
    };
  }
  if (step === 'read-captions') {
    const problem = captionsLoaded.problem ? `${captionsLoaded.problem}. ` : '';
    const frames = ffmpeg ? '' : ' ffmpeg нет, lyric_frames.py в этой среде не запускается.';
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: `npm run song-status -- ${slug}`,
      because: `${problem}${agyHow}\n${letters}${frames}`,
    };
  }
  return {
    row: '4в',
    file: 'docs/methodology/04-text.md',
    command: `${python} scripts/pipeline/transcribe.py ${slug}`,
    because: `Whisper по вокальному стему work/${slug}/stems/vocals.wav пишет work/${slug}/transcript.json. Это свидетель порядка и времени, не эталон букв. ${letters} transcript.json в git не класть.`,
  };
}

function textNext(prefix = ''): Next {
  if (canonReady && lines.length === 0 && !subsOnDisk && !subsUnavailable && officialUrl) {
    return {
      row: '4',
      file: 'docs/methodology/04-text.md',
      command: `yt-dlp --skip-download --write-subs --sub-langs "ar,fa,tr,az,he,hi,la,de,en" --convert-subs vtt -o "work/${slug}/subs" "${officialUrl}"`,
      because:
        prefix +
        'Вокальных строк ещё нет. Одна попытка официальных субтитров, звук не качается. Пустой ответ, 429 или страница с проверкой — одна фраза в review: официальные субтитры: пусто или официальные субтитры: yt-dlp 429. Повторять не нужно. Дальше song-status даст титры экрана и Whisper. Буквы строк — из canon.md.',
    };
  }
  if (canonReady && lines.length === 0 && subsUnavailable) {
    const witness = witnessNext();
    if (witness) {
      witness.row = '4';
      witness.file = 'docs/methodology/04-text.md';
      witness.because =
        prefix +
        'Официальных субтитров нет. Файл субтитров у владельца не ждут. Буквы — из canon.md. Порядок и время — по свидетелям ниже. Расхождения — в review и в «Расхождения и вопросы».\n' +
        witness.because;
      return witness;
    }
  }
  const shown = missingCanon.slice(0, 8);
  const more = missingCanon.length - shown.length;
  const sample = shown.map((line) => `  ${line.id} — ${short(line.words.map((w) => w.w).join(' '))}`).join('\n');
  const because = !canonReady
    ? 'Соберите canon.md по шаблону docs/methodology/templates/canon.md: фрагмент, источник, пометка «Подтверждено: 1 источник» или «Подтверждено: 2 источника», затем «Последовательность в записи» и «Расхождения и вопросы». Строку «пустой шаблон» удалите. Секунды не выдумывайте: в столбце «с» ставьте «?».' +
      (subsUnavailable ? ' Официальных субтитров нет: после канона свидетели — титры экрана и Whisper, не файл от владельца.' : '')
    : lines.length === 0
      ? subsOnDisk
        ? `Субтитры уже лежат в work/${slug}. Буквы строк — из canon.md, порядок — по репликам. Границы секций не выдумывайте.`
        : subsUnavailable
          ? 'Свидетели, которые удалось снять, уже есть либо их нечем снять. Буквы — из canon.md. Порядок и время — по ним. Чего нет — флаг text-unverified и пункт в review. Если в review ещё нет фразы «официальные субтитры: пусто», допишите её. В столбце «с» ставьте «?», секунды не выдумывайте.'
          : 'Ссылки в canon.md мало: в lyrics.json ещё нет вокальных строк. Допишите цитату, «Как поётся» и последовательность. Строки в lyrics.json переносите, когда есть карта записи или официальные титры с порядком. Границы секций и секунды не выдумывайте.'
      : `Эти строки не найдены в canon.md:\n${sample}${more > 0 ? `\n  … и ещё ${more}` : ''}\nПриведите lyrics.json к эталону или объясните расхождение в разделе «Расхождения и вопросы». Канон не переписывайте по слуху.`;
  return {
    row: '4',
    file: 'docs/methodology/04-text.md',
    command: lines.length > 0 && canonReady ? `npm run validate -- ${slug}` : `npm run song-status -- ${slug}`,
    because: prefix + because,
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
  const paths = [`content/songs/${slug}`];
  if (enc) paths.push(`content/audio-enc/${slug}`);
  if (existsSync(join(root, 'docs/analysis', slug))) paths.push(`docs/analysis/${slug}`);
  if (existsSync(dossierPath)) paths.push(`docs/analysis/translation/${slug}.md`);
  return {
    row: '12',
    file: 'docs/methodology/12-publish.md',
    command: `git add ${paths.join(' ')}`,
    because: `Коммит в свою ветку. В main не сливать. Открытый m4a не добавлять. Сообщение: Add ${song.title}: text, translation, commentary, timing (${status}). work/ не коммитить. Прослушивание владельцем этой командой не запускается.`,
  };
}

function partsNext(): Next {
  const sample = partsCov.missing.slice(0, 8).map((id) => `  ${id}`).join('\n');
  return {
    row: '4б',
    file: 'docs/methodology/04-text.md',
    command: `npm run validate -- ${slug}`,
    because: !song.parts?.length
      ? 'Заполните song.json → parts по разделу «Состав песни» в 04-text.md. Только то, что назвали canon.md и sources.md. Чего источник не назвал, не пишите: карточка сама скажет «не установлено». Состав можно вести параллельно с переводом и видео, когда строки уже лежат.'
      : partsCov.dup.length
        ? `Строка входит в две части (${partsCov.dup.slice(0, 8).join(', ')}). Одна вокальная строка — одна часть.`
        : `Эти строки не входят в состав:\n${sample}\nДобавьте их в sections или lines нужной части.`,
  };
}

function cuesNext(): Next {
  if (cuesLoaded.problem || (cuesLoaded.rows && (extraCues.length || missingCues.length))) {
    const sample = missingCues.slice(0, 8).map((id) => `  ${id}`).join('\n');
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: `npm run song-status -- ${slug}`,
      because: `Поправьте docs/analysis/${slug}/cues.json. В каждом объекте только line, cue, lang, start, end. Текста реплики нет. Каждая вокальная строка — одна реплика.${sample ? `\n${sample}` : ''}`,
    };
  }
  if (subsOnDisk) {
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: `npm run song-status -- ${slug}`,
      because: `Субтитры уже лежат в work/${slug}. В git их не кладите. Напишите docs/analysis/${slug}/cues.json по разделу «Если официальные субтитры уже лежат» в 04-text.md: время и id, без текста. timing.status остаётся draft. npm run draft-timing не запускайте.`,
    };
  }
  if (subsUnavailable) {
    const witness = witnessNext();
    if (witness) return witness;
  }
  if (officialUrl && !subsStopped) {
    return {
      row: '4в',
      file: 'docs/methodology/04-text.md',
      command: `yt-dlp --skip-download --write-subs --sub-langs "ar,fa,tr,az,he,hi,la,de,en" --convert-subs vtt -o "work/${slug}/subs" "${officialUrl}"`,
      because:
        'Одна попытка, звук не качается. Если ответ пустой, 429 или страница с проверкой, допишите в review ровно одну фразу: официальные субтитры: yt-dlp 429 или официальные субтитры: пусто. Повторять команду не нужно. Следующий song-status даст титры экрана и Whisper. Файл субтитров у владельца не ждут. Автосубтитры в эталон не идут.',
    };
  }
  return {
    row: '4в',
    file: 'docs/methodology/04-text.md',
    command: `npm run song-status -- ${slug}`,
    because:
      'Ссылки на официальное видео в sources.md нет, поэтому субтитры скачать нечем. Допишите в review ровно: официальные субтитры: пусто. Следующий song-status перейдёт к титрам экрана, если видеофайл уже есть, и к Whisper по вокальному стему.',
  };
}

function dossierNext(): Next {
  if (!dossier || missingDossier.length || !dossier.includes('Источник') || !dossier.includes('Принято')) {
    const sample = missingDossier.slice(0, 8).map((id) => `  ${id}`).join('\n');
    return {
      row: '6б',
      file: 'docs/methodology/06-translation.md',
      command: `npm run song-status -- ${slug}`,
      because: !dossier
        ? `Создайте docs/analysis/translation/${slug}.md по разделу «Досье» в 06-translation.md и по образцу docs/analysis/translation/karitas.md. Текст той песни не копируйте. Стандарт — docs/methodology/translation-standard.md. Чего не открыли — «требует проверки».`
        : `Допишите досье. Нет id:\n${sample}\nУ блока есть «Источник» и «Принято».`,
    };
  }
  return {
    row: '6б',
    file: 'docs/methodology/06-translation.md',
    command: `npm run song-status -- ${slug}`,
    because:
      'Обратный перевод делает другая модель, её вызывает Claude · Lead. Grok ответ не выдумывает. Когда проверка записана, добавьте в досье заголовок «Обратный перевод» и решения по замечаниям. Если Gemini сейчас недоступен, допишите в review ровно: обратный перевод: ждёт Gemini — и остановитесь, команду не повторяйте.',
  };
}

function videoNext(): Next {
  const py = python || 'python';
  if (!visionFrames && videoOnDisk) {
    return {
      row: '9б',
      file: 'docs/methodology/09-instruments.md',
      command: `npm run song-status -- ${slug}`,
      because: `Видео лежит в work/${slug}. Просмотр запускает Claude · Lead, не Grok. Задание — scripts/instrument_id/prompts/watch-video.md: сначала вид ролика (concert, lyric_video, static, other) в поле video_type. У лирик-видео в заметке кадра — что титры есть и где; буквы титров читает отдельное задание read-captions.md. У концерта — инструменты, как раньше. Скопируйте задание в work/${slug}/watch-prompt.md, путь видео подставьте вместо {{VIDEO}}, запустите из корня репозитория (agy только через agy_run.py настройки владельца, он же пишет расход):\n  ${agyInvoke(slug, 'vision.json', 'watch-prompt.md', `watch-video ${slug}`)}\nОтвет structured_output запишите в docs/analysis/${slug}/vision.json. Поле video_type можно не присылать: старый файл без него проходит проверку. Если вы не Claude · Lead, напишите в отчёте, что видео ждёт просмотра, и agy не вызывайте.`,
    };
  }
  if (!visionFrames && officialUrl && !videoStopped) {
    return {
      row: '9б',
      file: 'docs/methodology/09-instruments.md',
      command: ytInvoke('18', `work/${slug}/video.mp4`, officialUrl),
      because:
        'Одна попытка, тот же ролик, что и звук: формат 18 — это 360p. Если 429 или вход — те же фразы review, что в стадии 2. Повторно не запускать. Файл в git не класть.',
    };
  }
  if (visionFrames && !fusionOk) {
    return {
      row: '9б',
      file: 'docs/methodology/09-instruments.md',
      command: `${py} scripts/instrument_id/run.py fuse ${slug}`,
      because: 'Сведение титров, кадров и звука, если звук уже распознан. Одного звука для инструмента недостаточно. Дальше снова song-status.',
    };
  }
  return {
    row: '9б',
    file: 'docs/methodology/09-instruments.md',
    command: `${py} scripts/instrument_id/run.py entries ${slug} --write`,
    because: `Пишет docs/analysis/${slug}/entries.md и поля instruments, entries, performers. Правило — «титры и чёткий кадр» или «три плана», оно же в 09-instruments.md. Строки и время слов не трогает. Если features.json нет, атака не уточняется, команда всё равно эта. Потом npm run validate -- ${slug}.`,
  };
}

let next: Next | null = null;
if (!sourcesReady) {
  next = {
    row: '1',
    file: 'docs/methodology/01-intake.md',
    command: `npm run song-status -- ${slug}`,
    because:
      languageStub && !!sources && !sources.includes(TEMPLATE) && citesWork(sources)
        ? 'В song.json замените язык-заглушку en на языки, которые реально поются. Когда код уже верный, пункт review про заглушку перепишите. Ссылку на официальное видео запишите в sources.md целиком: скачивание печатает стадия записи, одну попытку, тот же ролик.'
        : 'Заполните sources.md: адрес https:// официального видео или строка «Файл: имя.расширение» (например «Файл: recording.m4a»). «Файл: нет» источником не считается. Строку «пустой шаблон» удалите. В song.json замените язык-заглушку en на языки, которые реально поются. Чужой ролик не записывайте.',
  };
} else if (!audioReady && (Boolean(python && ffmpeg) || (Boolean(officialUrl) && !videoStopped && !sourceFile))) {
  next = audioNext();
} else if (!audioReady && !textReady) {
  const missingTool = !python && !ffmpeg ? 'нет ни Python, ни ffmpeg' : !ffmpeg ? 'нет ffmpeg' : 'нет Python';
  next = textNext(
    `Записи ещё нет (${missingTool}). Если в sources.md есть ссылка на официальное видео, стадия записи даст одну команду yt-dlp на машине владельца. Пока файла нет, соберите текст. Секунды не ставьте.\n`,
  );
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
    because: `Создайте jobs/${slug}.json: {"slug":"${slug}","stages":["separate","sections"]}. Ответ коммита кладёт карту в docs/analysis/${slug}/sections.suggested.json. Границы без этого файла не выдумывайте. Секунды перенесите в lyrics.json и проверьте на слух.`,
  };
} else if (!textReady) {
  if (!structureReady) {
    const structure = rows.find((row) => row.name === 'структура');
    if (structure) {
      structure.state = 'отложено';
      structure.detail = 'границы не выдуманы: нет ни Python с ffmpeg, ни конвейера на ветке';
    }
  }
  next = textNext();
} else if (!closed(partsState)) {
  next = partsNext();
} else if (!closed(cuesState)) {
  next = cuesNext();
} else if (!translationReady) {
  const sample = slow.slice(0, 5).map((line) => `  ${line.id} — ${line.cps.toFixed(0)} зн/с при ${line.sung.toFixed(1)} с`).join('\n');
  next = {
    row: '6',
    file: 'docs/methodology/06-translation.md',
    command: `npm run validate -- ${slug}`,
    because: slow.length
      ? `Сократите перевод, пока скорость не станет ≤ ${CPS_OK} зн/с. Считает строка как поётся (конец последнего слова минус начало первого), не пауза после неё:\n${sample}`
      : 'У вокальной строки пустой перевод. Смысл — по docs/methodology/translation-standard.md. Досье — следующая строка, когда скорость уже в норме.',
  };
} else if (!closed(dossierState)) {
  next = dossierNext();
} else if (!commentsReady) {
  const sample = [
    ...fragmentsWithoutComment.slice(0, 4).map((fragment) => `  фрагмент «${short(fragment.title)}» — секция ${fragment.sectionId}`),
    ...bareInstrumentals.slice(0, 4).map((section) => `  проигрыш ${section.id} — нет note`),
  ].join('\n');
  next = {
    row: '7',
    file: 'docs/methodology/07-comment.md',
    command: `npm run song-status -- ${slug}`,
    because: `Одно пояснение на фрагмент канона: автор, форма, контекст. Место — первая секция фрагмента или её первая строка. Строке с em пояснение не нужно, ей нужна пара **…** в переводе. Пустое пояснение ради галочки не пишите. У проигрыша — note, одно-два спокойных предложения. Секция только с voice или choir ничего не требует. Если рядом с voice или choir стоит другой ключ, note нужен: это уже не секция только из голоса.\n${sample}\nПояснение отдельной строки пишите, только если перевод не передал термин, игру слов или аллюзию. Такие строки машина не ищет: это чек-лист в файле стадии.`,
  };
} else if (!translitReady) {
  const sample = noTranslit.slice(0, 5).map((line) => `  ${line.id}`).join('\n');
  next = {
    row: '8',
    file: 'docs/methodology/08-transliteration.md',
    command: `npm run validate -- ${slug}`,
    because: `Для арабского письма заполните translit кириллицей, как поётся:\n${sample}`,
  };
} else if (!closed(videoState)) {
  next = videoNext();
} else if (!instrumentsReady) {
  next = {
    row: '9',
    file: 'docs/methodology/09-instruments.md',
    command: `npm run validate -- ${slug}`,
    because: `Ключей нет в src/instruments/list.ts: ${[...new Set(unknownInstruments)].join(', ')}. Новый инструмент — запись в каталоге и гравюра по рецепту стадии 9, не отдельный модуль песни. Пока инструмент не опознан, ставьте ensemble и флаг attribution-unverified.`,
  };
} else if (!timingReady && pipeline) {
  next = timingNext();
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
    because:
      'Текст, перевод и пояснения закрыты, но время слов всё ещё черновик, а конвейера на ветке нет. Публиковать рано: пословную заливку сайт при draft не включает. Задание jobs/' +
      slug +
      '.json не создавайте: файла .github/workflows/pipeline.yml нет, пустой пуш ничего не посчитает. Когда файл появится, эта команда сменится на задание. Секунды руками не ставьте.',
  };
} else if (!coverReady) {
  next = {
    row: '—',
    file: 'docs/design/design-system.md',
    command: 'npm run art -- covers',
    because:
      song.cover?.kind === 'official'
        ? `Официальная обложка${song.cover.releaseTitle ? ` «${song.cover.releaseTitle}»` : ''}. Нужны public/covers/${slug}/source.jpg и jpg 96, 192, 512, 1024. Команда уменьшает исходник и не рисует вместо него цветовое поле.`
        : `Официального файла нет: квадрат цвета из palette.field, без букв. Нужны public/covers/${slug}/96.png, 192.png, 512.png и 1024.png. Команда рисует поле только для таких песен.`,
  };
} else if (!enc) {
  const publish = rows.find((row) => row.name === 'публикация');
  if (publish) {
    publish.state = 'рано';
    publish.detail = audioKey ? 'перед коммитом нужен шифр: ключ есть' : 'шифр: ждёт ключа; открытый файл в git не входит';
  }
  next = encryptIsNext(true, enc, plain, audioKey)
    ? {
        row: '12',
        file: 'docs/methodology/12-publish.md',
        command: `npm run audio:encrypt -- ${slug}`,
        because:
          'Строки маршрута закрыты. В git коммитится только шифр. Ключ уже есть: npm run audio:encrypt, затем снова song-status. Открытый m4a не добавлять.',
      }
    : {
        row: '12',
        file: 'docs/methodology/12-publish.md',
        command: `npm run song-status -- ${slug}`,
        because:
          'Строки маршрута закрыты. Шифр — условие коммита записи. Ключа AUDIO_KEY нет: строка «шифр» — «шифр: ждёт ключа». Открытый файл в git не класть. Коммит записи ждёт ключ. Это место, где нужен человек; остальные стадии от ключа не зависят.',
      };
} else {
  const publish = rows.find((row) => row.name === 'публикация');
  if (publish) {
    publish.state = 'да';
    publish.detail = 'можно коммитить';
  }
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
if (next.command.includes('song-status')) {
  console.log('Эта команда файлы не правит. Сначала сделайте то, что в абзаце выше, потом запустите её снова.');
}
