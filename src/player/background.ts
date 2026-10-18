/**
 * What happens to playback when the phone locks or the page is hidden.
 *
 * Safari's default audio session is `auto`. On iPhone that session is ambient: after the
 * page is backgrounded the media element can come back unpaused but frozen, and the ringer
 * switch can silence it (WebKit bug 323022, reported 2026-08-31). `playback` at page load
 * is the session type that keeps a song going on the lock screen. A live AudioContext is a
 * different path — iOS has repeatedly suspended it when the screen locks — so the equalizer
 * is the only reason to create one.
 *
 * Hiding the page never pauses. Coming back only re-anchors the clock to the element.
 */

export const PLAYBACK_SESSION_TYPE = 'playback';

/** How long, after the page is visible again, a backward sample is suspect. */
export const RESUME_GUARD_MS = 1500;

/** How long a suspect backward sample is ignored before the stage accepts it. */
export const BACK_HOLD_MS = 600;

export type PageSignal = 'hidden' | 'visible' | 'pagehide' | 'pageshow' | 'freeze';

/** `resync` reads the element. It does not mean pause and it does not mean play. */
export function backgroundIntent(signal: PageSignal): 'none' | 'resync' {
  if (signal === 'visible' || signal === 'pageshow') return 'resync';
  return 'none';
}

/** A live AudioContext joins the output device. Peaks use an offline context instead. */
export function wantsLiveAudioContext(effects: boolean, source: string): boolean {
  return effects && source !== 'silent';
}

type SessionCarrier = Navigator & {
  audioSession?: { type?: string; state?: string; onstatechange: (() => void) | null };
};

/** Tell WebKit this page is a music player. No-op where the API does not exist. */
export function claimPlaybackSession(nav: Navigator): void {
  const session = (nav as SessionCarrier).audioSession;
  if (!session) return;
  try {
    session.type = PLAYBACK_SESSION_TYPE;
  } catch {
    /* Safari before 16.4, or a session the page is not allowed to change */
  }
}

export interface ClockSample {
  /** Time the element or the silent clock reports right now. */
  raw: number;
  /** Last time handed to the scene. */
  published: number;
  /** performance.now() until which a backward sample is ignored. 0 = not holding. */
  heldUntil: number;
  now: number;
  /** A reader seek, including one from the lock screen. Backward is then the truth. */
  seeked: boolean;
  /** True for a short time after the page becomes visible again. */
  guarding: boolean;
}

export interface ClockDecision {
  time: number;
  published: number;
  heldUntil: number;
}

/**
 * Time the scene should paint. After the screen wakes, the element sometimes reports an
 * earlier position for a moment; painting that would rewind the lines. A seek is allowed
 * to go backward. If the element stays behind, the stage follows it once the hold ends.
 */
export function publishClock(sample: ClockSample, holdMs = BACK_HOLD_MS): ClockDecision {
  if (sample.seeked || !sample.guarding || !Number.isFinite(sample.raw)) {
    return { time: sample.raw, published: sample.raw, heldUntil: 0 };
  }
  if (sample.raw + 0.08 < sample.published) {
    const heldUntil = sample.heldUntil > 0 ? sample.heldUntil : sample.now + holdMs;
    if (sample.now < heldUntil) return { time: sample.published, published: sample.published, heldUntil };
    return { time: sample.raw, published: sample.raw, heldUntil: 0 };
  }
  return { time: sample.raw, published: sample.raw, heldUntil: 0 };
}
