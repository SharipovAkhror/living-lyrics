/**
 * Icon set drawn in the spirit of SF Symbols (SF Symbols themselves may only be used in Apple-platform apps).
 * 24-unit grid, 1.75 stroke, round caps/joins; transport glyphs are filled. Size follows the adjacent text style.
 */
import type { CSSProperties, ReactNode } from 'react';

type Glyph = { fill?: boolean; body: ReactNode };

const S = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const glyphs: Record<string, Glyph> = {
  'chevron.left': { body: <path d="M15 4.5 7.5 12l7.5 7.5" {...S} /> },
  'chevron.right': { body: <path d="m9 4.5 7.5 7.5L9 19.5" {...S} /> },
  'chevron.down': { body: <path d="m4.5 9 7.5 7.5L19.5 9" {...S} /> },
  'chevron.up': { body: <path d="M4.5 15 12 7.5l7.5 7.5" {...S} /> },
  xmark: { body: <path d="M6 6l12 12M18 6 6 18" {...S} /> },
  play: {
    fill: true,
    body: <path d="M7.2 4.4c0-1.1 1.2-1.8 2.2-1.2l11 6.9c.9.6.9 1.9 0 2.5l-11 6.9c-1 .6-2.2-.1-2.2-1.2V4.4Z" />,
  },
  pause: {
    fill: true,
    body: (
      <>
        <rect x="5.5" y="3.5" width="4.6" height="17" rx="1.4" />
        <rect x="13.9" y="3.5" width="4.6" height="17" rx="1.4" />
      </>
    ),
  },
  backward: {
    fill: true,
    body: (
      <>
        <path d="M11.4 6.7v10.6c0 .8-.9 1.3-1.6.8L2.6 13c-.6-.4-.6-1.3 0-1.7l7.2-5.4c.7-.5 1.6 0 1.6.8Z" />
        <path d="M21.6 6.7v10.6c0 .8-.9 1.3-1.6.8L12.8 13c-.6-.4-.6-1.3 0-1.7L20 5.9c.7-.5 1.6 0 1.6.8Z" />
      </>
    ),
  },
  forward: {
    fill: true,
    body: (
      <>
        <path d="M12.6 6.7v10.6c0 .8.9 1.3 1.6.8l7.2-5.1c.6-.4.6-1.3 0-1.7l-7.2-5.4c-.7-.5-1.6 0-1.6.8Z" />
        <path d="M2.4 6.7v10.6c0 .8.9 1.3 1.6.8L11.2 13c.6-.4.6-1.3 0-1.7L4 5.9c-.7-.5-1.6 0-1.6.8Z" />
      </>
    ),
  },
  'gobackward.10': {
    body: (
      <>
        <path d="M4.6 9.2A8 8 0 1 1 4 13" {...S} />
        <path d="M4.2 4.8v4.6h4.6" {...S} />
        <text x="12.4" y="15.6" fontSize="7.4" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-rounded)">10</text>
      </>
    ),
  },
  'goforward.10': {
    body: (
      <>
        <path d="M19.4 9.2A8 8 0 1 0 20 13" {...S} />
        <path d="M19.8 4.8v4.6h-4.6" {...S} />
        <text x="11.6" y="15.6" fontSize="7.4" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-rounded)">10</text>
      </>
    ),
  },
  'quote.bubble': {
    body: (
      <>
        <path d="M12 3.8c4.8 0 8.6 3.1 8.6 7s-3.8 7-8.6 7c-.8 0-1.6-.1-2.3-.3L5.2 19.6l1-3.4C4.4 14.9 3.4 13 3.4 10.8c0-3.9 3.8-7 8.6-7Z" {...S} />
        <path d="M9.2 9.4v2.4M14.6 9.4v2.4" strokeWidth="2.6" {...S} />
      </>
    ),
  },
  'book.closed': {
    body: (
      <>
        <path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14.5H6.6a2.1 2.1 0 0 1-2.1-2.1V5.5a2 2 0 0 1 2-2Z" {...S} />
        <path d="M4.5 17.4c0-1.2.9-2.1 2.1-2.1H19" {...S} />
        <path d="M9 7.5h6" {...S} />
      </>
    ),
  },
  textformat: {
    body: (
      <>
        <path d="M2.8 18.5 7.6 6.2h.6l4.8 12.3M4.4 14.4h6.8" {...S} />
        <path d="M14.4 12.4c.6-.9 1.6-1.4 2.8-1.4 1.8 0 3 1.1 3 2.9v4.6M20.2 15.2c-2.8-.2-5.6.3-5.6 2 0 1 .8 1.5 1.9 1.5 2.2 0 3.7-1.5 3.7-3.4" {...S} />
      </>
    ),
  },
  'slider.vertical.3': {
    body: (
      <>
        <path d="M6 3.5v17M12 3.5v17M18 3.5v17" {...S} />
        <rect x="3.6" y="13" width="4.8" height="3.2" rx="1.6" fill="var(--icon-knob, currentColor)" />
        <rect x="9.6" y="6.6" width="4.8" height="3.2" rx="1.6" fill="var(--icon-knob, currentColor)" />
        <rect x="15.6" y="10.6" width="4.8" height="3.2" rx="1.6" fill="var(--icon-knob, currentColor)" />
      </>
    ),
  },
  ellipsis: {
    fill: true,
    body: (
      <>
        <circle cx="5.5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="18.5" cy="12" r="1.8" />
      </>
    ),
  },
  'repeat.1': {
    body: (
      <>
        <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3" {...S} />
        <path d="M11.2 10.6 12.6 9.8v4.6" {...S} strokeWidth="1.6" />
      </>
    ),
  },
  magnifyingglass: {
    body: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" {...S} />
        <path d="m15.4 15.4 5.1 5.1" {...S} />
      </>
    ),
  },
  'square.and.arrow.down': {
    body: (
      <>
        <path d="M8 9.5H6.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H16" {...S} />
        <path d="M12 3v11M8.5 10.8 12 14.3l3.5-3.5" {...S} />
      </>
    ),
  },
  'music.note': {
    body: (
      <>
        <path d="M9 17.5V5.4c0-.6.4-1.1 1-1.2l8-1.7c.6-.1 1.1.3 1.1.9v11.4" {...S} />
        <ellipse cx="6.6" cy="17.6" rx="2.6" ry="2.2" {...S} />
        <ellipse cx="16.7" cy="15" rx="2.6" ry="2.2" {...S} />
      </>
    ),
  },
  gauge: {
    body: (
      <>
        <path d="M4.2 17.5a8.6 8.6 0 1 1 15.6 0" {...S} />
        <path d="m12 13.4 4-4.6" {...S} />
        <circle cx="12" cy="13.6" r="1.4" fill="currentColor" stroke="none" />
      </>
    ),
  },
  'hand.raised': {
    body: (
      <path
        d="M8.2 12.6V5.4a1.4 1.4 0 0 1 2.8 0v5.8V3.9a1.4 1.4 0 0 1 2.8 0v7.3V5a1.4 1.4 0 0 1 2.8 0v7.4-4a1.4 1.4 0 0 1 2.8 0v6.3c0 3.8-2.7 6.8-6.4 6.8h-.7c-2.1 0-3.6-.8-5-2.6l-3.2-4.1c-.5-.7-.4-1.6.3-2.1.7-.5 1.6-.4 2.1.3l.7.9"
        {...S}
      />
    ),
  },
  wand: {
    body: (
      <>
        <path d="m4 20 10.5-10.5M13 8l3 3" {...S} />
        <path d="M17.5 3v3M16 4.5h3M20.5 9v2.4M19.3 10.2h2.4M9.5 2.8v2.4M8.3 4h2.4" {...S} strokeWidth="1.5" />
      </>
    ),
  },
  globe: {
    body: (
      <>
        <circle cx="12" cy="12" r="8.6" {...S} />
        <path d="M3.6 12h16.8M12 3.4c2.4 2.4 3.6 5.3 3.6 8.6s-1.2 6.2-3.6 8.6c-2.4-2.4-3.6-5.3-3.6-8.6s1.2-6.2 3.6-8.6Z" {...S} />
      </>
    ),
  },
  sun: {
    body: (
      <>
        <circle cx="12" cy="12" r="4" {...S} />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...S} />
      </>
    ),
  },
  moon: { body: <path d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2Z" {...S} /> },
  'circle.lefthalf': {
    body: (
      <>
        <circle cx="12" cy="12" r="8.6" {...S} />
        <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2Z" fill="currentColor" />
      </>
    ),
  },
  waveform: {
    body: <path d="M3 12h1M6.5 9v6M10 5v14M13.5 8v8M17 10.5v3M20.5 11.5v1" {...S} />,
  },
  pencil: {
    body: (
      <>
        <path d="M16.3 3.9a2.2 2.2 0 0 1 3.1 3.1L8.6 17.8l-4.3 1.2 1.2-4.3L16.3 3.9Z" {...S} />
        <path d="m14.6 5.6 3.1 3.1" {...S} />
      </>
    ),
  },
  checkmark: { body: <path d="m4.5 12.5 4.6 4.6L19.5 6.7" {...S} /> },
  plus: { body: <path d="M12 4.5v15M4.5 12h15" {...S} /> },
  minus: { body: <path d="M4.5 12h15" {...S} /> },
  'info.circle': {
    body: (
      <>
        <circle cx="12" cy="12" r="8.6" {...S} />
        <path d="M12 11v5.5" {...S} />
        <circle cx="12" cy="7.7" r="1.1" fill="currentColor" stroke="none" />
      </>
    ),
  },
  'book.pages': {
    body: (
      <>
        <path d="M3.5 5.5c2.9-1.3 5.8-1.3 8.5.6 2.7-1.9 5.6-1.9 8.5-.6v13c-2.9-1.3-5.8-1.3-8.5.6-2.7-1.9-5.6-1.9-8.5-.6v-13Z" {...S} />
        <path d="M12 6.1v13" {...S} />
      </>
    ),
  },
  'square.grid.2x2': {
    body: (
      <>
        <rect x="3.8" y="3.8" width="7" height="7" rx="2" {...S} />
        <rect x="13.2" y="3.8" width="7" height="7" rx="2" {...S} />
        <rect x="3.8" y="13.2" width="7" height="7" rx="2" {...S} />
        <rect x="13.2" y="13.2" width="7" height="7" rx="2" {...S} />
      </>
    ),
  },
  'speaker.wave.2': {
    body: (
      <>
        <path d="M4 9.4h2.9L11 5.6v12.8l-4.1-3.8H4a.9.9 0 0 1-.9-.9V10.3c0-.5.4-.9.9-.9Z" {...S} />
        <path d="M14.6 9.2a4 4 0 0 1 0 5.6M17.4 6.6a7.6 7.6 0 0 1 0 10.8" {...S} />
      </>
    ),
  },
  eye: {
    body: (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...S} />
        <circle cx="12" cy="12" r="3" {...S} />
      </>
    ),
  },
  'arrow.up.left.and.arrow.down.right': {
    body: <path d="M4.5 9.5v-5h5M4.8 4.8l5.4 5.4M19.5 14.5v5h-5M19.2 19.2l-5.4-5.4" {...S} />,
  },
  'textformat.abc': {
    body: (
      <>
        <path d="M2.5 16.5 5.6 8h.6l3.1 8.5M3.6 13.6h4.6" {...S} />
        <path d="M11.4 8v8.5h2.8c1.4 0 2.3-.8 2.3-2.1 0-1.4-1-2.2-2.4-2.2h-2.7M11.4 12.2h2.4c1.2 0 2-.7 2-1.9 0-1.2-.8-2.3-2.1-2.3h-2.3" {...S} />
        <path d="M21.6 9.4a2.9 2.9 0 0 0-2.4-1.3c-1.9 0-3 1.8-3 4.2s1.1 4.2 3 4.2c1 0 1.8-.5 2.4-1.3" {...S} />
      </>
    ),
  },
};

export type IconName = keyof typeof glyphs;

export function Icon({
  name,
  size = 22,
  weight = 1.75,
  className,
  style,
  label,
}: {
  name: IconName | string;
  size?: number;
  weight?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label. Omit when the parent control already has one. */
  label?: string;
}) {
  const g = glyphs[name];
  if (!g) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill={g.fill ? 'currentColor' : 'none'}
      stroke={g.fill ? 'none' : 'currentColor'}
      strokeWidth={weight}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {g.body}
    </svg>
  );
}
