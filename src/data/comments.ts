/**
 * Viewer gate for commentary. One place, on load: a line or a section marked
 * `comment-draft` loses its `comment` before any screen can read it.
 * The flag stays. `commentFor` treats that surviving mark as "do not inherit".
 */
import type { Line, Lyrics, Section } from './schema';

export const COMMENT_DRAFT = 'comment-draft';

export function commentDraftHidden(flags: readonly string[] | undefined): boolean {
  return flags?.includes(COMMENT_DRAFT) ?? false;
}

function withoutComment<T extends { comment?: string }>(item: T): T {
  if (!('comment' in item)) return item;
  const { comment: _comment, ...rest } = item;
  return rest as T;
}

function stripLine(line: Line): Line {
  return commentDraftHidden(line.flags) ? withoutComment(line) : line;
}

function stripSection(section: Section): Section {
  const hidden = commentDraftHidden(section.flags);
  if (section.kind === 'instrumental') return hidden ? withoutComment(section) : section;
  let changed = hidden;
  const lines = section.lines.map((line) => {
    const next = stripLine(line);
    if (next !== line) changed = true;
    return next;
  });
  if (!changed) return section;
  const base = hidden ? withoutComment(section) : section;
  return { ...base, lines };
}

/** Drop draft commentary. Unflagged text is left as it was, and the input is not mutated. */
export function hideDraftComments(lyrics: Lyrics): Lyrics {
  let changed = false;
  const sections = lyrics.sections.map((section) => {
    const next = stripSection(section);
    if (next !== section) changed = true;
    return next;
  });
  return changed ? { ...lyrics, sections } : lyrics;
}
