/**
 * Timeline scrubber: a thin track that thickens under the finger, tap or drag to seek.
 * Instrumental stretches are marked on the rail. Time sits above the rail, beside an optional control.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Timeline } from '@/data/timeline';
import { formatTime } from '@/data/library';
import { stageCovered, watchCover } from '@/scene/cover';

export function Scrubber({
  timeline,
  duration,
  clock,
  onSeek,
  accessory,
}: {
  timeline: Timeline;
  duration: number;
  clock: () => number;
  onSeek: (t: number) => void;
  /** Sits on the time row, opposite the current time. The mismatch key lives here. */
  accessory?: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLSpanElement>(null);
  const rem = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragT = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastText = '';
    let lastScale = '';
    let lastT = Number.NaN;
    const loop = () => {
      raf = 0;
      if (stageCovered()) return;
      raf = requestAnimationFrame(loop);
      const t = dragT.current ?? clock();
      if (t === lastT) return;
      lastT = t;
      const p = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
      // Three decimals is about one pixel on the rail. A fresh string every frame grew WebKit's set.
      const scale = `scaleX(${p.toFixed(3)})`;
      if (fill.current && scale !== lastScale) {
        lastScale = scale;
        fill.current.style.transform = scale;
      }
      const text = formatTime(t) + '|' + formatTime(duration - t);
      if (text !== lastText) {
        lastText = text;
        if (cur.current) cur.current.textContent = formatTime(t);
        if (rem.current) rem.current.textContent = `−${formatTime(Math.max(0, duration - t))}`;
        track.current?.setAttribute('aria-valuenow', String(Math.round(t)));
        track.current?.setAttribute('aria-valuetext', `${formatTime(t)} из ${formatTime(duration)}`);
      }
    };
    const unwatch = watchCover(() => {
      if (!stageCovered() && !raf) raf = requestAnimationFrame(loop);
    });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unwatch();
    };
  }, [clock, duration]);

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };

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
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          dragT.current = timeAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragT.current != null) dragT.current = timeAt(e.clientX);
        }}
        onPointerUp={() => {
          if (dragT.current != null) onSeek(dragT.current);
          dragT.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragT.current = null;
          setDragging(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(clock() - 5);
          else if (e.key === 'ArrowRight') onSeek(clock() + 5);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="scrub-rail">
          {timeline.cues
            .filter((c) => c.kind === 'inst')
            .map((c) => (
              <span
                key={c.idx}
                className="scrub-inst"
                style={{ left: `${(c.start / duration) * 100}%`, width: `${((c.end - c.start) / duration) * 100}%` }}
              />
            ))}
          <div ref={fill} className="scrub-fill" />
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
