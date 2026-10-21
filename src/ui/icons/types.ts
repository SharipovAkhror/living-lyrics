/** Names the site already uses. The glass set draws the full list. */
export const ICON_NAMES = [
  'chevron.left',
  'chevron.right',
  'chevron.down',
  'chevron.up',
  'xmark',
  'play',
  'pause',
  'backward',
  'forward',
  'character.bubble',
  'book.closed',
  'music.note',
  'list.bullet',
  'slider.horizontal.3',
  'square.grid.2x2',
  'book.pages',
  'magnifyingglass',
  'info.circle',
  'flag',
  'speaker.wave.2',
  'square.and.arrow.down',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type Mark = {
  d: string;
  draw: 'fill' | 'stroke';
  /** 0–1. Duotone layers use this. Omitted means opaque. */
  opacity?: number;
  /** Stroke width in viewBox units. Omitted means the set's weight. */
  sw?: number;
  rule?: 'evenodd' | 'nonzero';
  transform?: string;
};

export type Glyph = {
  /** Idle, and the only drawing when the control is not pressed. */
  off: Mark[];
  /** Tab bar, when the parent has aria-pressed=true. */
  on?: Mark[];
};

export type IconSet = {
  id: 'c';
  /** Square viewBox. The glass set is drawn on a 24 grid. */
  vb: number;
  sw: number;
  glyphs: Record<IconName, Glyph>;
};
