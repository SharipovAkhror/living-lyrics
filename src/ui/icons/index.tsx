/**
 * Site icons. One family, Qalam (`scripts/art/icons/qalam.ts`).
 * Callers keep `import { Icon } from '@/ui/icons'`.
 * The pixel size picks an optical master: 16, 20, 24 or 32.
 */
import type { CSSProperties } from 'react';
import { glyphAt, opticalFor } from '../../../scripts/art/icons/qalam';
import { ICON_NAMES, type IconName, type Mark } from './types';

export type { IconName } from './types';

const STYLE_ID = 'll-ico-style';
const PAIR_CSS = [
  '.ll-ico.ll-pair .ll-on { display: none; }',
  "[aria-pressed='true'] .ll-ico.ll-pair .ll-off { display: none; }",
  "[aria-pressed='true'] .ll-ico.ll-pair .ll-on { display: block; }",
].join('\n');

function ensurePairStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const node = document.createElement('style');
  node.id = STYLE_ID;
  node.textContent = PAIR_CSS;
  document.head.appendChild(node);
}

ensurePairStyle();

function Marks({ marks, sw }: { marks: Mark[]; sw: number }) {
  return marks.map((mark, index) => (
    <path
      key={index}
      d={mark.d}
      fill={mark.draw === 'fill' ? 'currentColor' : 'none'}
      stroke={mark.draw === 'stroke' ? 'currentColor' : 'none'}
      strokeWidth={mark.draw === 'stroke' ? (mark.sw ?? sw) : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      fillOpacity={mark.draw === 'fill' ? mark.opacity : undefined}
      strokeOpacity={mark.draw === 'stroke' ? mark.opacity : undefined}
      fillRule={mark.rule ?? 'evenodd'}
      transform={mark.transform}
    />
  ));
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
  /** Kept so older call sites compile. The set's weight is fixed. */
  weight?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label. Omit when the parent control already has one. */
  label?: string;
}) {
  if (!(ICON_NAMES as readonly string[]).includes(name)) return null;
  const px = Math.round(size);
  const glyph = glyphAt(name as IconName, opticalFor(px));
  const pair = Boolean(glyph.on);
  const vb = 24;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${vb} ${vb}`}
      className={['ll-ico', pair ? 'll-pair' : '', className].filter(Boolean).join(' ')}
      style={style}
      fill="none"
      shapeRendering="geometricPrecision"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g className="ll-off">
        <Marks marks={glyph.off} sw={1.78} />
      </g>
      {glyph.on && (
        <g className="ll-on">
          <Marks marks={glyph.on} sw={1.78} />
        </g>
      )}
    </svg>
  );
}
