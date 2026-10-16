/** 10-band graphic EQ (ISO octave centres) with presets tuned for this repertoire. Gains in dB. */
export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export interface EqPreset {
  id: string;
  name: string;
  hint: string;
  bands: number[];
  preamp: number;
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Без коррекции', hint: 'Как записано', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { id: 'voice', name: 'Голос', hint: 'Слова и дикция чётче', bands: [-2, -1.5, -1, 0, 1.5, 3, 3.5, 2.5, 1, 0], preamp: -2.5 },
  { id: 'frame-drums', name: 'Даф и бендир', hint: 'Глубже низ, плотнее удар', bands: [3, 4, 3, 1, -0.5, -1, 0, 1, 1, 0.5], preamp: -3.5 },
  { id: 'strings', name: 'Канун и сантур', hint: 'Больше воздуха и блеска', bands: [-1, -1, -0.5, 0, 0, 0.5, 1.5, 3, 3.5, 3], preamp: -3 },
  { id: 'hall', name: 'Концертный зал', hint: 'Мягкая середина, широкий верх', bands: [1.5, 1, 0, -1, -1.5, -0.5, 0.5, 1.5, 2, 2], preamp: -2 },
  { id: 'night', name: 'Тихий вечер', hint: 'Без резких верхов и гула', bands: [-3, -2, -1, 0, 0.5, 1, 0.5, -1, -2.5, -3.5], preamp: 0 },
  { id: 'small-speakers', name: 'Динамик телефона', hint: 'Компенсирует маленький динамик', bands: [-4, -3, 2, 3, 2, 1, 0, 1, 0.5, 0], preamp: -3 },
];

export function presetById(id: string) {
  return EQ_PRESETS.find((p) => p.id === id) ?? EQ_PRESETS[0];
}

export function formatFreq(f: number) {
  return f >= 1000 ? `${f / 1000}k` : String(f);
}
