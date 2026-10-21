/**
 * Shared pieces for the T27 iPhone memory runs.
 * Audio is a generated silent WAV of the song length: this machine has no AUDIO_KEY,
 * so the encrypted recording cannot be decrypted. Chromium plays that WAV.
 * Playwright WebKit on this host reports codecs and then errors on every payload,
 * so the recorder clocks that engine instead of letting the element fail.
 */
import { execFileSync } from 'node:child_process';
import { devices } from 'playwright';

export const PHONE = devices['iPhone 14 Pro'] ?? devices['iPhone 13'];

export function flag(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

/** Unsigned 8-bit mono WAV. Silence is 128. Duration is the song length, not a loop. */
export function wavSilence(seconds, rate = 8000) {
  const samples = Math.max(1, Math.ceil(seconds * rate));
  const dataBytes = samples;
  const buf = Buffer.alloc(44 + dataBytes, 128);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

/**
 * Silent WAV of the song length, served at the `.m4a` URL.
 * This Playwright Chromium has no AAC decoder (`canPlayType` of mp4a.40.2 is
 * empty) and still plays a WAV body on that URL. ffmpeg AAC, including the
 * Windows encoder, comes back as media error 4, so the banner stays up.
 */
export function prepareAudio(seconds, _outDir) {
  return {
    body: wavSilence(seconds),
    type: 'audio/wav',
    label: `generated silent WAV, 8 kHz 8-bit mono, ${seconds}s, served at the song m4a URL with Range`,
  };
}

/**
 * WebKit on this host rejects the silent WAV (media error 4) and then stays at t = 0.
 * The scene still has to move for an hour, so the stand-in clock advances `currentTime`
 * and hides the error flag. Chromium plays the file and must not use this.
 * A seek writes the setter, which rebases the clock.
 */
export async function installStandInClock(context, seconds) {
  await context.addInitScript((dur) => {
    Object.defineProperty(HTMLMediaElement.prototype, 'error', {
      configurable: true,
      get() {
        return null;
      },
    });
    // readyState 0 made every seek stick on `bridge`, so the scene froze until the
    // next seek and the hour never played. HAVE_ENOUGH_DATA lets the bridge clear.
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        return 4;
      },
    });
    // The clock used to advance even while the element stayed paused (native play()
    // rejects the WAV). A paused control then looked like playback. Time moves only
    // after play(), and pause() freezes it. The native decoder is never touched.
    let base = 0;
    let t0 = performance.now();
    let playing = false;
    const advance = () => {
      if (!playing) return base;
      let t = base + (performance.now() - t0) / 1000;
      if (t >= dur) {
        base = 0;
        t0 = performance.now();
        t = 0;
      }
      return t;
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return !playing;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return advance();
      },
      // Do not forward to the native setter. WebKit leaks a decode buffer on every
      // seek of the WAV fixture, which is not how a real recording behaves.
      set(v) {
        base = Math.max(0, Math.min(dur, Number(v) || 0));
        t0 = performance.now();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value() {
        if (!playing) {
          t0 = performance.now();
          playing = true;
        }
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value() {
        if (playing) {
          base = advance();
          playing = false;
          t0 = performance.now();
        }
        this.dispatchEvent(new Event('pause'));
      },
    });
  }, seconds);
}

/**
 * Playwright WebKit on this host cannot decode any payload (media error 4),
 * so a real file never reaches play. The element is not pointed at the URL:
 * that load is what raises the banner. Time, play and pause behave as they
 * would with a recording of `durations[slug]` seconds. Chromium plays the WAV
 * and must not use this.
 */
export async function installWebKitClock(context, durations) {
  await context.addInitScript((map) => {
    let src = '';
    let dur = 0;
    let base = 0;
    let t0 = performance.now();
    let playing = false;
    const secondsOf = (url) => {
      const slug = /\/audio\/([^/]+)\//.exec(String(url))?.[1] || '';
      const n = Number(map[slug]);
      return Number.isFinite(n) ? n : 0;
    };
    const advance = () => {
      if (!playing) return base;
      const t = base + (performance.now() - t0) / 1000;
      return dur > 0 ? Math.min(dur, t) : t;
    };
    const proto = HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get() {
        return src;
      },
      set(v) {
        src = String(v || '');
        dur = secondsOf(src);
        base = 0;
        playing = false;
        t0 = performance.now();
        if (!(dur > 0)) return;
        queueMicrotask(() => {
          this.dispatchEvent(new Event('loadedmetadata'));
          this.dispatchEvent(new Event('canplay'));
          this.dispatchEvent(new Event('canplaythrough'));
        });
      },
    });
    Object.defineProperty(proto, 'currentSrc', {
      configurable: true,
      get() {
        return src;
      },
    });
    Object.defineProperty(proto, 'error', {
      configurable: true,
      get() {
        return null;
      },
    });
    Object.defineProperty(proto, 'readyState', {
      configurable: true,
      get() {
        return src ? 4 : 0;
      },
    });
    Object.defineProperty(proto, 'networkState', {
      configurable: true,
      get() {
        return src ? 1 : 0;
      },
    });
    Object.defineProperty(proto, 'paused', {
      configurable: true,
      get() {
        return !playing;
      },
    });
    Object.defineProperty(proto, 'duration', {
      configurable: true,
      get() {
        return dur > 0 ? dur : Number.NaN;
      },
    });
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get() {
        return advance();
      },
      set(v) {
        base = Math.max(0, Math.min(dur || 0, Number(v) || 0));
        t0 = performance.now();
      },
    });
    proto.load = function load() {};
    proto.play = function play() {
      if (!playing) {
        t0 = performance.now();
        playing = true;
      }
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    proto.pause = function pause() {
      if (playing) {
        base = advance();
        playing = false;
        t0 = performance.now();
      }
      this.dispatchEvent(new Event('pause'));
    };
  }, durations);
}

async function fulfillAudio(route, body, type) {
  const req = route.request();
  if (req.method() === 'HEAD' || req.method() === 'OPTIONS') {
    await route.fulfill({
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': type,
        'Content-Length': String(body.length),
      },
      body: Buffer.alloc(0),
    });
    return;
  }
  const range = req.headers()['range'];
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? Math.min(body.length - 1, Number(m[1])) : 0;
    const end = m && m[2] ? Math.min(body.length - 1, Number(m[2])) : body.length - 1;
    const slice = body.subarray(start, end + 1);
    await route.fulfill({
      status: 206,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Content-Length': String(slice.length),
      },
      body: slice,
    });
    return;
  }
  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(body.length),
    },
    body,
  });
}

export async function installAudioRoute(context, body, type = 'audio/wav') {
  await installResolvedAudio(context, () => ({ body, type }));
}

/** `resolve` returns `{ body, type }` for a URL, or null to leave the request alone. */
export async function installResolvedAudio(context, resolve) {
  await context.route('**/*.{m4a,mp3,aac,wav,flac}', async (route) => {
    const audio = resolve(route.request().url());
    if (!audio) {
      await route.continue();
      return;
    }
    await fulfillAudio(route, audio.body, audio.type);
  });
}

export async function installProbe(context) {
  await context.addInitScript(() => {
    const counts = { add: 0, remove: 0 };
    const origAdd = EventTarget.prototype.addEventListener;
    const origRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      counts.add += 1;
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      counts.remove += 1;
      return origRemove.call(this, type, fn, opts);
    };
    window.__llListen = counts;
  });
}

export async function probe(page) {
  return page.evaluate(() => {
    // Only the layers that can blur or filter. Walking every element with
    // getComputedStyle on a 30s cadence retained WebKit backing stores and
    // looked like an application leak.
    const watched = document.querySelectorAll(
      '.glass, .glass--strong, .sheet, .ist-plate, .ist-chip, .btn-quiet, .flow-plate, .fb, .ist-art, .topbar, .player',
    );
    let blur = 0;
    let filter = 0;
    let will = 0;
    for (const el of watched) {
      const s = getComputedStyle(el);
      const backdrop = s.backdropFilter || s.webkitBackdropFilter || '';
      if (backdrop && backdrop !== 'none') blur += 1;
      if (s.filter && s.filter !== 'none') filter += 1;
      if (s.willChange && s.willChange !== 'auto') will += 1;
    }
    const all = document.getElementsByTagName('*');
    const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
      w: c.width,
      h: c.height,
      cssW: Math.round(c.getBoundingClientRect().width),
      cssH: Math.round(c.getBoundingClientRect().height),
    }));
    const listen = window.__llListen ?? { add: 0, remove: 0 };
    const q = (query) => matchMedia(query).matches;
    return {
      nodes: all.length,
      blur,
      filter,
      will,
      canvases,
      canvasPixels: canvases.reduce((sum, c) => sum + c.w * c.h, 0),
      listeners: listen.add - listen.remove,
      listenerAdds: listen.add,
      listenerRemoves: listen.remove,
      phone: document.documentElement.dataset.phone ?? '',
      media: {
        coarse: q('(hover: none) and (pointer: coarse)'),
        narrow: q('(max-width: 760px)'),
        phone: q('(hover: none) and (pointer: coarse) and (max-width: 1100px)'),
      },
      timeText: document.querySelector('.scrub-now')?.textContent ?? '',
      section: document.querySelector('.topbar-section')?.textContent ?? '',
      sheet: !!document.querySelector('[role="dialog"]'),
      audio: [...document.querySelectorAll('audio')].map((a) => ({
        t: a.currentTime,
        d: a.duration,
        paused: a.paused,
        ready: a.readyState,
        error: a.error ? a.error.code : 0,
      })),
    };
  });
}

export async function chromiumMetrics(cdp) {
  if (!cdp) return null;
  const { metrics } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const m of metrics) out[m.name] = m.value;
  return {
    jsHeapUsed: out.JSHeapUsedSize ?? null,
    jsHeapTotal: out.JSHeapTotalSize ?? null,
    nodes: out.Nodes ?? null,
    listeners: out.JSEventListeners ?? null,
    documents: out.Documents ?? null,
    layoutCount: out.LayoutCount ?? null,
    styleCount: out.RecalcStyleCount ?? null,
  };
}

/**
 * Working set of a process and every process it spawned, in bytes.
 * Node and the shell are left out: Playwright's browser is a grandchild of this script,
 * and `browser.process()` is not on the public Browser object.
 */
export function workingSetTree(rootPid) {
  if (!rootPid) return null;
  const script = [
    `$target = ${Number(rootPid)}`,
    '$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize',
    '$set = [System.Collections.Generic.HashSet[int]]::new()',
    '[void]$set.Add($target)',
    '$grow = $true',
    'while ($grow) {',
    '  $grow = $false',
    '  foreach ($p in $procs) {',
    '    $id = [int]$p.ProcessId',
    '    $parent = [int]$p.ParentProcessId',
    '    if ($set.Contains($parent) -and -not $set.Contains($id)) { [void]$set.Add($id); $grow = $true }',
    '  }',
    '}',
    '$sum = [int64]0; $all = [int64]0; $count = 0; $names = @{}',
    'foreach ($p in $procs) {',
    '  if (-not $set.Contains([int]$p.ProcessId)) { continue }',
    '  $all += [int64]$p.WorkingSetSize',
    '  $n = [string]$p.Name',
    "  if ($n -match '^(node|powershell|pwsh|cmd|conhost)') { continue }",
    '  $sum += [int64]$p.WorkingSetSize',
    '  $count++',
    '  if ($names.ContainsKey($n)) { $names[$n]++ } else { $names[$n] = 1 }',
    '}',
    'if ($count -eq 0) { $sum = $all; $count = $set.Count }',
    '$label = ($names.Keys | ForEach-Object { $_ + "=" + $names[$_] }) -join ","',
    'Write-Output ($sum.ToString() + " " + $count.ToString() + " " + $label)',
  ].join('; ');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 });
    const parts = out.trim().split(/\s+/);
    const bytes = Number(parts[0]);
    const processes = Number(parts[1]);
    if (!Number.isFinite(bytes)) return null;
    return { bytes, processes, names: parts.slice(2).join(' ') };
  } catch {
    return null;
  }
}

export function browserPid(browser) {
  try {
    const proc = typeof browser.process === 'function' ? browser.process() : null;
    return proc?.pid ?? null;
  } catch {
    return null;
  }
}

export function slopePerMin(rows, pick) {
  const pts = rows.map((row) => ({ x: row.tMin, y: pick(row) })).filter((p) => Number.isFinite(p.y));
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den ? num / den : 0;
}

export function phoneContext() {
  return {
    viewport: PHONE.viewport,
    userAgent: PHONE.userAgent,
    deviceScaleFactor: PHONE.deviceScaleFactor,
    isMobile: PHONE.isMobile,
    hasTouch: PHONE.hasTouch,
    locale: 'ru-RU',
    colorScheme: 'dark',
  };
}
