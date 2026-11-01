/**
 * Pure helpers for comment text — no React dependency.
 * Used by RichText (rendering) and SongPage (plain-text preview).
 */

/** Trailing punctuation that stays outside a bare URL link. */
const TRAIL = /[.,;:)»]+$/;

/** Matches [text](url) markdown links — only http/https URLs become links. */
export const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

/** Matches bare http/https URLs (not already inside a markdown link). */
export const BARE_URL = /(?<!\]\()https?:\/\/[^\s,;:)»]+/g;

/**
 * Returns the host of a URL string (e.g. "shazam.com" from
 * "https://www.shazam.com/song/123/alive"). Falls back to the full URL.
 */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Strips markup and returns plain text suitable for a preview:
 * - `[text](url)` → `text`
 * - bare http/https URL → its hostname (e.g. `shazam.com`)
 * - `*` / `**` removed
 * Non-http/https schemes are left untouched.
 */
export function plainComment(text: string): string {
  // Replace markdown links first.
  let out = text.replace(MD_LINK, (_m, label: string) => label);
  // Replace bare URLs with their host, stripping trailing punctuation.
  out = out.replace(BARE_URL, (url) => {
    const trail = url.match(TRAIL)?.[0] ?? '';
    const bare = trail ? url.slice(0, -trail.length) : url;
    return urlHost(bare) + trail;
  });
  // Strip bold/italic markers.
  out = out.replace(/\*+/g, '');
  return out;
}
