/**
 * The song's sky: three washes from its palette and a fixed field of stars.
 * Position and brightness are a function of playback time, so a seek paints the same sky.
 * Nothing here is a game engine. A hidden or off-screen field does not keep a timer.
 */
import { useEffect, useMemo, useRef } from 'react';

function skyAt(t: number) {
  const a = t * 0.018;
  return {
    x1: 50 + Math.sin(a) * 18,
    y1: 38 + Math.cos(a * 0.73) * 16,
    x2: 70 + Math.sin(a * 0.51 + 1.4) * 16,
    y2: 64 + Math.cos(a * 0.44 + 0.5) * 14,
    x3: 26 + Math.sin(a * 0.36 + 2.2) * 12,
    y3: 76 + Math.cos(a * 0.66 + 1) * 10,
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  p: number;
}

/** Forty-eight stars, the same ones every visit. Seeded so the sky is not a fresh random each mount. */
function starField(): Star[] {
  let s = 20261017;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: Star[] = [];
  for (let i = 0; i < 48; i++) out.push({ x: next() * 100, y: next() * 100, r: 1.1 + next() * 1.3, p: next() * 6.28 });
  return out;
}

export function Field({
  colors,
  dark,
  clock,
  t = 0,
  still = false,
}: {
  colors: string[];
  dark: boolean;
  /** Playback seconds. Omit for a frozen sky (`t`). */
  clock?: () => number;
  t?: number;
  /** One frame, then stop. Library bands use this. */
  still?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLDivElement>(null);
  const starEls = useRef<(HTMLElement | null)[]>([]);
  const stars = useMemo(starField, []);
  const [c1, c2, c3, c4] = colors;

  useEffect(() => {
    const host = root.current;
    const wash = sky.current;
    if (!host || !wash) return;
    let timer = 0;
    let lastT = -1;
    let seen = false;
    const nodes = starEls.current;

    const paint = (time: number) => {
      const p = skyAt(time);
      wash.style.setProperty('--x1', `${p.x1.toFixed(2)}%`);
      wash.style.setProperty('--y1', `${p.y1.toFixed(2)}%`);
      wash.style.setProperty('--x2', `${p.x2.toFixed(2)}%`);
      wash.style.setProperty('--y2', `${p.y2.toFixed(2)}%`);
      wash.style.setProperty('--x3', `${p.x3.toFixed(2)}%`);
      wash.style.setProperty('--y3', `${p.y3.toFixed(2)}%`);
      for (let i = 0; i < stars.length; i++) {
        const node = nodes[i];
        if (!node) continue;
        const tw = 0.5 + 0.5 * Math.sin(time * 0.22 + stars[i].p);
        node.style.opacity = (dark ? 0.28 + tw * 0.62 : 0.16 + tw * 0.3).toFixed(3);
      }
    };

    const tick = () => {
      timer = 0;
      if (document.hidden || !seen) return;
      const time = clock ? clock() : t;
      if (lastT < 0 || Math.abs(time - lastT) >= 0.01) {
        lastT = time;
        paint(time);
      }
      if (!still && clock) timer = window.setTimeout(tick, 100);
    };

    const start = () => {
      if (timer || document.hidden || !seen) return;
      tick();
    };
    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      seen = entry.isIntersecting;
      if (seen) start();
      else stop();
    });
    io.observe(host);
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [clock, t, still, dark, stars]);

  return (
    <div
      ref={root}
      className={`field${dark ? ' is-dark' : ''}`}
      style={{ ['--f1' as string]: c1, ['--f2' as string]: c2, ['--f3' as string]: c3, ['--f4' as string]: c4 ?? c3 }}
      aria-hidden
    >
      <div ref={sky} className="field-sky" />
      <div className="field-veil" />
      {stars.map((star, i) => (
        <i
          key={i}
          ref={(el) => {
            starEls.current[i] = el;
          }}
          className="field-star"
          style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.r, height: star.r }}
        />
      ))}
    </div>
  );
}
