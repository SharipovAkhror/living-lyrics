/**
 * Play and pause crossed by opacity. The contact sheet skips CSS animation,
 * so the blend is an inline spring of about 140 ms. No turn: a spin read as a
 * second icon in the middle of the swap.
 */
import { useLayoutEffect, useRef } from 'react';
import { motionBlocked } from '@/app/morph';
import { PlayerIcon } from './playerIcons';
import { stepSpring, type SpringState } from './spring';

/** Settles in about 140 ms. */
const MORPH = { stiffness: 320, damping: 32, mass: 1 };

function paint(play: HTMLElement, pause: HTMLElement, t: number) {
  const a = Math.max(0, Math.min(1, t));
  play.style.opacity = (1 - a).toFixed(3);
  pause.style.opacity = a.toFixed(3);
  play.style.transform = 'none';
  pause.style.transform = 'none';
}

export function PlayPause({ playing, size = 28 }: { playing: boolean; size?: number }) {
  const playRef = useRef<HTMLSpanElement>(null);
  const pauseRef = useRef<HTMLSpanElement>(null);
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
  const hidden = { opacity: 0 } as const;
  return (
    <span className="play-glyph" style={{ width: px, height: px }}>
      <span ref={playRef} className="play-glyph-mark" style={playing ? hidden : undefined}>
        <PlayerIcon name="play" size={px} />
      </span>
      <span ref={pauseRef} className="play-glyph-mark" style={playing ? undefined : hidden}>
        <PlayerIcon name="pause" size={px} />
      </span>
    </span>
  );
}
