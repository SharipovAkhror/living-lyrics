/**
 * Timeline. Each part is a colour from the song, the playhead is a transform
 * written from a frame, and a drag previews the part without rebuilding the stage.
 * A flick coasts. A slow arrival near a part boundary eases onto it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Cue, Timeline } from '@/data/timeline';
import { lineText } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { stepSpring, type SpringState } from '@/ui/spring';

/** Entry peaks near 1.04 in about 160 ms. Exit is the fast critical spring. */
const BUBBLE = { stiffness: 790, damping: 40, mass: 1 };
const BUBBLE_OUT = { stiffness: 1600, damping: 80, mass: 1 };
const WIDTH_SPRING = { stiffness: 420, damping: 32, mass: 1 };
const LABEL_SPRING = { stiffness: 900, damping: 46, mass: 1 };
/** Rail and thumb swell over about 400 ms, so a 100 ms sheet sees the growth. */
const GRAB = { stiffness: 100, damping: 18, mass: 1 };

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
  onPreview,
  accessory,
  colors,
}: {
  timeline: Timeline;
  duration: number;
  clock: () => number;
  onSeek: (t: number) => void;
  /** Song time under the finger, or null once the engine clock is the source again. */
  onPreview?: (t: number | null) => void;
  /** Sits on the time row, opposite the current time. The mismatch key lives here. */
  accessory?: ReactNode;
  /** Song field colours, one per part, in order. */
  colors: string[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const rest = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLSpanElement>(null);
  const rem = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const bubbleBody = useRef<HTMLDivElement>(null);
  const partEl = useRef<HTMLSpanElement>(null);
  const lineEl = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragT = useRef<number | null>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const segments = segmentsOf(timeline, duration, colors);
  const span = Math.max(duration, 0.001);
  let lastMark = 0;
  const partMarks = segments.filter((seg) => {
    const at = seg.start / span;
    if (at < 0.012 || at - lastMark < 0.04) return false;
    lastMark = at;
    return true;
  });
  const boundsKey = segments.map((seg) => `${seg.id}:${seg.start}:${seg.end}`).join('|');
  const boundsRef = useRef<number[]>([]);
  boundsRef.current = segments.map((seg) => seg.start).concat(duration);

  useEffect(() => {
    let raf = 0;
    let lastText = '';
    let lastPreview = '';
    let coast: { t: number; v: number } | null = null;
    let last = performance.now();
    let bubble: SpringState = { x: 0, v: 0 };
    let widthSpring: SpringState = { x: 0, v: 0 };
    let widthTarget = 0;
    let haveWidth = false;
    let heightSpring: SpringState = { x: 0, v: 0 };
    let heightTarget = 0;
    let haveHeight = false;
    let labelSpring: SpringState = { x: 1, v: 0 };
    let smoothX = -1;
    let grab: SpringState = { x: 0, v: 0 };
    let grabSince = 0;
    let previewGap = -1;
    const width = () => track.current?.getBoundingClientRect().width ?? 1;

    const liftFor = (node: HTMLElement) => {
      const host = track.current;
      if (!host) return 0;
      const trackRect = host.getBoundingClientRect();
      if (previewGap < 0) previewGap = parseFloat(getComputedStyle(node).bottom) || 8;
      const layoutBottom = trackRect.top - previewGap;
      const layoutTop = layoutBottom - node.offsetHeight;
      const note = document.querySelector('.note-card');
      if (!(note instanceof HTMLElement)) return 0;
      const noteBox = note.getBoundingClientRect();
      if (noteBox.height < 8) return 0;
      if (layoutBottom > noteBox.top + 4 && layoutTop < noteBox.bottom - 4) {
        return Math.min(0, noteBox.top - 8 - layoutBottom);
      }
      return 0;
    };

    const paint = (t: number, dt: number, live: boolean) => {
      previewRef.current?.(live ? t : null);
      const span = duration > 0 ? duration : 1;
      const p = Math.min(1, Math.max(0, t / span));
      const w = width();
      const holding = dragT.current != null;
      // WebKit may deliver one frame for the whole hold. Integrate the wall
      // time, or the 320 ms sample still reads the resting scale.
      if (holding && grabSince) {
        const elapsed = Math.min(1.2, Math.max(0, (performance.now() - grabSince) / 1000));
        let state: SpringState = { x: 0, v: 0 };
        let left = elapsed;
        let guard = 0;
        while (left > 0.0001 && guard < 24) {
          const slice = Math.min(0.05, left);
          state = stepSpring(state, 1, slice, GRAB);
          left -= slice;
          guard += 1;
        }
        grab = state;
      } else grab = stepSpring(grab, 0, dt, GRAB);
      const g = Math.max(0, grab.x);
      const headScale = (1 + 0.3 * g).toFixed(3);
      if (head.current) head.current.style.transform = `translate3d(${(p * w).toFixed(2)}px, -50%, 0) scale(${headScale})`;
      if (rail.current) {
        if (!holding && g < 0.02 && Math.abs(grab.v) < 0.02) {
          if (rail.current.style.transform) {
            rail.current.style.transform = '';
            rail.current.style.transition = '';
          }
        } else {
          rail.current.style.transition = 'none';
          rail.current.style.transform = `scaleY(${(1 + g).toFixed(3)})`;
        }
      }
      if (played.current) played.current.style.transform = `scaleX(${p.toFixed(4)})`;
      if (rest.current) rest.current.style.transform = `scaleX(${(1 - p).toFixed(4)})`;
      // Part marks stay, but only the ones next to the thumb. Far ticks read as a ruler.
      const marks = rail.current?.querySelectorAll<HTMLElement>('.scrub-seg');
      if (marks) {
        for (const seg of marks) {
          const at = parseFloat(seg.style.left) / 100;
          const near = Number.isFinite(at) && Math.abs(at - p) < 0.045;
          const next = near ? (seg.classList.contains('is-inst') ? '0.18' : '0.28') : '0';
          if (seg.style.opacity !== next) seg.style.opacity = next;
        }
      }
      const text = formatTime(t) + '|' + formatTime(duration - t);
      if (text !== lastText) {
        lastText = text;
        if (cur.current) cur.current.textContent = formatTime(t);
        if (rem.current) rem.current.textContent = `−${formatTime(Math.max(0, duration - t))}`;
      }
      track.current?.setAttribute('aria-valuenow', String(Math.round(t)));
      track.current?.setAttribute('aria-valuetext', `${formatTime(t)} из ${formatTime(duration)}`);
      // The rounded second is what a person reads. The scene is the exact second.
      const stamp = t.toFixed(3);
      if (track.current && track.current.dataset.t !== stamp) track.current.dataset.t = stamp;
      const open = dragT.current != null || coast != null;
      bubble = stepSpring(bubble, open ? 1 : 0, dt, open ? BUBBLE : BUBBLE_OUT);
      if (open) {
        const view = previewOf(cueAt(timeline.cues, t));
        const key = view.part + '|' + view.line;
        if (key !== lastPreview) {
          const first = lastPreview === '';
          lastPreview = key;
          // A hidden box measures as 0. Show it before reading the new label's width.
          if (preview.current) preview.current.hidden = false;
          if (partEl.current) partEl.current.textContent = view.part;
          if (lineEl.current) lineEl.current.textContent = view.line;
          if (!first) labelSpring = { x: 0, v: 0 };
          const body = bubbleBody.current;
          if (body) {
            const measured = body.offsetWidth;
            const measuredH = body.offsetHeight;
            if (!haveWidth || measured < 2) {
              haveWidth = measured > 1;
              widthSpring = { x: measured, v: 0 };
              widthTarget = measured;
            } else widthTarget = measured;
            if (!haveHeight || measuredH < 2) {
              haveHeight = measuredH > 1;
              heightSpring = { x: measuredH, v: 0 };
              heightTarget = measuredH;
            } else heightTarget = measuredH;
          }
        }
      }
      labelSpring = stepSpring(labelSpring, 1, dt, LABEL_SPRING);
      if (haveWidth) widthSpring = stepSpring(widthSpring, widthTarget, dt, WIDTH_SPRING);
      if (haveHeight) heightSpring = stepSpring(heightSpring, heightTarget, dt, WIDTH_SPRING);
      const x = bubble.x;
      const closing = !open;
      const clamped = Math.max(0, Math.min(1, x));
      const over = Math.max(0, x - 1);
      const opacity = closing ? clamped : Math.min(1, clamped + over);
      const scale = closing ? 0.92 + 0.08 * clamped : 0.85 + 0.15 * clamped + over;
      const node = preview.current;
      if (!node) return;
      if (open || opacity > 0.02) {
        node.hidden = false;
        node.style.opacity = opacity.toFixed(3);
        node.style.transformOrigin = 'center bottom';
        const drawn = haveWidth ? Math.max(1, widthSpring.x) : node.scrollWidth;
        node.style.width = `${drawn.toFixed(1)}px`;
        if (haveHeight) node.style.height = `${Math.max(1, heightTarget).toFixed(1)}px`;
        const hScale = heightTarget > 1 ? Math.max(0.35, Math.min(1.15, heightSpring.x / heightTarget)) : 1;
        const tipX = p * w;
        smoothX = smoothX < 0 ? tipX : smoothX + (tipX - smoothX) * 0.22;
        const lift = open ? liftFor(node) : 0;
        node.style.transform = `translate3d(${smoothX.toFixed(2)}px, ${lift.toFixed(2)}px, 0) scale(${scale.toFixed(3)}) scaleY(${hScale.toFixed(3)})`;
        const body = bubbleBody.current;
        if (body) {
          const ly = (1 - Math.max(0, Math.min(1, labelSpring.x))) * 4;
          const counter = 1 / Math.max(0.35, hScale);
          body.style.opacity = Math.max(0, Math.min(1, labelSpring.x)).toFixed(3);
          body.style.transformOrigin = 'center bottom';
          body.style.transform = `translate3d(0, ${ly.toFixed(2)}px, 0) scaleY(${counter.toFixed(3)})`;
        }
      } else if (!node.hidden) {
        node.hidden = true;
        node.style.opacity = '0';
        node.style.height = '';
        lastPreview = '';
        haveWidth = false;
        haveHeight = false;
        smoothX = -1;
        previewGap = -1;
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
          paint(dragT.current + gap * pull * 0.7, dt, true);
        } else {
          paint(dragT.current, dt, true);
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
        paint(coast.t, dt, true);
        if (Math.abs(coast.v) < 0.35) {
          const landed = slow && Math.abs(magnet - coast.t) < window ? magnet : coast.t;
          coast = null;
          const at = Math.min(duration, Math.max(0, landed));
          seekRef.current(at);
          previewRef.current?.(null);
        }
        return;
      }
      paint(clock(), dt, false);
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
      grabSince = performance.now();
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
      grabSince = 0;
      setDragging(false);
      if (Math.abs(velocity) > Math.max(6, duration * 0.08)) coast = { t, v: velocity };
      else {
        seekRef.current(t);
        previewRef.current?.(null);
      }
    };
    const cancel = () => {
      if (dragT.current == null) return;
      const t = dragT.current;
      dragT.current = null;
      grabSince = 0;
      coast = null;
      setDragging(false);
      seekRef.current(t);
      previewRef.current?.(null);
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
        <div ref={rail} className="scrub-rail">
          <div ref={played} className="scrub-played" />
          {partMarks.map((seg) => (
            <span
              key={seg.id}
              className={`scrub-seg${seg.kind === 'inst' ? ' is-inst' : ''}`}
              style={{ left: `${(seg.start / span) * 100}%` }}
            />
          ))}
          <div ref={rest} className="scrub-rest" />
        </div>
        <div ref={head} className="scrub-head" />
        <div ref={preview} className="scrub-preview" hidden>
          <div ref={bubbleBody} className="scrub-preview-body">
            <span ref={partEl} className="scrub-preview-part" />
            <span ref={lineEl} className="scrub-preview-line" />
          </div>
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
