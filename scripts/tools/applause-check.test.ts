/**
 * The broken fixture must fail. Clean cases must stay quiet.
 *   npx tsx scripts/tools/applause-check.test.ts
 */
import { applauseIssues, type Plate } from './applause-check.ts';

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const quiet = (issues: { msg: string }[], where: string) => {
  if (issues.length) fail(`${where}: ${issues.map((issue) => issue.msg).join('; ')}`);
};

const plate = (over: Partial<Plate> & Pick<Plate, 'id'>): Plate => ({
  kind: 'instrumental',
  label: 'Проигрыш',
  start: 0,
  end: 10,
  instruments: [],
  ...over,
});

const broken = applauseIssues({
  review: [],
  sections: [plate({ id: 'end', label: 'Аплодисменты', start: 90, end: 100, instruments: ['daf'] })],
  spans: [],
});
if (broken.length !== 1) fail(`пустая дорожка детектора не поймала даф на аплодисментах: ${broken.length}`);
else console.log(`сломанный пример: ${broken[0].where}: ${broken[0].msg}`);

const drawn = applauseIssues({
  review: [],
  sections: [plate({ id: 'solo', start: 10, end: 20, instruments: ['voice', 'daf'] })],
  spans: [{ start: 10, end: 20, accepted: true }],
});
if (drawn.length !== 1) fail(`рисунок на принятом участке не ошибка: ${drawn.length}`);
else console.log(`сломанный пример: ${drawn[0].where}: ${drawn[0].msg}`);

const edge = applauseIssues({
  review: [],
  sections: [plate({ id: 'spill', start: 19.4, end: 30, instruments: ['oud'] })],
  spans: [{ start: 10, end: 20, accepted: true }],
});
if (edge.length !== 1) fail(`перехлёст 0,6 с не ошибка: ${edge.length}`);

const singing = applauseIssues({
  review: [],
  sections: [plate({ id: 'verse', kind: 'vocal', label: 'Куплет', start: 18, end: 40, instruments: [] })],
  spans: [{ start: 10, end: 20, accepted: true }],
});
if (singing.length !== 1) fail(`пение на участке аплодисментов не ошибка: ${singing.length}`);

const samples = new Array(20 * 6).fill(0.1);
const voice = applauseIssues({
  review: ['в review есть voice-10, но не эта секция'],
  sections: [plate({ id: 'voice-1', start: 0, end: 3, instruments: ['voice'], label: 'Голос' })],
  spans: [],
  vocals: { rate: 20, samples },
  floor: 0.375,
});
if (voice.length !== 1) fail(`тихий голос без своего id в review не ошибка: ${voice.length}`);
else console.log(`сломанный пример: ${voice[0].where}: ${voice[0].msg}`);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'bows', label: 'Аплодисменты', start: 90, end: 100, instruments: [] })],
    spans: [{ start: 90, end: 100, accepted: true }],
  }),
  'пустые аплодисменты',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'next', start: 20, end: 30, instruments: ['oud'] })],
    spans: [{ start: 10, end: 20, accepted: true }],
  }),
  'общая граница',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'touch', start: 19.5, end: 30, instruments: ['oud'] })],
    spans: [{ start: 10, end: 20, accepted: true }],
  }),
  'перехлёст ровно 0,5 с',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'daf', start: 10, end: 20, instruments: ['daf'] })],
    spans: [{ start: 10, end: 20, accepted: false }],
  }),
  'непринятый участок',
);

quiet(
  applauseIssues({
    review: ['2026-10-31. voice-5, свидетели расходятся, голос оставлен.'],
    sections: [plate({ id: 'voice-5', start: 0, end: 3, instruments: ['voice'], label: 'Голос' })],
    spans: [],
    vocals: { rate: 20, samples },
    floor: 0.375,
  }),
  'тихий голос назван в review',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'crumb', start: 0, end: 1.5, instruments: ['voice'], label: 'Голос' })],
    spans: [],
    vocals: { rate: 20, samples },
    floor: 0.375,
  }),
  'короче 2 с',
);

const loud = new Array(20 * 6).fill(0.5);
quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'voice-2', start: 0, end: 3, instruments: ['voice'], label: 'Голос' })],
    spans: [],
    vocals: { rate: 20, samples: loud },
    floor: 0.375,
  }),
  'стем выше порога',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'voice-3', start: 0, end: 3, instruments: ['voice'], label: 'Голос' })],
    spans: [],
    vocals: { rate: 20, samples: new Array(20 * 6).fill(0.375) },
    floor: 0.375,
  }),
  'стем ровно на пороге',
);

quiet(
  applauseIssues({
    review: [],
    sections: [plate({ id: 'voice-4', start: 0, end: 3, instruments: ['voice'], label: 'Голос' })],
    spans: [],
  }),
  'нет стема — голосовая половина молчит',
);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('applause-check: broken fixture fails, clean cases pass');
