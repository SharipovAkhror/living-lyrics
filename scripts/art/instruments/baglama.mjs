import { longNeckLute } from '../lute.mjs';

// Bağlama (saz): carved pear body, long neck with nineteen tied frets, seven strings in three courses.
export default function baglama() {
  return longNeckLute({
    key: 'baglama',
    title: 'Баглама',
    bodyW: 128,
    bodyH: 150,
    neckW: 18,
    neckTop: 50,
    headH: 34,
    frets: 19,
    fretStep: 1.05,
    strings: 7,
    pegs: [
      { side: -1, y: 26 },
      { side: 1, y: 26 },
      { side: -1, y: 33 },
      { side: 1, y: 33 },
      { side: -1, y: 40 },
      { side: 1, y: 40 },
      { side: -1, y: 47 },
    ],
    soundhole: 'small',
    guard: true,
    tilt: 30,
  });
}
