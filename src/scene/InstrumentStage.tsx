/**
 * Several instrument engravings at once, each on its own plate with its name, native name and performer.
 * Layout comes from src/instruments/layout.ts (pure); this component only renders it.
 *
 * Time is the caller's: `progress` (draw-in) and `presence` (fade) are pure functions of the playback time,
 * so seeking gives the same frame. Nothing here runs a keyframe that restarts on re-render.
 * When a GLB exists and the device can show it, one shared WebGL canvas draws those plates.
 * The song block does not pass playback seconds; `sync(time, drives)` does, for the gallery and the bench.
 * Styles: src/styles/instruments.css (classes `ist-…`) and src/instruments/render/stage3d.css.
 */
import { forwardRef, memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { effectiveMotion, useSettings } from '@/app/settings';
import type { InstrumentDrive } from '@/instruments/animation';
import { instrument, instrumentAspect, instrumentSvg, loadInstrumentSvg, scopeSvgIds } from '@/instruments/catalog';
import { layoutInstruments, type Layout, type LayoutMode, type Slot } from '@/instruments/layout';
import { hasModelSync, loadModelIndex } from '@/instruments/render/models';
import type { CameraFrame, StageSession, StageSlotSpec, StageView } from '@/instruments/render/three';
import { canTry3d } from '@/instruments/render/support';

import '@/instruments/render/stage3d.css';

export interface InstrumentStageProps {
  /** Catalogue keys, lead instrument first. Unknown keys are drawn as the ensemble. */
  keys: string[];
  /** Performers: «Имя (инструмент)» is matched by the instrument's name; otherwise index-aligned with `keys`. */
  performers?: string[];
  /** Layout mode from the data (`layout` of an instrumental section); omitted or 'auto' lets the engine choose. */
  mode?: LayoutMode | 'auto' | string;
  /** Draw-in progress 0…1 (contours, then hatching), a pure function of time. */
  progress: number;
  /** Presence 0…1: plates fade and settle in (and out) with it. */
  presence: number;
  /** Box available to the stage, CSS px. */
  size: { w: number; h: number };
  /** Loudness 0…1 for string and skin micro-motion; 0 keeps the drawings still. */
  energy?: number;
  /** Playback seconds. The song stage leaves this out until it can call `sync`. */
  time?: number;
  /** Per-instrument drives aligned with `keys`. Pulse and sustain stay 0 when this is omitted. */
  drives?: InstrumentDrive[];
  /** Keep the drawing buffer so a bench can read pixels back. */
  preserve?: boolean;
  className?: string;
  /** Receives the computed layout (e.g. to show which mode was chosen). */
  onLayout?: (layout: Layout) => void;
}

export interface InstrumentStageHandle {
  /** Pose at `time` seconds. `drives` wins over the slot drives until the next call that passes them. */
  sync(time: number, drives?: InstrumentDrive[]): void;
  /** Crop or aim the shared camera. `null` restores the fitted hero view. */
  setCamera(frame: CameraFrame | null): void;
  draw(): void;
  pixels(): { width: number; height: number; data: Uint8ClampedArray } | null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Who plays what: «Имя (танбур)» goes to the tanbur; otherwise performers follow the order of `keys`. */
export function assignPerformers(keys: string[], performers: string[] = []): (string | undefined)[] {
  const out: (string | undefined)[] = keys.map(() => undefined);
  const rest: string[] = [];
  const names = keys.map((k) => (instrument(k)?.name ?? k).toLowerCase());
  for (const p of performers) {
    const m = p.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const i = m ? names.findIndex((n, j) => !out[j] && (m[2].toLowerCase().includes(n) || m[2].toLowerCase() === keys[j])) : -1;
    if (m && i >= 0) out[i] = m[1].trim();
    else rest.push(p);
  }
  if (!rest.length) return out;
  const free = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (rest.length === free.length) rest.forEach((p, j) => (out[free[j]] = p));
  else if (free.length) out[free[0]] = rest.join(', ');
  return out;
}

export const InstrumentStage = forwardRef<InstrumentStageHandle, InstrumentStageProps>(function InstrumentStage(
  { keys, performers, mode, progress, presence, size, energy = 0, time, drives, preserve = false, className, onLayout },
  ref,
) {
  const list = keys.length ? keys : ['ensemble'];
  const n = list.length;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const infos = list.map((k) => instrument(k));
  const players = useMemo(() => assignPerformers(list, performers), [list.join(), performers?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = 1 + (infos.some((i) => i?.native) ? 1 : 0) + (players.some(Boolean) ? 1 : 0);

  const layout = useMemo(
    () =>
      layoutInstruments(n, size, {
        mode: mode && mode !== 'auto' ? (mode as LayoutMode) : 'auto',
        aspects: list.map(instrumentAspect),
        lines,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, size.w, size.h, mode, list.join(), lines],
  );
  useEffect(() => onLayout?.(layout), [layout, onLayout]);

  const [svgs, setSvgs] = useState<Record<string, string>>(() => Object.fromEntries(list.map((k) => [k, instrumentSvg(k)])));
  useEffect(() => {
    let alive = true;
    const missing = list.filter((k) => !svgs[k]);
    if (!missing.length) return;
    void Promise.all(missing.map((k) => loadInstrumentSvg(k).then((s) => [k, s] as const))).then((pairs) => {
      if (alive) setSvgs((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join()]);

  const settings = useSettings();
  const motion = effectiveMotion(settings);
  const style = settings.instrumentStyle;
  const wants3d = style !== 'drawing' && canTry3d(motion);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<StageSession | null>(null);
  const clockRef = useRef(time ?? 0);
  const drivesRef = useRef(drives);
  const cameraRef = useRef<CameraFrame | null>(null);
  const sigRef = useRef('');
  const [glReady, setGlReady] = useState(false);
  const listKey = list.join();

  if (drives) drivesRef.current = drives;

  const hiddenNames = layout.hidden.map((i) => infos[i]?.name ?? list[i]);
  const p = clamp01(presence);
  const stagger = n > 1 ? 0.14 : 0;
  const drawStagger = n > 1 ? 0.18 : 0;

  const collect = (index: Set<string> | null): StageSlotSpec[] => {
    const host = hostRef.current;
    if (!host) return [];
    const specs: StageSlotSpec[] = [];
    for (const slot of layout.slots) {
      if (slot.kind === 'more') continue;
      const key = list[slot.index];
      const known = index ? index.has(key) : hasModelSync(key);
      if (!known) continue;
      const art = host.querySelector<HTMLElement>(`[data-slot="${slot.index}"]`);
      if (!art) continue;
      const rank = slot.index;
      const pi = easeOut(clamp01(p * (1 + stagger * (n - 1)) - stagger * rank));
      const d0 = clamp01(clamp01(progress) * (1 + drawStagger * (n - 1)) - drawStagger * slot.index);
      const given = drivesRef.current?.[slot.index];
      specs.push({
        art,
        key,
        turn: slot.turn ?? 0,
        rotate: slot.rotate ?? 0,
        presence: pi * (slot.opacity ?? 1),
        z: slot.z,
        drive: {
          draw: easeOut(d0),
          hatch: clamp01((d0 - 0.45) / 0.55),
          energy: given?.energy ?? energy,
          pulse: given?.pulse ?? 0,
          sustain: given?.sustain ?? 0,
          breath: given?.breath ?? 0,
          beat: given?.beat ?? 0,
        },
      });
    }
    return specs;
  };

  const mark = (specs: StageSlotSpec[]) => {
    const host = hostRef.current;
    if (!host) return;
    const keep = new Set(specs.map((s) => s.art));
    host.querySelectorAll<HTMLElement>('.ist-art').forEach((el) => el.classList.toggle('is-3d', keep.has(el)));
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !wants3d) return;
    let alive = true;
    let session: StageSession | null = null;
    let canvas: HTMLCanvasElement | null = null;
    void (async () => {
      const index = await loadModelIndex();
      if (!alive) return;
      const specs = collect(index);
      if (!specs.length) return;
      const { mountStage } = await import('@/instruments/render/three');
      if (!alive || !hostRef.current) return;
      canvas = document.createElement('canvas');
      canvas.className = 'ist-gl';
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      session = await mountStage(host, canvas, { preserve });
      if (!alive) {
        session.dispose();
        canvas.remove();
        return;
      }
      sessionRef.current = session;
      session.setStyle(style === 'materials' ? 'materials' : 'engraving');
      session.setTime(clockRef.current);
      if (cameraRef.current) session.setCamera(cameraRef.current);
      const latest = collect(index);
      sigRef.current = latest.map((s) => s.key).join('|');
      await session.setSlots(latest);
      if (!alive) return;
      mark(latest);
      host.dataset.ready = '1';
      setGlReady(true);
    })();
    return () => {
      alive = false;
      setGlReady(false);
      host.removeAttribute('data-ready');
      sigRef.current = '';
      sessionRef.current = null;
      session?.dispose();
      canvas?.remove();
      host.querySelectorAll('.ist-art.is-3d').forEach((el) => el.classList.remove('is-3d'));
    };
    // Remount when the reader turns volume on or off, or the instrument list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants3d, listKey, preserve]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!session || !glReady) return;
    const specs = collect(null);
    const sig = specs.map((s) => s.key).join('|');
    const views: StageView[] = specs.map((s) => ({
      art: s.art,
      drive: s.drive,
      presence: s.presence,
      turn: s.turn,
      rotate: s.rotate,
      z: s.z,
    }));
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      void session.setSlots(specs).then(() => {
        if (sessionRef.current !== session) return;
        mark(specs);
        session.setViews(views);
      });
    } else {
      mark(specs);
      session.setViews(views);
    }
    // collect() reads the latest plate geometry and drives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glReady, layout, progress, presence, energy, drives, listKey]);

  useLayoutEffect(() => {
    if (style === 'drawing') return;
    sessionRef.current?.setStyle(style);
  }, [style, glReady]);

  useLayoutEffect(() => {
    if (time === undefined) return;
    clockRef.current = time;
    sessionRef.current?.setTime(time);
  }, [time, glReady]);

  useImperativeHandle(ref, () => ({
    sync(nextTime, nextDrives) {
      clockRef.current = nextTime;
      if (nextDrives) drivesRef.current = nextDrives;
      const session = sessionRef.current;
      session?.setTime(nextTime);
      if (nextDrives) session?.setDriveOverride(nextDrives);
    },
    setCamera(frame) {
      cameraRef.current = frame;
      sessionRef.current?.setCamera(frame);
    },
    draw() {
      sessionRef.current?.draw();
    },
    pixels() {
      return sessionRef.current?.pixels() ?? null;
    },
  }), []);

  return (
    <div
      ref={hostRef}
      className={`ist ist--${layout.mode}${energy > 0.01 ? ' ist--live' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size.w, height: size.h }}
      role="group"
      aria-label={`Инструменты: ${list.map((k, i) => infos[i]?.name ?? k).join(', ')}`}
    >
      {layout.slots.map((slot) => {
        const rank = slot.kind === 'more' ? n : slot.index;
        const pi = easeOut(clamp01(p * (1 + stagger * (n - 1)) - stagger * rank));
        if (slot.kind === 'more') {
          return <Chip key="more" slot={slot} presence={pi} names={hiddenNames} />;
        }
        const d = clamp01(clamp01(progress) * (1 + drawStagger * (n - 1)) - drawStagger * slot.index);
        const key = list[slot.index];
        return (
          <Plate
            key={`${slot.index}-${key}`}
            slot={slot}
            presence={pi}
            draw={easeOut(d)}
            hatch={clamp01((d - 0.45) / 0.55)}
            energy={energy}
            name={infos[slot.index]?.name ?? key}
            native={infos[slot.index]?.native}
            performer={players[slot.index]}
            svg={svgs[key] ?? ''}
            idSuffix={`${uid}${slot.index}`}
            instrumentKey={key}
          />
        );
      })}
    </div>
  );
});

function plateTransform(slot: Slot, presence: number) {
  const parts: string[] = [];
  if (slot.turn) parts.push(`perspective(1200px) rotateY(${slot.turn}deg)`);
  const rise = (1 - presence) * 14;
  if (rise > 0.01) parts.push(`translate3d(0, ${rise.toFixed(2)}px, 0) scale(${(0.97 + 0.03 * presence).toFixed(4)})`);
  if (slot.rotate) parts.push(`rotate(${slot.rotate}deg)`);
  return parts.join(' ') || undefined;
}

function Plate({
  slot,
  presence,
  draw,
  hatch,
  energy,
  name,
  native,
  performer,
  svg,
  idSuffix,
  instrumentKey,
}: {
  slot: Slot;
  presence: number;
  draw: number;
  hatch: number;
  energy: number;
  name: string;
  native?: string;
  performer?: string;
  svg: string;
  idSuffix: string;
  instrumentKey: string;
}) {
  const style = {
    left: slot.x,
    top: slot.y,
    width: slot.w,
    height: slot.h,
    zIndex: slot.z,
    opacity: (slot.opacity ?? 1) * presence,
    transform: plateTransform(slot, presence),
    '--draw': draw.toFixed(4),
    '--hatch': hatch.toFixed(3),
    '--energy': energy.toFixed(3),
  } as CSSProperties;
  const { label, art } = slot;
  return (
    <figure className={`ist-plate ist-plate--${slot.role} ist-t-${label.tier}`} style={style}>
      <Art
        svg={svg}
        suffix={idSuffix}
        slotIndex={slot.index}
        instrumentKey={instrumentKey}
        style={{ left: art.x, top: art.y, width: art.w, height: art.h }}
      />
      <figcaption className={`ist-label ist-label--${label.align}`} style={{ left: label.x, top: label.y, width: label.w, height: label.h }}>
        <span className="ist-name">{name}</span>
        {native ? (
          <span className="ist-native" dir="auto">
            {native}
          </span>
        ) : null}
        {performer ? <span className="ist-perf">{performer}</span> : null}
      </figcaption>
    </figure>
  );
}

/** The engraving itself: re-rendered only when the drawing changes, never on progress updates. */
const Art = memo(function Art({
  svg,
  suffix,
  style,
  slotIndex,
  instrumentKey,
}: {
  svg: string;
  suffix: string;
  style: CSSProperties;
  slotIndex: number;
  instrumentKey: string;
}) {
  const html = useMemo(() => scopeSvgIds(svg, suffix), [svg, suffix]);
  return (
    <div
      className="ist-art"
      data-slot={slotIndex}
      data-instrument={instrumentKey}
      style={style}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, (a, b) => a.svg === b.svg && a.suffix === b.suffix && a.slotIndex === b.slotIndex && a.instrumentKey === b.instrumentKey && a.style.left === b.style.left && a.style.top === b.style.top && a.style.width === b.style.width && a.style.height === b.style.height);

function Chip({ slot, presence, names }: { slot: Slot; presence: number; names: string[] }) {
  return (
    <div
      className="ist-chip"
      style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h, zIndex: slot.z, opacity: presence }}
      title={names.join(', ')}
      aria-label={`И ещё: ${names.join(', ')}`}
    >
      +{slot.more}
    </div>
  );
}

export default InstrumentStage;
