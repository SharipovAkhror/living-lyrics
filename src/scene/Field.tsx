/**
 * The song's sky: three washes from its palette and a fixed field of stars.
 * Position and brightness are a function of playback time, so a seek paints the same sky.
 * Nothing here is a game engine. A hidden or off-screen field does not keep a timer.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { bisect } from '@/app/bisect';
import { isPhone } from '@/ui/phone';
import { stageCovered, watchCover } from './cover';

function skyAt(t: number) {
  const a = t * 0.011;
  return {
    x1: 50 + Math.sin(a) * 18,
    y1: 38 + Math.cos(a * 0.73) * 16,
    x2: 70 + Math.sin(a * 0.51 + 1.4) * 16,
    y2: 64 + Math.cos(a * 0.44 + 0.5) * 14,
    x3: 26 + Math.sin(a * 0.36 + 2.2) * 12,
    y3: 76 + Math.cos(a * 0.66 + 1) * 10,
  };
}

/**
 * Percent translate of a 250% layer whose centre sits on the field centre.
 * `percent` is the old gradient centre, measured on the inset -12% sky box
 * (124% of the field). 50 on that box is the field centre, so the translate is 0.
 */
export function washTranslate(percent: number): number {
  const field = -0.12 + 1.24 * (percent / 100);
  return ((field - 0.5) / 2.5) * 100;
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
  for (let i = 0; i < 48; i++) out.push({ x: next() * 100, y: next() * 100, r: 0.6 + next() * 0.7, p: next() * 6.28 });
  return out;
}

export const Field = memo(function Field({
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
  const washes = useRef<(HTMLDivElement | null)[]>([]);
  const starEls = useRef<(HTMLElement | null)[]>([]);
  const stars = useMemo(starField, []);
  const [c1, c2, c3, c4] = colors;

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let timer = 0;
    let lastT = -1;
    let lastStar = Number.NaN;
    let seen = false;
    const nodes = starEls.current;

    const paint = (time: number) => {
      const phone = isPhone();
      // The three washes are fixed gradient images. Playback only translates
      // them, which stays on the compositor. Rewriting the gradient string
      // kept a new WebKit raster each time (T27). The translate is a function
      // of playback time, so a seek paints the same sky.
      if (!bisect('wash')) {
        const p = skyAt(time);
        const centres = [
          [p.x1, p.y1],
          [p.x2, p.y2],
          [p.x3, p.y3],
        ];
        for (let i = 0; i < centres.length; i++) {
          const node = washes.current[i];
          if (!node) continue;
          const transform = `translate3d(${washTranslate(centres[i][0]).toFixed(2)}%, ${washTranslate(centres[i][1]).toFixed(2)}%, 0)`;
          if (node.style.transform !== transform) node.style.transform = transform;
        }
      }
      // Stars are a few opacity steps. Phones sample them on a 0.4 s bucket of
      // the song clock so a seek repeats the frame and the writes stay few.
      const starTime = phone ? Math.floor(time / 0.4) * 0.4 : time;
      if (!bisect('stars') && starTime !== lastStar) {
        lastStar = starTime;
        for (let i = 0; i < stars.length; i++) {
          const node = nodes[i];
          if (!node) continue;
          const tw = 0.5 + 0.5 * Math.sin(starTime * 0.22 + stars[i].p);
          const opacity = (dark ? 0.04 + tw * 0.06 : 0.02 + tw * 0.03).toFixed(phone ? 2 : 3);
          if (node.style.opacity !== opacity) node.style.opacity = opacity;
        }
      }
    };

    const tick = () => {
      timer = 0;
      if (stageCovered() || !seen) return;
      const time = clock ? clock() : t;
      if (lastT < 0 || Math.abs(time - lastT) >= 0.01) {
        lastT = time;
        paint(time);
      }
      if (!still && clock) timer = window.setTimeout(tick, 100);
    };

    const start = () => {
      if (timer || stageCovered() || !seen) return;
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
    const unwatch = watchCover(() => {
      if (stageCovered()) stop();
      else start();
    });
    return () => {
      stop();
      io.disconnect();
      unwatch();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [clock, t, still, dark, stars]);

  if (bisect('field')) return null;

  return (
    <div
      ref={root}
      className={`field${dark ? ' is-dark' : ''}`}
      style={{ ['--f1' as string]: c1, ['--f2' as string]: c2, ['--f3' as string]: c3, ['--f4' as string]: c4 ?? c3 }}
      aria-hidden
    >
      <div className="field-sky">
        <div
          ref={(el) => {
            washes.current[0] = el;
          }}
          className="field-wash field-wash-1"
        />
        <div
          ref={(el) => {
            washes.current[1] = el;
          }}
          className="field-wash field-wash-2"
        />
        <div
          ref={(el) => {
            washes.current[2] = el;
          }}
          className="field-wash field-wash-3"
        />
      </div>
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
});
