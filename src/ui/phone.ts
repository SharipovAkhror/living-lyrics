/**
 * Phone budget. Desktop (a mouse, or a window that is not a coarse pointer) is unchanged.
 * A real iPhone matches the media query. Playwright's iPhone profile also sends an iPhone
 * user agent, so the same budget applies when the media features are not emulated.
 */

export const PHONE_MEDIA = '(hover: none) and (pointer: coarse) and (max-width: 1100px)';

let cached: boolean | null = null;

export function isPhone(): boolean {
  if (cached != null) return cached;
  if (typeof matchMedia === 'undefined') return false;
  const coarse = matchMedia(PHONE_MEDIA).matches;
  const ua = typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent);
  cached = coarse || ua;
  return cached;
}

/** Keep `dataset.phone` in step with `isPhone`, including rotation. */
export function installPhoneBudget(): void {
  if (typeof document === 'undefined' || typeof matchMedia === 'undefined') return;
  const query = matchMedia(PHONE_MEDIA);
  const apply = () => {
    const ua = /iPhone|iPod/.test(navigator.userAgent);
    cached = query.matches || ua;
    if (cached) document.documentElement.dataset.phone = '1';
    else delete document.documentElement.dataset.phone;
  };
  apply();
  query.addEventListener('change', apply);
}
