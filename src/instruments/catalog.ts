/**
 * Instrument catalogue. Keys are used in lyrics.json (`instruments: ["qanun", "oud"]`).
 * Each key needs an engraving in src/instruments/svg/<key>.svg (drawn by scripts/art/build-instruments.mjs,
 * spec in docs/methodology/09-instruments.md). Add new instruments here first.
 */
const svgs = import.meta.glob('/src/instruments/svg/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface InstrumentInfo {
  key: string;
  name: string;
  /** Name in the source tradition, original script. */
  native?: string;
  family: 'струнные щипковые' | 'струнные ударные' | 'смычковые' | 'духовые' | 'ударные' | 'клавишные' | 'голоса' | 'ансамбль';
  origin: string;
  description: string;
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { key: 'oud', name: 'Уд', native: 'عود', family: 'струнные щипковые', origin: 'Ближний Восток', description: 'Безладовая лютня с грушевидным корпусом из клёпок и отогнутой назад головкой; играют плектром (рише).' },
  { key: 'qanun', name: 'Канун', native: 'قانون', family: 'струнные щипковые', origin: 'Ближний Восток, Турция', description: 'Трапециевидная цитра, 72–81 струна тройками; рычажки-мандалы меняют строй на доли тона.' },
  { key: 'ney', name: 'Най', native: 'نی', family: 'духовые', origin: 'Персия, Турция, арабский мир', description: 'Тростниковая продольная флейта с шестью отверстиями спереди и одним сзади; дыхание слышно в звуке.' },
  { key: 'daf', name: 'Даф', native: 'دف', family: 'ударные', origin: 'Иран, Курдистан, Азербайджан', description: 'Большой рамочный барабан; по внутреннему ободу — кольца, которые звенят при каждом ударе.' },
  { key: 'bendir', name: 'Бендир', native: 'بندير', family: 'ударные', origin: 'Магриб, Турция', description: 'Рамочный барабан со струнами под мембраной, дающими гудящий призвук.' },
  { key: 'darbuka', name: 'Дарбука', native: 'دربوكة', family: 'ударные', origin: 'Арабский мир, Турция', description: 'Кубковый барабан: глубокий «дум» в центре, звонкий «тек» у края.' },
  { key: 'santur', name: 'Сантур', native: 'سنتور', family: 'струнные ударные', origin: 'Иран', description: 'Трапециевидные цимбалы: 72 струны, подставки-харраки, лёгкие молоточки-мизрабы.' },
  { key: 'tanbur', name: 'Танбур', native: 'تنبور', family: 'струнные щипковые', origin: 'Курдистан, Иран', description: 'Длинногрифая лютня с маленьким корпусом из шелковицы; инструмент суфийских собраний ахль-и хакк.' },
  { key: 'baglama', name: 'Баглама', native: 'bağlama', family: 'струнные щипковые', origin: 'Турция', description: 'Длинногрифая лютня с подвязанными ладами и тремя хорами струн.' },
  { key: 'tar', name: 'Тар', native: 'تار', family: 'струнные щипковые', origin: 'Азербайджан, Иран', description: 'Лютня с корпусом-«восьмёркой», затянутым бычьим перикардом; голос азербайджанского мугама.' },
  { key: 'kamancheh', name: 'Кяманча', native: 'کمانچه', family: 'смычковые', origin: 'Иран, Азербайджан', description: 'Смычковая с круглым корпусом на шпиле; играют, поворачивая инструмент, а не смычок.' },
  { key: 'erhu', name: 'Эрху', native: '二胡', family: 'смычковые', origin: 'Китай', description: 'Двухструнная скрипка: волос смычка проходит между струнами, резонатор обтянут кожей питона.' },
  { key: 'violin', name: 'Скрипка', family: 'смычковые', origin: 'Европа; в арабской музыке — с XIX века', description: 'В андалузской и арабской традиции её держат вертикально на колене.' },
  { key: 'cello', name: 'Виолончель', family: 'смычковые', origin: 'Европа', description: 'Басовый голос струнной группы.' },
  { key: 'zurna', name: 'Зурна', native: 'zurna', family: 'духовые', origin: 'Турция, Кавказ, Иран', description: 'Громкий конический гобой с раструбом; играют с непрерывным дыханием.' },
  { key: 'duduk', name: 'Дудук', family: 'духовые', origin: 'Армения, Кавказ', description: 'Абрикосовая трубка с широкой двойной тростью; мягкий, «плачущий» тембр.' },
  { key: 'piano', name: 'Фортепиано', family: 'клавишные', origin: 'Европа', description: 'Гармоническая опора аранжировки.' },
  { key: 'choir', name: 'Хор', family: 'голоса', origin: '', description: 'Хоровые голоса.' },
  { key: 'ensemble', name: 'Ансамбль', family: 'ансамбль', origin: '', description: 'Все инструменты вместе.' },
];

const byKey = new Map(INSTRUMENTS.map((i) => [i.key, i]));

export function instrument(key: string) {
  return byKey.get(key);
}

export function instrumentSvg(key: string): string {
  return svgs[`/src/instruments/svg/${key}.svg`] ?? svgs['/src/instruments/svg/ensemble.svg'] ?? '';
}

export function hasArt(key: string) {
  return `/src/instruments/svg/${key}.svg` in svgs;
}
