/**
 * Telegram inbox. Forward a recording to the bot (or send a Dropbox / Google Drive / direct link)
 * and it lands in the repository encrypted, under content/inbox/<date>-<name>/, with a quality
 * report. The next agent run takes it from there (docs/methodology/01-sourcing.md).
 *
 * The bot does not download from YouTube: YouTube refuses cloud servers ("confirm you're not a bot"),
 * so a YouTube link is saved to the inbox as a request and the bot asks for the file.
 *
 * Environment (Vercel → Settings → Environment Variables):
 *   TELEGRAM_BOT_TOKEN   from @BotFather
 *   GITHUB_TOKEN         fine-grained token, this repository only, Contents: read and write
 *   AUDIO_KEY            already set: recordings are stored AES-256-GCM encrypted
 *   TELEGRAM_ALLOWED_USERS  optional, comma-separated Telegram ids; owners can also join through
 *                        the link on the setup page, which records them in content/inbox/owners.json
 * Setup: open https://<site>/api/telegram?setup=1 while signed in to the site.
 */
import { waitUntil } from '@vercel/functions';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, inspect } from './_audio.js';

const TG_FILE_LIMIT = 20 * 1024 * 1024; // Bot API refuses to hand out larger files
const LINK_LIMIT = 45 * 1024 * 1024;
const OWNERS = 'content/inbox/owners.json';

type TgFile = { file_id: string; file_size?: number; file_name?: string; mime_type?: string; duration?: number; title?: string; performer?: string };
type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number };
  from?: { id: number; first_name?: string; username?: string };
  text?: string;
  caption?: string;
  audio?: TgFile;
  document?: TgFile;
  video?: TgFile;
  voice?: TgFile;
};

const env = (k: string) => process.env[k]?.trim() || '';
const secretFor = (token: string) => createHmac('sha256', token).update('webhook').digest('hex').slice(0, 48);
const ownerCode = (token: string) => createHmac('sha256', token).update('owner:' + env('AUTH_SECRET')).digest('hex').slice(0, 16);

async function tg<T = unknown>(method: string, body: unknown): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

const say = (msg: TgMessage, text: string) =>
  tg('sendMessage', { chat_id: msg.chat.id, text, reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true }, link_preview_options: { is_disabled: true } });

// ---------------------------------------------------------------- GitHub

const repo = () => env('GITHUB_REPO') || `${env('VERCEL_GIT_REPO_OWNER') || 'SharipovAkhror'}/${env('VERCEL_GIT_REPO_SLUG') || 'living-lyrics'}`;
const branch = () => env('GITHUB_BRANCH') || 'main';

async function gh<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${env('GITHUB_TOKEN')}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'living-lyrics-inbox',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/** One commit with several files (Git Data API: blobs → tree → commit → ref). */
async function commit(files: { path: string; data: Buffer }[], message: string) {
  const blobs = await Promise.all(
    files.map((f) => gh<{ sha: string }>('/git/blobs', { method: 'POST', body: { content: f.data.toString('base64'), encoding: 'base64' } })),
  );
  for (let attempt = 0; ; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${branch()}`);
    const parent = await gh<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
    const tree = await gh<{ sha: string }>('/git/trees', {
      method: 'POST',
      body: { base_tree: parent.tree.sha, tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i].sha })) },
    });
    const c = await gh<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [ref.object.sha], author: { name: 'Living Lyrics inbox', email: 'inbox@living-lyrics.invalid' } },
    });
    try {
      await gh(`/git/refs/heads/${branch()}`, { method: 'PATCH', body: { sha: c.sha } });
      return;
    } catch (e) {
      if (attempt >= 2) throw e; // the branch moved under us: rebuild on the new head
    }
  }
}

let ownersCache: { at: number; ids: string[] } | null = null;
async function owners(): Promise<string[]> {
  if (ownersCache && Date.now() - ownersCache.at < 60_000) return ownersCache.ids;
  let ids: string[] = [];
  try {
    const f = await gh<{ content: string }>(`/contents/${OWNERS}?ref=${branch()}`);
    ids = (JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')) as { ids: string[] }).ids;
  } catch {
    ids = [];
  }
  ownersCache = { at: Date.now(), ids };
  return ids;
}

// ---------------------------------------------------------------- inbox

const CYR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' };
function slugify(s: string) {
  const t = s
    .toLowerCase()
    .replace(/[а-яё]/g, (c) => CYR[c] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return t || 'recording';
}

function encrypt(data: Buffer) {
  const key = Buffer.from(env('AUDIO_KEY'), 'hex');
  if (key.length !== 32) throw new Error('AUDIO_KEY не задан');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

const EXT: Record<string, string> = { 'MP4/M4A': 'm4a', FLAC: 'flac', WAV: 'wav', Ogg: 'ogg', WebM: 'webm', MP3: 'mp3' };

async function file(msg: TgMessage, data: Buffer, meta: { name: string; mime: string; seconds?: number; title?: string; performer?: string; source: string }, links: string[], note: string) {
  const q = inspect(data, meta.name, meta.mime, meta.seconds);
  const label = [meta.performer, meta.title].filter(Boolean).join(' — ') || meta.name.replace(/\.[^.]+$/, '');
  const stamp = new Date(msg.date * 1000).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const dir = `content/inbox/${stamp}-${slugify(label)}`;
  const ext = EXT[q.format] ?? (meta.name.split('.').pop() || 'bin').toLowerCase();
  const info = {
    received: new Date(msg.date * 1000).toISOString(),
    via: meta.source,
    from: msg.from?.username ?? msg.from?.first_name ?? null,
    label,
    title: meta.title ?? null,
    performer: meta.performer ?? null,
    fileName: meta.name,
    note: note || null,
    links,
    file: `source.${ext}.enc`,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    quality: q,
  };
  await commit(
    [
      { path: `${dir}/source.${ext}.enc`, data: encrypt(data) },
      { path: `${dir}/info.json`, data: Buffer.from(JSON.stringify(info, null, 2) + '\n') },
    ],
    `Inbox: ${label}`,
  );
  await say(msg, `Сохранил «${label}».\n${describe(q, data.length)}\n\nПапка: ${dir}\nДальше: откройте агента и скажите «добавь песню из inbox».`);
}

async function linkOnly(msg: TgMessage, links: string[], note: string, why: string) {
  const stamp = new Date(msg.date * 1000).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const dir = `content/inbox/${stamp}-link`;
  const info = { received: new Date(msg.date * 1000).toISOString(), via: 'telegram-link', from: msg.from?.username ?? msg.from?.first_name ?? null, note: note || null, links, file: null };
  await commit([{ path: `${dir}/info.json`, data: Buffer.from(JSON.stringify(info, null, 2) + '\n') }], `Inbox: link ${links[0]}`);
  await say(msg, `${why}\n\nСсылку сохранил в очередь (${dir}). Пришлите сам файл — например, перешлите его сюда из бота-загрузчика, — и агент возьмёт запись и ссылку вместе.`);
}

const NO_SERVER = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|music\.apple\.com|music\.yandex\.\w+|soundcloud\.com|deezer\.com|tidal\.com|vk\.com|instagram\.com|tiktok\.com)$/;

function directUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (NO_SERVER.test(u.hostname)) return null;
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (u.hostname === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get('id');
    return id ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` : null;
  }
  return u.toString();
}

async function download(url: string, limit: number) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 living-lyrics-inbox' } });
  if (!r.ok || !r.body) throw new Error(`не скачивается (${r.status})`);
  const type = r.headers.get('content-type') ?? '';
  if (type.startsWith('text/html')) return null;
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > limit) throw new Error(`файл ${(len / 1048576).toFixed(0)} МБ — больше предела ${limit / 1048576} МБ`);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) throw new Error(`файл больше ${limit / 1048576} МБ`);
    chunks.push(Buffer.from(value));
  }
  const disp = r.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disp.match(/filename="?([^";]+)/i)?.[1] ?? new URL(r.url).pathname.split('/').pop() ?? 'recording');
  return { data: Buffer.concat(chunks), name, mime: type };
}

const HELP = `Это приёмная записей для Living Lyrics.

Что можно прислать:
• аудио- или видеофайл — перешлите из бота-загрузчика или из чата (до 20 МБ);
• ссылку на Dropbox, Google Диск или прямую ссылку на файл — бот скачает сам (до 45 МБ);
• ссылку на YouTube — сохраню как заявку, но файл всё равно нужен: YouTube не отдаёт записи облачным серверам.

В подписи можно написать название песни или ссылку на официальное видео — это поможет агенту.`;

async function handle(msg: TgMessage) {
  const token = env('TELEGRAM_BOT_TOKEN');
  const uid = String(msg.from?.id ?? msg.chat.id);
  const text = (msg.text ?? msg.caption ?? '').trim();

  const claim = text.match(/^\/start\s+(\w+)/)?.[1];
  const allowed = [...env('TELEGRAM_ALLOWED_USERS').split(/[\s,]+/).filter(Boolean), ...(await owners())];
  if (claim && claim === ownerCode(token) && !allowed.includes(uid)) {
    await commit([{ path: OWNERS, data: Buffer.from(JSON.stringify({ ids: [...(await owners()), uid] }, null, 2) + '\n') }], 'Inbox: add bot owner');
    ownersCache = null;
    await say(msg, `Готово, вы владелец бота.\n\n${HELP}`);
    return;
  }
  if (!allowed.includes(uid)) {
    await say(msg, `Это закрытый бот. Чтобы им пользоваться, откройте на сайте страницу /api/telegram?setup=1 и нажмите ссылку «Стать владельцем». Ваш Telegram id: ${uid}.`);
    return;
  }
  if (/^\/(start|help)\b/.test(text)) {
    await say(msg, HELP);
    return;
  }

  const links = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
  const note = text;
  const f = msg.audio ?? msg.document ?? msg.video ?? msg.voice;
  if (f) {
    if ((f.file_size ?? 0) > TG_FILE_LIMIT) {
      await say(msg, `Файл ${((f.file_size ?? 0) / 1048576).toFixed(0)} МБ — Telegram не отдаёт ботам файлы больше 20 МБ. Положите его в Dropbox или на Google Диск (доступ по ссылке) и пришлите ссылку — до 45 МБ бот скачает сам.`);
      return;
    }
    await say(msg, 'Принял, проверяю и сохраняю…');
    const info = await tg<{ file_path: string }>('getFile', { file_id: f.file_id });
    const got = await download(`https://api.telegram.org/file/bot${token}/${info.file_path}`, TG_FILE_LIMIT);
    if (!got) throw new Error('Telegram не отдал файл');
    await file(msg, got.data, { name: f.file_name ?? info.file_path.split('/').pop() ?? 'recording', mime: f.mime_type ?? '', seconds: f.duration, title: f.title, performer: f.performer, source: 'telegram' }, links, note);
    return;
  }
  if (links.length) {
    const direct = directUrl(links[0]);
    if (!direct) {
      await linkOnly(msg, links, note, 'С этого сервиса сервер скачать не может: YouTube и стриминги не отдают записи облачным серверам.');
      return;
    }
    await say(msg, 'Скачиваю по ссылке…');
    const got = await download(direct, LINK_LIMIT);
    if (!got) {
      await linkOnly(msg, links, note, 'По ссылке открылась страница, а не файл. Для Google Диска и Dropbox включите доступ «всем, у кого есть ссылка».');
      return;
    }
    await file(msg, got.data, { name: got.name, mime: got.mime, source: 'link' }, links, note);
    return;
  }
  await say(msg, HELP);
}

// ---------------------------------------------------------------- HTTP

export async function POST(request: Request) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) return new Response('bot is not configured', { status: 503 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secretFor(token)) return new Response('forbidden', { status: 403 });
  const update = (await request.json()) as { message?: TgMessage };
  const msg = update.message;
  if (msg) waitUntil(handle(msg).catch((e: unknown) => say(msg, `Не получилось: ${e instanceof Error ? e.message : String(e)}`).catch(() => {})));
  return new Response('ok');
}

/** Setup page. The site's password gate covers GET requests to this path. */
export async function GET(request: Request) {
  const token = env('TELEGRAM_BOT_TOKEN');
  const page = (body: string) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Telegram-бот</title><body style="font:17px/1.45 -apple-system,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px">${body}</body>`,
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  const missing = ['TELEGRAM_BOT_TOKEN', 'GITHUB_TOKEN', 'AUDIO_KEY'].filter((k) => !env(k));
  if (missing.length) return page(`<h1>Бот не настроен</h1><p>В Vercel → Settings → Environment Variables не хватает: ${missing.join(', ')}. После добавления сделайте Redeploy и откройте эту страницу снова.</p>`);
  if (new URL(request.url).searchParams.get('setup') !== '1') return page('<p>Откройте <a href="?setup=1">/api/telegram?setup=1</a>, чтобы подключить бота.</p>');

  const host = env('VERCEL_PROJECT_PRODUCTION_URL') || new URL(request.url).host;
  await tg('setWebhook', { url: `https://${host}/api/telegram`, secret_token: secretFor(token), allowed_updates: ['message'], drop_pending_updates: true });
  await tg('setMyCommands', { commands: [{ command: 'help', description: 'Что можно прислать' }] });
  const me = await tg<{ username: string }>('getMe', {});
  await gh(`/git/ref/heads/${branch()}`); // fails loudly if GITHUB_TOKEN cannot see the repository
  const link = `https://t.me/${me.username}?start=${ownerCode(token)}`;
  return page(`<h1>Бот @${me.username} подключён</h1><p>Запись в репозиторий ${repo()} работает.</p><p><a href="${link}">Стать владельцем</a> — откроется Telegram, нажмите «Start». Ссылка личная: не пересылайте её.</p>`);
}
