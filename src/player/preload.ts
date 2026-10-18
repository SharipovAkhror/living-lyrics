/**
 * How much of a recording to fetch before the reader asks for sound.
 * The element always streams: play() starts at the first buffered seconds and does not
 * wait for the rest of the file. A generous connection may buffer ahead; a metered or
 * slow one spends nothing until the play button.
 */

export type PreloadMode = 'none' | 'metadata' | 'auto';

export interface NetHint {
  saveData: boolean;
  /** `slow-2g`, `2g`, `3g`, `4g`, or '' when the browser does not say. */
  effectiveType: string;
}

type ConnectionNav = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
};

export function readNetHint(nav: Navigator): NetHint {
  const c = (nav as ConnectionNav).connection;
  return {
    saveData: !!c?.saveData,
    effectiveType: typeof c?.effectiveType === 'string' ? c.effectiveType : '',
  };
}

/** True when buffering a recording ahead of the tap will not spend a scarce connection. */
export function eagerAudio(net: NetHint): boolean {
  if (net.saveData) return false;
  if (net.effectiveType === 'slow-2g' || net.effectiveType === '2g' || net.effectiveType === '3g') return false;
  return true;
}

/**
 * `first` — the song just opened, lyrics may still be on the wire. Metadata only, and
 * only on a generous connection, so a 15 MB recording does not queue ahead of the page.
 * `settle` — the sky has painted. A generous connection may then fill the buffer.
 * `play` — the reader asked. `auto` lets the browser stream; it does not download the file first.
 */
export function preloadMode(phase: 'first' | 'settle' | 'play', net: NetHint): PreloadMode {
  if (phase === 'play') return 'auto';
  if (!eagerAudio(net)) return 'none';
  return phase === 'first' ? 'metadata' : 'auto';
}
