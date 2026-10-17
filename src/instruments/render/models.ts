/** Which instruments have a built GLB. Families add a file and rebuild the index; this module stays. */

let pending: Promise<Set<string>> | null = null;
let known: Set<string> | null = null;

export function loadModelIndex(): Promise<Set<string>> {
  if (known) return Promise.resolve(known);
  if (!pending) {
    pending = fetch('/instruments/3d/index.json')
      .then((res) => (res.ok ? res.json() : { instruments: [] }))
      .then((data: { instruments?: string[] }) => {
        known = new Set(data.instruments ?? []);
        return known;
      })
      .catch(() => {
        known = new Set();
        return known;
      });
  }
  return pending;
}

export function hasModelSync(key: string): boolean {
  return known?.has(key) ?? false;
}
