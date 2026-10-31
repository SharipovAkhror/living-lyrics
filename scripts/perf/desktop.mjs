// Desktop rows for round 22. Drawn keys, hover, focus, scrub preview, wheel, column.
// node scripts/perf/desktop.mjs --base http://127.0.0.1:4176 [--only D34] [--engine chromium]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { installResolvedAudio, installWebKitClock, prepareAudio } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const only = args.only && args.only !== 'true' ? args.only : '';
const engineOnly = args.engine && args.engine !== 'true' ? args.engine : '';

const results = [];
function note(name, ok, detail = '') {
  if (only && !name.includes(only)) return;
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

function songDurations() {
  const map = {};
  for (const slug of readdirSync('content/songs')) {
    const file = `content/songs/${slug}/song.json`;
    if (!existsSync(file)) continue;
    const song = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof song.duration === 'number' && song.duration > 1) map[slug] = song.duration;
  }
  return map;
}

async function installSilence(context, browserName) {
  const map = songDurations();
  const cache = new Map();
  await installResolvedAudio(context, (url) => {
    const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
    const seconds = map[slug];
    if (!seconds) return null;
    const key = String(seconds);
    if (!cache.has(key)) cache.set(key, prepareAudio(seconds, 'work/studio/silence'));
    return cache.get(key);
  });
  if (browserName === 'webkit') await installWebKitClock(context, map);
}

const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const phoneTouch = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

function clockSeconds(text) {
  const m = /(\d+):(\d{2})/.exec(text || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function openSong(page) {
  await page.goto(`${base}/song/karitas?t=42`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.scrub-now').waitFor({ timeout: 8000 });
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.scrub-now')?.textContent || '';
      const m = /(\d+):(\d{2})/.exec(text);
      const line = (document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '').replace(/\s+/g, '').trim();
      return m && Number(m[1]) * 60 + Number(m[2]) >= 40 && line.length > 0;
    },
    { timeout: 8000 },
  );
}

/** Let the previous seek finish painting. The 100 ms budget is the key's own, from a quiet frame. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const line = () => document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '';
        const t0 = performance.now();
        let last = line();
        let stable = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          const now = line();
          if (now && now === last) stable += 1;
          else {
            last = now;
            stable = 0;
          }
          // A seek paints the new line within a few frames. Waiting out that
          // paint keeps the next key off the previous frame's layout.
          const quiet = stable >= 3 && performance.now() - t0 >= 120;
          if (quiet || frames >= 24) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Dispatch one key and read the drawn clock, line, and controls until they change or 100 ms pass. */
async function keyWithin(page, spec) {
  await settle(page);
  return page.evaluate(async (key) => {
    const read = () => ({
      clock: document.querySelector('.scrub-now')?.textContent || '',
      line: (document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '').replace(/\s+/g, ' ').trim(),
      play: document.querySelector('button.btn-xl')?.getAttribute('aria-label') || '',
      tr: getComputedStyle(document.querySelector('.fb--line.is-current .fb-tr') || document.body).display !== 'none'
        && !!document.querySelector('.fb--line.is-current .fb-tr')
        && (document.querySelector('.fb--line.is-current .fb-tr')?.getClientRects().length || 0) > 0,
      note: !!document.querySelector('.note-card, .comment.is-margin'),
      help: !!document.querySelector('.keys-help'),
      toast: document.querySelector('.mark-toast')?.textContent || '',
      sheet: !!document.querySelector('.sheet'),
      path: location.pathname,
    });
    const before = read();
    const t0 = performance.now();
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: key.code,
        key: key.key,
        shiftKey: !!key.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
    const watch = key.watch || '';
    const field = (row) => (watch ? row[watch] : JSON.stringify(row));
    let after = read();
    let ms = Math.round(performance.now() - t0);
    // The clock is the frame that shows the change. The read itself forces
    // layout, and that probe time is not the key.
    while (field(before) === field(after) && performance.now() - t0 < 100) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const frameAt = performance.now();
      after = read();
      if (field(before) !== field(after)) ms = Math.round(frameAt - t0);
    }
    return { before, after, ms };
  }, spec);
}

function changed(row, pick) {
  return pick(row.before) !== pick(row.after) && row.ms <= 100;
}

async function runKeys(browser, browserName) {
  const context = await browser.newContext({ ...desk, colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  const tag = `${browserName} D34 keys-drawn`;
  try {
    await openSong(page);
    const right = await keyWithin(page, { code: 'ArrowRight', key: 'ArrowRight', watch: 'line' });
    note(tag, changed(right, (s) => s.line) && right.after.path === right.before.path, `right ${right.ms}ms line ${right.before.line.slice(0, 24)} -> ${right.after.line.slice(0, 24)}`);
    const left = await keyWithin(page, { code: 'ArrowLeft', key: 'ArrowLeft', watch: 'line' });
    note(tag, changed(left, (s) => s.line), `left ${left.ms}ms`);
    const back = await keyWithin(page, { code: 'KeyJ', key: 'j', watch: 'clock' });
    const backFrom = clockSeconds(back.before.clock);
    const backTo = clockSeconds(back.after.clock);
    note(tag, back.ms <= 100 && backFrom != null && backTo != null && backFrom - backTo >= 8 && backFrom - backTo <= 12, `J ${back.ms}ms ${back.before.clock}->${back.after.clock}`);
    const fwd = await keyWithin(page, { code: 'KeyL', key: 'l', watch: 'clock' });
    const fwdFrom = clockSeconds(fwd.before.clock);
    const fwdTo = clockSeconds(fwd.after.clock);
    note(tag, fwd.ms <= 100 && fwdFrom != null && fwdTo != null && fwdTo - fwdFrom >= 8 && fwdTo - fwdFrom <= 12, `L ${fwd.ms}ms ${fwd.before.clock}->${fwd.after.clock}`);
    const shift = await keyWithin(page, { code: 'ArrowRight', key: 'ArrowRight', shift: true, watch: 'clock' });
    const shiftFrom = clockSeconds(shift.before.clock);
    const shiftTo = clockSeconds(shift.after.clock);
    note(tag, shift.ms <= 100 && shiftFrom != null && shiftTo != null && shiftTo - shiftFrom >= 8 && shiftTo - shiftFrom <= 12, `shift+right ${shift.ms}ms ${shift.before.clock}->${shift.after.clock}`);
    const home = await keyWithin(page, { code: 'Home', key: 'Home', watch: 'clock' });
    const homeAt = clockSeconds(home.after.clock) === 0;
    note(tag, homeAt && (clockSeconds(home.before.clock) === 0 || home.ms <= 100), `home ${home.ms}ms ${home.after.clock}`);
    const zero = await keyWithin(page, { code: 'Digit0', key: '0', watch: 'clock' });
    const zeroAt = clockSeconds(zero.after.clock) === 0;
    note(tag, zeroAt && (clockSeconds(zero.before.clock) === 0 || zero.ms <= 100), `0 ${zero.ms}ms ${zero.after.clock}`);
    const mid = await keyWithin(page, { code: 'Digit5', key: '5', watch: 'clock' });
    const midSec = clockSeconds(mid.after.clock);
    note(tag, mid.ms <= 100 && midSec != null && Math.abs(midSec - 488) <= 2, `5 ${mid.ms}ms ${mid.after.clock}`);
    const space = await keyWithin(page, { code: 'Space', key: ' ', watch: 'play' });
    note(tag, changed(space, (s) => s.play), `space ${space.ms}ms ${space.before.play}->${space.after.play}`);
    const kay = await keyWithin(page, { code: 'KeyK', key: 'л', watch: 'play' });
    note(
      tag,
      changed(kay, (s) => s.play) && kay.before.note === kay.after.note,
      `K ${kay.ms}ms play ${kay.before.play}->${kay.after.play} note stayed ${kay.before.note === kay.after.note}`,
    );
    const tee = await keyWithin(page, { code: 'KeyT', key: 'е', watch: 'tr' });
    note(tag, changed(tee, (s) => s.tr), `T ${tee.ms}ms tr ${tee.before.tr}->${tee.after.tr}`);
    const cee = await keyWithin(page, { code: 'KeyC', key: 'с', watch: 'note' });
    note(tag, changed(cee, (s) => s.note), `C ${cee.ms}ms note ${cee.before.note}->${cee.after.note}`);
    const em = await keyWithin(page, { code: 'KeyM', key: 'ь', watch: 'toast' });
    note(tag, em.ms <= 100 && /Отмечено/.test(em.after.toast), `M ${em.ms}ms ${em.after.toast}`);
    const help = await keyWithin(page, { code: 'Slash', key: '?', shift: true, watch: 'help' });
    note(tag, help.ms <= 100 && help.after.help && help.after.path === '/song/karitas', `help ${help.ms}ms`);
    const esc = await keyWithin(page, { code: 'Escape', key: 'Escape', watch: 'help' });
    note(tag, esc.ms <= 100 && !esc.after.help && esc.after.path === '/song/karitas', `esc ${esc.ms}ms path ${esc.after.path}`);

    await page.locator('button[aria-label="О песне"]').focus();
    const playBefore = await page.locator('button.btn-xl').getAttribute('aria-label');
    await page.evaluate(() => {
      window.__llKey = 0;
      document.querySelector('button[aria-label="О песне"]')?.addEventListener(
        'keydown',
        () => {
          window.__llKey = performance.now();
        },
        { once: true },
      );
    });
    await page.keyboard.press('Space');
    const onButton = await page.evaluate(async (before) => {
      const t0 = window.__llKey || performance.now();
      let play = before;
      let sheet = false;
      while (performance.now() - t0 < 100) {
        play = document.querySelector('button.btn-xl')?.getAttribute('aria-label') || '';
        sheet = !!document.querySelector('.sheet');
        if (sheet) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { play, sheet, ms: Math.round(performance.now() - t0), path: location.pathname };
    }, playBefore);
    note(tag, onButton.play === playBefore && onButton.sheet, `space on button ${onButton.ms}ms play ${playBefore}->${onButton.play} sheet ${onButton.sheet}`);
    await page.evaluate(() => {
      window.__llKey = 0;
      window.addEventListener(
        'keydown',
        () => {
          window.__llKey = performance.now();
        },
        { once: true },
      );
    });
    await page.keyboard.press('Escape');
    const close = await page.evaluate(async () => {
      const t0 = window.__llKey || performance.now();
      const visible = () => {
        const node = document.querySelector('.sheet');
        return !!node && node.getClientRects().length > 0;
      };
      let sheet = true;
      while (performance.now() - t0 < 100) {
        sheet = visible();
        if (!sheet) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { sheet, ms: Math.round(performance.now() - t0), path: location.pathname };
    });
    note(tag, close.ms <= 100 && !close.sheet && close.path === '/song/karitas', `esc sheet ${close.ms}ms`);
    const again = await keyWithin(page, { code: 'KeyK', key: 'k', watch: 'play' });
    note(tag, changed(again, (s) => s.play), `K after sheet ${again.ms}ms ${again.before.play}->${again.after.play}`);
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

async function runHover(browser, browserName) {
  const context = await browser.newContext({ ...desk, colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  const tag = `${browserName} D35 hover-drawn`;
  try {
    await openSong(page);
    const button = page.locator('button.btn-xl').first();
    const box = await button.boundingBox();
    if (!box) {
      note(tag, false, 'no play button');
    } else {
      await page.mouse.move(8, 8);
      const rest = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.evaluate(() => {
        window.__llHover = 0;
        document.querySelector('button.btn-xl')?.addEventListener(
          'pointerenter',
          () => {
            window.__llHover = performance.now();
          },
          { once: true },
        );
      });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const moved = await page.evaluate(async (start) => {
        const t0 = window.__llHover || performance.now();
        const el = document.querySelector('button.btn-xl');
        let next = start;
        while (performance.now() - t0 < 100) {
          next = el ? getComputedStyle(el).backgroundColor : '';
          if (next !== start) break;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return { ms: Math.round(performance.now() - t0), rest: start, next, entered: window.__llHover > 0 };
      }, rest);
      note(tag, moved.entered && moved.ms <= 100 && moved.rest !== moved.next, `hover ${moved.ms}ms ${moved.rest} -> ${moved.next}`);
    }
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();

  const touch = await browser.newContext({ ...phoneTouch, colorScheme: 'dark' });
  await installSilence(touch, browserName);
  const phone = await touch.newPage();
  try {
    await openSong(phone);
    const hoverMedia = await phone.evaluate(() => matchMedia('(hover: hover)').matches);
    await phone.locator('button.btn-xl').hover({ force: true }).catch(() => {});
    const painted = await phone.evaluate(() => {
      const el = document.querySelector('button.btn-xl');
      if (!el) return null;
      return { matches: el.matches(':hover'), bg: getComputedStyle(el).backgroundColor };
    });
    note(
      `${browserName} D35 hover-none-on-touch`,
      hoverMedia === false,
      `hover media ${hoverMedia} element ${painted ? painted.matches : 'missing'}`,
    );
  } catch (err) {
    note(`${browserName} D35 hover-none-on-touch`, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await touch.close();
}

async function runFocus(browser, browserName) {
  const context = await browser.newContext({ ...desk, colorScheme: 'light' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  const tag = `${browserName} D36 focus-ring`;
  try {
    await openSong(page);
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const style = getComputedStyle(el);
      const width = parseFloat(style.outlineWidth) || 0;
      return {
        name: el.getAttribute('aria-label') || el.className,
        style: style.outlineStyle,
        width,
        color: style.outlineColor,
      };
    });
    await page.locator('button.btn-xl').click();
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('button.btn-xl');
      if (!(el instanceof HTMLElement)) return null;
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) || 0, active: document.activeElement === el };
    });
    const ring = !!tabbed && tabbed.style !== 'none' && tabbed.width >= 2;
    const quiet = !!clicked && (clicked.style === 'none' || clicked.width < 1);
    note(tag, ring && quiet, `tab ${tabbed ? `${tabbed.name} ${tabbed.style} ${tabbed.width}` : 'none'} click ${clicked ? `${clicked.style} ${clicked.width}` : 'none'}`);
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

async function runPreview(browser, browserName) {
  const context = await browser.newContext({ ...desk, colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  const tag = `${browserName} D37 scrub-preview`;
  try {
    await openSong(page);
    const track = page.locator('.scrub-track').first();
    const box = await track.boundingBox();
    if (!box) {
      note(tag, false, 'no track');
    } else {
      const ratio = 0.37;
      await page.evaluate(() => {
        window.__llX = null;
        document.querySelector('.scrub-track')?.addEventListener('pointermove', (event) => {
          window.__llX = event.clientX;
        });
      });
      await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2);
      const seen = await page.evaluate(async () => {
        const t0 = performance.now();
        let text = '';
        let open = false;
        let ms = 0;
        while (performance.now() - t0 < 100) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const node = document.querySelector('.scrub-preview');
          const style = node ? getComputedStyle(node) : null;
          open = !!node && !node.hidden && !!style && style.visibility !== 'hidden' && Number(style.opacity) > 0.4;
          text = node?.textContent || '';
          ms = performance.now() - t0;
          if (open && /\d+:\d{2}/.test(text)) break;
        }
        const track = document.querySelector('.scrub-track');
        const rect = track ? track.getBoundingClientRect() : null;
        const duration = Number(track?.getAttribute('aria-valuemax')) || 0;
        const x = window.__llX;
        const expect = rect && x != null ? ((x - rect.left) / Math.max(1, rect.width)) * duration : null;
        return { ms: Math.round(ms), open, text: text.replace(/\s+/g, ' ').trim(), expect, duration };
      });
      const shown = clockSeconds(seen.text);
      note(
        tag,
        seen.ms <= 100 && seen.open && shown != null && seen.expect != null && Math.abs(shown - seen.expect) <= 1,
        `${seen.ms}ms «${seen.text}» expect ${seen.expect == null ? 'none' : seen.expect.toFixed(1)}s duration ${seen.duration}`,
      );
    }
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

async function runWheel(browser, browserName) {
  const context = await browser.newContext({ ...desk, colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  const tag = `${browserName} D38 wheel-line`;
  try {
    await openSong(page);
    const stage = page.locator('.scene-stage').first();
    const box = await stage.boundingBox();
    if (!box) {
      note(tag, false, 'no stage');
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(120, box.height / 2));
      const once = await page.evaluate(async () => {
        const line = () => (document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '').replace(/\s+/g, ' ').trim();
        const before = line();
        const node = document.querySelector('.scene');
        node?.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const mid = line();
        node?.dispatchEvent(new WheelEvent('wheel', { deltaY: 16, deltaMode: 0, bubbles: true, cancelable: true }));
        node?.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, deltaMode: 0, bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, mid, after: line() };
      });
      note(
        tag,
        once.before.length > 0 && once.before !== once.mid && once.mid === once.after && once.mid.length > 0,
        `one notch ${once.before.slice(0, 20)} -> ${once.mid.slice(0, 20)} inertia ${once.after === once.mid}`,
      );
      const seek = await page.evaluate(async () => {
        const clock = () => document.querySelector('.scrub-now')?.textContent || '';
        const before = clock();
        const node = document.querySelector('.scrub-track');
        node?.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { before, after: clock() };
      });
      const from = clockSeconds(seek.before);
      const to = clockSeconds(seek.after);
      note(tag, from != null && to != null && to - from >= 4 && to - from <= 6, `scrub wheel ${seek.before}->${seek.after}`);
      const header = await page.evaluate(async () => {
        const line = () => (document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '').replace(/\s+/g, ' ').trim();
        const before = line();
        const node = document.querySelector('.topbar');
        const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
        node?.dispatchEvent(event);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return { before, after: line(), defaulted: !event.defaultPrevented };
      });
      note(tag, header.before === header.after && header.defaulted, `header wheel left the line ${header.before === header.after}`);
    }
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

/** Type steps named in the round. A linear vw term is not a step. */
const TYPE_STEPS = [
  [1280, 800, 50],
  [1440, 900, 54],
  [1680, 1050, 56],
  [1920, 1080, 60],
  [2560, 1440, 64],
  [3440, 1440, 68],
];

async function runProportion(browser, browserName) {
  const tag = `${browserName} D39 desk-proportion`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await installSilence(context, browserName);
  const page = await context.newPage();
  try {
    await openSong(page);
    for (const [width, height, latin] of TYPE_STEPS) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(
        (want) => {
          const line = document.querySelector('.fb--line.is-current .fb-orig');
          const stage = document.querySelector('.scene-stage');
          const player = document.querySelector('.player');
          if (!line || !stage || !player) return false;
          return Math.round(parseFloat(getComputedStyle(line).fontSize)) === want;
        },
        latin,
        { timeout: 2000 },
      );
      const box = await page.evaluate(() => {
        const stage = document.querySelector('.scene-stage');
        const player = document.querySelector('.player');
        const line = document.querySelector('.fb--line.is-current .fb-orig');
        if (!stage || !player || !line) return null;
        const s = stage.getBoundingClientRect();
        const p = player.getBoundingClientRect();
        return {
          stage: Math.round(s.width),
          player: Math.round(p.width),
          latin: Math.round(parseFloat(getComputedStyle(line).fontSize)),
        };
      });
      const ok = !!box && box.stage <= 920 && box.stage >= 640 && Math.abs(box.player - box.stage) <= 8 && box.latin === latin;
      note(tag, ok, box ? `${width} stage ${box.stage} player ${box.player} latin ${box.latin} want ${latin}` : `${width} missing`);
    }
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

async function runMedia(browser) {
  const context = await browser.newContext({ ...desk, colorScheme: 'dark' });
  await context.addInitScript(() => {
    const session = navigator.mediaSession;
    const bag = { handlers: {}, positions: [], metadata: null };
    const assign = () => {
      const desc = Object.getOwnPropertyDescriptor(MediaMetadata.prototype, 'title');
      // Metadata is a constructor argument, so read it when the page assigns the object.
    };
    assign();
    const origSet = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      bag.handlers[action] = handler;
      try {
        origSet(action, handler);
      } catch {
        /* the action can be missing in this build */
      }
    };
    const origPos = session.setPositionState?.bind(session);
    if (origPos) {
      session.setPositionState = (state) => {
        bag.positions.push({ ...state });
        try {
          origPos(state);
        } catch {
          /* out of range while the source swaps */
        }
      };
    }
    const Orig = window.MediaMetadata;
    window.MediaMetadata = function MediaMetadataSpy(data) {
      bag.metadata = data;
      return new Orig(data);
    };
    window.__llMedia = bag;
  });
  await installSilence(context, 'chromium');
  const page = await context.newPage();
  const tag = 'chromium D40 media-session';
  try {
    await openSong(page);
    await page.waitForTimeout(200);
    const actions = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];
    const bag = await page.evaluate((names) => {
      const media = window.__llMedia;
      const have = names.filter((name) => typeof media?.handlers?.[name] === 'function');
      const art = media?.metadata?.artwork || [];
      return {
        title: media?.metadata?.title || '',
        artist: media?.metadata?.artist || '',
        album: media?.metadata?.album || '',
        art: art.length,
        have,
      };
    }, actions);
    const metaOk = bag.title && bag.artist && bag.album && bag.art >= 4 && bag.have.length === actions.length;
    note(tag, !!metaOk, `meta ${bag.title} / ${bag.album} art ${bag.art} handlers ${bag.have.join(',')}`);
    const moved = await page.evaluate(async () => {
      const line = () => (document.querySelector('.fb--line.is-current .fb-orig')?.textContent || '').replace(/\s+/g, ' ').trim();
      const before = line();
      const t0 = performance.now();
      window.__llMedia.handlers.nexttrack({ action: 'nexttrack' });
      let after = line();
      while (before === after && performance.now() - t0 < 100) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        after = line();
      }
      return { before, after, ms: Math.round(performance.now() - t0) };
    });
    note(tag, moved.before !== moved.after && moved.after.length > 0 && moved.ms <= 100, `nexttrack ${moved.ms}ms line changed ${moved.before !== moved.after}`);
    await page.evaluate(() => window.__llMedia.handlers.seekto({ action: 'seekto', seekTime: 120 }));
    await page.waitForTimeout(80);
    const clock = await page.evaluate(() => document.querySelector('.scrub-now')?.textContent || '');
    const positions = await page.evaluate(() => window.__llMedia.positions.length);
    note(tag, /2:00/.test(clock) && positions > 0, `seekto ${clock} positions ${positions}`);
  } catch (err) {
    note(tag, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
  await context.close();
}

const chrome = !engineOnly || engineOnly === 'chromium' ? await chromium.launch() : null;
const kit = !engineOnly || engineOnly === 'webkit' ? await webkit.launch() : null;
const engines = [
  ['chromium', chrome],
  ['webkit', kit],
].filter((pair) => pair[1]);

// The two engines do not share a page. Running them together keeps the gate under 10 min.
await Promise.all(
  engines.map(async ([name, browser]) => {
    if (!only || only === 'D34') await runKeys(browser, name);
    if (!only || only === 'D35') await runHover(browser, name);
    if (!only || only === 'D36') await runFocus(browser, name);
    if (!only || only === 'D37') await runPreview(browser, name);
    if (!only || only === 'D38') await runWheel(browser, name);
    if (!only || only === 'D39') await runProportion(browser, name);
  }),
);
if (chrome && (!only || only === 'D40')) await runMedia(chrome);

if (chrome) await chrome.close();
if (kit) await kit.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} desktop rows passed`);
if (failed.length) process.exit(1);
