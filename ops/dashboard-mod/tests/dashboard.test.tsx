import { expect, mock, test } from 'claude-code/testing'

import { syncDelta, syncNext, taskSince, newFailures, waitPushes, agentRows, bandLine, cardContext, cardDoc, chatSince, codename, PANEL_URL, panelDoc, trendNext, dashboardContext, geminiWindows, isDashboardAsk, limitPush, remoteLive, rotationNote, settingsPatch, songRows, stateKey, summaryText, tokens, USER_SETTINGS } from '../hooks/register'
import type { Board, Live } from '../types'

const BOARD: Board = {
  updated: '2026-10-18T10:05:00Z',
  claude: 'Проверяю отчёты.',
  models: { claude: 'Opus 5.5', grok: 'grok-4.7', gemini: 'gemini-3.8-flash-high' },
  tasks: [
    { id: 'you-video', section: 'you', title: 'Видео концертов', how: 'Прислать ботом.' },
    { id: 't30', section: 'now', status: 'running', agent: 'claude', who: 'LL · Tech', title: 'Панель', now: 'Собираю', next: 'Показать' },
    { id: 't1', section: 'now', agent: 'grok', worktree: 't1-sync', title: 'Подсветка по словам' },
    { id: 'g', section: 'now', agent: 'gemini', title: 'Видео концертов' },
    { id: 'd1', section: 'done', date: '18 окт', title: 'Сцена инструментов' },
  ],
  songs: [{ id: 'one', title: 'ONE', groups: [{ name: 'Соло', proven: 20, placed: 33, total: 37 }, { name: 'Хор', proven: 0, placed: 22, total: 26 }] }],
  feed: [{ at: '2026-10-18T10:00:00Z', from: 'claude', to: 'gemini', text: 'Посмотреть концерт' }],
  syncGoal: 90,
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

test('a long-finished Grok drops off; a running folder no task names still shows', async () => {
  const live: Live = {
    grok: [
      { name: 't1-sync', state: 'finished', minutes: 3070, step: 'Готово.' },
      { name: 't28-icons', state: 'working', minutes: 2, step: 'Рисую.' },
    ],
    gemini: [],
  }
  const rows = agentRows(BOARD, live)
  expect(rows.map(r => r.name)).toEqual(['LL · Tech', 'Grok · Icons', 'Gemini · Watch'])
  expect(rows[1]?.state).toBe('работает · 2 мин')
  const fresh = agentRows(BOARD, { grok: [{ name: 't1-sync', state: 'finished', minutes: 30, step: '' }], gemini: [] })
  expect(fresh[1]?.state).toBe('готово · Claude проверяет')
})

test('the band lists every task at work and counts what waits on the owner', async () => {
  const line = bandLine(BOARD, LIVE)
  expect(line?.rows.map(r => r.agent)).toEqual(['claude', 'grok', 'gemini'])
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
  expect(text).toMatch(/◼ \*\*Grok · Sync\*\* — Подсветка по словам · остановился · 7 мин/)
  expect(text).toMatch(/✻ Claude 5 ч 23 % · ✦ Gemini 5 ч 6 %, неделя 2 % · ◼ Grok сегодня 178 М ток\./)
  expect(text).toMatch(/Нужно от вас:\*\* Видео концертов/)
  expect(text).toMatch(/цель 90 %/)
  expect(text).toContain('- ONE · соло — **54 %** (20/37)')
  expect(text).not.toContain('![')
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

test('typing dashboard puts the whole summary into the reply for windows that draw no card', async () => {
  const ctx = dashboardContext(summaryText(BOARD, LIVE, [], null))
  expect(ctx).toContain('Grok · Sync')
  expect(ctx).toContain('Нужно от вас:** Видео концертов')
  expect(ctx).toContain('ONE · хор — **0 %** (0/26)')
})

test('the chat card lists the chats and the Actions runs the orchestrator published', async () => {
  const text = summaryText(BOARD, { ...LIVE, chats: [{ name: 'LL · Main', state: 'idle' }, { name: 'LL · Site', state: 'working' }], pipeline: [{ name: 'pipeline', title: 'Proof of ONE', minutes: 12 }] }, [], null)
  expect(text).toContain('- ✻ Main — свободен')
  expect(text).toContain('- ✻ Site — работает')
  expect(text).toContain('- ⚙ **GitHub · pipeline** — Proof of ONE · 12 мин')
})

test('the rotation signal comes at 60 % of context, only in Living Lyrics folders', async () => {
  expect(rotationNote(59, 'C:/Users/User/Documents/GitHub/living-lyrics')).toBe(null)
  expect(rotationNote(61, 'C:/Users/User/Documents/GitHub/living-lyrics')).toContain('docs/process/chat-rotation.md')
  expect(rotationNote(80, 'C:/Users/User/Documents/GitHub/living-lyrics-wt/ll-business')).toContain('80 %')
  expect(rotationNote(90, 'C:/Users/User/Documents/GitHub/tenek-brand')).toBe(null)
  expect(rotationNote(undefined, 'C:/x/living-lyrics')).toBe(null)
})

test('the weekly limit pushes once per window, from 95 %', async () => {
  const week = (percentUsed: number) => [{ kind: 'five_hour', percentUsed: 99 }, { kind: 'seven_day', percentUsed, resetsAt: '2026-10-23T04:00:00Z' }]
  expect(limitPush(week(94), undefined)).toBe(null)
  expect(limitPush(week(96), undefined)?.text).toMatch(/^Недельный лимит Claude: 96 %/)
  expect(limitPush(week(99), '2026-10-23T04:00:00Z')).toBe(null)
  expect(limitPush(week(99), '2026-10-16T04:00:00Z')?.key).toBe('2026-10-23T04:00:00Z')
})

test('user settings: a missing or different key is written, the rest stays, a kept file is not touched', async () => {
  const current = { model: 'haiku', cleanupPeriodDays: 30 }
  expect(settingsPatch(current)).toEqual({ model: 'haiku', cleanupPeriodDays: 36500 })
  expect(settingsPatch({ model: 'haiku' })).toEqual({ model: 'haiku', cleanupPeriodDays: 36500 })
  expect(settingsPatch({ ...USER_SETTINGS, model: 'haiku' })).toBe(null)
})

test('the image card state carries every block, and its reply sends the PNG with the text as fallback', async () => {
  const doc = cardDoc(BOARD, LIVE, [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-21T04:00:00Z' }], { grok: { plan: 'SuperGrok Heavy', today: 38_000_000 } })
  expect(doc?.limits.claude[0]).toEqual({ label: '5 ч', used: 23, reset: expect.stringContaining('сброс'), resetAt: '2026-10-21T04:00:00Z' })
  expect(doc?.limits.grok?.today).toBe('38 М')
  expect(doc?.you.map(t => t.title)).toEqual(['Видео концертов'])
  expect(doc?.agents.map(a => a.agent)).toEqual(['claude', 'grok', 'gemini'])
  expect(cardDoc(null, LIVE, [], null)).toBe(null)
  const ctx = cardContext('C:\\Temp\\card.png', 'SUMMARY', 1)
  expect(ctx).toContain('files ["C:/Temp/card.png"]')
  expect(ctx).toContain('display "render"')
  expect(ctx.endsWith('SUMMARY')).toBe(true)
  expect(codename('t27-iphone')).toBe('iPhone')
})

test('/dashboard hands the word to the model, so the image card comes as the reply', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'plugin') sent.push(e.text)
    return { drop: 'test' } as never
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }) as never)
  await $.command.run({ command: 'dashboard' })
  await clock.advance(100)
  expect(sent).toEqual(['дашборд'])
})

test('the limit trend takes a sample every 15 minutes and keeps a week', async () => {
  const lim = [{ kind: 'five_hour', percentUsed: 26.4 }, { kind: 'seven_day', percentUsed: 3 }]
  const u = { grok: { today: 1000 }, gemini: { quota: { gemini: { fiveHourRemaining: 98, weeklyRemaining: 93 } } } }
  const t0 = 1_000_000_000_000
  const one = trendNext([], lim, u, t0)
  expect(one).toEqual([{ t: t0, c5: 26, cw: 3, g5: 2, gw: 7, gk: 1000 }])
  expect(trendNext(one, lim, u, t0 + 60_000)).toBe(one)
  expect(trendNext(one, lim, u, t0 + 15 * 60_000).length).toBe(2)
  expect(trendNext(one, lim, u, t0 + 8 * 86_400_000).length).toBe(1)
  expect(trendNext([], [], null, t0)).toEqual([])
})

test('a chat keeps its since-time while its state holds', async () => {
  const a = chatSince({}, [{ name: 'LL · Main', state: 'working' }], 100)
  expect(chatSince(a, [{ name: 'LL · Main', state: 'working' }], 900)['LL · Main']?.at).toBe(100)
  expect(chatSince(a, [{ name: 'LL · Main', state: 'idle' }], 900)['LL · Main']).toEqual({ state: 'idle', at: 900 })
})

test('the panel document adds trend, durations, tasks and roadmap steps to the card', async () => {
  const live: Live = { ...LIVE, chats: [{ name: 'LL · Main', state: 'working' }], grok: [{ ...LIVE.grok[0]!, age: 95 }] }
  const doc = panelDoc(BOARD, live, [], null, [{ t: 1, c5: 5 }], { 'LL · Main': { state: 'working', at: 0 } }, 30 * 60_000)
  expect(doc?.chats[0]).toMatchObject({ name: 'LL · Main', state: 'working', minutes: 30 })
  expect(doc?.agents.find(a => a.agent === 'grok')?.age).toBe(95)
  expect(doc?.work.map(t => [t.id, t.who, t.state, t.session])).toEqual([['t30', 'LL · Tech', 'working', null], ['t1', 'Grok · Sync', 'stalled', 95], ['g', 'Gemini', 'working', null]])
  expect(doc?.trend).toEqual([{ t: 1, c5: 5 }])
  expect(panelDoc(null, live, [], null, [], {}, 0)).toBe(null)
})

test('a panel write from anyone but the mod takes the usual permission path', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' }) as never)
  const own = await $.tool.check({ tool: 'ArtifactData', input: { url: PANEL_URL, collection: 'dashboard', doc_id: 'now', action: 'set' } } as never)
  expect(own.decision).toBe('ask')
})

test('a chat waiting over two minutes pushes once per wait, naming what it waits on', async () => {
  const chats = [{ name: 'LL · Tech', state: 'waiting', waiting_for: 'Artifact: publish' }, { name: 'LL · Site', state: 'working' }]
  const a = waitPushes({}, chats, 0)
  expect(a.push).toEqual([])
  const b = waitPushes(a.next, chats, 2 * 60_000)
  expect(b.push).toEqual(['Tech ждёт вас: Artifact: publish. Откройте чат.'])
  expect(waitPushes(b.next, chats, 10 * 60_000).push).toEqual([])
  const c = waitPushes(b.next, [{ name: 'LL · Tech', state: 'working' }], 11 * 60_000)
  expect(c.next).toEqual({})
  expect(waitPushes(waitPushes(c.next, chats, 12 * 60_000).next, chats, 15 * 60_000).push.length).toBe(1)
})

test('a failed Actions run is reported once; the first look only remembers', async () => {
  const run = (id: number) => ({ id, name: 'pipeline', branch: 'grok/t1-sync', title: 'x', url: 'u', at: '' })
  const first = newFailures(undefined, [run(1)])
  expect(first.report).toEqual([])
  const second = newFailures(first.seen, [run(1), run(2)])
  expect(second.report.map(r => r.id)).toEqual([2])
  expect(newFailures(second.seen, [run(2)]).report).toEqual([])
})

test('sync shows the change since yesterday; tasks keep the time they first showed', async () => {
  const h = syncNext([], [{ label: 'Karitas', proven: 20 }], 0)
  expect(syncNext(h, [{ label: 'Karitas', proven: 21 }], 10 * 60_000)).toBe(h)
  const later = syncNext(h, [{ label: 'Karitas', proven: 24 }], 25 * 3_600_000)
  expect(syncDelta(later, 'Karitas', 26, 25 * 3_600_000)).toBe(6)
  expect(syncDelta(h, 'Karitas', 26, 3_600_000)).toBe(null)
  expect(taskSince({ t1: 5 }, ['t1', 't2'], 99)).toEqual({ t1: 5, t2: 99 })
})
