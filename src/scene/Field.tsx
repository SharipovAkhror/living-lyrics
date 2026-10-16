/**
 * Animated colour field behind the Scene: four soft light sources drifting on slow Lissajous paths,
 * breathing with the music's loudness envelope. Rendered on a tiny canvas and upscaled — cheap and smooth.
 */
import { useEffect, useRef } from 'react';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function Field({
  colors,
  dark,
  energy,
  still,
}: {
  colors: string[];
  dark: boolean;
  /** Returns 0..1 loudness for "now". */
  energy: () => number;
  still: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const rgb = colors.map(hexToRgb);
    let raf = 0;
    let last = 0;
    let smooth = 0;
    const W = 72;
    const H = 128;
    canvas.width = W;
    canvas.height = H;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33 && !still) return; // ~30 fps is plenty for a blurred field
      last = now;
      const t = still ? 12 : now / 1000;
      smooth += (energy() - smooth) * 0.12;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = dark ? '#050507' : '#faf9f7';
      ctx.fillRect(0, 0, W, H);
      if (dark) ctx.globalCompositeOperation = 'lighter';
      const paths = [
        [0.27, 0.031, 0.043, 0.0],
        [0.73, 0.023, 0.037, 1.7],
        [0.5, 0.017, 0.029, 3.1],
        [0.38, 0.029, 0.021, 4.4],
      ];
      rgb.forEach(([r, g, b], i) => {
        const [cx, fx, fy, ph] = paths[i % paths.length];
        const x = (cx + 0.28 * Math.sin(t * fx * 6.28 + ph)) * W;
        const y = (0.5 + 0.36 * Math.sin(t * fy * 6.28 + ph * 1.3)) * H;
        const rad = (0.55 + 0.1 * Math.sin(t * 0.21 + i) + 0.14 * smooth) * Math.max(W, H);
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
        // Dark: additive light. Light: translucent pastel washes over paper white.
        const k = dark ? 0.42 + 0.25 * smooth : 0.3 + 0.12 * smooth;
        grd.addColorStop(0, `rgba(${r},${g},${b},${k})`);
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);
      });
      if (!dark) {
        // Lift the whole field toward white so text keeps AAA contrast.
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(draw);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [colors, dark, energy, still]);

  return (
    <div className="field" aria-hidden>
      <canvas ref={ref} className="field-canvas" />
      <div className="field-grain" />
    </div>
  );
}
