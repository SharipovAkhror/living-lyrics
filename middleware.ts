/**
 * Password gate (Vercel Routing Middleware). Set SITE_PASSWORD (and ideally AUTH_SECRET) in the
 * project's environment variables. Without SITE_PASSWORD the site is open — handy for local dev.
 * A signed, HttpOnly cookie keeps the reader signed in for 180 days; it works in the
 * home-screen web app on iPhone, unlike HTTP Basic auth.
 */
import { next } from '@vercel/functions/middleware';

export const config = {
  matcher: ['/((?!icons/|manifest.webmanifest|favicon.ico).*)'],
};

const COOKIE = 'll_session';
const MAX_AGE = 60 * 60 * 24 * 180;

const enc = new TextEncoder();

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function secretOf(password: string) {
  return process.env.AUTH_SECRET || (await hmac('living-lyrics', password));
}

function loginPage(nextPath: string, error = false) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Living Lyrics</title>
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<style>
:root{--bg:#f2f2f7;--card:#fff;--label:#000;--label2:rgba(60,60,67,.6);--fill:rgba(118,118,128,.12);--accent:#9a6a12;--red:#ff3b30}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--label:#fff;--label2:rgba(235,235,245,.6);--fill:rgba(118,118,128,.24);--accent:#e7b654;--red:#ff453a}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--label);
font:17px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;letter-spacing:-.41px;-webkit-font-smoothing:antialiased;padding:24px}
form{width:min(100%,360px);display:flex;flex-direction:column;gap:14px;text-align:center}
img{width:76px;height:76px;border-radius:18px;margin:0 auto 6px;box-shadow:0 10px 30px -12px rgba(0,0,0,.45)}
h1{font:700 28px/1.2 -apple-system,"SF Pro Display",Inter,system-ui,sans-serif;margin:0;letter-spacing:.3px}
p{margin:0;color:var(--label2);font-size:15px}
input{height:50px;border-radius:14px;border:0;background:var(--fill);color:var(--label);font:inherit;padding:0 16px;outline:none}
input:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 40%,transparent)}
button{height:50px;border-radius:999px;border:0;background:var(--accent);color:#fff;font:600 17px/1 inherit;cursor:pointer}
@media (prefers-color-scheme:dark){button{color:#000}}
.err{color:var(--red);font-size:15px}
</style></head><body><form method="post" action="/__auth">
<img src="/icons/icon-192.png" alt=""><h1>Living Lyrics</h1><p>Введите пароль, чтобы открыть библиотеку.</p>
<input type="password" name="password" autocomplete="current-password" placeholder="Пароль" required autofocus>
<input type="hidden" name="next" value="${esc(nextPath)}">
${error ? '<div class="err">Неверный пароль</div>' : ''}
<button type="submit">Войти</button></form></body></html>`;
}

export default async function middleware(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return next();
  const url = new URL(request.url);
  // Telegram's webhook cannot sign in; the function checks Telegram's own secret header instead.
  if (url.pathname === '/api/telegram' && request.method === 'POST') return next();
  const secret = await secretOf(password);

  if (url.pathname === '/__auth' && request.method === 'POST') {
    const form = await request.formData();
    const given = String(form.get('password') ?? '');
    const rawNext = String(form.get('next') ?? '/');
    const nextPath = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
    if (!safeEqual(await hmac(secret, given), await hmac(secret, password))) {
      return new Response(loginPage(nextPath, true), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    const value = `${exp}.${await hmac(secret, String(exp))}`;
    return new Response(null, {
      status: 303,
      headers: {
        location: nextPath,
        'set-cookie': `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        'cache-control': 'no-store',
      },
    });
  }

  const cookie = readCookie(request, COOKIE);
  if (cookie) {
    const [exp, sig] = cookie.split('.');
    if (Number(exp) > Date.now() / 1000 && sig && safeEqual(sig, await hmac(secret, exp))) return next();
  }

  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  if (wantsHtml) {
    return new Response(loginPage(url.pathname + url.search), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } });
}
