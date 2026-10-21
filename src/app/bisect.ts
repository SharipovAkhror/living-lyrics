/**
 * Measurement switch for the iPhone memory bisect. Inert unless the page is
 * opened with `?bisect=<name>`. The names are the parts of the live scene.
 */

const NAMES = new Set([
  'field',
  'stars',
  'wash',
  'instruments',
  'words',
  'placement',
  'slots',
  'measure',
  'scrubber',
  'mediasession',
  'react',
  // Phone line hosts use a 2d translate, so the slot is not a translateZ layer.
  'layer',
  // Engraving halo and hit flash (drop-shadow) stay off. Brightness remains.
  'glow',
]);

/** `?bisect=field` or `?bisect=field,words`. Inert when the parameter is absent. */
export function bisect(name: string): boolean {
  if (typeof location === 'undefined') return false;
  const value = new URLSearchParams(location.search).get('bisect');
  if (!value || !NAMES.has(name)) return false;
  return value.split(',').includes(name);
}
