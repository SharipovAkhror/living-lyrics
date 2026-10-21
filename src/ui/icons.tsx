/**
 * Tabler Icons 3.49.0, outline stroke 2 and the matching fill where the set has one.
 * MIT licence. Copyright (c) 2020-2026 Paweł Kuna.
 * Paths copied from https://github.com/tabler/tabler-icons
 * tag v3.49.0, commit bbed884d15354b5cebf2493371f20dc2d5e83eaf.
 * The site does not depend on the package. One grid, 24 units.
 * Round caps and joins. No optical-size masters in this family.
 *
 * Draw each glyph at a whole pixel size (16, 20, 22, 24 or 28).
 * Play is shifted 0.74 units right: the filled triangle's ink sits left of
 * the box centre, and the round play button shows that. Pause and the skip
 * marks already sit on the box centre, so they are not moved.
 * Active controls (aria-pressed) swap in the filled twin. Language, music,
 * volume, search, close and the chevrons stay strokes: a fill would close
 * the letters, or the filled twin is a different picture.
 */
import { createElement, type CSSProperties, type ReactNode } from 'react';
import './icons.css';

type Attrs = Record<string, string>;
type Node = readonly [string, Attrs];
type Mode = 'line' | 'pair' | 'solid';

type Glyph = {
  mode: Mode;
  line: readonly Node[];
  fill: readonly Node[] | null;
  /** viewBox transform for a solid glyph that needs optical centring */
  shift?: string;
};

const glyphs = {
  'chevron.left': { mode: 'line', line: [['path', { d: 'M15 6l-6 6l6 6' }]], fill: null },
  'chevron.right': { mode: 'line', line: [['path', { d: 'M9 6l6 6l-6 6' }]], fill: null },
  'chevron.down': { mode: 'line', line: [['path', { d: 'M6 9l6 6l6 -6' }]], fill: null },
  'chevron.up': { mode: 'line', line: [['path', { d: 'M6 15l6 -6l6 6' }]], fill: null },
  'xmark': { mode: 'line', line: [['path', { d: 'M18 6l-12 12' }], ['path', { d: 'M6 6l12 12' }]], fill: null },
  'play': { mode: 'solid', line: [['path', { d: 'M7 4v16l13 -8l-13 -8' }]], fill: [['path', { d: 'M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z' }]], shift: 'translate(0.74 0)' },
  'pause': { mode: 'solid', line: [['path', { d: 'M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12' }], ['path', { d: 'M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12' }]], fill: [['path', { d: 'M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z' }], ['path', { d: 'M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z' }]] },
  'backward': { mode: 'solid', line: [['path', { d: 'M20 5v14l-12 -7l12 -7' }], ['path', { d: 'M4 5l0 14' }]], fill: [['path', { d: 'M19.496 4.136l-12 7a1 1 0 0 0 0 1.728l12 7a1 1 0 0 0 1.504 -.864v-14a1 1 0 0 0 -1.504 -.864z' }], ['path', { d: 'M4 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z' }]] },
  'forward': { mode: 'solid', line: [['path', { d: 'M4 5v14l12 -7l-12 -7' }], ['path', { d: 'M20 5l0 14' }]], fill: [['path', { d: 'M3 5v14a1 1 0 0 0 1.504 .864l12 -7a1 1 0 0 0 0 -1.728l-12 -7a1 1 0 0 0 -1.504 .864z' }], ['path', { d: 'M20 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z' }]] },
  'character.bubble': { mode: 'line', line: [['path', { d: 'M9 6.371c0 4.418 -2.239 6.629 -5 6.629' }], ['path', { d: 'M4 6.371h7' }], ['path', { d: 'M5 9c0 2.144 2.252 3.908 6 4' }], ['path', { d: 'M12 20l4 -9l4 9' }], ['path', { d: 'M19.1 18h-6.2' }], ['path', { d: 'M6.694 3l.793 .582' }]], fill: null },
  'book.closed': { mode: 'pair', line: [['path', { d: 'M8 9h8' }], ['path', { d: 'M8 13h6' }], ['path', { d: 'M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3' }]], fill: [['path', { d: 'M18 3a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-2.586l-2.707 2.707a1 1 0 0 1 -1.32 .083l-.094 -.083l-2.708 -2.707h-2.585a4 4 0 0 1 -3.995 -3.8l-.005 -.2v-8a4 4 0 0 1 4 -4zm-4 9h-6a1 1 0 0 0 0 2h6a1 1 0 0 0 0 -2m2 -4h-8a1 1 0 1 0 0 2h8a1 1 0 0 0 0 -2' }]] },
  'music.note': { mode: 'line', line: [['path', { d: 'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' }], ['path', { d: 'M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' }], ['path', { d: 'M9 17v-13h10v13' }], ['path', { d: 'M9 8h10' }]], fill: null },
  'list.bullet': { mode: 'pair', line: [['path', { d: 'M9 6l11 0' }], ['path', { d: 'M9 12l11 0' }], ['path', { d: 'M9 18l11 0' }], ['path', { d: 'M5 6l0 .01' }], ['path', { d: 'M5 12l0 .01' }], ['path', { d: 'M5 18l0 .01' }]], fill: [['path', { d: 'M21 6a1 1 0 0 1 -1 1h-10a1 1 0 1 1 0 -2h10a1 1 0 0 1 1 1' }], ['path', { d: 'M21 12a1 1 0 0 1 -1 1h-10a1 1 0 0 1 0 -2h10a1 1 0 0 1 1 1' }], ['path', { d: 'M21 18a1 1 0 0 1 -1 1h-10a1 1 0 0 1 0 -2h10a1 1 0 0 1 1 1' }], ['path', { d: 'M7 5.995v.02c0 1.099 -.895 1.99 -2 1.99s-2 -.891 -2 -1.99v-.02c0 -1.099 .895 -1.99 2 -1.99s2 .891 2 1.99' }], ['path', { d: 'M7 11.995v.02c0 1.099 -.895 1.99 -2 1.99s-2 -.891 -2 -1.99v-.02c0 -1.099 .895 -1.99 2 -1.99s2 .891 2 1.99' }], ['path', { d: 'M7 17.995v.02c0 1.099 -.895 1.99 -2 1.99s-2 -.891 -2 -1.99v-.02c0 -1.099 .895 -1.99 2 -1.99s2 .891 2 1.99' }]] },
  'slider.horizontal.3': { mode: 'pair', line: [['path', { d: 'M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' }], ['path', { d: 'M4 6l8 0' }], ['path', { d: 'M16 6l4 0' }], ['path', { d: 'M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' }], ['path', { d: 'M4 12l2 0' }], ['path', { d: 'M10 12l10 0' }], ['path', { d: 'M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' }], ['path', { d: 'M4 18l11 0' }], ['path', { d: 'M19 18l1 0' }]], fill: [['path', { d: 'M17 15c1.306 0 2.418 .835 2.83 2h.17a1 1 0 0 1 0 2h-.171a3.001 3.001 0 0 1 -5.658 0h-10.171a1 1 0 0 1 0 -2h10.173c.41 -1.165 1.52 -2 2.827 -2m-9 -6c1.306 0 2.418 .835 2.83 2h9.17a1 1 0 0 1 0 2h-9.171a3.001 3.001 0 0 1 -5.658 0h-1.171a1 1 0 0 1 0 -2h1.173c.41 -1.165 1.52 -2 2.827 -2m6 -6c1.306 0 2.418 .835 2.83 2h3.17a1 1 0 0 1 0 2h-3.171a3.001 3.001 0 0 1 -5.658 0h-7.171a1 1 0 1 1 0 -2h7.173c.41 -1.165 1.52 -2 2.827 -2' }]] },
  'square.grid.2x2': { mode: 'pair', line: [['path', { d: 'M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }], ['path', { d: 'M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4' }]], fill: [['path', { d: 'M9 3a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M19 3a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M9 13a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }], ['path', { d: 'M19 13a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z' }]] },
  'book.pages': { mode: 'pair', line: [['path', { d: 'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }], ['path', { d: 'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }], ['path', { d: 'M3 6l0 13' }], ['path', { d: 'M12 6l0 13' }], ['path', { d: 'M21 6l0 13' }]], fill: [['path', { d: 'M21.5 5.134a1 1 0 0 1 .493 .748l.007 .118v13a1 1 0 0 1 -1.5 .866a8 8 0 0 0 -7.5 -.266v-15.174a10 10 0 0 1 8.5 .708m-10.5 -.707l.001 15.174a8 8 0 0 0 -7.234 .117l-.327 .18l-.103 .044l-.049 .016l-.11 .026l-.061 .01l-.117 .006h-.042l-.11 -.012l-.077 -.014l-.108 -.032l-.126 -.056l-.095 -.056l-.089 -.067l-.06 -.056l-.073 -.082l-.064 -.089l-.022 -.036l-.032 -.06l-.044 -.103l-.016 -.049l-.026 -.11l-.01 -.061l-.004 -.049l-.002 -13.068a1 1 0 0 1 .5 -.866a10 10 0 0 1 8.5 -.707' }]] },
  'magnifyingglass': { mode: 'line', line: [['path', { d: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' }], ['path', { d: 'M21 21l-6 -6' }]], fill: null },
  'info.circle': { mode: 'pair', line: [['path', { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' }], ['path', { d: 'M12 9h.01' }], ['path', { d: 'M11 12h1v4h1' }]], fill: [['path', { d: 'M12 2c5.523 0 10 4.477 10 10a10 10 0 0 1 -19.995 .324l-.005 -.324l.004 -.28c.148 -5.393 4.566 -9.72 9.996 -9.72zm0 9h-1l-.117 .007a1 1 0 0 0 0 1.986l.117 .007v3l.007 .117a1 1 0 0 0 .876 .876l.117 .007h1l.117 -.007a1 1 0 0 0 .876 -.876l.007 -.117l-.007 -.117a1 1 0 0 0 -.764 -.857l-.112 -.02l-.117 -.006v-3l-.007 -.117a1 1 0 0 0 -.876 -.876l-.117 -.007zm.01 -3l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007z' }]] },
  'flag': { mode: 'pair', line: [['path', { d: 'M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9' }], ['path', { d: 'M5 21v-7' }]], fill: [['path', { d: 'M4 5a1 1 0 0 1 .3 -.714a6 6 0 0 1 8.213 -.176l.351 .328a4 4 0 0 0 5.272 0l.249 -.227c.61 -.483 1.527 -.097 1.61 .676l.005 .113v9a1 1 0 0 1 -.3 .714a6 6 0 0 1 -8.213 .176l-.351 -.328a4 4 0 0 0 -5.136 -.114v6.552a1 1 0 0 1 -1.993 .117l-.007 -.117v-16z' }]] },
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
      strokeWidth={solid ? undefined : 2}
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
