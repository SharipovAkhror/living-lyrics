/**
 * Site icons. One family, Qalam (`scripts/art/icons/qalam.ts`).
 * Callers keep `import { Icon } from '@/ui/icons'`.
 * The pixel size picks an optical master: 16, 20, 24, 28 or 32.
 * The outline is snapped to that exact CSS size.
 */
import { useId, type CSSProperties } from 'react';
import { glyphAt, opticalFor } from '../../../scripts/art/icons/qalam';
import { ICON_NAMES, type IconName, type Mark } from './types';

export type { IconName } from './types';

const STYLE_ID = 'll-ico-style';
const PAIR_CSS = [
  '.ll-ico { --qalam-wash: color-mix(in srgb, currentColor 32%, var(--bg)); }',
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

function Path({ mark, sw }: { mark: Mark; sw: number }) {
  return (
    <path
      d={mark.d}
      fill={mark.tone === 'wash' ? 'var(--qalam-wash)' : mark.draw === 'fill' ? 'currentColor' : 'none'}
      stroke={mark.draw === 'stroke' ? 'currentColor' : 'none'}
      strokeWidth={mark.draw === 'stroke' ? (mark.sw ?? sw) : undefined}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      fillOpacity={mark.tone === 'wash' ? 1 : mark.draw === 'fill' ? mark.opacity : undefined}
      strokeOpacity={mark.draw === 'stroke' ? mark.opacity : undefined}
      fillRule={mark.rule ?? 'evenodd'}
      transform={mark.transform}
    />
  );
}

function Marks({ marks, sw, maskId }: { marks: Mark[]; sw: number; maskId: string }) {
  const holes = marks.filter((mark) => mark.knock && mark.d);
  const body = marks.filter((mark) => !mark.knock && mark.d);
  const cut = holes.length > 0;
  return (
    <>
      {cut && (
        <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          {holes.map((mark, index) => (
            <path key={index} d={mark.d} fill="black" fillRule={mark.rule ?? 'nonzero'} transform={mark.transform} />
          ))}
        </mask>
      )}
      <g mask={cut ? `url(#${maskId})` : undefined}>
        {body.map((mark, index) => (
          <Path key={index} mark={mark} sw={sw} />
        ))}
      </g>
    </>
  );
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
  const reactId = useId().replace(/:/g, '');
  if (!(ICON_NAMES as readonly string[]).includes(name)) return null;
  const px = Math.round(size);
  const glyph = glyphAt(name as IconName, opticalFor(px), px);
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
        <Marks marks={glyph.off} sw={1.78} maskId={`${reactId}-off`} />
      </g>
      {glyph.on && (
        <g className="ll-on">
          <Marks marks={glyph.on} sw={1.78} maskId={`${reactId}-on`} />
        </g>
      )}
    </svg>
  );
}
