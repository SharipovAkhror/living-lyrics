/**
 * Timeline. The playhead is a transform written in the same frame as the finger.
 * There is no coast and no magnet: a flick used to keep the song in the scrub
 * state after pointerup, and the frame probe still measured that work.
 * The bubble does not write width or height. Those layout writes sat on the
 * same frames as the stage.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Cue, Timeline } from '@/data/timeline';
import { lineText } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { stepSpring, type SpringState } from '@/ui/spring';

/** Entry is already readable. Exit is the fast critical spring. */
const BUBBLE = { stiffness: 790, damping: 40, mass: 1 };
const BUBBLE_OUT = { stiffness: 1600, damping: 80, mass: 1 };

interface Segment {
  id: string;
  label: string;
  kind: 'vocal' | 'inst';
  start: number;
  end: number;
}

function segmentsOf(timeline: Timeline, duration: number): Segment[] {
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
    out.push({
      id: cue.section.id,
      label: cue.section.label,
      kind: cue.kind === 'inst' ? 'inst' : 'vocal',
      start,
      end,
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
}: {
  timeline: Timeline;
  duration: number;
  clock: () => number;
  onSeek: (t: number) => void;
  /** Song time under the finger, or null once the engine clock is the source again. */
  onPreview?: (t: number | null) => void;
  /** Sits on the time row, opposite the current time. The mismatch key lives here. */
  accessory?: ReactNode;
  /** Kept so older call sites compile. The bed no longer takes the song colour. */
  colors?: string[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLSpanElement>(null);
  const rem = useRef<HTMLSpanElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const partEl = useRef<HTMLSpanElement>(null);
  const lineEl = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragT = useRef<number | null>(null);
  const hoverT = useRef<number | null>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const segments = segmentsOf(timeline, duration);
  const span = Math.max(duration, 0.001);
  let lastMark = 0;
  const partMarks = segments.filter((seg) => {
    const at = seg.start / span;
    if (at < 0.012 || at - lastMark < 0.04) return false;
    lastMark = at;
    return true;
  });
  let lastMap = -1;
  const mapMarks = segments.filter((seg) => {
    const at = seg.start / span;
    if (at < 0.008 || at - lastMap < 0.012) return false;
    lastMap = at;
    return true;
  });
  const boundsKey = segments.map((seg) => `${seg.id}:${seg.start}:${seg.end}`).join('|');

  useEffect(() => {
    let raf = 0;
    let lastText = '';
    let lastPreview = '';
    let lastRail = '';
    let last = performance.now();
    let bubble: SpringState = { x: 0, v: 0 };
    let sentLive = false;
    let segs: HTMLElement[] | null = null;
    const trackObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 1) trackW = rect.width;
    });
    let trackW = track.current?.offsetWidth || 1;
    if (track.current) trackObserver.observe(track.current);

    const publish = (t: number, live: boolean) => {
      if (live) {
        sentLive = true;
        previewRef.current?.(t);
        return;
      }
      if (!sentLive) return;
      sentLive = false;
      previewRef.current?.(null);
    };

    const paint = (t: number, dt: number, live: boolean) => {
      publish(t, live);
      const spanNow = duration > 0 ? duration : 1;
      const w = trackW;
      const holding = dragT.current != null;
      const hovering = hoverT.current != null && !holding;
      const songT = hovering ? clock() : t;
      const p = Math.min(1, Math.max(0, songT / spanNow));
      const pTip = Math.min(1, Math.max(0, t / spanNow));
      // Immediate. A spring still read as rest scale at the 320 ms sample on WebKit,
      // and a 0.22 follow on the bubble was the lag under the finger.
      const headScale = holding ? 1.28 : 1;
      const railKey = `${p.toFixed(4)}|${headScale}|${Math.round(w)}`;
      if (railKey !== lastRail) {
        lastRail = railKey;
        if (head.current) {
          head.current.style.transform = `translate3d(${(p * w).toFixed(2)}px, -50%, 0) scale(${headScale})`;
        }
        if (played.current) played.current.style.transform = `scaleX(${p.toFixed(4)})`;
        if (!segs && track.current) segs = [...track.current.querySelectorAll<HTMLElement>('.scrub-seg')];
        if (segs) {
          for (const seg of segs) {
            const at = parseFloat(seg.style.left) / 100;
            const near = Number.isFinite(at) && Math.abs(at - p) < 0.045;
            if (seg.classList.contains('is-near') !== near) seg.classList.toggle('is-near', near);
            const next = near ? '0.55' : '0';
            if (seg.style.opacity !== next) seg.style.opacity = next;
          }
        }
      }
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
      const open = holding || hovering;
      if (open && bubble.x < 0.2) bubble = { x: 1, v: 0 };
      else bubble = stepSpring(bubble, open ? 1 : 0, dt, open ? BUBBLE : BUBBLE_OUT);
      if (open) {
        const cue = cueAt(timeline.cues, t);
        const view = hovering ? { part: formatTime(t), line: cue?.section.label ?? '' } : previewOf(cue);
        const key = view.part + '|' + view.line;
        if (key !== lastPreview) {
          lastPreview = key;
          if (partEl.current) partEl.current.textContent = view.part;
          if (lineEl.current) lineEl.current.textContent = view.line;
        }
      }
      const node = preview.current;
      if (!node) return;
      const x = bubble.x;
      const closing = !open;
      const clamped = Math.max(0, Math.min(1, x));
      const opacity = closing ? clamped : 1;
      if (open || opacity > 0.02) {
        node.hidden = false;
        node.style.opacity = opacity.toFixed(3);
        node.style.transform = `translate3d(${(pTip * w).toFixed(2)}px, 0, 0)`;
      } else if (!node.hidden) {
        node.hidden = true;
        node.style.opacity = '0';
        lastPreview = '';
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
      if (dragT.current != null) {
        paint(dragT.current, dt, true);
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
    let trackRect: DOMRect | null = null;
    const timeAt = (clientX: number, fresh = false) => {
      const r = !fresh && trackRect ? trackRect : (trackRect = node.getBoundingClientRect());
      return Math.min(duration, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * duration));
    };

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      hoverT.current = null;
      node.setPointerCapture(event.pointerId);
      originX = event.clientX;
      trackRect = node.getBoundingClientRect();
      trackW = trackRect.width || trackW;
      originT = timeAt(event.clientX);
      dragT.current = originT;
      setDragging(true);
      paint(originT, 0.016, true);
    };
    const move = (event: PointerEvent) => {
      if (dragT.current == null) {
        if (fine && event.pointerType !== 'touch') hoverT.current = timeAt(event.clientX, true);
        return;
      }
      hoverT.current = null;
      const widthPx = trackRect?.width || trackW || 1;
      dragT.current = Math.min(duration, Math.max(0, originT + ((event.clientX - originX) / Math.max(1, widthPx)) * duration));
      paint(dragT.current, 0.016, true);
    };
    const finish = (t: number) => {
      dragT.current = null;
      hoverT.current = null;
      setDragging(false);
      seekRef.current(t);
      sentLive = true;
      previewRef.current?.(null);
      sentLive = false;
    };
    const up = (event: PointerEvent) => {
      if (dragT.current == null) return;
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      finish(dragT.current);
    };
    const cancel = () => {
      if (dragT.current == null) return;
      finish(dragT.current);
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
        <div className="scrub-rail">
          <div ref={played} className="scrub-played" />
          <div className="scrub-rest" />
        </div>
        <div className="scrub-ticks" aria-hidden="true">
          {mapMarks.map((seg) => (
            <span
              key={`map-${seg.id}`}
              className={`scrub-map${seg.kind === 'inst' ? ' is-inst' : ''}`}
              style={{ left: `${(seg.start / span) * 100}%` }}
            />
          ))}
          {partMarks.map((seg) => (
            <span
              key={seg.id}
              className={`scrub-seg${seg.kind === 'inst' ? ' is-inst' : ''}`}
              style={{ left: `${(seg.start / span) * 100}%` }}
            />
          ))}
        </div>
        <div ref={head} className="scrub-head" />
        <div ref={preview} className="scrub-preview" hidden>
          <div className="scrub-preview-body">
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
