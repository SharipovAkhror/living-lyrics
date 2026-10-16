/**
 * Playback engine. One <audio> element; a Web Audio graph (EQ, preamp, gain) is attached only
 * while effects are on, because on iPhone audio routed through Web Audio stops when the screen
 * locks. Turning effects off swaps in a fresh, unrouted element so background playback returns.
 * Without any audio file the engine runs a silent clock, so the Scene can still be previewed.
 */
import { EQ_FREQS } from './eq';
import { loadAudio, saveAudio, removeAudio } from './fileStore';
import type { Peaks } from '@/data/schema';

export type SourceKind = 'library' | 'local' | 'silent';

export interface EngineState {
  playing: boolean;
  source: SourceKind;
  localName?: string;
  duration: number;
  ready: boolean;
  error?: string;
  effects: boolean;
}

type Listener = () => void;

export interface EngineOptions {
  slug: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  urls: { high?: string; saver?: string };
  gainDb?: number;
}

export class AudioEngine {
  private el: HTMLAudioElement;
  private opts: EngineOptions;
  private listeners = new Set<Listener>();
  private localUrl: string | null = null;
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private quality: 'high' | 'saver' = 'high';
  private rate = 1;
  private volume = 1;
  private normalize = true;
  private eq = { bands: new Array(10).fill(0) as number[], preamp: 0 };

  // Smoothed clock: media currentTime advances in coarse steps on some browsers.
  private anchorMedia = 0;
  private anchorPerf = 0;
  private silentTime = 0;

  state: EngineState;

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.el = this.makeElement();
    this.state = { playing: false, source: 'silent', duration: opts.duration, ready: true, effects: false };
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
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    void this.ctx?.close();
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
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private makeElement() {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.setAttribute('playsinline', '');
    el.addEventListener('play', () => {
      this.resync();
      this.patch({ playing: true });
    });
    el.addEventListener('pause', () => {
      this.resync();
      this.patch({ playing: false });
    });
    el.addEventListener('seeked', () => this.resync());
    el.addEventListener('timeupdate', () => this.resync());
    el.addEventListener('ratechange', () => this.resync());
    el.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(el.duration) && el.duration > 0) this.patch({ duration: el.duration, ready: true, error: undefined });
    });
    el.addEventListener('error', () => {
      if (this.state.source === 'silent') return;
      this.patch({ error: 'Не удалось загрузить аудио.', ready: false });
    });
    el.addEventListener('ended', () => this.patch({ playing: false }));
    return el;
  }

  private libraryUrl() {
    const { high, saver } = this.opts.urls;
    return this.quality === 'saver' ? saver ?? high : high ?? saver;
  }

  private setSource(kind: SourceKind, url: string, localName?: string) {
    const t = this.currentTime();
    const wasPlaying = this.state.playing;
    this.el.src = url;
    this.el.load();
    const restore = () => {
      if (t > 0) this.el.currentTime = t;
      this.applyRate();
      if (wasPlaying) void this.el.play().catch(() => this.patch({ playing: false }));
    };
    this.el.addEventListener('loadedmetadata', restore, { once: true });
    this.patch({ source: kind, localName, ready: false, error: undefined });
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
      this.el.removeAttribute('src');
      this.el.load();
      this.patch({ source: 'silent', localName: undefined, ready: true, playing: false, duration: this.opts.duration });
    }
  }

  /** Decodes the current local file and computes a loudness envelope (used by the Scene when no peaks.json exists). */
  async computePeaks(rate = 20): Promise<Peaks | null> {
    if (this.state.source !== 'local' || !this.localUrl) return null;
    try {
      const buf = await (await fetch(this.localUrl)).arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const audio = await ctx.decodeAudioData(buf);
      void ctx.close();
      const ch = audio.getChannelData(0);
      const hop = Math.floor(audio.sampleRate / rate);
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
    } catch {
      return null;
    }
  }

  // ---------- transport ----------

  get playing() {
    return this.state.playing;
  }

  currentTime(): number {
    if (this.state.source === 'silent') {
      if (!this.state.playing) return this.silentTime;
      const t = this.silentTime + ((performance.now() - this.anchorPerf) / 1000) * this.rate;
      return Math.min(t, this.state.duration);
    }
    if (this.el.paused) return this.el.currentTime;
    const predicted = this.anchorMedia + ((performance.now() - this.anchorPerf) / 1000) * this.el.playbackRate;
    // Never drift more than 120 ms from the element.
    return Math.abs(predicted - this.el.currentTime) > 0.12 ? this.el.currentTime : predicted;
  }

  private resync() {
    this.anchorMedia = this.el.currentTime;
    this.anchorPerf = performance.now();
    this.updatePositionState();
  }

  async play() {
    if (this.state.source === 'silent') {
      if (this.silentTime >= this.state.duration - 0.05) this.silentTime = 0;
      this.anchorPerf = performance.now();
      this.patch({ playing: true });
      this.tickSilent();
      return;
    }
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    try {
      await this.el.play();
    } catch {
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
      this.silentTime = this.currentTime();
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
    if (this.state.source === 'silent') {
      this.silentTime = clamped;
      this.anchorPerf = performance.now();
      this.listeners.forEach((l) => l());
      return;
    }
    this.el.currentTime = clamped;
    this.resync();
  }

  skip(delta: number) {
    this.seek(this.currentTime() + delta);
  }

  setRate(rate: number) {
    if (this.state.source === 'silent' && this.state.playing) {
      this.silentTime = this.currentTime();
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
    if (on && !this.ctx && this.state.source !== 'silent') this.buildGraph();
    if (!on && this.ctx) this.teardownGraph();
    this.applyEq();
    this.patch({ effects: on && !!this.ctx });
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
    const t = this.currentTime();
    const wasPlaying = this.state.playing;
    const src = this.el.src;
    this.el.pause();
    void this.ctx?.close();
    this.ctx = null;
    this.preamp = null;
    this.filters = [];
    this.el = this.makeElement();
    this.el.src = src;
    this.el.addEventListener(
      'loadedmetadata',
      () => {
        this.el.currentTime = t;
        this.applyRate();
        this.applyVolume();
        if (wasPlaying) void this.el.play();
      },
      { once: true },
    );
    this.el.load();
  }

  private applyEq() {
    this.filters.forEach((f, i) => (f.gain.value = this.eq.bands[i] ?? 0));
    this.applyVolume();
  }

  // ---------- Media Session (lock screen, headphones, Control Center) ----------

  onLineNav: ((dir: -1 | 1) => void) | null = null;

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.opts.title,
      artist: this.opts.artist,
      album: this.opts.album ?? '',
      artwork: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
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
    set('seekto', (d) => d.seekTime != null && this.seek(d.seekTime));
    set('previoustrack', () => this.onLineNav?.(-1));
    set('nexttrack', () => this.onLineNav?.(1));
  }

  private updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.state.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.el.playbackRate || 1,
        position: Math.min(d, Math.max(0, this.el.currentTime)),
      });
    } catch {
      /* position out of range during source switch */
    }
  }
}
