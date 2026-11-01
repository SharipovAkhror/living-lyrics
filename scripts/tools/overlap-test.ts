/**
 * Phone playback must not paint a line over another line, or an engraving over a line.
 *
 * WebKit, 390×844, silence in place of the recording, real play() (not a seek sweep:
 * a seek left this bug green). Commentary on, collapsed, and off. Alive and For True
 * Lovers, the whole song. Alive from 7:00 to 7:30 stays at ×1. The rest may run at ×4
 * only when a short ×1 and ×4 pass through the same passage report the same overlap.
 * A painted intersection deeper than 1 px fails. A box the reader cannot see (opacity
 * under 0.12, visibility hidden, display none) does not count. An engraving is clipped
 * to overflow:hidden ancestors, because getBoundingClientRect ignores that clip.
 * A visibility:visible plate inside a visibility:hidden host does count: that is the
 * parked engraving that used to paint through.
 *
 *   npm run test:overlap
 *
 * OVERLAP_ROOT  directory vite serves (default: this repo)
 * OVERLAP_PORT  default 5211
 * OVERLAP_SONGS comma list, default alive,for-true-lovers
 * OVERLAP_MODES comma list of on,collapsed,off
 * OVERLAP_FROM  seconds to start at (default 0)
 * OVERLAP_TO    seconds to stop at (default: the end of the song)
 * OVERLAP_SHOTS file prefix under work/phone/frames (empty: no frames)
 * OVERLAP_FAIL_FAST  1 exits after the first hit once required frames are saved
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { webkit, devices, type Browser, type Page } from 'playwright';

const PORT = Number(process.env.OVERLAP_PORT || 5211);
if (process.env.OVERLAP_LOG) {
  const file = process.env.OVERLAP_LOG;
  const orig = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    orig(...args);
    appendFileSync(file, `${args.map((a) => String(a)).join(' ')}\n`);
  };
}
const ROOT = process.env.OVERLAP_ROOT || process.cwd();
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.OVERLAP_SHOTS || '';
const FAIL_FAST = process.env.OVERLAP_FAIL_FAST === '1';
const FROM = Number(process.env.OVERLAP_FROM || 0);
const TO_ENV = process.env.OVERLAP_TO ? Number(process.env.OVERLAP_TO) : null;
const SONGS = (process.env.OVERLAP_SONGS || 'alive,for-true-lovers').split(',').map((s) => s.trim()).filter(Boolean);
const MODE_NAMES = (process.env.OVERLAP_MODES || 'on,collapsed,off').split(',').map((s) => s.trim());

const ALL_MODES = [
  { name: 'on', showComment: true, commentOpen: true },
  { name: 'collapsed', showComment: true, commentOpen: false },
  { name: 'off', showComment: false, commentOpen: false },
] as const;

const MODES = ALL_MODES.filter((m) => MODE_NAMES.includes(m.name));
const IPHONE = devices['iPhone 13'];
const PEN_LIMIT = 1;

interface Hit {
  kind: string;
  pen: number;
  area: number;
  a: string;
  b: string;
}

interface Sample {
  t: number;
  phone: string;
  stage: string;
  hits: Hit[];
  worst: number;
}

const measureInPage = eval(`(function measureInPage() {
  const OP = 0.12;
  const PLAYER_OP = 0.5;
  const track = document.querySelector('.scrub-track[aria-valuemax]');
  const fill = document.querySelector('.scrub-fill');
  const dur = track ? Number(track.getAttribute('aria-valuemax')) : 0;
  let t = track ? Number(track.getAttribute('aria-valuenow')) : 0;
  if (fill instanceof HTMLElement && dur > 0) {
    const m = /scaleX\\(([\\d.]+)\\)/.exec(fill.style.transform || '');
    if (m) t = Number(m[1]) * dur;
  }
  const parentOf = (n) => {
    if (!n) return null;
    if (n.parentElement) return n.parentElement;
    const root = n.getRootNode && n.getRootNode();
    if (root && root.host) return root.host;
    return null;
  };
  const painted = (el) => {
    let o = 1;
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') return 0;
      const op = parseFloat(cs.opacity);
      if (Number.isFinite(op)) o *= op;
      if (o < OP) return o;
      n = parentOf(n);
    }
    return o;
  };
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    let n = parentOf(el);
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const a = n.getBoundingClientRect();
      if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
        box.l = Math.max(box.l, a.left);
        box.r = Math.min(box.r, a.right);
      }
      if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
        box.t = Math.max(box.t, a.top);
        box.b = Math.min(box.b, a.bottom);
      }
      n = parentOf(n);
    }
    return box;
  };
  const usable = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return painted(el) >= OP;
  };
  const penOf = (a, b) => {
    const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (!(x > 1 && y > 1)) return 0;
    return Math.min(x, y);
  };
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18);
  const pieces = [];
  for (const line of document.querySelectorAll('.fb--line')) {
    if (getComputedStyle(line).visibility === 'hidden') continue;
    for (const sel of ['.fb-orig', '.fb-tr']) {
      const el = line.querySelector(sel);
      if (!usable(el)) continue;
      const box = boxOf(el);
      if (box.r - box.l < 2 || box.b - box.t < 2) continue;
      pieces.push({ line, el, box, op: painted(el), text: label(el) });
    }
  }
  const arts = [];
  for (const mount of document.querySelectorAll('.ist-art-mount')) {
    const root = mount.shadowRoot;
    const nodes = root ? root.querySelectorAll('.ist-art') : mount.querySelectorAll('.ist-art');
    nodes.forEach((el) => {
      if (!usable(el)) return;
      const box = boxOf(el);
      if (box.r - box.l < 2 || box.b - box.t < 2) return;
      arts.push({ el, box, key: el.dataset.instrument || 'art' });
    });
  }
  const hits = [];
  const push = (kind, pen, a, b, boxA, boxB) => {
    if (pen <= 1 || hits.length >= 6) return;
    const x = Math.min(boxA.r, boxB.r) - Math.max(boxA.l, boxB.l);
    const y = Math.min(boxA.b, boxB.b) - Math.max(boxA.t, boxB.t);
    hits.push({ kind, pen: Math.round(pen * 10) / 10, area: Math.round(x * y), a, b });
  };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (pieces[i].line === pieces[j].line) continue;
      push('line', penOf(pieces[i].box, pieces[j].box), pieces[i].text, pieces[j].text, pieces[i].box, pieces[j].box);
    }
  }
  for (const art of arts) {
    for (const piece of pieces) {
      push('art', penOf(art.box, piece.box), art.key, piece.text, art.box, piece.box);
    }
  }
  const player = document.querySelector('.player');
  if (player instanceof HTMLElement) {
    const pb = player.getBoundingClientRect();
    const pbox = { l: pb.left, t: pb.top, r: pb.right, b: pb.bottom };
    for (const piece of pieces) {
      if (piece.op < PLAYER_OP) continue;
      push('player', penOf(piece.box, pbox), 'player', piece.text, pbox, piece.box);
    }
    for (const art of arts) {
      push('player', penOf(art.box, pbox), 'player', art.key, pbox, art.box);
    }
  }
  let worst = 0;
  for (const h of hits) if (h.pen > worst) worst = h.pen;
  const stage = document.querySelector('.scene-stage');
  const sr = stage ? stage.getBoundingClientRect() : null;
  return {
    t,
    phone: document.documentElement.dataset.phone || '',
    stage: sr ? Math.round(sr.width) + 'x' + Math.round(sr.height) : '',
    hits,
    worst,
  };
})`) as () => Sample;

const engineInPage = eval(`(function engineInPage(req) {
  const action = req.action;
  const arg = req.arg;
  const looks = (s) => s && typeof s === 'object' && typeof s.setRate === 'function' && typeof s.seek === 'function' && typeof s.play === 'function';
  const find = () => {
    if (window.__llEngine && looks(window.__llEngine)) return window.__llEngine;
    const root = document.querySelector('#root');
    if (!root) return null;
    const fk = Object.keys(root).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
    let start = fk ? root[fk] : null;
    if (start && start.current) start = start.current;
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      for (let i = 0; hook && i < 80; i++, hook = hook.next) {
        const s = hook.memoizedState;
        if (looks(s)) {
          window.__llEngine = s;
          return s;
        }
        if (Array.isArray(s) && looks(s[0])) {
          window.__llEngine = s[0];
          return s[0];
        }
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  };
  const engine = find();
  if (!engine) return { ok: false, error: 'engine missing' };
  if (action === 'seek') engine.seek(arg);
  if (action === 'rate') engine.setRate(arg);
  if (action === 'play') engine.play();
  if (action === 'pause') engine.pause();
  const audio = document.querySelector('audio');
  return {
    ok: true,
    source: engine.state && engine.state.source,
    playing: !!engine.playing,
    error: (engine.state && engine.state.error) || '',
    duration: engine.state && engine.state.duration,
    playbackRate: audio ? audio.playbackRate : null,
    media: audio ? audio.currentTime : null,
  };
})`) as (req: { action: string; arg?: number }) => {
  ok: boolean;
  source?: string;
  playing?: boolean;
  error?: string;
  duration?: number;
  playbackRate?: number | null;
  media?: number | null;
};

function clockScript(seconds: number): string {
  return `(() => {
    const dur = ${seconds};
    let base = 0;
    let t0 = 0;
    let playing = false;
    let rate = 1;
    let ended = false;
    const advance = () => {
      if (!playing) return base;
      let t = base + ((performance.now() - t0) / 1000) * (rate || 1);
      if (t >= dur) {
        base = dur;
        playing = false;
        t0 = performance.now();
        if (!ended) {
          ended = true;
          const el = document.querySelector('audio');
          if (el) queueMicrotask(() => el.dispatchEvent(new Event('ended')));
        }
        return dur;
      }
      return t;
    };
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (this instanceof HTMLMediaElement && type === 'error') return;
      return origAdd.call(this, type, fn, opts);
    };
    const def = (name, desc) => {
      try { Object.defineProperty(HTMLMediaElement.prototype, name, desc); }
      catch (err) { window.__llClockError = String(err); }
    };
    def('error', { configurable: true, get() { return null; } });
    def('readyState', { configurable: true, get() { return 4; } });
    def('paused', { configurable: true, get() { return !playing; } });
    def('playbackRate', {
      configurable: true,
      get() { return rate; },
      set(v) {
        const next = Number(v) > 0 ? Number(v) : 1;
        if (next === rate) return;
        base = advance();
        t0 = performance.now();
        rate = next;
        try { this.dispatchEvent(new Event('ratechange')); } catch (e) { /* already torn down */ }
      },
    });
    def('currentTime', {
      configurable: true,
      get() { return advance(); },
      set(v) {
        base = Math.max(0, Math.min(dur, Number(v) || 0));
        t0 = performance.now();
        ended = base < dur - 0.05 ? false : ended;
      },
    });
    def('play', {
      configurable: true,
      value() {
        if (!playing) { t0 = performance.now(); playing = true; }
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      },
    });
    def('pause', {
      configurable: true,
      value() {
        if (playing) { base = advance(); playing = false; t0 = performance.now(); }
        this.dispatchEvent(new Event('pause'));
      },
    });
    window.__llClock = 'stand-in';
  })();`;
}

function songDuration(slug: string): number {
  const file = join(ROOT, 'content', 'songs', slug, 'song.json');
  const song = JSON.parse(readFileSync(file, 'utf8')) as { duration?: number };
  if (!song.duration || song.duration < 1) throw new Error(`no duration in ${file}`);
  return song.duration;
}

function silence(seconds: number): Buffer {
  const dir = join(process.cwd(), 'work', 'phone', 'audio');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `silence-${Math.round(seconds)}s.m4a`);
  const made = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(Math.ceil(seconds)), '-c:a', 'aac', '-b:a', '24k', '-movflags', '+faststart', file],
    { encoding: 'utf8' },
  );
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${(made.stderr || '').slice(-200)}`);
  return readFileSync(file);
}

function startVite(): ChildProcess {
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(child: ChildProcess) {
  const started = Date.now();
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  while (Date.now() - started < 30_000) {
    if (child.exitCode != null) throw new Error(`vite exited ${child.exitCode}\n${log}`);
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite did not start\n${log}`);
}

function stopVite(child: ChildProcess) {
  if (child.exitCode != null) return;
  child.kill();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callEngine(page: Page, action: string, arg?: number) {
  const res = await page.evaluate(engineInPage, { action, arg });
  if (!res.ok) throw new Error(res.error || 'engine call failed');
  return res;
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(measureInPage);
}

/** Play from `from` to `to` at `rate`. Returns the worst painted penetration. */
async function playSpan(page: Page, from: number, to: number, rate: number, shots: (t: number, hits: Hit[]) => Promise<void>): Promise<{ worst: number; hits: Hit[]; samples: number; achieved: number }> {
  await callEngine(page, 'pause');
  const sought = await callEngine(page, 'seek', from);
  await callEngine(page, 'rate', rate);
  await callEngine(page, 'play');
  if ((sought.duration || 0) < from) throw new Error(`duration ${sought.duration} is shorter than seek ${from}`);
  let tStart = 0;
  let landed = false;
  for (let i = 0; i < 50; i++) {
    tStart = (await sample(page)).t;
    if (Math.abs(tStart - from) < 1.5) {
      landed = true;
      break;
    }
    await sleep(60);
  }
  if (!landed) {
    throw new Error(`seek to ${from} showed t=${tStart.toFixed(2)} source=${sought.source} dur=${sought.duration} media=${sought.media}`);
  }
  const wallStart = Date.now();
  let worst = 0;
  const hits: Hit[] = [];
  let samples = 0;
  let lastT = tStart;
  let stillSince = Date.now();
  const wallCap = ((to - from) / Math.max(rate, 0.25)) * 1000 + 45_000;
  while (Date.now() - wallStart < wallCap) {
    const s = await sample(page);
    samples += 1;
    if (s.t >= to - 0.15) {
      worst = Math.max(worst, s.worst);
      if (s.hits.length && hits.length < 8) hits.push(...s.hits.slice(0, 2));
      break;
    }
    if (s.t > lastT + 0.05) {
      lastT = s.t;
      stillSince = Date.now();
    } else if (Date.now() - stillSince > 8_000) {
      throw new Error(`clock stalled at t=${s.t.toFixed(2)} (asked ×${rate})`);
    }
    if (s.worst > worst) {
      worst = s.worst;
      for (const h of s.hits) {
        if (hits.length < 8) hits.push({ ...h, a: `${h.a} @${s.t.toFixed(1)}` });
      }
    }
    if (rate >= 3 && samples === 12) {
      const ach = (lastT - tStart) / Math.max(0.3, (Date.now() - wallStart) / 1000);
      if (ach < 2) throw new Error(`asked ×${rate} but the clock moved ×${ach.toFixed(2)} (t=${lastT.toFixed(2)})`);
    }
    await shots(s.t, s.hits);
    await sleep(80);
  }
  const elapsed = (Date.now() - wallStart) / 1000;
  const achieved = elapsed > 0.4 ? (lastT - tStart) / elapsed : 0;
  if (lastT < to - 1.5) throw new Error(`stopped at t=${lastT.toFixed(2)} before ${to} (×${achieved.toFixed(2)})`);
  return { worst, hits, samples, achieved };
}

async function main() {
  if (!MODES.length) throw new Error('no modes');
  const head = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  console.log(`root ${ROOT}`);
  console.log(`commit ${head.stdout.trim()} port ${PORT}`);
  console.log(`songs ${SONGS.join(',')} modes ${MODES.map((m) => m.name).join(',')} from ${FROM} to ${TO_ENV ?? 'end'}`);
  const vite = startVite();
  let browser: Browser | null = null;
  let failed = 0;
  let fast = true;
  try {
    await waitForServer(vite);
    browser = await webkit.launch();
    let spotted = false;
    for (const slug of SONGS) {
      const duration = songDuration(slug);
      const body = silence(duration + 2);
      const end = TO_ENV == null ? duration - 0.3 : Math.min(TO_ENV, duration - 0.05);
      for (const mode of MODES) {
        const title = `${slug} ${mode.name}`;
        console.log(`\n${title}`);
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 1,
          isMobile: true,
          hasTouch: true,
          userAgent: IPHONE.userAgent,
          locale: 'ru-RU',
          colorScheme: 'dark',
        });
        await context.addInitScript(clockScript(duration + 5));
        await context.addInitScript((settings: { showComment: boolean; commentOpen: boolean }) => {
          localStorage.setItem('living-lyrics.settings.v2', JSON.stringify({
            showComment: settings.showComment,
            commentOpen: settings.commentOpen,
            textAlign: 'center',
            lineEntrance: 'settle',
            showTranslation: true,
            rate: 1,
          }));
          localStorage.removeItem('living-lyrics.resume.v1');
        }, { showComment: mode.showComment, commentOpen: mode.commentOpen });
        await context.route('**/*.{m4a,mp3,aac,wav,flac}', async (route) => {
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Type': 'audio/mp4',
              'Accept-Ranges': 'bytes',
              'Content-Length': String(body.length),
            },
            body,
          });
        });
        const page = await context.newPage();
        page.on('pageerror', (err) => console.log(`  pageerror ${err.message}`));
        await page.goto(`${BASE}/song/${slug}?t=0`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.scrub-track[aria-valuemax]', { timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector('.scene-stage', { timeout: 20_000 });
        const clockNote = await page.evaluate(() => {
          const w = window as unknown as { __llClock?: string; __llClockError?: string };
          return `${w.__llClock || 'native'}${w.__llClockError ? ' ' + w.__llClockError : ''}`;
        });
        console.log(`  clock ${clockNote}`);
        let ready = await callEngine(page, 'state');
        for (let i = 0; i < 40 && (ready.source !== 'library' || (ready.duration || 0) < 30); i++) {
          await sleep(100);
          ready = await callEngine(page, 'state');
        }
        console.log(`  engine source=${ready.source} dur=${ready.duration} err=${ready.error || '—'}`);
        const shotDir = join(process.cwd(), 'work', 'phone', 'frames');
        if (SHOTS) mkdirSync(shotDir, { recursive: true });
        const taken = new Set<string>();
        const shoot = async (t: number, hits: Hit[] = []) => {
          if (!SHOTS || slug !== 'alive') return;
          const want: { name: string; at: number }[] = [];
          if (mode.name === 'collapsed') {
            want.push({ name: `${SHOTS}-709.png`, at: 429 }, { name: `${SHOTS}-723.png`, at: 443 });
          }
          if (mode.name === 'on') want.push({ name: `${SHOTS}-709-open.png`, at: 429 });
          for (const shot of want) {
            if (taken.has(shot.name) || t < shot.at || t > shot.at + 1.4) continue;
            taken.add(shot.name);
            const file = join(shotDir, shot.name);
            await page.screenshot({ path: file });
            console.log(`  shot ${file} t=${t.toFixed(2)}`);
          }
          const big = hits.find((h) => h.pen > 20);
          const name = big ? `${SHOTS}-${mode.name}-hit.png` : '';
          if (name && !taken.has(name)) {
            taken.add(name);
            const file = join(shotDir, name);
            await page.screenshot({ path: file });
            console.log(`  shot ${file} t=${t.toFixed(2)} ${big?.kind} ${big?.pen}px`);
          }
        };
        if (!spotted && slug === 'alive' && FROM <= 300 && end >= 318) {
          spotted = true;
          const slow = await playSpan(page, 300, 318, 1, async () => {});
          const quick = await playSpan(page, 300, 318, 4, async () => {});
          console.log(`  spot 300–318 ×1 worst=${slow.worst.toFixed(1)}px achieved=${slow.achieved.toFixed(2)} samples=${slow.samples}`);
          console.log(`  spot 300–318 ×4 worst=${quick.worst.toFixed(1)}px achieved=${quick.achieved.toFixed(2)} samples=${quick.samples}`);
          for (const h of [...slow.hits, ...quick.hits].slice(0, 4)) console.log(`  spot hit ${h.kind} ${h.pen}px ${h.a} | ${h.b}`);
          if (Math.abs(slow.worst - quick.worst) > PEN_LIMIT || quick.achieved < 2.5) {
            fast = false;
            console.log('  ×4 does not match ×1; the rest of the song stays at ×1');
          } else {
            console.log('  ×4 matches ×1 on this passage');
          }
          if (slow.worst > PEN_LIMIT || quick.worst > PEN_LIMIT) failed += 1;
        }
        const start = Math.max(0, FROM);
        let cursor = start;
        let worst = 0;
        let samples = 0;
        const hits: Hit[] = [];
        const run = async (a: number, b: number, rate: number) => {
          if (b - a < 0.4) return;
          const span = await playSpan(page, a, b, rate, shoot);
          samples += span.samples;
          if (span.worst > worst) worst = span.worst;
          if (hits.length < 8) hits.push(...span.hits.slice(0, 8 - hits.length));
          console.log(`  ${a.toFixed(0)}–${b.toFixed(0)}s ×${rate} worst=${span.worst.toFixed(1)}px achieved=${span.achieved.toFixed(2)} samples=${span.samples}`);
          if (span.worst > PEN_LIMIT) failed += 1;
        };
        // Alive 7:00–7:30 is always ×1. Outside it, ×4 only after the spot check agreed.
        if (slug === 'alive' && end > 418 && cursor < 452) {
          if (cursor < 418) {
            await run(cursor, Math.min(418, end), fast ? 4 : 1);
            cursor = Math.min(418, end);
          }
          const zoneEnd = Math.min(452, end);
          if (zoneEnd - cursor > 0.4) {
            await run(Math.max(cursor, 418), zoneEnd, 1);
            cursor = zoneEnd;
          }
        }
        if (cursor < end - 0.3) await run(cursor, end, fast ? 4 : 1);
        const first = await sample(page);
        console.log(`  phone=${first.phone || '—'} stage=${first.stage} samples=${samples} worst=${worst.toFixed(1)}px`);
        for (const h of hits) console.log(`  hit ${h.kind} ${h.pen}px area=${h.area} ${h.a} | ${h.b}`);
        if (SHOTS && slug === 'alive' && (mode.name === 'collapsed' || mode.name === 'on')) {
          const need = mode.name === 'collapsed' ? [`${SHOTS}-709.png`, `${SHOTS}-723.png`] : [`${SHOTS}-709-open.png`];
          for (const name of need) if (!taken.has(name) && end > 446) console.log(`  MISSING shot ${name}`);
        }
        if (worst > PEN_LIMIT) console.log('  FAIL');
        else console.log('  PASS');
        await context.close();
        if (FAIL_FAST && failed > 0 && (!SHOTS || taken.size >= (mode.name === 'on' ? 1 : 2))) {
          console.log('  fail-fast stop');
          console.error(`\n${failed} overlap(s) over 1px`);
          process.exitCode = 1;
          return;
        }
      }
    }
  } finally {
    await browser?.close();
    stopVite(vite);
  }
  if (failed) {
    console.error(`\n${failed} overlap(s) over 1px`);
    process.exit(1);
  }
  console.log('\nno painted overlap over 1px');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
