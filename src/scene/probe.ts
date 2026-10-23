/**
 * One-shot render failure for the resume crash test.
 * The call site in Scene is compiled out of the Vercel production build
 * (`__SCENE_PROBE__` in vite.config.ts), so a reader cannot open it.
 *
 * The flag stays armed until the error boundary acknowledges it. React retries
 * a failed render once; consuming the flag on the first throw let that retry
 * succeed and skipped the boundary, so the error was never recorded.
 */
declare const __SCENE_PROBE__: boolean | undefined;

let settled = false;

/** True while `?ll-render-error=1` is set and the boundary has not caught it yet. */
export function sceneProbeArmed(search: string): boolean {
  if (typeof __SCENE_PROBE__ === 'undefined' || !__SCENE_PROBE__ || settled) return false;
  const q = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(q).get('ll-render-error') === '1';
}

/** The boundary calls this before remounting, so the next render paints. */
export function acknowledgeSceneProbe(): void {
  settled = true;
}
