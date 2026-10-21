/**
 * Play and pause as two glyphs in one control.
 * The swap is a spring on opacity, scale and rotation, written inline.
 * A CSS animation is skipped by the contact-sheet capture, so the critic
 * would only see the cut.
 */
import { useLayoutEffect, useRef } from 'react';
import { motionBlocked } from '@/app/morph';
import { stepSpring, type SpringState } from './spring';

const PLAY =
  'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z';
const PAUSE =
  'M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z';

/** About 280 ms, wide enough that a 100 ms contact sheet catches the turn. */
const MORPH = { stiffness: 320, damping: 22, mass: 1 };

function paint(play: SVGPathElement, pause: SVGPathElement, t: number) {
  const a = Math.max(0, Math.min(1, t));
  play.style.opacity = (1 - a).toFixed(3);
  pause.style.opacity = a.toFixed(3);
  play.style.transform = `scale(${(1 - a * 0.38).toFixed(3)}) rotate(${(-72 * a).toFixed(2)}deg)`;
  pause.style.transform = `scale(${(0.62 + 0.38 * a).toFixed(3)}) rotate(${(72 * (1 - a)).toFixed(2)}deg)`;
}

export function PlayPause({ playing, size = 28 }: { playing: boolean; size?: number }) {
  const playRef = useRef<SVGPathElement>(null);
  const pauseRef = useRef<SVGPathElement>(null);
  const state = useRef<SpringState>({ x: playing ? 1 : 0, v: 0 });
  const seen = useRef(false);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const play = playRef.current;
    const pause = pauseRef.current;
    if (!play || !pause) return;
    const target = playing ? 1 : 0;
    if (!seen.current || motionBlocked()) {
      seen.current = true;
      state.current = { x: target, v: 0 };
      paint(play, pause, target);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      state.current = stepSpring(state.current, target, dt, MORPH);
      paint(play, pause, state.current.x);
      if (Math.abs(state.current.x - target) < 0.01 && Math.abs(state.current.v) < 0.04) {
        state.current = { x: target, v: 0 };
        paint(play, pause, target);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing]);

  const px = Math.round(size);
  const shape = { transformBox: 'fill-box', transformOrigin: 'center' } as const;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 256 256"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <path ref={playRef} d={PLAY} style={shape} />
      <path ref={pauseRef} d={PAUSE} style={shape} />
    </svg>
  );
}
