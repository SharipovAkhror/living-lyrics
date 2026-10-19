import { expect, test } from 'claude-code/testing'

import { agentRows, bandLine, codename, geminiWindows, isDashboardAsk, remoteLive, songRows, stateKey, summaryText, tokens } from '../hooks/register'
import type { Board, Live } from '../types'

const BOARD: Board = {
  updated: '2026-10-18T10:05:00Z',
  claude: 'Проверяю отчёты.',
  models: { claude: 'Opus 5.5', grok: 'grok-4.7', gemini: 'gemini-3.8-flash-high' },
  tasks: [
    { id: 'you-video', section: 'you', title: 'Видео концертов', how: 'Прислать ботом.' },
    { id: 't1', section: 'now', agent: 'grok', worktree: 't1-sync', title: 'Подсветка по словам' },
    { id: 'g', section: 'now', agent: 'gemini', title: 'Видео концертов' },
    { id: 'd1', section: 'done', date: '18 окт', title: 'Сцена инструментов' },
  ],
  songs: [{ id: 'one', title: 'ONE', groups: [{ name: 'Соло', proven: 20, placed: 33, total: 37 }, { name: 'Хор', proven: 0, placed: 22, total: 26 }] }],
  feed: [{ at: '2026-10-18T10:00:00Z', from: 'claude', to: 'gemini', text: 'Посмотреть концерт' }],
}

const LIVE: Live = {
  grok: [{ name: 't1-sync', state: 'stalled', minutes: 7, step: 'Жду прогон.', tokens: 133558422, model: 'grok-4.7-build' }],
  gemini: [{ slug: 'karitas', minutes: 3 }],
}

test('agents are Claude first, then each Grok task with its live state, then Gemini', async () => {
  const rows = agentRows(BOARD, LIVE)
  expect(rows.map(r => r.agent)).toEqual(['claude', 'grok', 'gemini'])
  expect(rows[1]?.state).toBe('остановился · 7 мин')
  expect(rows[1]?.name).toBe('Grok · Sync')
  expect(rows[1]?.model).toBe('grok-4.7-build')
  expect(rows[2]?.name).toBe('Gemini · Watch')
  expect(rows[1]?.tone).toBe('stalled')
  expect(rows[1]?.detail).toBe('Жду прогон.')
  expect(rows[2]?.state).toBe('смотрит Karitas · 3 мин')
})

test('the band leaves Claude out and counts what waits on the owner', async () => {
  const line = bandLine(BOARD, LIVE)
  expect(line?.rows.map(r => r.agent)).toEqual(['grok', 'gemini'])
  expect(line?.you).toBe(1)
  expect(bandLine(null, LIVE)).toBe(null)
})

test('a song with two groups gets a row per group', async () => {
  expect(songRows(BOARD.songs).map(r => r.label)).toEqual(['ONE · соло', 'ONE · хор'])
})

test('the pane draws on every surface before the board arrives', async $ => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'll-dashboard',
      surface,
      component: 'Pane',
      requestId: 'll-dashboard',
      props: {
        title: 'Dashboard',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /Нет данных/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the filled pane draws on every surface', async ($, on) => {
  on('state.get', ($, e, next) => {
    if (e.plugin === 'll-dashboard' && e.key === 'board') return { value: { value: BOARD, version: 1 } }
    if (e.plugin === 'll-dashboard' && e.key === 'live') return { value: { value: LIVE, version: 1 } }
    return next(e)
  })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const pane = await $.ui.mount({
      plugin: 'll-dashboard',
      surface,
      component: 'Pane',
      requestId: 'll-dashboard',
      props: { title: 'Dashboard', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: /остановился · 7 мин/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Claude → Gemini/ })).toBeDefined()
    await pane.unmount()
  }
})

test('names, tokens and quota windows read the same way everywhere', async () => {
  expect(codename('t1-sync')).toBe('Sync')
  expect(codename('t7c-sources')).toBe('Sources')
  expect(codename('t13-parts')).toBe('Parts')
  expect(tokens(133558422)).toBe('134 М')
  expect(tokens(4500000)).toBe('4.5 М')
  expect(geminiWindows({ fiveHourRemaining: 94.14, fiveHourResetIn: '4h 2m', weeklyRemaining: 98.15 }).map(w => Math.round(w.used))).toEqual([6, 2])
})

test('the chat summary names each executor, the usage and what waits on the owner', async () => {
  const text = summaryText(BOARD, LIVE, [{ kind: 'five_hour', percentUsed: 23 }], {
    grok: { plan: 'SuperGrok Heavy', today: 178282571 },
    gemini: { plan: 'Google AI Pro', quota: { gemini: { fiveHourRemaining: 94, weeklyRemaining: 98 } } },
  })
  expect(text).toMatch(/\*\*Grok · Sync\*\* — Подсветка по словам · остановился · 7 мин/)
  expect(text).toMatch(/Gemini 5 ч 6 %, неделя 2 % · Grok сегодня 178 М ток\. · Claude 5 ч 23 %/)
  expect(text).toMatch(/Нужно от вас: Видео концертов/)
  expect(summaryText(null, LIVE, [], null)).toBe('Dashboard: данных пока нет.')
})

test('typing dashboard on the phone draws the live card in that message row', async ($, on) => {
  on('state.get', ($, e, next) => {
    if (e.plugin === 'll-dashboard' && e.key === 'board') return { value: { value: BOARD, version: 1 } }
    if (e.plugin === 'll-dashboard' && e.key === 'live') return { value: { value: LIVE, version: 1 } }
    return next(e)
  })
  for (const surface of ['mobile', 'desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'll-dashboard',
      surface,
      component: 'UserMessage',
      requestId: 'm1',
      props: { text: 'Dashboard', origin: { kind: 'bridge' }, isExpanded: false },
      viewport: { columns: 44, rows: 40 },
    })
    expect(await ui.find({ type: 'Text', text: /Grok · Sync/ })).toBeDefined()
    await ui.unmount()
  }
  expect(isDashboardAsk('  /dashboard ')).toBe(true)
  expect(isDashboardAsk('покажи dashboard')).toBe(false)
})

test('a published state is aged by the time since it was written', async () => {
  const published: Live = { at: '2026-10-19T10:00:00Z', grok: [{ name: 't1-sync', state: 'working', minutes: 2, step: '' }], gemini: [{ slug: 'one', minutes: 1 }] }
  const out = remoteLive(published, Date.parse('2026-10-19T10:10:00Z'))
  expect(out.grok[0]?.minutes).toBe(12)
  expect(out.gemini[0]?.minutes).toBe(11)
})

test('a published state older than 45 minutes, or without a time, shows nothing', async () => {
  const published: Live = { at: '2026-10-19T10:00:00Z', grok: [{ name: 't1-sync', state: 'working', minutes: 2, step: '' }], gemini: [] }
  expect(remoteLive(published, Date.parse('2026-10-19T11:00:00Z'))).toEqual({ grok: [], gemini: [] })
  expect(remoteLive({ grok: published.grok, gemini: [] }, Date.now())).toEqual({ grok: [], gemini: [] })
  expect(remoteLive(null, Date.now())).toEqual({ grok: [], gemini: [] })
})

test('the publish key ignores minutes and steps but sees a state change', async () => {
  const a: Live = { grok: [{ name: 't1', state: 'working', minutes: 1, step: 'a', model: 'm' }], gemini: [] }
  const b: Live = { grok: [{ name: 't1', state: 'working', minutes: 9, step: 'b', model: 'm' }], gemini: [] }
  const c: Live = { grok: [{ name: 't1', state: 'finished', minutes: 9, step: 'b', model: 'm' }], gemini: [] }
  expect(stateKey(a)).toBe(stateKey(b))
  expect(stateKey(a) === stateKey(c)).toBe(false)
})
