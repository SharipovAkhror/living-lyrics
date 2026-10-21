/**
 * Playback engine. One <audio> element, mounted so iOS keeps it when the screen locks.
 * Web Audio (EQ, preamp) is attached only while effects are on: on iPhone a live
 * AudioContext is suspended when the screen locks. Turning effects off swaps in a fresh,
 * unrouted element so background playback returns.
 * The audio session is `playback` (see background.ts). Hiding the page does not pause.
 * Without any audio file the engine runs a silent clock, so the Scene can still be previewed.
 */
import { coverMime, coverUrl, type CoverExt } from '@/data/covers';
import type { Peaks } from '@/data/schema';
import {
  RESUME_GUARD_MS,
  backgroundIntent,
  claimPlaybackSession,
  publishClock,
  wantsLiveAudioContext,
  type PageSignal,
} from './background';
import { EQ_FREQS } from './eq';
import { loadAudio, removeAudio, saveAudio } from './fileStore';
import { preloadMode, readNetHint, type PreloadMode } from './preload';

export type SourceKind = 'library' | 'local' | 'silent';

export interface EngineState {
  playing: boolean;
  source: SourceKind;
  localName?: string;
  duration: number;
  ready: boolean;
  error?: string;
  effects: boolean;
  /** The element has data ahead of the playhead, so a tap can start at once. */
  canPlay: boolean;
  /** Play was asked for and the element does not yet have data ahead. Honest wait, not a frozen icon. */
  buffering: boolean;
}

type Listener = () => void;

export interface EngineOptions {
  slug: string;
  title: string;
  artist: string;
  /** Lock screen and CarPlay album line: the version label (`song.version.label`), not the release title. */
  album?: string;
  duration: number;
  urls: { high?: string; saver?: string };
  gainDb?: number;
  /** Square files under public/covers. Omitted means the colour-field png. */
  coverExt?: CoverExt;
}

type SessionCarrier = Navigator & {
  audioSession?: { type?: string; state?: string; onstatechange: (() => void) | null };
};

export class AudioEngine {
  private el: HTMLAudioElement;
  private opts: EngineOptions;
  private listeners = new Set<Listener>();
  private localUrl: string | null = null;
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private quality: 'high' | 'saver' = 'high';
  /** What to put on the element the next time a source is attached. */
  private preload: PreloadMode = 'none';
  /** play() was called and has not reached audible playback yet. */
  private pendingPlay = false;
  private rate = 1;
  private volume = 1;
  private normalize = true;
  private eq = { bands: new Array(10).fill(0) as number[], preamp: 0 };

  // Smoothed clock: media currentTime advances in coarse steps on some browsers.
  private anchorMedia = 0;
  private anchorPerf = 0;
  private silentTime = 0;
  /** Last time handed to the scene. */
  private published = 0;
  private heldUntil = 0;
  private seeked = false;
  /** performance.now() until which a backward sample after wake is ignored. */
  private guardUntil = 0;
  /**
   * Media time to keep painting while a new element loads (quality change, equalizer off).
   * The fresh element starts at 0; painting that would rewind the stage.
   */
  private bridge: number | null = null;
  /**
   * A seek that arrived before the element had metadata. The load captured an older
   * time and would otherwise rewind to it when `loadedmetadata` fires.
   */
  private pendingSeek: number | null = null;

  state: EngineState;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.el = this.makeElement();
    this.state = {
      playing: false,
      source: 'silent',
      duration: opts.duration,
      ready: true,
      effects: false,
      canPlay: false,
      buffering: false,
    };
    this.bindPageLifecycle();
    this.bindAudioSession();
  }

  // ---------- lifecycle ----------

  async init(prefs: { quality: 'high' | 'saver'; rate: number; volume: number; normalize: boolean }) {
    this.quality = prefs.quality;
    this.rate = prefs.rate;
    this.volume = prefs.volume;
    this.normalize = prefs.normalize;
    const stored = await loadAudio(this.opts.slug);
    if (stored) {
      this.useLocal(stored.blob, stored.name);
    } else if (this.libraryUrl()) {
      this.setSource('library', this.libraryUrl()!);
    } else {
      this.patch({ source: 'silent', ready: true });
    }
    this.applyRate();
    this.applyVolume();
    this.setupMediaSession();
  }

  destroy() {
    this.unbindPageLifecycle();
    const session = (navigator as SessionCarrier).audioSession;
    try {
      if (session?.onstatechange === this.onSessionState) session.onstatechange = null;
    } catch {
      /* already gone with the page */
    }
    this.discard(this.el);
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    void this.ctx?.close();
    this.ctx = null;
    this.listeners.clear();
    if ('mediaSession' in navigator) {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) {
        try {
          navigator.mediaSession.setActionHandler(a, null);
        } catch {
          /* unsupported action */
        }
      }
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private patch(p: Partial<EngineState>) {
    const playingChanged = p.playing !== undefined && p.playing !== this.state.playing;
    this.state = { ...this.state, ...p };
    if (playingChanged) this.syncPlaybackState();
    this.listeners.forEach((l) => l());
  }

  /** Ignore events from an element we already replaced (equalizer teardown). */
  private listen(el: HTMLAudioElement, type: string, fn: () => void) {
    el.addEventListener(type, () => {
      if (el !== this.el) return;
      fn();
    });
  }

  private makeElement() {
    const el = new Audio();
    // Nothing is fetched until setSource applies the situational preload.
    el.preload = 'none';
    // Same-origin files do not need CORS. The attribute is set so the equalizer can
    // read the element later without reloading it.
    el.crossOrigin = 'anonymous';
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    this.listen(el, 'play', () => {
      this.resync();
      this.patch({ playing: true });
      this.syncBuffering();
    });
    this.listen(el, 'pause', () => {
      this.pendingPlay = false;
      this.resync();
      this.patch({ playing: false, buffering: false });
    });
    this.listen(el, 'seeked', () => this.resync());
    this.listen(el, 'timeupdate', () => this.resync());
    this.listen(el, 'ratechange', () => this.resync());
    this.listen(el, 'loadedmetadata', () => {
      if (Number.isFinite(el.duration) && el.duration > 0) this.patch({ duration: el.duration, ready: true, error: undefined });
      this.syncBuffering();
    });
    this.listen(el, 'waiting', () => this.syncBuffering());
    this.listen(el, 'stalled', () => this.syncBuffering());
    this.listen(el, 'canplay', () => {
      if (!this.state.canPlay) this.patch({ canPlay: true });
      this.syncBuffering();
    });
    this.listen(el, 'playing', () => {
      this.pendingPlay = false;
      this.syncBuffering();
    });
    this.listen(el, 'error', () => {
      // A seek that has not landed yet still has to paint. Dropping the bridge here rewinds a reload.
      if (this.pendingSeek == null) this.bridge = null;
      this.pendingPlay = false;
      if (this.state.source === 'silent') return;
      this.patch({ error: this.audioErrorMessage(), ready: false, buffering: false, canPlay: false });
    });
    this.listen(el, 'ended', () => this.patch({ playing: false, buffering: false }));
    this.mount(el);
    return el;
  }

  /** Keep the element in the document. A detached element is easier for iOS to drop on lock. */
  private mount(el: HTMLAudioElement) {
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none';
    const parent = document.body ?? document.documentElement;
    if (parent && el.parentNode !== parent) parent.appendChild(el);
  }

  private discard(el: HTMLAudioElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.remove();
  }

  private onVisibility = () => {
    this.applyPage(document.hidden ? 'hidden' : 'visible');
  };
  private onPageHide = () => this.applyPage('pagehide');
  private onPageShow = () => this.applyPage('pageshow');
  private onFreeze = () => this.applyPage('freeze');
  private onSessionState = () => {
    const session = (navigator as SessionCarrier).audioSession;
    // A phone call interrupts the session. When it returns, read the element.
    // Do not call play(): the system resumes a playback session itself.
    if (session?.state === 'active') this.resync();
  };

  private bindPageLifecycle() {
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('freeze', this.onFreeze);
  }

  private unbindPageLifecycle() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('freeze', this.onFreeze);
  }

  private bindAudioSession() {
    claimPlaybackSession(navigator);
    const session = (navigator as SessionCarrier).audioSession;
    if (!session) return;
    try {
      session.onstatechange = this.onSessionState;
    } catch {
      /* statechange is missing; waking the page still re-anchors the clock */
    }
  }

  /** Re-anchor when the page is shown again. Never pause, never start a second play. */
  private applyPage(signal: PageSignal) {
    if (backgroundIntent(signal) !== 'resync') return;
    this.guardUntil = performance.now() + RESUME_GUARD_MS;
    this.heldUntil = 0;
    this.resync();
  }

  private libraryUrl() {
    const { high, saver } = this.opts.urls;
    return this.quality === 'saver' ? saver ?? high : high ?? saver;
  }

  private setSource(kind: SourceKind, url: string, localName?: string) {
    const t = this.rawTime();
    const wasPlaying = this.state.playing;
    if (t > 0.05) this.bridge = t;
    const el = this.el;
    // Hint first. Setting src with preload=none does not fetch; load() does, even then.
    el.preload = this.preload;
    el.src = url;
    const restore = () => {
      this.placeRestoredTime(el, t);
      if (el !== this.el) return;
      if (wasPlaying) void el.play().catch(() => this.patch({ playing: false }));
    };
    el.addEventListener('loadedmetadata', restore, { once: true });
    if (this.preload !== 'none') el.load();
    this.patch({ source: kind, localName, ready: false, error: undefined, canPlay: false, buffering: false });
  }

  /**
   * Change how far ahead the open recording is fetched. Does not reload a song
   * that is already playing: a reload would drop the lock-screen session.
   */
  setPreload(mode: PreloadMode) {
    this.preload = mode;
    if (this.el.preload === mode) return;
    this.el.preload = mode;
    if (mode !== 'auto' || this.state.source === 'silent' || !this.el.src || this.state.playing) return;
    // A metadata load that already finished will not grow by itself. Ask again only at the start.
    if (this.el.readyState < 3 && this.el.currentTime < 0.05 && this.el.networkState === 0) this.el.load();
  }

  /** Load the current recording again. Playback stays paused until the reader taps. */
  retry() {
    this.pendingPlay = false;
    if (this.state.source === 'local' && this.localUrl) {
      this.setSource('local', this.localUrl, this.state.localName);
      return;
    }
    const lib = this.libraryUrl();
    if (lib) {
      this.setPreload(preloadMode('play', readNetHint(navigator)));
      this.setSource('library', lib);
      return;
    }
    this.patch({ error: 'Нет записи для этой песни.', ready: false, buffering: false });
  }

  private audioErrorMessage() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Нет сети. Проверьте соединение и повторите.';
    return 'Не удалось загрузить запись.';
  }

  /** Buffering is true only while sound was asked for and the element has nothing ahead of the playhead. */
  private syncBuffering() {
    const el = this.el;
    const asked = this.pendingPlay || (this.state.playing && !el.paused);
    const on = this.state.source !== 'silent' && asked && el.readyState < 3 && !el.error;
    if (on === this.state.buffering) return;
    this.patch({ buffering: on });
  }

  private useLocal(blob: Blob, name: string) {
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    this.localUrl = URL.createObjectURL(blob);
    this.setSource('local', this.localUrl, name);
  }

  async attachFile(file: File) {
    if (!file.type.startsWith('audio/') && !/\.(m4a|mp3|aac|wav|flac|ogg|opus|webm|caf|aiff?)$/i.test(file.name)) {
      throw new Error('Это не аудиофайл.');
    }
    const probe = document.createElement('audio');
    if (file.type && probe.canPlayType(file.type) === '') {
      throw new Error('Этот браузер не умеет играть такой формат. Подойдут m4a (AAC), mp3, wav; FLAC и Opus — не везде.');
    }
    this.useLocal(file, file.name);
    await saveAudio(this.opts.slug, file);
  }

  async detachFile() {
    await removeAudio(this.opts.slug);
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    this.localUrl = null;
    const lib = this.libraryUrl();
    if (lib) this.setSource('library', lib);
    else {
      this.bridge = null;
      this.pendingSeek = null;
      this.el.removeAttribute('src');
      this.el.load();
      this.patch({ source: 'silent', localName: undefined, ready: true, playing: false, duration: this.opts.duration });
    }
  }

  /**
   * Decodes the current local file and computes a loudness envelope (used by the Scene when no peaks.json exists).
   * Offline: a live AudioContext here would join the output device and can stop the song on lock.
   */
  async computePeaks(rate = 20): Promise<Peaks | null> {
    if (this.state.source !== 'local' || !this.localUrl) return null;
    try {
      const buf = await (await fetch(this.localUrl)).arrayBuffer();
      const host = window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
      const Offline = window.OfflineAudioContext || host.webkitOfflineAudioContext;
      if (!Offline) return null;
      const ctx = new Offline(1, 1, 44100);
      const audio = await ctx.decodeAudioData(buf.slice(0));
      return envelope(audio, rate);
    } catch {
      return null;
    }
  }

  // ---------- transport ----------

  get playing() {
    return this.state.playing;
  }

  /** Time the scene and the scrubber paint. Does not seek the element. */
  currentTime(): number {
    const decision = publishClock({
      raw: this.rawTime(),
      published: this.published,
      heldUntil: this.heldUntil,
      now: performance.now(),
      seeked: this.seeked,
      guarding: performance.now() < this.guardUntil,
    });
    this.seeked = false;
    this.published = decision.published;
    this.heldUntil = decision.heldUntil;
    return decision.time;
  }

  /** Put a just-loaded element back on the seek the reader asked for, not the time captured when the load started. */
  private placeRestoredTime(el: HTMLAudioElement, captured: number) {
    if (el !== this.el) return;
    const target = this.pendingSeek != null ? this.pendingSeek : captured;
    if (target > 0.05) {
      try {
        el.currentTime = target;
      } catch {
        /* currentTime before metadata throws on some browsers; pendingSeek retries on the next event */
      }
    }
    if (this.pendingSeek != null) {
      const stuck = el.readyState >= 1 && Math.abs(el.currentTime - this.pendingSeek) < 0.75;
      if (stuck) this.pendingSeek = null;
      else this.bridge = this.pendingSeek;
    }
    this.noteSeek();
    this.applyRate();
    this.resync();
  }

  /**
   * The element's clock, or null when asking again would be pointless.
   * A failed element (the iPhone reload was fed by polling `currentTime` on one)
   * stays on the last published time instead of being queried every frame.
   */
  private mediaTime(): number | null {
    if (this.el.error) return null;
    try {
      return this.el.currentTime;
    } catch {
      return null;
    }
  }

  private rawTime(): number {
    const live = this.mediaTime();
    if (this.pendingSeek != null && live != null && this.el.readyState >= 1 && Math.abs(live - this.pendingSeek) < 0.75) {
      this.pendingSeek = null;
    }
    if (this.bridge != null && this.state.source !== 'silent') {
      const caughtUp = live != null && this.el.readyState >= 1 && Math.abs(live - this.bridge) < 0.75;
      if (!caughtUp) return this.bridge;
      this.bridge = null;
    }
    if (this.state.source === 'silent') {
      if (!this.state.playing) return this.silentTime;
      const t = this.silentTime + ((performance.now() - this.anchorPerf) / 1000) * this.rate;
      return Math.min(t, this.state.duration);
    }
    if (live == null) return this.pendingSeek ?? this.published;
    if (this.el.paused) return live;
    const predicted = this.anchorMedia + ((performance.now() - this.anchorPerf) / 1000) * this.el.playbackRate;
    // Never drift more than 120 ms from the element.
    return Math.abs(predicted - live) > 0.12 ? live : predicted;
  }

  private resync() {
    this.anchorMedia = this.state.source === 'silent' ? this.silentTime : this.el.currentTime;
    this.anchorPerf = performance.now();
    this.updatePositionState();
  }

  private noteSeek() {
    this.seeked = true;
    this.heldUntil = 0;
    this.guardUntil = 0;
  }

  async play() {
    claimPlaybackSession(navigator);
    if (this.state.source === 'silent') {
      if (this.silentTime >= this.state.duration - 0.05) this.silentTime = 0;
      this.anchorPerf = performance.now();
      this.patch({ playing: true, buffering: false });
      this.tickSilent();
      return;
    }
    // Stream from the first buffered seconds. preload=auto does not mean "download the file, then start".
    this.setPreload('auto');
    this.pendingPlay = true;
    this.syncBuffering();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    try {
      await this.el.play();
    } catch {
      this.pendingPlay = false;
      this.syncBuffering();
      this.patch({ playing: false });
    }
  }

  private silentTimer = 0;
  private tickSilent() {
    cancelAnimationFrame(this.silentTimer);
    const loop = () => {
      if (!this.state.playing || this.state.source !== 'silent') return;
      if (this.currentTime() >= this.state.duration) {
        this.silentTime = this.state.duration;
        this.patch({ playing: false });
        return;
      }
      this.silentTimer = requestAnimationFrame(loop);
    };
    this.silentTimer = requestAnimationFrame(loop);
  }

  pause() {
    if (this.state.source === 'silent') {
      this.silentTime = this.rawTime();
      this.patch({ playing: false });
      return;
    }
    this.el.pause();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.state.duration - 0.05));
    this.noteSeek();
    if (this.state.source === 'silent') {
      this.bridge = null;
      this.pendingSeek = null;
      this.silentTime = clamped;
      this.anchorPerf = performance.now();
      this.listeners.forEach((l) => l());
      return;
    }
    this.pendingSeek = clamped;
    try {
      this.el.currentTime = clamped;
    } catch {
      /* ignored until metadata; pendingSeek is applied from loadedmetadata */
    }
    // A reload may ignore the write until metadata arrives. Keep painting the requested time.
    const stuck = this.el.readyState >= 1 && Math.abs(this.el.currentTime - clamped) < 0.75;
    if (stuck) {
      this.pendingSeek = null;
      this.bridge = null;
    } else {
      this.bridge = clamped;
    }
    this.resync();
    this.syncBuffering();
  }

  skip(delta: number) {
    this.seek(this.rawTime() + delta);
  }

  setRate(rate: number) {
    if (this.state.source === 'silent' && this.state.playing) {
      this.silentTime = this.rawTime();
      this.anchorPerf = performance.now();
    }
    this.rate = rate;
    this.applyRate();
  }

  private applyRate() {
    this.el.playbackRate = this.rate;
    this.el.preservesPitch = true;
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }

  setNormalize(on: boolean) {
    this.normalize = on;
    this.applyVolume();
  }

  /** Loudness normalisation: attenuation through element volume; boosts only when the Web Audio graph exists. */
  private applyVolume() {
    const gainDb = this.normalize ? this.opts.gainDb ?? 0 : 0;
    const lin = Math.pow(10, gainDb / 20);
    if (this.preamp) {
      this.el.volume = this.volume;
      this.preamp.gain.value = lin * Math.pow(10, this.eq.preamp / 20);
    } else {
      this.el.volume = Math.max(0, Math.min(1, this.volume * Math.min(1, lin)));
    }
  }

  setQuality(q: 'high' | 'saver') {
    if (q === this.quality) return;
    this.quality = q;
    if (this.state.source === 'library' && this.libraryUrl()) this.setSource('library', this.libraryUrl()!);
  }

  // ---------- effects ----------

  setEffects(on: boolean, bands: number[], preamp: number) {
    this.eq = { bands, preamp };
    if (wantsLiveAudioContext(on, this.state.source) && !this.ctx) this.buildGraph();
    if (!on && this.ctx) this.teardownGraph();
    this.applyEq();
    this.patch({ effects: on && !!this.ctx });
    claimPlaybackSession(navigator);
  }

  private buildGraph() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(this.el);
    const preamp = ctx.createGain();
    const filters = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.41;
      return b;
    });
    src.connect(preamp);
    let node: AudioNode = preamp;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.preamp = preamp;
    this.filters = filters;
    this.applyVolume();
  }

  /** Swap to a fresh element that is not routed through Web Audio (restores lock-screen playback on iOS). */
  private teardownGraph() {
    const t = this.rawTime();
    const wasPlaying = this.state.playing;
    this.bridge = t;
    const src = this.el.src;
    const old = this.el;
    void this.ctx?.close();
    this.ctx = null;
    this.preamp = null;
    this.filters = [];
    this.el = this.makeElement();
    old.pause();
    old.removeAttribute('src');
    old.load();
    old.remove();
    const el = this.el;
    el.src = src;
    el.addEventListener(
      'loadedmetadata',
      () => {
        this.placeRestoredTime(el, t);
        if (el !== this.el) return;
        this.applyVolume();
        if (wasPlaying) void el.play();
      },
      { once: true },
    );
    el.load();
  }

  private applyEq() {
    this.filters.forEach((f, i) => (f.gain.value = this.eq.bands[i] ?? 0));
    this.applyVolume();
  }

  // ---------- Media Session (lock screen, CarPlay, headphones, Control Center) ----------

  onLineNav: ((dir: -1 | 1) => void) | null = null;

  private artwork(): MediaImage[] {
    const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : '';
    const url = (path: string) => (origin ? `${origin}${path}` : path);
    const ext: CoverExt = this.opts.coverExt === 'jpg' ? 'jpg' : 'png';
    const cover = (size: number) => ({
      src: url(coverUrl(this.opts.slug, size, ext)),
      sizes: `${size}x${size}`,
      type: coverMime(ext),
    });
    // The song square first. The site icon stays, for a player that cannot load the file.
    return [
      cover(1024),
      cover(512),
      cover(192),
      cover(96),
      { src: url('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: url('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
    ];
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata !== 'function') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.opts.title,
      artist: this.opts.artist,
      // Album on the lock screen and in CarPlay is the version, so two concerts of one song stay distinct.
      album: this.opts.album ?? '',
      artwork: this.artwork(),
    });
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(a, h);
      } catch {
        /* unsupported */
      }
    };
    set('play', () => void this.play());
    set('pause', () => this.pause());
    set('seekbackward', (d) => this.skip(-(d.seekOffset ?? 10)));
    set('seekforward', (d) => this.skip(d.seekOffset ?? 10));
    set('seekto', (d) => {
      if (d.seekTime != null) this.seek(d.seekTime);
    });
    set('previoustrack', () => this.onLineNav?.(-1));
    set('nexttrack', () => this.onLineNav?.(1));
    this.syncPlaybackState();
  }

  private syncPlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.state.playing ? 'playing' : 'paused';
    } catch {
      /* playbackState is missing on older Safari */
    }
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.state.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const position = Math.min(d, Math.max(0, this.state.source === 'silent' ? this.silentTime : this.el.currentTime));
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.el.playbackRate || this.rate || 1,
        position,
      });
    } catch {
      /* position out of range during source switch */
    }
  }
}

function envelope(audio: AudioBuffer, rate: number): Peaks {
  const ch = audio.getChannelData(0);
  const hop = Math.max(1, Math.floor(audio.sampleRate / rate));
  const rms: number[] = [];
  let max = 0;
  for (let i = 0; i < ch.length; i += hop) {
    let s = 0;
    const end = Math.min(ch.length, i + hop);
    for (let j = i; j < end; j++) s += ch[j] * ch[j];
    const v = Math.sqrt(s / Math.max(1, end - i));
    rms.push(v);
    if (v > max) max = v;
  }
  return { rate, duration: audio.duration, rms: rms.map((v) => (max ? +(v / max).toFixed(3) : 0)) };
}
