// Library → song, settings, full text, scrub, and play. Chromium and WebKit, phone and desktop.
// A black frame is a screenshot whose pixels are almost all near black, sampled while the route changes.
// node scripts/perf/interactions.mjs --base http://127.0.0.1:4176
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';
import { corpusFor, noteCardInPage, sampleInPage } from './drawn.mjs';
import { installResolvedAudio, installWebKitClock, prepareAudio } from './lib.mjs';

const karitasCorpus = corpusFor('karitas');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (!token.startsWith('--')) return pairs;
    pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return pairs;
  }, []),
);

const base = args.base || 'http://127.0.0.1:4176';
const iphoneUa =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const phone = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: iphoneUa,
};
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

// The recording file is encrypted. The element still has to accept play and pause
// so the control can be tested without AUDIO_KEY.
const stubMedia = () => {
  HTMLMediaElement.prototype.play = function playStub() {
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pauseStub() {
    this.dispatchEvent(new Event('pause'));
  };
};

function matrixOf(transform) {
  if (!transform || transform === 'none') return { a: 1, d: 1 };
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((n) => Number(n.trim()));
  if (!Number.isFinite(parts[0]) || !Number.isFinite(parts[3])) return null;
  return { a: parts[0], d: parts[3] };
}

async function luma(buffer) {
  const { data, info } = await sharp(buffer).resize(48, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let dark = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    if (y < 12) dark += 1;
  }
  return { mean: Math.round((sum / n) * 10) / 10, darkPct: Math.round((dark / n) * 1000) / 1000 };
}

async function sampleFlight(page) {
  const samples = [];
  const pending = page.locator('.lib-hero').evaluate((el) => el.click());
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const shot = await page.screenshot({ type: 'jpeg', quality: 35, animations: 'allow' }).catch(() => null);
    if (!shot) continue;
    const light = await luma(shot);
    const layer = await page
      .evaluate(() => {
        const shell = document.querySelector('.morph-shell');
        const cover = document.querySelector('.morph-cover');
        const box = cover ? cover.getBoundingClientRect() : null;
        const song = document.querySelector('.song');
        return {
          shell: !!shell,
          coverW: box ? box.width : 0,
          coverH: box ? box.height : 0,
          vw: window.innerWidth,
          vh: window.innerHeight,
          songOpacity: song ? Number(getComputedStyle(song).opacity) : null,
        };
      })
      .catch(() => null);
    samples.push({ ...light, ...layer });
  }
  await pending.catch(() => {});
  await page.waitForURL('**/song/**', { timeout: 8000 });
  return samples;
}

async function measureFlight(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const hero = document.querySelector('.lib-hero');
        const poster = hero?.querySelector('[data-poster]');
        if (!hero || !poster) {
          resolve({ ok: false, ms: -1, detail: 'no hero' });
          return;
        }
        const home = poster.getBoundingClientRect();
        let settled = false;
        document.addEventListener(
          'click',
          () => {
            const t0 = performance.now();
            // Against the card, not the flyer. The flight steps inside the click,
            // before this listener, so the tap frame has already moved.
            const sample = (now) => {
              if (settled) return;
              const box = document.querySelector('.morph-cover')?.getBoundingClientRect();
              const moved =
                !!box &&
                (Math.abs(box.width - home.width) > 1 || Math.abs(box.left - home.left) > 1 || Math.abs(box.top - home.top) > 1);
              const ms = Math.max(0, Math.round(now - t0));
              if (moved) {
                settled = true;
                resolve({ ok: ms <= 100, ms, w: Math.round(box.width), detail: `${ms} ms → ${Math.round(box.width)} px` });
                return;
              }
              if (now - t0 > 450) {
                settled = true;
                resolve({ ok: false, ms, w: box ? Math.round(box.width) : 0, detail: `no move by ${ms} ms` });
              }
            };
            sample(t0);
            const tick = (frameNow) => {
              const now = typeof frameNow === 'number' ? frameNow : performance.now();
              sample(now);
              if (!settled) requestAnimationFrame(tick);
            };
            if (!settled) requestAnimationFrame(tick);
          },
          { once: true },
        );
        hero.click();
      }),
  );
}

function flightVerdict(samples) {
  const black = samples.filter((s) => s.mean < 10 && s.darkPct > 0.9);
  const plate = samples.filter((s) => {
    if (s.shell) return true;
    if (!s.coverW || !s.coverH || !s.vw || !s.vh) return false;
    return (s.coverW * s.coverH) / (s.vw * s.vh) > 0.7;
  });
  const hidden = samples.filter((s) => s.songOpacity != null && s.songOpacity < 0.2);
  const means = samples.map((s) => s.mean);
  const min = means.length ? Math.min(...means) : null;
  return {
    ok: black.length === 0 && plate.length === 0 && hidden.length === 0 && samples.length >= 2,
    detail: `samples=${samples.length} minMean=${min} black=${black.length} plate=${plate.length} hiddenSong=${hidden.length}`,
  };
}

async function chromeClear(page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const obstacles = [...document.querySelectorAll('.player-alert, .player .comment')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 8 && r.height > 8;
        return shown ? { name: el.className, r } : null;
      })
      .filter(Boolean);
    const hits = [];
    for (const node of document.querySelectorAll('.fb-orig, .fb-tr, .fb-inst-kicker, .fb-voice, .fb-meta')) {
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const block = node.closest('.fb');
      if (block && Number(getComputedStyle(block).opacity) < 0.15) continue;
      if (getComputedStyle(node).visibility === 'hidden') continue;
      for (const o of obstacles) {
        if (hit(r, o.r)) {
          hits.push({
            text: node.className,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            obstacle: o.name,
          });
        }
      }
    }
    return { hits, obstacles: obstacles.map((o) => o.name) };
  });
}

function nearToken(rgb, target) {
  return Math.hypot(rgb[0] - target[0], rgb[1] - target[1], rgb[2] - target[2]);
}

async function paintOf(buffer) {
  const { data, info } = await sharp(buffer).resize(32, 18, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  const sum = [0, 0, 0];
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] < 3 && data[i + 1] < 3 && data[i + 2] < 3) black += 1;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  return {
    rgb: sum.map((v) => Math.round(v / n)),
    blackPct: black / n,
  };
}

async function openSong(page) {
  await page.goto(base + '/song/karitas?t=42', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.scene').waitFor({ timeout: 8000 });
  await page.waitForFunction(
    () => {
      const song = document.querySelector('.song');
      const raw = song ? getComputedStyle(song).getPropertyValue('--player-h') : '';
      return parseFloat(raw) > 40 && document.querySelector('.fb--line');
    },
    { timeout: 8000 },
  );
}

async function dialogSettled(page) {
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('[role="dialog"]');
      const backdrop = document.querySelector('.sheet-backdrop');
      if (!dialog || !backdrop) return false;
      const box = dialog.getBoundingClientRect();
      const scrim = Number(getComputedStyle(backdrop).opacity);
      return box.height > 120 && box.top < window.innerHeight - 40 && box.bottom > 80 && scrim >= 0.9;
    },
    { timeout: 5000 },
  );
}

async function closeDialog(page) {
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.waitForFunction(() => !document.querySelector('.sheet-root'), { timeout: 5000 });
}

async function stageView(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.scene-stage');
    if (!stage) return { ok: false, lines: 0, arts: 0, why: 'no stage' };
    const box = stage.getBoundingClientRect();
    const seen = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!(Number(style.opacity) > 0.04)) return false;
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      const top = Math.max(rect.top, box.top);
      const bottom = Math.min(rect.bottom, box.bottom);
      const left = Math.max(rect.left, box.left);
      const right = Math.min(rect.right, box.right);
      return bottom - top > 8 && right - left > 8;
    };
    let lines = 0;
    let arts = 0;
    const textOf = '.scene-view .fb--line .fb-orig, .scene-depart .fb--line .fb-orig, .scene-view .fb--intro .intro-title, .scene-depart .fb--intro .intro-title';
    for (const el of stage.querySelectorAll(textOf)) {
      const text = (el.textContent || '').replace(/\u200b/g, '').trim();
      if (text && seen(el)) lines += 1;
    }
    // Phone plates keep the drawing in a shadow root. A light-DOM query cannot see it.
    const walk = (root) => {
      for (const el of root.querySelectorAll('.ist-art, .ist-art-mount')) {
        if (el.classList.contains('ist-art') && seen(el)) arts += 1;
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(stage);
    return { ok: lines > 0 || arts > 0, lines, arts };
  });
}

async function readDrawn(page) {
  return page.evaluate(sampleInPage, karitasCorpus);
}

async function burstDrawn(page, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(await readDrawn(page));
    if (i + 1 < count) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
  }
  return rows;
}

function judgeDrawn(rows) {
  const bad = rows.filter((row) => !row?.ok);
  const texts = rows.reduce((sum, row) => sum + (row?.texts || 0), 0);
  const sample = bad[0];
  const detail = sample
    ? JSON.stringify({ bad: sample.bad, overlap: sample.overlap, texts: sample.texts, frame: rows.indexOf(sample), of: rows.length })
    : `frames ${rows.length} texts ${texts}`;
  return { ok: rows.length >= 20 && bad.length === 0 && texts > 0, detail };
}

async function meanDiff(a, b, box, scale) {
  if (!box) return 99;
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  const cut = async (buf) => {
    const meta = await sharp(buf).metadata();
    const w = Math.min(width, (meta.width || width) - left);
    const h = Math.min(height, (meta.height || height) - top);
    return sharp(buf)
      .extract({ left, top, width: Math.max(1, w), height: Math.max(1, h) })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  };
  const leftShot = await cut(a);
  const rightShot = await cut(b);
  const n = Math.min(leftShot.data.length, rightShot.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(leftShot.data[i] - rightShot.data[i]);
  return n ? sum / n : 99;
}

/** The feature file starts a second after the song mounts. Wait until that pose exists. */
async function featuresSettled(page) {
  await page
    .waitForFunction(
      () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/features.json') && entry.responseEnd > 0),
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(150);
}

async function seekMatch(page) {
  await page.evaluate(() => {
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
  });
  await page.waitForTimeout(80);
  const box = await page.locator('.scene-stage').boundingBox();
  const scale = await page.evaluate(() => window.devicePixelRatio || 1);
  const seconds = await page.evaluate(() => {
    const track = document.querySelector('.scrub-track');
    const exact = Number(track?.getAttribute('data-t'));
    const rounded = Number(track?.getAttribute('aria-valuenow'));
    return Number.isFinite(exact) ? exact : rounded;
  });
  const released = await page.screenshot({ type: 'png', animations: 'disabled' });
  await page.goto(`${base}/song/karitas?t=${seconds}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await featuresSettled(page);
  await page.evaluate(() => {
    const field = document.querySelector('.field');
    if (field instanceof HTMLElement) field.style.visibility = 'hidden';
  });
  await page.waitForTimeout(80);
  const sought = await page.screenshot({ type: 'png', animations: 'disabled' });
  const mean = await meanDiff(released, sought, box, scale);
  if (mean >= 2) {
    mkdirSync('work/studio/seek-debug', { recursive: true });
    const id = `${Date.now()}`;
    writeFileSync(`work/studio/seek-debug/${id}-released.png`, released);
    writeFileSync(`work/studio/seek-debug/${id}-seek.png`, sought);
    writeFileSync('work/studio/seek-debug/last.json', JSON.stringify({ id, seconds, mean }));
  }
  return { seconds, mean, width: box ? Math.round(box.width) : 0, height: box ? Math.round(box.height) : 0 };
}

function clockSeconds(text) {
  const hit = /(\d+):(\d{2})/.exec(text || '');
  if (!hit) return Number.NaN;
  return Number(hit[1]) * 60 + Number(hit[2]);
}

async function stageViewCount(page) {
  return page.evaluate(() => {
    let count = 0;
    for (const el of document.querySelectorAll('.stage-view')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number(style.opacity) > 0.05) count += 1;
    }
    return count;
  });
}

/** Settled opening of I Have Come Alive: title contrast and whether an engraving is drawn. */
async function introStage(page) {
  await page.goto(base + '/song/i-have-come-alive', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () => {
      const song = document.querySelector('.song');
      const title = document.querySelector('.intro-title');
      if (!song || !title) return false;
      if (song.classList.contains('is-arriving') || document.querySelector('.morph-cover')) return false;
      return title.getBoundingClientRect().height > 8;
    },
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const parse = (c) => {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return [244, 241, 234, 1];
      const p = m[1].split(',').map((s) => Number(s.trim()));
      return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
    };
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (rgb) => 0.2126 * lin(rgb[0] / 255) + 0.7152 * lin(rgb[1] / 255) + 0.0722 * lin(rgb[2] / 255);
    const title = document.querySelector('.intro-title');
    const song = document.querySelector('.song');
    if (!title || !song) return { ratio: 0, arts: 0, why: 'missing' };
    let opacity = 1;
    let node = title;
    while (node && node !== document.documentElement) {
      const o = Number(getComputedStyle(node).opacity);
      if (Number.isFinite(o)) opacity *= o;
      node = node.parentElement;
    }
    const fg = parse(getComputedStyle(title).color);
    const bg = parse(getComputedStyle(song).backgroundColor);
    const mixed = [0, 1, 2].map((i) => Math.round(fg[i] * opacity + bg[i] * (1 - opacity)));
    const hi = Math.max(lum(mixed), lum(bg));
    const lo = Math.min(lum(mixed), lum(bg));
    const stage = document.querySelector('.scene-stage');
    let arts = 0;
    const seen = (el) => {
      let current = el;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!(Number(style.opacity) > 0.04)) return false;
        const root = current.getRootNode();
        const next = current.parentElement || (root instanceof ShadowRoot ? root.host : null);
        if (!next || next === current) break;
        current = next;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    };
    const walk = (root) => {
      if (!root) return;
      for (const el of root.querySelectorAll('.ist-art, .ist-art-mount')) {
        if (el.classList.contains('ist-art') && seen(el)) arts += 1;
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    if (stage) walk(stage);
    return {
      ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      opacity: Math.round(opacity * 1000) / 1000,
      arts,
    };
  });
}

async function runCore(page, label) {
  const out = [];
  const note = (name, ok, detail) => {
    out.push({ name: `${label} ${name}`, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${name} ${detail}`);
  };

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.lib-hero').waitFor();
  if (label.includes('desktop')) {
    const search = await page.evaluate(() => {
      const title = document.querySelector('.lib-title')?.getBoundingClientRect();
      const field = document.querySelector('.search')?.getBoundingClientRect();
      const actions = document.querySelector('.lib-actions')?.getBoundingClientRect();
      if (!title || !field || !actions) return null;
      return {
        aligned: Math.abs(title.top - field.top) < 28 && Math.abs(actions.top - field.top) < 28,
        width: Math.round(field.width),
      };
    });
    note(
      'search-row',
      !!search && search.aligned && search.width <= 490 && search.width >= 200,
      search ? `aligned=${search.aligned} width=${search.width}` : 'missing',
    );
  }

  const started = await measureFlight(page);
  note('flight-start', !!started && started.ok, started ? started.detail : 'missing');
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.locator('.lib-hero').waitFor();
  const samples = await sampleFlight(page);
  const flight = flightVerdict(samples);
  note('flight-no-black', flight.ok, flight.detail);

  const stage = await page.evaluate(() => {
    const scene = document.querySelector('.scene');
    const stageBox = document.querySelector('.scene-stage')?.getBoundingClientRect();
    const block = document.querySelector('.fb--line, .fb--inst, .fb--intro');
    const blockBox = block?.getBoundingClientRect();
    return {
      stageH: stageBox ? Math.round(stageBox.height) : 0,
      block: block?.className ?? '',
      blockH: blockBox ? Math.round(blockBox.height) : 0,
      opacity: scene ? Number(getComputedStyle(scene).opacity) : 0,
    };
  });
  note('stage-visible', stage.stageH > 80 && stage.blockH > 8 && stage.opacity > 0.85, JSON.stringify(stage));

  await openSong(page);

  if (label.includes('desktop')) {
    const rank = await page.evaluate(() => {
      const parse = (color) => {
        const raw = String(color);
        const m = raw.match(/[\d.]+/g);
        if (!m) return null;
        let r = Number(m[0]);
        let g = Number(m[1]);
        let b = Number(m[2]);
        const a = m[3] == null ? 1 : Number(m[3]);
        // color(srgb …) is 0–1. rgb() is 0–255. Dividing the first by 255 made the translation look like the page.
        if (/srgb|display-p3|color\(/.test(raw) && Math.max(r, g, b) <= 1) {
          r *= 255;
          g *= 255;
          b *= 255;
        }
        return { r, g, b, a };
      };
      const channel = (c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const rel = (r, g, b) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const used = (el) => {
        let a = 1;
        let node = el;
        while (node && node !== document.documentElement) {
          const style = getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none') return 0;
          a *= Number(style.opacity);
          node = node.parentElement;
        }
        return a;
      };
      const bg = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 7, g: 6, b: 12, a: 1 };
      const contrast = (el) => {
        const fg = parse(getComputedStyle(el).color);
        if (!fg) return 0;
        const alpha = Math.max(0, Math.min(1, fg.a * used(el)));
        const L = rel(fg.r, fg.g, fg.b) * alpha + rel(bg.r, bg.g, bg.b) * (1 - alpha);
        const Lb = rel(bg.r, bg.g, bg.b);
        return (Math.max(L, Lb) + 0.05) / (Math.min(L, Lb) + 0.05);
      };
      const brightest = (list) => list.filter(Boolean).sort((a, b) => used(b) - used(a))[0] || null;
      const orig = document.querySelector('.fb--line.is-current .w');
      const tr = document.querySelector('.fb--line.is-current .fb-tr');
      const idle = [...document.querySelectorAll('.fb--line:not(.is-current)')];
      const dimOrig = brightest(idle.map((el) => el.querySelector('.w')));
      const dimTr = brightest(idle.map((el) => el.querySelector('.fb-tr')).filter((el) => el && used(el) > 0.35));
      if (!orig || !tr) return null;
      return {
        origC: Math.round(contrast(orig) * 100) / 100,
        trC: Math.round(contrast(tr) * 100) / 100,
        dimO: Math.round((dimOrig ? contrast(dimOrig) : 0) * 100) / 100,
        dimT: dimTr ? Math.round(contrast(dimTr) * 100) / 100 : null,
      };
    });
    note(
      'hierarchy',
      !!rank && rank.origC > rank.trC && rank.dimO >= 3 && (rank.dimT == null || rank.dimT >= 4.5),
      rank ? JSON.stringify(rank) : 'missing',
    );
  }

  if (label.includes('phone')) {
    const phoneBlur = await page.evaluate(() => {
      const node = document.querySelector('.fb--line:not(.is-current) .fb-orig');
      return {
        phone: document.documentElement.dataset.phone || '',
        filter: node ? getComputedStyle(node).filter : 'missing',
      };
    });
    note('phone-no-blur', phoneBlur.phone === '1' && !String(phoneBlur.filter).includes('blur'), JSON.stringify(phoneBlur));
    const card = await page.evaluate(noteCardInPage);
    note('note-card', !!card && card.ok, card ? card.why : 'missing');
  }

  const reading = await page.evaluate(() => {
    const line = document.querySelector('.fb--line.is-current') || document.querySelector('.fb--line');
    const player = document.querySelector('.player');
    const banner = document.querySelector('.player-alert');
    if (!line || !player) return null;
    const lr = line.getBoundingClientRect();
    const pr = player.getBoundingClientRect();
    const br = banner ? banner.getBoundingClientRect() : null;
    const center = (lr.top + lr.bottom) / 2;
    return {
      centerAboveFloor: center < pr.top - 2,
      clearOfBanner: !br || lr.top >= br.bottom - 4,
      bannerW: br ? Math.round(br.width) : 0,
      lineTop: Math.round(lr.top),
      bannerBottom: br ? Math.round(br.bottom) : null,
      playerTop: Math.round(pr.top),
    };
  });
  note(
    'line-in-window',
    !!reading && reading.centerAboveFloor && reading.clearOfBanner && (reading.bannerW === 0 || reading.bannerW <= 548),
    reading ? JSON.stringify(reading) : 'missing',
  );

  const mark = await page.locator('.mark-btn').innerText().catch(() => '');
  const kbd = await page.locator('.mark-kbd').count();
  note('no-latin-m', kbd === 0 && !/\bM\b/.test(mark), `kbd=${kbd} text=${JSON.stringify(mark.trim())}`);

  if (label.includes('phone')) {
    const noteFade = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const rows = [];
          let rest = 0;
          const read = () => {
            const card = document.querySelector('.note-card');
            const sheet = document.querySelector('.sheet');
            const cardBox = card ? card.getBoundingClientRect() : null;
            const sheetBox = sheet ? sheet.getBoundingClientRect() : null;
            if (!rest && cardBox) rest = cardBox.bottom;
            rows.push({
              opacity: card ? Number(getComputedStyle(card).opacity) : null,
              passed: !!(sheetBox && rest && sheetBox.height > 80 && sheetBox.top < rest - 1),
            });
          };
          document.addEventListener(
            'click',
            () => {
              read();
              const tick = () => {
                read();
                const last = rows[rows.length - 1];
                if (rows.length >= 14 || (last && last.passed && rows.length > 4)) resolve(rows);
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            },
            { once: true },
          );
          const button = document.querySelector('button[aria-label="Настройки"]');
          if (!button) resolve([]);
          else button.click();
        }),
    );
    const opacities = (noteFade || []).map((row) => row.opacity).filter((n) => n != null);
    const buckets = new Set(opacities.map((n) => Math.round(n * 10) / 10));
    const passedAt = (noteFade || []).findIndex((row) => row.passed);
    const until = passedAt < 0 ? opacities : opacities.slice(0, passedAt + 1);
    const hidden = until.length > 0 && until[until.length - 1] <= 0.05;
    note('note-fade', buckets.size >= 3 && hidden, JSON.stringify({ buckets: [...buckets], passedAt, n: opacities.length }));
  } else {
    await page.locator('button[aria-label="Настройки"]').click();
  }
  let opened = false;
  try {
    await dialogSettled(page);
    opened = true;
  } catch {
    opened = false;
  }
  const sheet = opened
    ? await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const backdrop = document.querySelector('.sheet-backdrop');
        const grabber = document.querySelector('.sheet-grabber');
        const title = dialog?.querySelector('.sheet-title')?.textContent?.trim() ?? '';
        const box = dialog.getBoundingClientRect();
        const scrim = backdrop ? getComputedStyle(backdrop).opacity : '0';
        const g = grabber?.getBoundingClientRect();
        return { title, h: Math.round(box.height), scrim: Number(scrim), grabber: g ? g.height : 0 };
      })
    : null;
  note(
    'settings-open',
    !!sheet && sheet.h > 120 && sheet.title === 'Настройки' && sheet.scrim >= 0.9 && sheet.grabber >= 4,
    sheet ? JSON.stringify(sheet) : 'dialog never entered the viewport',
  );

  if (sheet) {
    const grabber = page.locator('.sheet-grabber');
    const box = await grabber.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 48, { steps: 6 });
      await page.waitForTimeout(40);
      const stretched = await page.locator('[role="dialog"]').evaluate((el) => el.style.transform);
      await page.mouse.up();
      const y = Number((stretched.match(/translate3d\(\s*0(?:px)?,\s*(-?[\d.]+)/) || [])[1]);
      note('sheet-rubber', Number.isFinite(y) && y < -2, stretched || 'no transform');
    } else {
      note('sheet-rubber', false, 'grabber has no box');
    }
    let gone = false;
    try {
      await closeDialog(page);
      gone = true;
    } catch {
      gone = false;
    }
    note('settings-close', gone, gone ? 'unmounted' : 'still covering the page');
  } else {
    note('sheet-rubber', false, 'sheet did not open');
    note('settings-close', false, 'sheet did not open');
  }

  await page.locator('button[aria-label="Весь текст"]').click();
  let textOpen = false;
  try {
    await dialogSettled(page);
    textOpen = true;
  } catch {
    textOpen = false;
  }
  const textTitle = textOpen ? (await page.locator('.sheet-title').innerText()).trim() : '';
  note('text-open', textOpen && textTitle === 'Весь текст', textTitle || 'no dialog');
  if (textOpen) {
    try {
      await closeDialog(page);
    } catch (err) {
      note('text-close', false, String(err && err.message ? err.message : err).split('\n')[0]);
      await page.locator('.sheet-backdrop').click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  await page.waitForFunction(() => !document.querySelector('.sheet-root')).catch(() => {});
  const before = Number(await page.locator('.scrub-track[role="slider"]').getAttribute('aria-valuenow'));
  const track = page.locator('.scrub-track[role="slider"]');
  const trackBox = await track.boundingBox();
  if (!trackBox) {
    note('scrub', false, 'track has no box');
    note('scrub-mid', false, 'track has no box');
    note('scrub-inst', false, 'track has no box');
    note('scrub-lyric', false, 'track has no box');
    note('scrub-views', false, 'track has no box');
    note('handoff', false, 'track has no box');
  } else {
    await page.mouse.move(trackBox.x + 8, trackBox.y + trackBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(320);
    const bloom = await page.evaluate(() => {
      const rail = document.querySelector('.scrub-rail');
      const preview = document.querySelector('.scrub-preview');
      const head = document.querySelector('.scrub-head');
      const railT = rail ? getComputedStyle(rail).transform : 'none';
      const headT = head ? getComputedStyle(head).transform : 'none';
      const previewBox = preview && !preview.hidden ? preview.getBoundingClientRect() : null;
      const trackBox = document.querySelector('.scrub-track')?.getBoundingClientRect();
      const railBox = rail?.getBoundingClientRect();
      return {
        rail: railT,
        head: headT,
        dragging: document.querySelector('.scrub')?.classList.contains('is-dragging') ?? false,
        railH: railBox ? Math.round(railBox.height * 10) / 10 : 0,
        previewAbove: previewBox && trackBox ? previewBox.bottom <= trackBox.top - 4 : false,
      };
    });
    const y = trackBox.y + trackBox.height / 2;
    const x0 = trackBox.x + 8;
    // 705s / 977s is the qanun break. A fast last step would coast past it.
    const xInst = trackBox.x + trackBox.width * (705 / 977);
    let mid = null;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + ((xInst - x0) * i) / steps, y);
      if (i === 4) {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        mid = await stageView(page);
      }
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(80);
    await page.mouse.move(xInst + 1, y);
    await page.waitForTimeout(120);
    await page.mouse.move(xInst, y);
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const inst = await stageView(page);
    const after = Number(await page.locator('.scrub-track[role="slider"]').getAttribute('aria-valuenow'));
    const rail = matrixOf(bloom.rail);
    const head = matrixOf(bloom.head);
    note(
      'scrub',
      Number.isFinite(before) &&
        Number.isFinite(after) &&
        Math.abs(after - before) > 20 &&
        !!rail &&
        (rail.d >= 1.7 || bloom.railH >= 7) &&
        !!head &&
        head.a >= 1.2 &&
        bloom.previewAbove,
      `before=${before} after=${after} rail=${bloom.rail} h=${bloom.railH} drag=${bloom.dragging} head=${bloom.head} bubble=${bloom.previewAbove}`,
    );
    note('scrub-mid', !!mid && mid.ok, JSON.stringify(mid));
    note(
      'scrub-inst',
      !!inst && inst.arts > 0 && after > 680 && after < 730,
      JSON.stringify({ ...inst, after }),
    );
    const sought = await seekMatch(page);
    note('scrub-seek', sought.mean < 2, `t=${sought.seconds} mean=${sought.mean.toFixed(3)} ${sought.width}x${sought.height}`);
    // The margin note closes on an instrumental cue and the dock recentres.
    const lyricBox = (await track.boundingBox()) || trackBox;
    const yLyric = lyricBox.y + lyricBox.height / 2;
    const xLyric0 = lyricBox.x + 16;
    const xLyric = lyricBox.x + lyricBox.width * (42 / 977);
    await page.mouse.move(xLyric0, yLyric);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(xLyric0 + ((xLyric - xLyric0) * i) / 6, yLyric);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(80);
    await page.mouse.move(xLyric + 1, yLyric);
    await page.waitForTimeout(120);
    await page.mouse.move(xLyric, yLyric);
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(450);
    const lyric = await stageView(page);
    const lyricAt = Number(await page.locator('.scrub-track[role="slider"]').getAttribute('aria-valuenow'));
    note('scrub-lyric', !!lyric && lyric.lines > 0 && lyricAt > 20 && lyricAt < 80, JSON.stringify({ ...lyric, lyricAt }));
    const counts = [];
    const fastDrawn = [];
    // Measure again: the margin note came back on release and the column, with the
    // phone-width dock, re-centred. The box from before that is a stale target.
    const fastBox = (await track.boundingBox()) || lyricBox;
    const yFast = fastBox.y + fastBox.height / 2;
    const xA = fastBox.x + 10;
    const xB = fastBox.x + fastBox.width * 0.9;
    await page.mouse.move(xA, yFast);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(xA + ((xB - xA) * i) / 14, yFast);
      counts.push(await stageViewCount(page));
      fastDrawn.push(await readDrawn(page));
    }
    if (fastDrawn.length < 20) fastDrawn.push(...(await burstDrawn(page, 20 - fastDrawn.length)));
    await page.mouse.up();
    const maxViews = counts.length ? Math.max(...counts) : 0;
    note('scrub-views', maxViews >= 1 && maxViews <= 2, JSON.stringify(counts));
    const fastJudge = judgeDrawn(fastDrawn);
    note('drawn-fast', fastJudge.ok, fastJudge.detail);
    await page.mouse.move(xA, yFast);
    await page.mouse.down();
    await page.mouse.move(xA + (xB - xA) * 0.35, yFast);
    await page.waitForTimeout(320);
    const slowDrawn = await burstDrawn(page, 20);
    await page.mouse.up();
    const slowJudge = judgeDrawn(slowDrawn);
    note('drawn-slow', slowJudge.ok, slowJudge.detail);
    const max = Number(await track.getAttribute('aria-valuemax'));
    // Release recentres the dock when the margin note opens or closes. The box
    // from that same turn is the previous column, and 30 s lands on the intro.
    let handRail = (await track.boundingBox()) || trackBox;
    for (let i = 0; i < 10 && handRail; i++) {
      await page.waitForTimeout(40);
      const next = await track.boundingBox();
      if (!next) break;
      const still = Math.abs(next.x - handRail.x) < 0.5 && Math.abs(next.y - handRail.y) < 0.5 && Math.abs(next.width - handRail.width) < 0.5;
      handRail = next;
      if (still) break;
    }
    if (handRail && max > 40) {
      const yRail = handRail.y + handRail.height / 2;
      const xAt = (sec) => handRail.x + (sec / max) * handRail.width;
      await page.mouse.move(xAt(30), yRail);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.move(xAt(40), yRail);
      await page.waitForTimeout(360);
      await page.mouse.up();
      await page.waitForTimeout(80);
      const hand = await page.evaluate(() => {
        const song = document.querySelector('.song');
        return {
          flag: song?.dataset.handoff || '',
          ms: Number(song?.dataset.handoffMs || 0),
        };
      });
      note('handoff', hand.flag === 'ok' && hand.ms > 0 && hand.ms <= 120, JSON.stringify(hand));
    } else {
      note('handoff', false, 'no rail');
    }
  }

  const play = page.locator('button.btn-xl').first();
  const playBox = await play.boundingBox();
  if (!playBox) {
    note('press', false, 'play button has no box');
    note('play-toggle', false, 'play button has no box');
  } else {
    // A scrub that still holds the pointer would eat this press. Release it, then
    // press a point on the button that is actually the hit target.
    await page.mouse.up();
    await page.waitForTimeout(150);
    const spot = await play.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const spots = [
        [box.left + box.width / 2, box.top + box.height / 2],
        [box.left + box.width / 2, box.top + 8],
        [box.left + 8, box.top + box.height / 2],
        [box.right - 8, box.top + box.height / 2],
        [box.left + box.width / 2, box.bottom - 8],
      ];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y, hit: '' };
      }
      const mid = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        hit: mid ? `${mid.tagName}.${String(mid.className).slice(0, 80)}` : 'none',
      };
    });
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.waitForTimeout(450);
    const held = await play.evaluate((el) => `${getComputedStyle(el).transform} inline=${el.style.transform}`);
    await page.mouse.up();
    const heldScale = matrixOf(held);
    note('press', !!heldScale && heldScale.a <= 0.94, spot.hit ? `${held} hit=${spot.hit}` : held);
    await page.waitForTimeout(250);
    const first = (await play.getAttribute('aria-label')) || '';
    await play.click();
    const mid = await page
      .waitForFunction(
        (prev) => {
          const now = document.querySelector('button.btn-xl')?.getAttribute('aria-label') || '';
          return now !== prev && (now === 'Пауза' || now === 'Воспроизвести');
        },
        first,
        { timeout: 2500 },
      )
      .then(() => play.getAttribute('aria-label'))
      .catch(() => '');
    await play.click();
    const end = await page
      .waitForFunction(
        (prev) => (document.querySelector('button.btn-xl')?.getAttribute('aria-label') || '') !== prev,
        mid,
        { timeout: 2500 },
      )
      .then(() => play.getAttribute('aria-label'))
      .catch(() => '');
    const known = (value) => value === 'Пауза' || value === 'Воспроизвести';
    note('play-toggle', known(first) && known(mid) && mid !== first && end === first, `${first} -> ${mid} -> ${end}`);
  }

  const intro = await introStage(page);
  note('intro-contrast', intro.ratio >= 4.5, JSON.stringify(intro));
  note('intro-engraving', intro.arts >= 1, JSON.stringify(intro));

  return out;
}

async function runDesign(browser) {
  const out = [];
  const note = (name, ok, detail) => {
    out.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  };

  const se = await browser.newContext({
    viewport: { width: 320, height: 568 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUa,
    colorScheme: 'light',
  });
  await se.addInitScript(stubMedia);
  const sePage = await se.newPage();
  await openSong(sePage);
  const seCard = await sePage.evaluate(noteCardInPage);
  note('se-note-card', !!seCard && seCard.ok, seCard ? seCard.why : 'missing');
  const seLine = await sePage.evaluate(() => {
    const orig = document.querySelector('.fb--line.is-current .fb-orig');
    const tr = document.querySelector('.fb--line.is-current .fb-tr');
    const card = document.querySelector('.note-card');
    const stage = document.querySelector('.scene-stage');
    if (!orig || !tr || !card || !stage) return null;
    const o = orig.getBoundingClientRect();
    const t = tr.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      origBottom: Math.round(o.bottom),
      trBottom: Math.round(t.bottom),
      cardTop: Math.round(c.top),
      stageBottom: Math.round(s.bottom),
      trH: Math.round(t.height),
      clear: o.bottom <= c.top - 1 && t.bottom <= c.top - 1 && t.bottom <= s.bottom + 1 && o.height > 8 && t.height > 8,
    };
  });
  note('se-line-clear', !!seLine && seLine.clear, seLine ? JSON.stringify(seLine) : 'missing');
  const title = await sePage.evaluate(() => {
    const song = document.querySelector('.topbar-song');
    const version = document.querySelector('.topbar-version');
    const who = document.querySelector('.topbar-who');
    return {
      text: song?.textContent ?? '',
      fits: !!song && song.scrollWidth <= song.clientWidth + 1,
      version: version ? getComputedStyle(version).display : 'missing',
      whoPx: who ? parseFloat(getComputedStyle(who).fontSize) : 0,
    };
  });
  note(
    'compact-title',
    title.fits && title.version === 'none' && title.whoPx >= 13 && title.text.length > 2,
    JSON.stringify(title),
  );
  const seClear = await chromeClear(sePage);
  note('se-chrome-clear', seClear.hits.length === 0, JSON.stringify(seClear));
  const lightInk = await sePage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dim-op').trim());
  note('light-dim', Number(lightInk) >= 0.7, lightInk);
  await se.close();

  const lightDesk = await browser.newContext({ ...desk, colorScheme: 'light' });
  const lightPage = await lightDesk.newPage();
  await openSong(lightPage);
  const blur = await lightPage.evaluate(() => {
    const node = document.querySelector('.fb--line:not(.is-current) .fb-orig');
    return node ? getComputedStyle(node).filter : 'missing';
  });
  note('desktop-blur', typeof blur === 'string' && blur.includes('blur'), blur);
  await lightDesk.close();

  const darkDesk = await browser.newContext({ ...desk, colorScheme: 'dark' });
  const darkPage = await darkDesk.newPage();
  await darkPage.goto(base + '/', { waitUntil: 'networkidle' });
  await darkPage.evaluate(() => document.fonts.ready);
  await darkPage.locator('.lib-hero .lg-edge').waitFor();
  const edge = await darkPage.evaluate(() => {
    const el = document.querySelector('.lib-hero .lg-edge');
    return el ? getComputedStyle(el).backgroundImage : 'missing';
  });
  note('dark-rim', edge === 'none', edge);
  await darkDesk.close();

  const land = await browser.newContext({
    viewport: { width: 852, height: 393 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUa,
    colorScheme: 'dark',
  });
  const landPage = await land.newPage();
  await openSong(landPage);
  const landClear = await chromeClear(landPage);
  note('landscape-chrome-clear', landClear.hits.length === 0, JSON.stringify(landClear));
  await landPage.locator('button[aria-label="Пояснение к этой строке"]').click();
  await landPage.waitForTimeout(400);
  const drawer = await landPage.evaluate(() => {
    const fold = document.querySelector('.player .comment.is-open .comment-fold');
    const comment = document.querySelector('.player .comment');
    const player = document.querySelector('.player');
    if (!fold || !comment || !player) return null;
    const f = fold.getBoundingClientRect();
    const c = comment.getBoundingClientRect();
    const p = player.getBoundingClientRect();
    return {
      position: getComputedStyle(fold).position,
      width: Math.round(f.width),
      vw: window.innerWidth,
      inDock: c.top >= p.top - 6 && c.bottom <= p.bottom + 12,
    };
  });
  note(
    'landscape-drawer',
    !!drawer && drawer.position === 'fixed' && drawer.width <= drawer.vw * 0.45 && drawer.width >= 120 && drawer.inDock,
    drawer ? JSON.stringify(drawer) : 'missing',
  );
  await land.close();

  const se375 = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUa,
    colorScheme: 'dark',
  });
  await se375.addInitScript(stubMedia);
  const se375Page = await se375.newPage();
  await openSong(se375Page);
  const se375Card = await se375Page.evaluate(noteCardInPage);
  note('se375-note-card', !!se375Card && se375Card.ok, se375Card ? se375Card.why : 'missing');
  await se375.close();

  const deskLib = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const deskLibPage = await deskLib.newPage();
  await deskLibPage.goto(base + '/', { waitUntil: 'networkidle' });
  await deskLibPage.evaluate(() => document.fonts.ready);
  const shelf = await deskLibPage.evaluate(() => {
    const row = document.querySelector('.lib-shelf');
    const cover = document.querySelector('.lib-row-cover');
    if (!row || !cover) return null;
    const box = row.getBoundingClientRect();
    const art = cover.getBoundingClientRect();
    return { bottom: Math.round(window.innerHeight - box.bottom), cover: Math.round(art.height) };
  });
  note('desk-posters', !!shelf && shelf.bottom < 48 && shelf.cover >= 180, shelf ? JSON.stringify(shelf) : 'missing');
  await deskLib.close();

  const columnNote = () => {
    const noteEl = document.querySelector('.comment.is-margin');
    const header = document.querySelector('.topbar');
    const stage = document.querySelector('.scene-stage');
    if (!noteEl || !header || !stage) return null;
    const n = noteEl.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      topDelta: Math.round(Math.abs(n.top - h.top) * 10) / 10,
      beside: n.left >= s.right - 4,
      headerLeft: Math.round(Math.abs(h.left - s.left) * 10) / 10,
      headerW: Math.round(Math.abs(h.width - s.width) * 10) / 10,
      noteH: Math.round(n.height),
      stageW: Math.round(s.width),
      vh: window.innerHeight,
    };
  };
  const columnOk = (box, minStage) =>
    !!box &&
    box.topDelta < 8 &&
    box.beside &&
    box.headerLeft < 4 &&
    box.headerW < 8 &&
    box.noteH > 48 &&
    box.noteH < box.vh * 0.72 &&
    box.stageW >= minStage;
  const deskSong = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const deskSongPage = await deskSong.newPage();
  await openSong(deskSongPage);
  const deskColumn = await deskSongPage.evaluate(columnNote);
  note('desk-note', columnOk(deskColumn, 800), deskColumn ? JSON.stringify(deskColumn) : 'missing');
  await deskSong.close();

  const wide = await browser.newContext({ viewport: { width: 2560, height: 1440 }, colorScheme: 'light' });
  const widePage = await wide.newPage();
  await openSong(widePage);
  const margin = await widePage.evaluate(columnNote);
  note('wide-note', columnOk(margin, 800) && !!margin && margin.stageW <= 920, margin ? JSON.stringify(margin) : 'missing');
  await wide.close();
  return out;
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

async function installStandIn(context, browserName) {
  const durations = songDurations();
  const cache = new Map();
  await installResolvedAudio(context, (url) => {
    const slug = /\/audio\/([^/]+)\//.exec(url)?.[1] || '';
    const seconds = durations[slug];
    if (!seconds) return null;
    const key = String(seconds);
    if (!cache.has(key)) cache.set(key, prepareAudio(seconds, 'work/studio/silence'));
    return cache.get(key);
  });
  if (browserName === 'webkit') await installWebKitClock(context, durations);
}

async function runPlayback(browser, browserName) {
  const out = [];
  const note = (name, ok, detail) => {
    out.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  };
  for (const [deviceName, device] of [
    ['phone', phone],
    ['desktop', desk],
  ]) {
    const context = await browser.newContext({ ...device, colorScheme: 'dark' });
    await installStandIn(context, browserName);
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('pageerror', browserName, deviceName, 'play', err.message));
    const prefix = `${browserName} ${deviceName}`;
    try {
      await openSong(page);
      const before = await page.evaluate(() => ({
        clock: document.querySelector('.scrub-now')?.textContent || '',
        line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' '),
      }));
      await page.locator('button.btn-xl').first().click();
      const playing = await page
        .waitForFunction(() => document.querySelector('button.btn-xl')?.getAttribute('aria-label') === 'Пауза', null, { timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      const drawn = await burstDrawn(page, 20);
      await page.waitForTimeout(5600);
      const after = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        const err = audio?.error;
        return {
          clock: document.querySelector('.scrub-now')?.textContent || '',
          line: [...document.querySelectorAll('.fb--line.is-current .w')].map((el) => (el.textContent || '').replace(/\u200b/g, '')).join(' '),
          label: document.querySelector('button.btn-xl')?.getAttribute('aria-label') || '',
          paused: audio?.paused ?? null,
          time: audio ? audio.currentTime : null,
          error: err ? err.code : 0,
        };
      });
      const clock = clockSeconds(after.clock) - clockSeconds(before.clock);
      const moved = normLine(after.line) !== normLine(before.line) && normLine(after.line).length > 0;
      const judge = judgeDrawn(drawn);
      note(
        `${prefix} play-advance`,
        playing && after.label === 'Пауза' && clock >= 3 && moved,
        `clock ${before.clock}->${after.clock} (${clock}) line ${moved} paused=${after.paused} t=${after.time} error=${after.error} glyph=${after.label}`,
      );
      note(`${prefix} drawn-play`, judge.ok, judge.detail);
    } catch (err) {
      note(`${prefix} play-advance`, false, String(err && err.message ? err.message : err).split('\n')[0]);
    }
    await context.close();
  }
  return out;
}

function normLine(value) {
  return String(value || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

const results = [];
const chrome = await chromium.launch();
const kit = await webkit.launch();

const only = args.only || '';
for (const [browserName, browser, deviceName, device] of [
  ['chromium', chrome, 'phone', phone],
  ['chromium', chrome, 'desktop', desk],
  ['webkit', kit, 'phone', phone],
  ['webkit', kit, 'desktop', desk],
].filter(([browserName, , deviceName]) => !only || only === `${browserName}-${deviceName}`)) {
  const context = await browser.newContext({ ...device, colorScheme: 'dark' });
  await context.addInitScript(stubMedia);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('pageerror', browserName, deviceName, err.message));
  try {
    results.push(...(await runCore(page, `${browserName} ${deviceName}`)));
  } catch (err) {
    const detail = String(err && err.stack ? err.stack : err);
    results.push({ name: `${browserName} ${deviceName} crash`, ok: false, detail });
    console.log(`FAIL ${browserName} ${deviceName} crash ${detail.split('\n')[0]}`);
  }
  await context.close();
}

async function runFirstPaint(browser, browserName) {
  const out = [];
  const note = (name, ok, detail) => {
    out.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  };
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'commit' });
    const shot = await page.screenshot({ type: 'png', animations: 'disabled' });
    const paint = await paintOf(shot);
    const target = scheme === 'dark' ? [7, 6, 12] : [239, 230, 218];
    const dist = nearToken(paint.rgb, target);
    note(
      `${browserName} first-paint-${scheme}`,
      paint.blackPct < 0.2 && dist < 48,
      `rgb=${paint.rgb.join(',')} black=${paint.blackPct.toFixed(3)} dist=${Math.round(dist)}`,
    );
    await context.close();
  }
  return out;
}

try {
  if (!only) results.push(...(await runDesign(chrome)));
  if (!only) {
    results.push(...(await runPlayback(chrome, 'chromium')));
    results.push(...(await runPlayback(kit, 'webkit')));
  }
} catch (err) {
  const detail = String(err && err.stack ? err.stack : err);
  results.push({ name: 'design crash', ok: false, detail });
  console.log(`FAIL design crash ${detail.split('\n')[0]}`);
}

try {
  if (!only) {
    results.push(...(await runFirstPaint(chrome, 'chromium')));
    results.push(...(await runFirstPaint(kit, 'webkit')));
  }
} catch (err) {
  const detail = String(err && err.stack ? err.stack : err);
  results.push({ name: 'first-paint crash', ok: false, detail });
  console.log(`FAIL first-paint crash ${detail.split('\n')[0]}`);
}

await chrome.close();
await kit.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const row of failed) console.log(`  - ${row.name}: ${row.detail}`);
  process.exit(1);
}
