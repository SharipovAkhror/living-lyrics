/** Whether the page should try a 3D instrument or stay with the engraving. No three.js import. */
import type { MotionPref } from '@/app/settings';

type NavWithMemory = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

let webgl: boolean | null = null;

export function webglAvailable(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      webgl = false;
      return false;
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    webgl = true;
    return true;
  } catch {
    webgl = false;
    return false;
  }
}

/**
 * Save-Data or a device with 2 GB of RAM or less. Hardware concurrency is not used:
 * an iPhone often reports 4 cores and should still get the models.
 */
export function weakDevice(): boolean {
  const nav = navigator as NavWithMemory;
  if (nav.connection?.saveData) return true;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return true;
  return false;
}

/** `off` includes the OS “reduce motion” switch via `effectiveMotion`. Calm motion still allows 3D. */
export function canTry3d(motion: MotionPref): boolean {
  if (motion === 'off') return false;
  if (weakDevice()) return false;
  return webglAvailable();
}
