/**
 * /instruments — the catalogue of engravings and a playground for multi-instrument layouts.
 * Default export; the route is wired in src/app (not here). Styles: src/styles/instruments.css (ig-…).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { effectiveMotion, useSettings, type InstrumentStyle } from '@/app/settings';

type VolumeStyle = Exclude<InstrumentStyle, 'drawing'>;
import type { InstrumentDrive } from '@/instruments/animation';
import { INSTRUMENTS, hasArt, instrumentSvg, loadInstrumentSvg, scopeSvgIds, type InstrumentInfo } from '@/instruments/catalog';
import { LAYOUT_MODES, LAYOUT_NAMES, type Layout, type LayoutMode } from '@/instruments/layout';
import { loadModelIndex } from '@/instruments/render/models';
import { DRIVE_KEYS, DRIVE_LABELS, exampleDrive, type DriveKey } from '@/instruments/render/pose';
import { canTry3d } from '@/instruments/render/support';
import { InstrumentStage, type InstrumentStageHandle } from '@/scene/InstrumentStage';
import { linkHandler } from '@/app/router';
import { Segmented, Slider } from '@/components/controls';
import { Icon } from '@/icons/Icon';

import '@/instruments/render/stage3d.css';

const FAMILIES: InstrumentInfo['family'][] = ['струнные щипковые', 'струнные ударные', 'смычковые', 'духовые', 'ударные', 'клавишные', 'голоса', 'ансамбль'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MAX_PICK = 6;

export default function InstrumentsPage() {
  const q = new URLSearchParams(window.location.search);
  if (q.get('t6bench') === '1') return <Bench />;
  const frame = q.get('t6frame');
  if (frame === 'daf' || frame === 'oud') return <Frame instrument={frame} />;
  return <Catalogue />;
}

function Catalogue() {
  const settings = useSettings();
  const [volume, setVolume] = useState<VolumeStyle>(settings.instrumentStyle === 'engraving' ? 'engraving' : 'materials');
  const groups = useMemo(() => FAMILIES.map((family) => ({ family, items: INSTRUMENTS.filter((i) => i.family === family) })).filter((g) => g.items.length), []);
  const drawn = INSTRUMENTS.filter((i) => hasArt(i.key)).length;

  return (
    <div className="ig">
      <header className="ig-top">
        <a className="btn btn-circle glass" href="/" onClick={linkHandler('/')} aria-label="К списку песен">
          <Icon name="chevron.left" size={20} weight={2.2} />
        </a>
      </header>

      <div className="ig-head">
        <h1 className="t-large-title">Инструменты</h1>
        <p className="t-body secondary">
          Гравюры, которые сцена показывает в инструментальных частях песен: {drawn} из {INSTRUMENTS.length} в каталоге. У дафа и уда здесь объём: его можно повернуть пальцем и подать удар, звучание, дыхание, громкость и долю. На странице песни по умолчанию остаётся рисунок; объём там включается в настройках. Если модели ещё нет или устройство не тянет объём, остаётся рисунок. Если играют несколько инструментов сразу, сцена раскладывает их сама — это можно попробовать внизу страницы.
        </p>
        <div className="ig-volume">
          <Segmented
            label="Объём дафа и уда"
            value={volume}
            options={[
              { value: 'engraving', label: 'Гравюра' },
              { value: 'materials', label: 'Материалы' },
            ]}
            onChange={setVolume}
          />
        </div>
      </div>

      <section aria-labelledby="ig-catalogue">
        <h2 id="ig-catalogue" className="visually-hidden">
          Каталог
        </h2>
        {groups.map((g) => (
          <div key={g.family}>
            <h3 className="ig-family t-headline">{cap(g.family)}</h3>
            <ul className="ig-grid">
              {g.items.map((info) => (
                <li key={info.key}>
                  <Card info={info} volume={volume} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <Playground />
    </div>
  );
}

/* ---------- Catalogue card ---------- */

const REST: InstrumentDrive = { draw: 1, hatch: 1, energy: 0, pulse: 0, sustain: 0, breath: 0, beat: 0 };

interface CardRenderer {
  mount(container: HTMLElement, key: string): Promise<void> | void;
  update(drive: InstrumentDrive, time?: number): void;
  setOrbit(yaw: number, pitch: number): void;
  setStyle(style: VolumeStyle): void;
  dispose(): void;
}

function Card({ info, volume }: { info: InstrumentInfo; volume: VolumeStyle }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CardRenderer | null>(null);
  const driveRef = useRef<InstrumentDrive>(REST);
  const timeRef = useRef(0);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const playingRef = useRef(false);
  const mountingRef = useRef(false);
  const gen = useRef(0);
  const [svg, setSvg] = useState(() => (hasArt(info.key) ? instrumentSvg(info.key) : ''));
  const [drive, setDrive] = useState<InstrumentDrive>(REST);
  const [playing, setPlaying] = useState(false);
  const [armed, setArmed] = useState(false);
  const [live, setLive] = useState(false);
  const settings = useSettings();
  const motion = effectiveMotion(settings);
  const styleRef = useRef(volume);
  const svgRef = useRef(svg);
  styleRef.current = volume;
  svgRef.current = svg;
  playingRef.current = playing;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const drop = () => {
      gen.current += 1;
      mountingRef.current = false;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      el.classList.remove('is-3d');
      delete el.dataset.ready;
      setLive(false);
    };
    const io = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        if (!svgRef.current && hasArt(info.key) && on) {
          void loadInstrumentSvg(info.key).then((s) => {
            if (!alive) return;
            svgRef.current = s;
            setSvg(s);
          });
        }
        if (!on) {
          drop();
          return;
        }
        if (rendererRef.current || mountingRef.current) return;
        const ticket = ++gen.current;
        mountingRef.current = true;
        void (async () => {
          try {
            const index = await loadModelIndex();
            if (!alive || ticket !== gen.current) return;
            const wants = index.has(info.key) && canTry3d(motion);
            setArmed(wants);
            if (!wants) return;
            const { createInstrumentRenderer } = await import('@/instruments/render/three');
            if (!alive || ticket !== gen.current) return;
            const renderer = createInstrumentRenderer();
            renderer.setStyle(styleRef.current);
            rendererRef.current = renderer;
            await renderer.mount(el, info.key);
            if (!alive || ticket !== gen.current) {
              renderer.dispose();
              if (rendererRef.current === renderer) rendererRef.current = null;
              return;
            }
            // Drag right lowers rotation.y. The camera stays on the hero direction.
            renderer.setOrbit(yawRef.current, pitchRef.current);
            renderer.update(driveRef.current, timeRef.current);
            el.classList.add('is-3d');
            setLive(true);
          } catch (err) {
            console.error(err);
            rendererRef.current?.dispose();
            rendererRef.current = null;
          } finally {
            if (ticket === gen.current) mountingRef.current = false;
          }
        })();
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
      drop();
    };
  }, [info.key, motion]);

  useEffect(() => {
    rendererRef.current?.setStyle(volume);
  }, [volume, live]);

  useEffect(() => {
    if (!playing) return;
    // Elapsed time since the button press. The pose is exampleDrive(elapsed), not the song clock.
    const origin = performance.now() - timeRef.current * 1000;
    let raf = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const t = (now - origin) / 1000;
      timeRef.current = t;
      const next = exampleDrive(t);
      driveRef.current = next;
      // A slow turn while the example plays. Zero at t = 0, so a still at rest stays on the hero view.
      const sway = Math.sin(t * 0.45) * 0.22;
      rendererRef.current?.setOrbit(yawRef.current + sway, pitchRef.current);
      rendererRef.current?.update(next, t);
      setDrive(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      rendererRef.current?.setOrbit(yawRef.current, pitchRef.current);
    };
  }, [playing]);

  const setDriveKey = (key: DriveKey, value: number) => {
    playingRef.current = false;
    setPlaying(false);
    const next = { ...driveRef.current, [key]: value, draw: 1, hatch: 1 };
    driveRef.current = next;
    setDrive(next);
    rendererRef.current?.update(next, timeRef.current);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!live) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.drag = String(e.pointerId);
    e.currentTarget.dataset.x = String(e.clientX);
    e.currentTarget.dataset.y = String(e.clientY);
    e.currentTarget.dataset.yaw = String(yawRef.current);
    e.currentTarget.dataset.pitch = String(pitchRef.current);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.dataset.drag !== String(e.pointerId)) return;
    e.preventDefault();
    const yaw = Number(el.dataset.yaw) - (e.clientX - Number(el.dataset.x)) * 0.008;
    const pitch = Math.max(-1.05, Math.min(1.05, Number(el.dataset.pitch) - (e.clientY - Number(el.dataset.y)) * 0.008));
    yawRef.current = yaw;
    pitchRef.current = pitch;
    rendererRef.current?.setOrbit(yaw, pitch);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.dataset.drag === String(e.pointerId)) delete e.currentTarget.dataset.drag;
  };

  const html = useMemo(() => scopeSvgIds(svg, `card${info.key.replace(/[^a-z0-9]/g, '')}`), [svg, info.key]);

  return (
    <article className="ig-card">
      <div
        ref={ref}
        className="ig-card-art"
        data-instrument={info.key}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {svg ? <div className="ist-art" aria-hidden dangerouslySetInnerHTML={{ __html: html }} /> : null}
        {!hasArt(info.key) ? <span className="ig-noart t-footnote">Гравюры пока нет — сцена покажет ансамбль</span> : null}
      </div>
      {armed ? (
        <div className="ig-drive">
          {DRIVE_KEYS.map((key) => (
            <label key={key}>
              <span>{DRIVE_LABELS[key]}</span>
              <Slider min={0} max={1} step={0.01} value={drive[key]} label={DRIVE_LABELS[key]} onChange={(v) => setDriveKey(key, v)} />
              <span className="tabular">{drive[key].toFixed(2)}</span>
            </label>
          ))}
          <button type="button" className="ig-pick ig-drive-play" aria-pressed={playing} onClick={() => setPlaying((v) => !v)}>
            {playing ? 'Остановить' : 'Сыграть пример'}
          </button>
        </div>
      ) : null}
      <div className="ig-card-text">
        <div className="ig-card-name">
          <span className="t-headline">{info.name}</span>
          {info.native ? (
            <span className="ig-native t-subhead" dir="auto">
              {info.native}
            </span>
          ) : null}
        </div>
        {info.origin ? <div className="ig-meta t-footnote">{info.origin}</div> : null}
        <p className="ig-desc t-footnote">{info.description}</p>
        <div className="ig-key">{info.key}</div>
      </div>
    </article>
  );
}

/* ---------- Layout playground ---------- */

const SCREENS = [
  { id: 'phone', name: 'iPhone', w: 390, h: 600 },
  { id: 'desktop', name: 'Компьютер', w: 1200, h: 700 },
] as const;

function Playground() {
  const [picked, setPicked] = useState<string[]>(['oud', 'qanun', 'ney']);
  const [mode, setMode] = useState<LayoutMode | 'auto'>('auto');
  const [draw, setDraw] = useState(1);
  const [withPerformers, setWithPerformers] = useState(false);
  const options = INSTRUMENTS.filter((i) => hasArt(i.key) && i.key !== 'ensemble');

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < MAX_PICK ? [...p, key] : p));
  const performers = withPerformers ? picked.map((k) => `Имя исполнителя (${INSTRUMENTS.find((i) => i.key === k)?.name ?? k})`) : undefined;

  return (
    <section className="ig-section" aria-labelledby="ig-play">
      <h2 id="ig-play" className="t-title2">
        Расстановка
      </h2>
      <p className="t-callout secondary">
        Выберите от одного до шести инструментов; первый выбранный — ведущий. «Авто» подбирает раскладку по числу инструментов и размеру экрана и не даёт гравюре стать меньше читаемой — лишние уходят в «+N». Остальные режимы можно задать песне вручную полем <code>layout</code>.
      </p>
      <div className="ig-play">
        <div className="ig-row" role="group" aria-label="Инструменты">
          <span className="ig-row-title t-footnote">Инструменты · {picked.length} из {MAX_PICK}</span>
          {options.map((i) => {
            const n = picked.indexOf(i.key);
            return (
              <button key={i.key} type="button" className="ig-pick" aria-pressed={n >= 0} disabled={n < 0 && picked.length >= MAX_PICK} onClick={() => toggle(i.key)}>
                {n >= 0 ? <span className="ig-pick-n">{n + 1}</span> : null}
                {i.name}
              </button>
            );
          })}
        </div>
        <div className="ig-row" role="radiogroup" aria-label="Раскладка">
          <span className="ig-row-title t-footnote">Раскладка</span>
          {(['auto', ...LAYOUT_MODES] as const).map((m) => (
            <button key={m} type="button" role="radio" className="ig-pick" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'auto' ? 'Авто' : LAYOUT_NAMES[m]}
            </button>
          ))}
        </div>
        <div className="ig-row">
          <label className="ig-slider t-footnote">
            <span>Прорисовка</span>
            <Slider min={0} max={1} step={0.01} value={draw} label="Прорисовка" onChange={setDraw} />
            <span className="tabular">{Math.round(draw * 100)} %</span>
          </label>
          <button type="button" className="ig-pick" aria-pressed={withPerformers} onClick={() => setWithPerformers((v) => !v)}>
            Строка исполнителя
          </button>
        </div>
        {picked.length ? (
          <div className="ig-screens">
            {SCREENS.map((s) => (
              <Screen key={s.id} name={s.name} w={s.w} h={s.h} keys={picked} mode={mode} draw={draw} performers={performers} />
            ))}
          </div>
        ) : (
          <p className="t-footnote secondary">Выберите хотя бы один инструмент.</p>
        )}
      </div>
    </section>
  );
}

/** A screen of a given size, scaled down to fit the column, with the stage inside. */
function Screen({ name, w, h, keys, mode, draw, performers }: { name: string; w: number; h: number; keys: string[]; mode: LayoutMode | 'auto'; draw: number; performers?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(w);
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(1, avail / w);
  const pad = 12;
  const onLayout = useCallback((l: Layout) => setLayout(l), []);
  const size = useMemo(() => ({ w: w - 2 * pad, h: h - 2 * pad }), [w, h]);

  return (
    <figure className="ig-screen" style={{ margin: 0 }}>
      <div ref={ref} style={{ width: '100%' }}>
        <div className="ig-screen-frame" style={{ width: w * k, height: h * k }}>
          <div className="ig-screen-inner" style={{ width: w, height: h, transform: `scale(${k})` }}>
            <div style={{ position: 'absolute', left: pad, top: pad }}>
              <InstrumentStage keys={keys} performers={performers} mode={mode} progress={draw} presence={1} size={size} onLayout={onLayout} />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="ig-screen-meta t-footnote">
        <span>
          {name} · {w} × {h}
        </span>
        {layout ? (
          <span>
            {LAYOUT_NAMES[layout.mode]}
            {layout.fallback ? ' (авто)' : ''} · {layout.minArt} px{layout.hidden.length ? ` · +${layout.hidden.length}` : ''}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function levelDrive(level: number): InstrumentDrive {
  const v = level < 0 ? 0 : level > 1 ? 1 : level;
  return { draw: 1, hatch: 1, energy: v, pulse: v, sustain: v, breath: v, beat: v };
}

interface T6Seek {
  ok: boolean;
  max: number;
  width: number;
  height: number;
  reason?: string;
}

interface T6Fps {
  fps: number;
  frames: number;
  ms: number;
  width: number;
  height: number;
  instruments: number;
}

declare global {
  interface Window {
    __t6?: {
      pose: (time: number, level: number) => void;
      seek?: () => T6Seek;
      fps?: (ms?: number) => Promise<T6Fps>;
    };
  }
}

/** One large instrument for the drive-series stills (`?t6frame=daf`). */
function Frame({ instrument }: { instrument: 'daf' | 'oud' }) {
  const stageRef = useRef<InstrumentStageHandle>(null);
  const size = useMemo(() => ({ w: 880, h: 900 }), []);
  useEffect(() => {
    const pose = (time: number, level: number) => {
      stageRef.current?.sync(time, [levelDrive(level)]);
      stageRef.current?.draw();
    };
    window.__t6 = { pose };
    return () => {
      delete window.__t6;
    };
  }, [instrument]);
  return (
    <div className="t6-bench">
      <p className="t-footnote" style={{ textAlign: 'center', margin: '12px 0' }}>
        {instrument === 'daf' ? 'Даф' : 'Уд'}, крупный кадр
      </p>
      <InstrumentStage ref={stageRef} className="t6-frame" keys={[instrument]} mode="single" progress={1} presence={1} size={size} preserve />
    </div>
  );
}

/** Three instruments, one canvas (`?t6bench=1`). The catalogue stays unmounted so it does not add contexts. */
function Bench() {
  const stageRef = useRef<InstrumentStageHandle>(null);
  const shown = useRef(0);
  const size = useMemo(() => ({ w: 390, h: 780 }), []);
  const onLayout = useCallback((layout: Layout) => {
    shown.current = layout.slots.filter((s) => s.kind === 'instrument').length;
  }, []);
  useEffect(() => {
    const pose = (time: number, level: number) => {
      const drive = levelDrive(level);
      stageRef.current?.sync(time, [drive, drive, drive]);
      stageRef.current?.draw();
    };
    const seek = (): T6Seek => {
      const drive = levelDrive(0.65);
      const renderAt = (time: number) => {
        stageRef.current?.sync(time, [drive, drive, drive]);
        stageRef.current?.draw();
      };
      for (const t of [0.2, 3.4, 0.05, 2.8]) renderAt(t);
      renderAt(1.25);
      const a = stageRef.current?.pixels();
      for (const t of [5.5, 0.9, 4.1]) renderAt(t);
      renderAt(1.25);
      const b = stageRef.current?.pixels();
      if (!a || !b || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
        return { ok: false, max: 255, width: a?.width ?? 0, height: a?.height ?? 0, reason: 'разный размер кадра' };
      }
      let max = 0;
      for (let i = 0; i < a.data.length; i++) {
        const d = Math.abs(a.data[i] - b.data[i]);
        if (d > max) max = d;
      }
      return { ok: max <= 2, max, width: a.width, height: a.height };
    };
    const fps = async (durationMs = 2000): Promise<T6Fps> => {
      const start = performance.now();
      let frames = 0;
      let now = start;
      while (now - start < durationMs) {
        const t = (now - start) / 1000;
        stageRef.current?.sync(t, [exampleDrive(t), exampleDrive(t + 0.17), exampleDrive(t + 0.31)]);
        stageRef.current?.draw();
        frames += 1;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        now = performance.now();
      }
      const ms = performance.now() - start;
      const rect = document.querySelector('.t6-bench-stage')?.getBoundingClientRect();
      return { fps: frames / (ms / 1000), frames, ms, width: rect?.width ?? 0, height: rect?.height ?? 0, instruments: shown.current };
    };
    window.__t6 = { pose, seek, fps };
    return () => {
      delete window.__t6;
    };
  }, []);
  return (
    <div className="t6-bench">
      <p className="t-footnote" style={{ textAlign: 'center', margin: '12px 0' }}>
        Три инструмента на одном холсте: даф, уд и ещё один даф.
      </p>
      <InstrumentStage
        ref={stageRef}
        className="t6-bench-stage"
        keys={['daf', 'oud', 'daf']}
        mode="stack"
        progress={1}
        presence={1}
        energy={0}
        size={size}
        preserve
        onLayout={onLayout}
      />
    </div>
  );
}
