/**
 * Several instrument engravings at once, each on its own plate with its name, native name and performer.
 * Layout comes from src/instruments/layout.ts (pure); this component only renders it.
 *
 * Time is the caller's: `progress` (draw-in) and `presence` (fade) are pure functions of the playback time,
 * so seeking gives the same frame. Nothing here runs a keyframe that restarts on re-render; the only
 * running animations are the micro-vibrations of strings, which depend on `energy` (0 = still).
 * Styles: src/styles/instruments.css (classes `ist-…`).
 */
import { memo, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { instrument, instrumentAspect, instrumentSvg, loadInstrumentSvg, scopeSvgIds } from '@/instruments/catalog';
import { layoutInstruments, type Layout, type LayoutMode, type Slot } from '@/instruments/layout';

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
  className?: string;
  /** Receives the computed layout (e.g. to show which mode was chosen). */
  onLayout?: (layout: Layout) => void;
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

export function InstrumentStage({ keys, performers, mode, progress, presence, size, energy = 0, className, onLayout }: InstrumentStageProps) {
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

  // Engravings load lazily and are cached by the catalogue
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

  const hiddenNames = layout.hidden.map((i) => infos[i]?.name ?? list[i]);
  const p = clamp01(presence);
  const stagger = n > 1 ? 0.14 : 0;
  const drawStagger = n > 1 ? 0.18 : 0;

  return (
    <div
      className={`ist ist--${layout.mode}${energy > 0.01 ? ' ist--live' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size.w, height: size.h }}
      role="group"
      aria-label={`Инструменты: ${list.map((k, i) => infos[i]?.name ?? k).join(', ')}`}
    >
      {layout.slots.map((slot) => {
        // Each plate has its own share of presence and of the draw-in, the lead first
        const rank = slot.kind === 'more' ? n : slot.index;
        const pi = easeOut(clamp01(p * (1 + stagger * (n - 1)) - stagger * rank));
        if (slot.kind === 'more') {
          return <Chip key="more" slot={slot} presence={pi} names={hiddenNames} />;
        }
        const d = clamp01(clamp01(progress) * (1 + drawStagger * (n - 1)) - drawStagger * slot.index);
        return (
          <Plate
            key={`${slot.index}-${list[slot.index]}`}
            slot={slot}
            presence={pi}
            draw={easeOut(d)}
            hatch={clamp01((d - 0.45) / 0.55)}
            energy={energy}
            name={infos[slot.index]?.name ?? list[slot.index]}
            native={infos[slot.index]?.native}
            performer={players[slot.index]}
            svg={svgs[list[slot.index]] ?? ''}
            idSuffix={`${uid}${slot.index}`}
          />
        );
      })}
    </div>
  );
}

function plateTransform(slot: Slot, presence: number) {
  const parts: string[] = [];
  if (slot.turn) parts.push(`perspective(1200px) rotateY(${slot.turn}deg)`);
  // Settle in: rise a few px and grow from 97 %
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
      <Art svg={svg} suffix={idSuffix} style={{ left: art.x, top: art.y, width: art.w, height: art.h }} />
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
const Art = memo(function Art({ svg, suffix, style }: { svg: string; suffix: string; style: CSSProperties }) {
  const html = useMemo(() => scopeSvgIds(svg, suffix), [svg, suffix]);
  return <div className="ist-art" style={style} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />;
}, (a, b) => a.svg === b.svg && a.suffix === b.suffix && a.style.left === b.style.left && a.style.top === b.style.top && a.style.width === b.style.width && a.style.height === b.style.height);

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
