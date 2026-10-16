import { longNeckLute } from '../lute.mjs';

// Kurdish/Persian tanbur: small mulberry body, very long neck, fourteen tied frets, three strings.
export default function tanbur() {
  return longNeckLute({
    key: 'tanbur',
    title: 'Танбур',
    bodyW: 92,
    bodyH: 118,
    neckW: 15,
    neckTop: 44,
    headH: 26,
    frets: 15,
    fretStep: 0.95,
    strings: 3,
    pegs: [
      { side: -1, y: 28 },
      { side: 1, y: 34 },
      { side: -1, y: 40 },
    ],
    soundhole: null,
    guard: false,
    tilt: 34,
  });
}
