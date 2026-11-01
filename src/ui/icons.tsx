/**
 * Tabler Icons 3.49.0, outline stroke 2 and a filled twin for every toggle.
 * MIT licence. Copyright (c) 2020-2026 Paweł Kuna.
 * Paths copied from https://github.com/tabler/tabler-icons
 * tag v3.49.0, commit bbed884d15354b5cebf2493371f20dc2d5e83eaf,
 * then adjusted on this grid. The site does not depend on the package.
 * One grid, 24 units. Round caps and joins. Corner radius is 1 on a
 * stroke of 2 (the round terminal) and 4 on a filled container, the same
 * radius as the comment bubble.
 *
 * Draw each glyph at a whole pixel size (16, 20, 22, 24 or 28).
 * At 24 the stroke is 2. Smaller sizes keep a slightly heavier stroke so
 * the line does not look thin: rendered px = 2 * (size/24)^0.65.
 *
 * Player and song-header marks live in playerIcons.tsx. This file keeps
 * the library, the sheets and the shared chrome (chevrons, close, search,
 * the note, the speaker, the closed book on an empty state).
 *
 * A pressed control (aria-pressed) swaps in the filled twin.
 * Chevrons, close, search, the note and the speaker stay strokes.
 */
import { createElement, useId, type CSSProperties, type ReactNode } from 'react';
import './icons.css';

type Attrs = Record<string, string>;
type Node = readonly [string, Attrs];
type Mode = 'line' | 'pair' | 'solid';

type Plate = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  /** Width of the resting skeleton, cut out of the container. */
  hole: number;
  /** Puts the skeleton inside the container. Resting state is not scaled. */
  inset?: string;
};

type Glyph = {
  mode: Mode;
  line: readonly Node[];
  fill: readonly Node[] | null;
  /** viewBox transform for a solid glyph that needs optical centring */
  shift?: string;
  /** Active state: the line drawing knocked out of a filled container. */
  plate?: Plate;
};

/** Stroke on the 24-grid. Exactly 2 at 24px; optically heavier below that. */
function outlineStroke(size: number): number {
  if (size === 24) return 2;
  return Math.round(2 * (24 / size) ** 0.35 * 1000) / 1000;
}

const glyphs = {
  'chevron.left': { mode: 'line', line: [['path', { d: 'M15 6l-6 6l6 6' }]], fill: null },
  'chevron.right': { mode: 'line', line: [['path', { d: 'M9 6l6 6l-6 6' }]], fill: null },
  'chevron.down': { mode: 'line', line: [['path', { d: 'M6 9l6 6l6 -6' }]], fill: null },
  'chevron.up': { mode: 'line', line: [['path', { d: 'M6 15l6 -6l6 6' }]], fill: null },
  'xmark': { mode: 'line', line: [['path', { d: 'M18 6l-12 12' }], ['path', { d: 'M6 6l12 12' }]], fill: null },
  'book.closed': { mode: 'pair', line: [['path', { d: 'M8 9h8' }], ['path', { d: 'M8 13h6' }], ['path', { d: 'M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3' }]], fill: [['path', { d: 'M18 3a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-2.586l-2.707 2.707a1 1 0 0 1 -1.32 .083l-.094 -.083l-2.708 -2.707h-2.585a4 4 0 0 1 -3.995 -3.8l-.005 -.2v-8a4 4 0 0 1 4 -4zm-4 9h-6a1 1 0 0 0 0 2h6a1 1 0 0 0 0 -2m2 -4h-8a1 1 0 1 0 0 2h8a1 1 0 0 0 0 -2' }]] },
  'music.note': { mode: 'line', line: [['path', { d: 'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' }], ['path', { d: 'M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' }], ['path', { d: 'M9 17v-13h10v13' }], ['path', { d: 'M9 8h10' }]], fill: null },
  'square.grid.2x2': { mode: 'pair', line: [['path', { d: 'M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }]], fill: [['path', { d: 'M9 3a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M19 3a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M9 13a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M19 13a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }]] },
  'book.pages': { mode: 'pair', line: [['path', { d: 'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }], ['path', { d: 'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }], ['path', { d: 'M3 6l0 13' }], ['path', { d: 'M12 6l0 13' }], ['path', { d: 'M21 6l0 13' }]], fill: [['path', { d: 'M21.5 5.134a1 1 0 0 1 .493 .748l.007 .118v13a1 1 0 0 1 -1.5 .866a8 8 0 0 0 -7.5 -.266v-15.174a10 10 0 0 1 8.5 .708m-10.5 -.707l.001 15.174a8 8 0 0 0 -7.234 .117l-.327 .18l-.103 .044l-.049 .016l-.11 .026l-.061 .01l-.117 .006h-.042l-.11 -.012l-.077 -.014l-.108 -.032l-.126 -.056l-.095 -.056l-.089 -.067l-.06 -.056l-.073 -.082l-.064 -.089l-.022 -.036l-.032 -.06l-.044 -.103l-.016 -.049l-.026 -.11l-.01 -.061l-.004 -.049l-.002 -13.068a1 1 0 0 1 .5 -.866a10 10 0 0 1 8.5 -.707' }]] },
  'magnifyingglass': { mode: 'line', line: [['path', { d: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' }], ['path', { d: 'M21 21l-6 -6' }]], fill: null },
  'speaker.wave.2': { mode: 'line', line: [['path', { d: 'M15 8a5 5 0 0 1 0 8' }], ['path', { d: 'M17.7 5a9 9 0 0 1 0 14' }], ['path', { d: 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5' }]], fill: null },
  'square.and.arrow.down': { mode: 'pair', line: [['path', { d: 'M14 3v4a1 1 0 0 0 1 1h4' }], ['path', { d: 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2' }], ['path', { d: 'M12 17v-6' }], ['path', { d: 'M9.5 14.5l2.5 2.5l2.5 -2.5' }]], fill: [['path', { d: 'M12 2l.117 .007a1 1 0 0 1 .876 .876l.007 .117v4l.005 .15a2 2 0 0 0 1.838 1.844l.157 .006h4l.117 .007a1 1 0 0 1 .876 .876l.007 .117v9a3 3 0 0 1 -2.824 2.995l-.176 .005h-10a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-14a3 3 0 0 1 2.824 -2.995l.176 -.005zm0 8a1 1 0 0 0 -1 1v3.585l-.793 -.792a1 1 0 0 0 -1.32 -.083l-.094 .083a1 1 0 0 0 0 1.414l2.5 2.5l.044 .042l.068 .055l.11 .071l.114 .054l.105 .035l.15 .03l.116 .006l.117 -.007l.117 -.02l.108 -.033l.081 -.034l.098 -.052l.092 -.064l.094 -.083l2.5 -2.5a1 1 0 0 0 0 -1.414l-.094 -.083a1 1 0 0 0 -1.32 .083l-.793 .791v-3.584a1 1 0 0 0 -.883 -.993zm2.999 -7.001l4.001 4.001h-4z' }]] },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof glyphs;

const REACT_ATTR: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
};

function draw(nodes: readonly Node[], key: string): ReactNode[] {
  return nodes.map(([tag, attrs], i) => {
    const props: Record<string, string> = { key: key + i };
    for (const [attr, value] of Object.entries(attrs)) props[REACT_ATTR[attr] ?? attr] = value;
    return createElement(tag, props);
  });
}

function glyphOf(name: string): Glyph | null {
  if (!Object.prototype.hasOwnProperty.call(glyphs, name)) return null;
  return glyphs[name as IconName];
}

export function Icon({
  name,
  size = 24,
  className,
  style,
  label,
}: {
  name: IconName | string;
  size?: number;
  /** Kept so older call sites compile. Idle is one stroke; active is the fill. */
  weight?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label. Omit when the parent control already has one. */
  label?: string;
}) {
  const maskId = 'll' + useId().replace(/:/g, '');
  const glyph = glyphOf(name);
  if (!glyph) return null;
  const px = Math.round(size);
  const solid = glyph.mode === 'solid';
  const pair = glyph.mode === 'pair';
  const classes = ['ll-icon', pair ? 'll-pair' : '', className].filter(Boolean).join(' ');
  let body: ReactNode;
  if (solid) {
    const mark = draw(glyph.fill ?? glyph.line, 's');
    body = glyph.shift ? <g transform={glyph.shift}>{mark}</g> : mark;
  } else if (pair && glyph.plate) {
    const plate = glyph.plate;
    body = (
      <>
        {/* Mask stays outside the hidden fill group so it still resolves after display:none. */}
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" stroke="none" />
          <g transform={plate.inset} fill="none" stroke="black" strokeWidth={plate.hole} strokeLinecap="round" strokeLinejoin="round">
            {draw(glyph.line, 'h')}
          </g>
        </mask>
        <g className="ll-line">{draw(glyph.line, 'l')}</g>
        <g className="ll-fill">
          <rect x={plate.x} y={plate.y} width={plate.width} height={plate.height} rx={plate.rx} fill="currentColor" stroke="none" mask={`url(#${maskId})`} />
        </g>
      </>
    );
  } else if (pair && glyph.fill) {
    body = (
      <>
        <g className="ll-line">{draw(glyph.line, 'l')}</g>
        <g className="ll-fill" fill="currentColor" stroke="none">
          {draw(glyph.fill, 'f')}
        </g>
      </>
    );
  } else {
    body = draw(glyph.line, 'l');
  }
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      className={classes}
      style={style}
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={solid ? undefined : outlineStroke(px)}
      strokeLinecap={solid ? undefined : 'round'}
      strokeLinejoin={solid ? undefined : 'round'}
      shapeRendering="geometricPrecision"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {body}
    </svg>
  );
}
