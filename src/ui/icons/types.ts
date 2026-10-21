/** Names the site already uses. The Qalam family draws the full list. */
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
  /**
   * `wash` is the second tone: an opaque mix of the ink and the page.
   * It is not a transparency and not a second black fill.
   */
  tone?: 'wash';
  transform?: string;
  /**
   * Knock this fill out of the other marks in the same state.
   * Overlapping knocks stay open, so a broad-nib letter can cross itself.
   */
  knock?: boolean;
};

export type Glyph = {
  /** Idle, and the only drawing when the control is not pressed. */
  off: Mark[];
  /** Tab bar, when the parent has aria-pressed=true. */
  on?: Mark[];
};

export type IconSet = {
  id: 'qalam';
  /** Square viewBox. Qalam is drawn on a 24 grid. */
  vb: number;
  sw: number;
  /** The 24 master. Callers that know the pixel size use the optical master. */
  glyphs: Record<IconName, Glyph>;
};
