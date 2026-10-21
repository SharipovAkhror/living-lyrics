import lensUrl from './lens.png';

/**
 * Static lens for desktop glass. The map is baked (see lens.png): neutral grey
 * is no shift, the rim pushes samples outward. `scale` is a constant. Phone
 * surfaces never reference this filter.
 */
export function GlassFilter() {
  return (
    <svg className="lg-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="lg-refract" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
        <feImage href={lensUrl} result="map" preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="56" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
