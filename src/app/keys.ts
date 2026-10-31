/** Song-page keys. Physical `code`, so a Russian layout hits the same key. */

export type KeyAction =
  | { type: 'play' }
  | { type: 'skip'; by: number }
  | { type: 'start' }
  | { type: 'fraction'; n: number }
  | { type: 'line'; dir: -1 | 1 }
  | { type: 'translation' }
  | { type: 'comment' }
  | { type: 'mark' }
  | { type: 'help' }
  | { type: 'escape' };

function typing(node: EventTarget | null): boolean {
  const el = node instanceof HTMLElement ? node : document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A focused button or link keeps Space and Enter for itself. */
function keepsSpace(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  const role = node.getAttribute('role');
  return role === 'button' || role === 'slider' || role === 'link';
}

/**
 * `blocked` is a sheet or the help overlay: only Escape still acts.
 * Returns null when the key belongs to the focused control or a text field.
 */
export function keyAction(event: KeyboardEvent, blocked: boolean): KeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (typing(event.target) || typing(document.activeElement)) return null;
  if (event.code === 'Escape') return { type: 'escape' };
  if (blocked) return null;
  if ((event.code === 'Space' || event.code === 'Enter') && keepsSpace(document.activeElement)) return null;
  if (event.repeat && (event.code === 'Space' || event.code === 'KeyK' || event.code === 'KeyM' || event.code === 'KeyC' || event.code === 'KeyT')) {
    return null;
  }
  if (event.code === 'Space' || event.code === 'KeyK') return { type: 'play' };
  if (event.code === 'KeyJ' || (event.code === 'ArrowLeft' && event.shiftKey)) return { type: 'skip', by: -10 };
  if (event.code === 'KeyL' || (event.code === 'ArrowRight' && event.shiftKey)) return { type: 'skip', by: 10 };
  if (event.code === 'ArrowLeft') return { type: 'line', dir: -1 };
  if (event.code === 'ArrowRight') return { type: 'line', dir: 1 };
  if (event.code === 'Home' || event.code === 'Digit0' || event.code === 'Numpad0') return { type: 'start' };
  if (event.code === 'KeyT') return { type: 'translation' };
  if (event.code === 'KeyC') return { type: 'comment' };
  if (event.code === 'KeyM') return { type: 'mark' };
  if ((event.code === 'Slash' && event.shiftKey) || event.key === '?') return { type: 'help' };
  const digit = /^Digit([1-9])$/.exec(event.code) || /^Numpad([1-9])$/.exec(event.code);
  if (digit) return { type: 'fraction', n: Number(digit[1]) };
  return null;
}
