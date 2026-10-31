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
  const hoverT = useRef<number | null>(null);
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
    let lastRail = '';
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
    // The frame loop used to measure the track. During the cover rise that
    // read forced a layout of the whole page on every frame.
    let trackW = track.current?.offsetWidth || 1;
    let trackTop = 0;
    let noteTop = 0;
    let noteBottom = 0;
    let noteH = 0;
    let bubbleH = 0;
    const width = () => trackW;
    const rememberPlaces = () => {
      const host = track.current;
      if (host) {
        trackW = host.offsetWidth || trackW;
        trackTop = host.getBoundingClientRect().top;
      }
      const note = document.querySelector('.note-card');
      if (note instanceof HTMLElement) {
        const box = note.getBoundingClientRect();
        noteTop = box.top;
        noteBottom = box.bottom;
        noteH = box.height;
      } else noteH = 0;
    };
    const trackObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 1) trackW = rect.width;
    });
    if (track.current) trackObserver.observe(track.current);

    const liftFor = (node: HTMLElement) => {
      if (noteH < 8) return 0;
      if (previewGap < 0) previewGap = parseFloat(getComputedStyle(node).bottom) || 8;
      const layoutBottom = trackTop - previewGap;
      const layoutTop = layoutBottom - (bubbleH || node.offsetHeight);
      if (layoutBottom > noteTop + 4 && layoutTop < noteBottom - 4) {
        return Math.min(0, noteTop - 8 - layoutBottom);
      }
      return 0;
    };

    const paint = (t: number, dt: number, live: boolean) => {
      previewRef.current?.(live ? t : null);
      const span = duration > 0 ? duration : 1;
      const w = width();
      const holding = dragT.current != null;
      const hovering = hoverT.current != null && !holding && coast == null;
      const songT = hovering ? clock() : t;
      const p = Math.min(1, Math.max(0, songT / span));
      const pTip = Math.min(1, Math.max(0, t / span));
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
      // Hidden at rest. A fine pointer shows it; a drag grows it further.
      const headScale = holding ? 1.15 + 0.55 * g : hovering ? 1.2 : 0;
      const railKey = `${p.toFixed(4)}|${headScale.toFixed(3)}|${Math.round(w)}`;
      if (railKey !== lastRail) {
        lastRail = railKey;
        if (head.current) {
          head.current.style.transform = `translate3d(${(p * w).toFixed(2)}px, -50%, 0) scale(${headScale.toFixed(3)})`;
          head.current.style.opacity = headScale > 0.05 ? '1' : '0';
        }
        if (played.current) played.current.style.transform = `scaleX(${p.toFixed(4)})`;
        if (rest.current) rest.current.style.transform = `scaleX(${(1 - p).toFixed(4)})`;
        // Part marks stay, but only the ones next to the thumb. Far ticks read as a ruler.
        const marks = rail.current?.querySelectorAll<HTMLElement>('.scrub-seg');
        if (marks) {
          for (const seg of marks) {
            const at = parseFloat(seg.style.left) / 100;
            const near = Number.isFinite(at) && Math.abs(at - p) < 0.045;
            seg.classList.toggle('is-near', near);
            const next = near ? '1' : '0';
            if (seg.style.opacity !== next) seg.style.opacity = next;
          }
        }
      }
      // Hover previews in the bubble only. The clock stays on the song.
      if (!hovering) {
        const text = formatTime(t) + '|' + formatTime(duration - t);
        if (text !== lastText) {
          lastText = text;
          if (cur.current) cur.current.textContent = formatTime(t);
          if (rem.current) rem.current.textContent = `−${formatTime(Math.max(0, duration - t))}`;
          track.current?.setAttribute('aria-valuenow', String(Math.round(t)));
          track.current?.setAttribute('aria-valuetext', `${formatTime(t)} из ${formatTime(duration)}`);
        }
        const stamp = t.toFixed(3);
        if (track.current && track.current.dataset.t !== stamp) track.current.dataset.t = stamp;
      }
      const open = holding || coast != null || hovering;
      // The first hover frame is already readable. A spring from 0 misses a 100 ms sample.
      if (open && bubble.x < 0.2) bubble = { x: 1, v: 0 };
      else bubble = stepSpring(bubble, open ? 1 : 0, dt, open ? BUBBLE : BUBBLE_OUT);
      if (open) {
        const cue = cueAt(timeline.cues, t);
        const view = hovering ? { part: formatTime(t), line: cue?.section.label ?? '' } : previewOf(cue);
        const key = view.part + '|' + view.line;
        if (key !== lastPreview) {
          const first = lastPreview === '';
          lastPreview = key;
          // A hidden box measures as 0. Show it before reading the new label's width.
          if (preview.current) preview.current.hidden = false;
          if (partEl.current) partEl.current.textContent = view.part;
          if (lineEl.current) lineEl.current.textContent = view.line;
          if (!first) labelSpring = { x: 0, v: 0 };
          if (first) rememberPlaces();
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
            bubbleH = measuredH;
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
        const tipX = pTip * w;
        smoothX = hovering || smoothX < 0 ? tipX : smoothX + (tipX - smoothX) * 0.22;
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
        // The finger owns the pixel. The boundary magnet stays on a coast only.
        paint(dragT.current, dt, true);
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
      if (hoverT.current != null) {
        paint(hoverT.current, dt, false);
        return;
      }
      paint(clock(), dt, false);
    };
    raf = requestAnimationFrame(loop);

    const node = track.current;
    if (!node) {
      return () => {
        trackObserver.disconnect();
        cancelAnimationFrame(raf);
      };
    }
    let originX = 0;
    let originT = 0;
    let lastX = 0;
    let lastMove = 0;
    let vx = 0;

    const timeAt = (clientX: number) => {
      const r = node.getBoundingClientRect();
      return Math.min(duration, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * duration));
    };

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      coast = null;
      hoverT.current = null;
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
      if (dragT.current == null) {
        if (fine && event.pointerType !== 'touch') hoverT.current = timeAt(event.clientX);
        return;
      }
      hoverT.current = null;
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

    const leave = () => {
      if (dragT.current == null) hoverT.current = null;
    };
    let wheelLock = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const big = event.deltaMode === 1 || Math.abs(delta) >= 50;
      if (!big && Math.abs(delta) < 8) return;
      const now = performance.now();
      if (now < wheelLock) return;
      wheelLock = now + (big ? 80 : 220);
      seekRef.current(Math.min(duration, Math.max(0, clock() + (delta > 0 ? 5 : -5))));
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      trackObserver.disconnect();
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('wheel', onWheel);
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
