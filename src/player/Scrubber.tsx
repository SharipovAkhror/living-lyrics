/**
 * Timeline. Each part is a colour from the song, the playhead is a transform
 * written from a frame, and a drag previews the part without rebuilding the stage.
 * A flick coasts. A slow arrival near a part boundary eases onto it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Cue, Timeline } from '@/data/timeline';
import { lineText } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { stepSpring } from '@/ui/spring';

interface Segment {
  id: string;
  label: string;
  kind: 'vocal' | 'inst';
  start: number;
  end: number;
  color: string;
}

function segmentsOf(timeline: Timeline, duration: number, colors: string[]): Segment[] {
  const out: Segment[] = [];
  const span = Math.max(duration, 0.001);
  for (const cue of timeline.cues) {
    const start = Math.max(0, Math.min(span, cue.start));
    const end = Math.max(start, Math.min(span, cue.end));
    const last = out[out.length - 1];
    if (last && last.id === cue.section.id) {
      last.end = Math.max(last.end, end);
      continue;
    }
    const color = colors[out.length % Math.max(colors.length, 1)] ?? '#8a6a58';
    out.push({
      id: cue.section.id,
      label: cue.section.label,
      kind: cue.kind === 'inst' ? 'inst' : 'vocal',
      start,
      end,
      color,
    });
  }
  return out;
}

function cueAt(cues: Cue[], t: number): Cue | null {
  let found: Cue | null = null;
  for (const cue of cues) {
    if (cue.start > t + 0.02) break;
    found = cue;
  }
  return found;
}

function previewOf(cue: Cue | null): { part: string; line: string } {
  if (!cue) return { part: '', line: '' };
  if (cue.kind === 'inst') return { part: cue.section.label, line: 'Проигрыш' };
  const words = lineText(cue.line).replace(/\s+/g, ' ').trim();
  return { part: cue.section.label, line: words };
}

export function Scrubber({
  timeline,
  duration,
  clock,
  onSeek,
  accessory,
  colors,
}: {
  timeline: Timeline;
  duration: number;
  clock: () => number;
  onSeek: (t: number) => void;
  /** Sits on the time row, opposite the current time. The mismatch key lives here. */
  accessory?: ReactNode;
  /** Song field colours, one per part, in order. */
  colors: string[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLSpanElement>(null);
  const rem = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const partEl = useRef<HTMLSpanElement>(null);
  const lineEl = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragT = useRef<number | null>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const segments = segmentsOf(timeline, duration, colors);
  const boundsKey = segments.map((seg) => `${seg.id}:${seg.start}:${seg.end}`).join('|');
  const boundsRef = useRef<number[]>([]);
  boundsRef.current = segments.map((seg) => seg.start).concat(duration);

  useEffect(() => {
    let raf = 0;
    let lastText = '';
    let lastPreview = '';
    let coast: { t: number; v: number } | null = null;
    let last = performance.now();
    const width = () => track.current?.getBoundingClientRect().width ?? 1;

    const paint = (t: number) => {
      const span = duration > 0 ? duration : 1;
      const p = Math.min(1, Math.max(0, t / span));
      const w = width();
      if (head.current) head.current.style.transform = `translate3d(${(p * w).toFixed(2)}px, -50%, 0)`;
      if (rest.current) rest.current.style.transform = `scaleX(${(1 - p).toFixed(4)})`;
      const text = formatTime(t) + '|' + formatTime(duration - t);
      if (text !== lastText) {
        lastText = text;
        if (cur.current) cur.current.textContent = formatTime(t);
        if (rem.current) rem.current.textContent = `−${formatTime(Math.max(0, duration - t))}`;
      }
      track.current?.setAttribute('aria-valuenow', String(Math.round(t)));
      track.current?.setAttribute('aria-valuetext', `${formatTime(t)} из ${formatTime(duration)}`);
      if (dragT.current != null || coast) {
        const view = previewOf(cueAt(timeline.cues, t));
        const key = view.part + '|' + view.line;
        if (key !== lastPreview) {
          lastPreview = key;
          if (partEl.current) partEl.current.textContent = view.part;
          if (lineEl.current) lineEl.current.textContent = view.line;
        }
        if (preview.current) {
          preview.current.hidden = false;
          preview.current.style.transform = `translate3d(${(p * w).toFixed(2)}px, 0, 0)`;
        }
      } else if (preview.current && !preview.current.hidden) {
        preview.current.hidden = true;
        lastPreview = '';
      }
    };

    const nearest = (t: number) => {
      const bounds = boundsRef.current;
      let best = bounds[0] ?? 0;
      let dist = Math.abs(t - best);
      for (const b of bounds) {
        const d = Math.abs(t - b);
        if (d < dist) {
          best = b;
          dist = d;
        }
      }
      return best;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
      if (dragT.current != null) {
        const window = Math.max(0.35, duration * 0.012);
        const magnet = nearest(dragT.current);
        const gap = magnet - dragT.current;
        if (Math.abs(gap) < window) {
          const pull = 1 - Math.abs(gap) / window;
          paint(dragT.current + gap * pull * 0.7);
        } else {
          paint(dragT.current);
        }
        return;
      }
      if (coast) {
        const window = Math.max(0.45, duration * 0.015);
        const magnet = nearest(coast.t);
        const slow = Math.abs(coast.v) < Math.max(8, duration * 0.35);
        if (slow && Math.abs(magnet - coast.t) < window) {
          const next = stepSpring({ x: coast.t, v: coast.v }, magnet, dt, { stiffness: 140, damping: 18, mass: 1 });
          coast = { t: next.x, v: next.v };
        } else {
          coast.v *= Math.exp(-4.2 * dt);
          coast.t = Math.min(duration, Math.max(0, coast.t + coast.v * dt));
        }
        paint(coast.t);
        if (Math.abs(coast.v) < 0.35) {
          const landed = slow && Math.abs(magnet - coast.t) < window ? magnet : coast.t;
          coast = null;
          seekRef.current(Math.min(duration, Math.max(0, landed)));
        }
        return;
      }
      paint(clock());
    };
    raf = requestAnimationFrame(loop);

    const node = track.current;
    if (!node) return () => cancelAnimationFrame(raf);
    let originX = 0;
    let originT = 0;
    let lastX = 0;
    let lastMove = 0;
    let vx = 0;

    const timeAt = (clientX: number) => {
      const r = node.getBoundingClientRect();
      return Math.min(duration, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * duration));
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      coast = null;
      node.setPointerCapture(event.pointerId);
      originX = event.clientX;
      originT = timeAt(event.clientX);
      lastX = event.clientX;
      lastMove = performance.now();
      vx = 0;
      dragT.current = originT;
      setDragging(true);
    };
    const move = (event: PointerEvent) => {
      if (dragT.current == null) return;
      const now = performance.now();
      const dt = Math.max(8, now - lastMove);
      vx = (event.clientX - lastX) / dt;
      lastX = event.clientX;
      lastMove = now;
      const r = node.getBoundingClientRect();
      dragT.current = Math.min(duration, Math.max(0, originT + ((event.clientX - originX) / Math.max(1, r.width)) * duration));
    };
    const up = (event: PointerEvent) => {
      if (dragT.current == null) return;
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      const r = node.getBoundingClientRect();
      const secondsPerPx = duration / Math.max(1, r.width);
      const velocity = vx * 1000 * secondsPerPx;
      const t = dragT.current;
      dragT.current = null;
      setDragging(false);
      if (Math.abs(velocity) > Math.max(6, duration * 0.08)) coast = { t, v: velocity };
      else seekRef.current(t);
    };
    const cancel = () => {
      if (dragT.current == null) return;
      const t = dragT.current;
      dragT.current = null;
      coast = null;
      setDragging(false);
      seekRef.current(t);
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
    };
  }, [clock, duration, timeline, boundsKey]);

  return (
    <div className={`scrub${dragging ? ' is-dragging' : ''}`}>
      <div className="scrub-top">
        <span ref={cur} className="scrub-now tabular">
          0:00
        </span>
        {accessory}
      </div>
      <div
        ref={track}
        className="scrub-track"
        role="slider"
        tabIndex={0}
        aria-label="Позиция в песне"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, clock() - 5));
          else if (e.key === 'ArrowRight') onSeek(Math.min(duration, clock() + 5));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="scrub-rail">
          {segments.map((seg) => (
            <span
              key={seg.id}
              className={`scrub-seg${seg.kind === 'inst' ? ' is-inst' : ''}`}
              style={{
                left: `${(seg.start / Math.max(duration, 0.001)) * 100}%`,
                width: `${((seg.end - seg.start) / Math.max(duration, 0.001)) * 100}%`,
                background: seg.color,
              }}
            />
          ))}
          <div ref={rest} className="scrub-rest" />
          <div ref={head} className="scrub-head" />
        </div>
        <div ref={preview} className="scrub-preview" hidden>
          <span ref={partEl} className="scrub-preview-part" />
          <span ref={lineEl} className="scrub-preview-line" />
        </div>
      </div>
      <div className="scrub-meta">
        <span ref={rem} className="scrub-remain tabular">
          −0:00
        </span>
      </div>
    </div>
  );
}
