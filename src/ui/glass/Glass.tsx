import { createElement, type ElementType, type ReactNode, type Ref } from 'react';

/** Surfaces that share one liquid-glass material. */
export type GlassVariant = 'bar' | 'floor' | 'sheet' | 'card' | 'note' | 'chip';

/**
 * The layers of the material: one lens (the only backdrop filter), a song tint,
 * a specular wash and a lit rim. Nothing here listens to frames. The light
 * direction is two custom properties set on the document (`src/ui/glass/light.ts`).
 */
export function GlassLayers() {
  return (
    <span className="lg" aria-hidden="true">
      <span className="lg-lens" />
      <span className="lg-tint" />
      <span className="lg-spec" />
      <span className="lg-edge" />
    </span>
  );
}

type GlassProps = {
  as?: ElementType;
  variant?: GlassVariant;
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
} & Record<string, unknown>;

/** Host element plus the material. Pass `as` when the surface is not a div. */
export function Glass({ as = 'div', variant = 'card', className, children, ref, ...rest }: GlassProps) {
  return createElement(
    as,
    {
      ...rest,
      ref,
      'data-lg': variant,
      className: ['lg-host', `lg-host--${variant}`, className].filter(Boolean).join(' '),
    },
    <GlassLayers />,
    children,
  );
}
