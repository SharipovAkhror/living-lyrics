/**
 * Run: npx tsx src/player/background.test.ts
 * Lock-screen policy: the default path never builds a live AudioContext,
 * and hiding the page never calls pause() or a second play().
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACK_HOLD_MS,
  RESUME_GUARD_MS,
  backgroundIntent,
  publishClock,
  wantsLiveAudioContext,
  type PageSignal,
} from './background';

const SIGNALS: PageSignal[] = ['hidden', 'visible', 'pagehide', 'pageshow', 'freeze'];

function testPolicy() {
  for (const signal of SIGNALS) {
    const intent = backgroundIntent(signal);
    assert.ok(intent === 'none' || intent === 'resync');
    assert.notEqual(intent, 'pause');
    assert.notEqual(intent, 'play');
  }
  assert.equal(backgroundIntent('hidden'), 'none');
  assert.equal(backgroundIntent('pagehide'), 'none');
  assert.equal(backgroundIntent('freeze'), 'none');
  assert.equal(backgroundIntent('visible'), 'resync');
  assert.equal(backgroundIntent('pageshow'), 'resync');

  assert.equal(wantsLiveAudioContext(false, 'library'), false);
  assert.equal(wantsLiveAudioContext(false, 'local'), false);
  assert.equal(wantsLiveAudioContext(true, 'silent'), false);
  assert.equal(wantsLiveAudioContext(true, 'library'), true);

  const forward = publishClock({ raw: 40, published: 5, heldUntil: 0, now: 1000, seeked: false, guarding: true });
  assert.equal(forward.time, 40);

  const held = publishClock({ raw: 12, published: 40, heldUntil: 0, now: 1000, seeked: false, guarding: true });
  assert.equal(held.time, 40);
  assert.equal(held.heldUntil, 1000 + BACK_HOLD_MS);

  const still = publishClock({ raw: 12, published: 40, heldUntil: held.heldUntil, now: 1000 + BACK_HOLD_MS - 1, seeked: false, guarding: true });
  assert.equal(still.time, 40);

  const giveUp = publishClock({ raw: 12, published: 40, heldUntil: held.heldUntil, now: 1000 + BACK_HOLD_MS, seeked: false, guarding: true });
  assert.equal(giveUp.time, 12);

  const sought = publishClock({ raw: 8, published: 40, heldUntil: 0, now: 1000, seeked: true, guarding: true });
  assert.equal(sought.time, 8);

  const normal = publishClock({ raw: 12, published: 40, heldUntil: 0, now: 1000, seeked: false, guarding: false });
  assert.equal(normal.time, 12);

  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /navigator\.audioSession/);
  assert.match(html, /session\.type = 'playback'/);
  assert.match(html, /playsinline|apple-mobile-web-app-capable/);

  const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8')) as {
    display: string;
    categories: string[];
  };
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.categories.includes('music'));
}

type Fn = () => void;

class FakeAudio {
  static all: FakeAudio[] = [];
  preload = '';
  crossOrigin: string | null = null;
  src = '';
  currentTime = 0;
  duration = 120;
  paused = true;
  playbackRate = 1;
  volume = 1;
  preservesPitch = true;
  readyState = 0;
  plays = 0;
  pauses = 0;
  parent: unknown = null;
  style = { cssText: '' };
  attrs: Record<string, string> = {};
  private listeners = new Map<string, Set<Fn>>();

  constructor() {
    FakeAudio.all.push(this);
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
    if (name === 'src') this.src = '';
  }
  addEventListener(type: string, fn: Fn) {
    const set = this.listeners.get(type) ?? new Set<Fn>();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: Fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  load() {}
  play() {
    this.plays += 1;
    this.paused = false;
    this.readyState = 4;
    this.emit('play');
    return Promise.resolve();
  }
  pause() {
    this.pauses += 1;
    this.paused = true;
    this.emit('pause');
  }
  remove() {
    this.parent = null;
  }
}

function installDom() {
  FakeAudio.all = [];
  let liveContexts = 0;
  const docListeners = new Map<string, Set<Fn>>();
  const winListeners = new Map<string, Set<Fn>>();
  const body = {
    appendChild(el: FakeAudio) {
      el.parent = body;
    },
  };
  const documentMock = {
    hidden: false,
    body,
    documentElement: body,
    addEventListener(type: string, fn: Fn) {
      const set = docListeners.get(type) ?? new Set<Fn>();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type: string, fn: Fn) {
      docListeners.get(type)?.delete(fn);
    },
    createElement() {
      return new FakeAudio();
    },
  };
  const windowMock = {
    AudioContext: class {
      state = 'running';
      destination = {};
      constructor() {
        liveContexts += 1;
      }
      createMediaElementSource() {
        return { connect() {} };
      }
      createGain() {
        return { gain: { value: 1 }, connect() {} };
      }
      createBiquadFilter() {
        return { type: 'peaking', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect() {} };
      }
      close() {
        return Promise.resolve();
      }
      resume() {
        return Promise.resolve();
      }
    },
    addEventListener(type: string, fn: Fn) {
      const set = winListeners.get(type) ?? new Set<Fn>();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener(type: string, fn: Fn) {
      winListeners.get(type)?.delete(fn);
    },
  };
  const media = {
    metadata: null as { init: { title: string; artist: string; album: string; artwork: { src: string; sizes: string }[] } } | null,
    playbackState: 'none',
    setActionHandler() {},
    setPositionState() {},
  };
  const nav = {
    audioSession: { type: 'auto', state: 'active', onstatechange: null as Fn | null },
    mediaSession: media,
  };
  class Metadata {
    init: { title: string; artist: string; album: string; artwork: { src: string; sizes: string }[] };
    constructor(init: Metadata['init']) {
      this.init = init;
      media.metadata = this;
    }
  }
  const g = globalThis as unknown as {
    window: typeof windowMock;
    document: typeof documentMock;
    Audio: typeof FakeAudio;
    MediaMetadata: typeof Metadata;
    location: { origin: string };
  };
  g.window = windowMock;
  g.document = documentMock;
  g.Audio = FakeAudio;
  g.MediaMetadata = Metadata;
  g.location = { origin: 'https://example.test' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  return {
    documentMock,
    nav,
    media,
    liveContexts: () => liveContexts,
    fireDoc(type: string) {
      for (const fn of [...(docListeners.get(type) ?? [])]) fn();
    },
    fireWin(type: string) {
      for (const fn of [...(winListeners.get(type) ?? [])]) fn();
    },
  };
}

async function testEngine() {
  let clock = 1000;
  const clockProto = Object.getPrototypeOf(performance) as { now: () => number };
  const now = clockProto.now;
  clockProto.now = () => clock;
  try {
    const env = installDom();
    const { AudioEngine } = await import('./engine');
    const engine = new AudioEngine({
      slug: 'karitas',
      title: 'Karitas',
      artist: 'Sami Yusuf',
      album: 'Karitas',
      duration: 977,
      urls: { high: '/audio/karitas/high.m4a' },
      gainDb: -2,
      coverExt: 'jpg',
    });
    assert.equal(env.nav.audioSession.type, 'playback');
    assert.equal(env.liveContexts(), 0);

    const el = FakeAudio.all[0];
    assert.equal(el.attrs.playsinline, '');
    assert.equal(el.attrs['webkit-playsinline'], '');
    assert.equal(el.parent, env.documentMock.body);

    await engine.init({ quality: 'high', rate: 1, volume: 1, normalize: true });
    assert.equal(engine.state.source, 'library');
    assert.equal(engine.state.effects, false);
    assert.equal(env.liveContexts(), 0, 'default playback must not construct AudioContext');

    el.currentTime = 5;
    await engine.play();
    assert.equal(el.plays, 1);
    assert.equal(el.pauses, 0);
    assert.equal(engine.state.playing, true);
    assert.equal(env.media.playbackState, 'playing');
    assert.equal(env.media.metadata?.init.title, 'Karitas');
    assert.equal(env.media.metadata?.init.artist, 'Sami Yusuf');
    assert.equal(env.media.metadata?.init.album, 'Karitas');
    assert.ok(env.media.metadata?.init.artwork.some((item) => item.src === 'https://example.test/covers/karitas/512.jpg'));
    assert.ok(env.media.metadata?.init.artwork.some((item) => item.src === 'https://example.test/icons/icon-512.png'));

    env.documentMock.hidden = true;
    env.fireDoc('visibilitychange');
    env.fireWin('pagehide');
    env.fireDoc('freeze');
    assert.equal(el.pauses, 0, 'hiding the page called pause()');
    assert.equal(el.plays, 1, 'hiding the page started playback again');
    assert.equal(engine.state.playing, true);

    el.currentTime = 40;
    clock = 1000 + RESUME_GUARD_MS;
    env.documentMock.hidden = false;
    env.fireDoc('visibilitychange');
    const caught = engine.currentTime();
    assert.ok(caught >= 39.5, `scene clock ${caught} did not catch the element at 40`);
    assert.equal(el.plays, 1, 'waking the page must not start a second playback');
    assert.equal(el.pauses, 0);

    el.currentTime = 12;
    clock += 200;
    const held = engine.currentTime();
    assert.ok(held >= 39.5, `scene rewound to ${held}`);

    el.currentTime = 41;
    clock += 400;
    const followed = engine.currentTime();
    assert.ok(followed >= 40.5, `scene did not follow the element forward: ${followed}`);

    engine.seek(15);
    const sought = engine.currentTime();
    assert.ok(Math.abs(sought - 15) < 0.25, `seek landed on ${sought}`);

    await engine.computePeaks();
    assert.equal(env.liveContexts(), 0, 'peaks on a library file must not construct AudioContext');

    engine.setEffects(true, new Array(10).fill(0), 0);
    assert.equal(env.liveContexts(), 1);
    assert.equal(engine.state.effects, true);
    assert.equal(env.nav.audioSession.type, 'playback');

    engine.setEffects(false, new Array(10).fill(0), 0);
    assert.equal(env.liveContexts(), 1, 'turning effects off must not build another live context');
    assert.equal(engine.state.effects, false);
    assert.equal(FakeAudio.all.length, 2);
    const during = engine.currentTime();
    assert.ok(Math.abs(during - 15) < 0.75, `stage rewound while the element was replaced: ${during}`);
    FakeAudio.all[1].emit('loadedmetadata');
    assert.equal(FakeAudio.all[0].paused, true);
    assert.equal(FakeAudio.all[1].paused, false);
    assert.equal(FakeAudio.all[1].plays, 1);
    assert.equal(FakeAudio.all[0].plays, 1);

    env.documentMock.hidden = true;
    env.fireDoc('visibilitychange');
    env.fireDoc('freeze');
    assert.equal(FakeAudio.all[1].pauses, 0, 'the replacement element was paused in the background');
    assert.equal(engine.state.playing, true);

    engine.destroy();
  } finally {
    clockProto.now = now;
  }
}

/** A seek before metadata must survive the load's restore, which captured time 0. */
async function testPendingSeek() {
  installDom();
  const { AudioEngine } = await import('./engine');
  const engine = new AudioEngine({
    slug: 'karitas',
    title: 'Karitas',
    artist: 'Sami Yusuf',
    album: 'Karitas',
    duration: 977,
    urls: { high: '/audio/karitas/high.m4a' },
  });
  await engine.init({ quality: 'high', rate: 1, volume: 1, normalize: false });
  const el = FakeAudio.all[FakeAudio.all.length - 1];
  engine.seek(40);
  // The element dropped the write, the way a browser does before it has metadata.
  el.currentTime = 0;
  el.readyState = 0;
  el.emit('loadedmetadata');
  assert.ok(Math.abs(el.currentTime - 40) < 0.25, `element restored ${el.currentTime}`);
  const shown = engine.currentTime();
  assert.ok(Math.abs(shown - 40) < 0.25, `scene restored ${shown}`);
  engine.destroy();
}

testPolicy();
await testEngine();
await testPendingSeek();
console.log('player background: ok');
