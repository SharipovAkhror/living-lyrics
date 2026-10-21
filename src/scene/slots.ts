/**
 * Phone lyric slots. WebKit kept the backing store of a line each time the flow
 * unmounted it, and the working set climbed for the whole song. A slot stays in
 * the DOM: the cue it shows can change, the host element does not.
 */

export const PHONE_LINE_SLOTS = 8;
export const PHONE_INST_SLOTS = 8;

export interface PhoneSlot {
  idx: number;
  /** In the current window. A parked slot keeps its host and is not laid out. */
  live: boolean;
}

export function sameSlots(a: readonly (PhoneSlot | null)[], b: readonly (PhoneSlot | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || x.idx !== y.idx || x.live !== y.live) return false;
  }
  return true;
}

/**
 * Keep a cue in the slot it already occupies. A cue that no longer fits the window
 * parks that slot. A new cue reuses a parked host before it takes an empty one.
 */
export function assignSlots(prev: readonly (PhoneSlot | null)[], wanted: readonly number[]): (PhoneSlot | null)[] {
  const want = new Set(wanted);
  const next: (PhoneSlot | null)[] = prev.map((s) => (s ? { idx: s.idx, live: want.has(s.idx) } : null));
  const placed = new Set<number>();
  for (const s of next) if (s?.live) placed.add(s.idx);
  for (const id of wanted) {
    if (placed.has(id)) continue;
    let free = next.findIndex((s) => s != null && !s.live);
    if (free < 0) free = next.indexOf(null);
    if (free < 0) break;
    next[free] = { idx: id, live: true };
    placed.add(id);
  }
  return next;
}
