import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { AgentName, Board, ChatRow, FeedItem, Group, Hygiene, Limit, Live, PipelineRun, QuotaGroup, Song, Task, Usage } from '../types'
import { ICON_CLAUDE, ICON_GEMINI, ICON_GROK } from './icons'

/**
 * Living Lyrics dashboard. The band above the prompt is one line: which agent works on what,
 * and a Dashboard button. The pane shows each agent's limits, the agents by name and model with
 * their live state, what waits on the owner, word-sync progress and the latest hand-offs.
 * Layout follows the pane width (`bodyColumns`): narrow drops the secondary lines.
 * The board is the repo's ops/board.json: read from disk when the session runs in the repo's main
 * checkout, else fetched from GitHub (the repo is public), so the mod works on any computer.
 * Live Grok and Gemini state (hooks/agents_live.py) and the usage collector (ops/usage/collect.py,
 * every 10 min) run only where the executors work: the checkout with ../living-lyrics-wt beside it.
 * That machine also publishes the live state to the `live` branch (ops/agents/publish_live.py, only
 * when states change, plus a heartbeat); every other device reads it from there (raw.githubusercontent).
 */

const PANE = 'll-dashboard'
const TITLE = 'Dashboard'
const RAW = 'https://raw.githubusercontent.com/SharipovAkhror/living-lyrics/main'
const BOARD = 'ops/board.json'
const USAGE = 'ops/usage/latest.json'
const LIVE_URL = 'https://raw.githubusercontent.com/SharipovAkhror/living-lyrics/refs/heads/live/ops/live.json'
const PUBLISH = 'ops/agents/publish_live.py'
const STALE_MIN = 45
const POLL_MS = 30_000
const REMOTE_MS = 120_000
const COLLECT_MS = 600_000
const NARROW = 56

const board = atom({ plugin: 'll-dashboard', key: 'board' } as const, null)
const live = atom({ plugin: 'll-dashboard', key: 'live' } as const, { grok: [], gemini: [] })
const limits = atom({ plugin: 'll-dashboard', key: 'limits' } as const, [])
const usage = atom({ plugin: 'll-dashboard', key: 'usage' } as const, null)

const NAME: Record<AgentName | 'owner', string> = { claude: 'Claude', grok: 'Grok', gemini: 'Gemini', owner: 'Вы' }
const ICON: Record<AgentName, string> = { claude: ICON_CLAUDE, grok: ICON_GROK, gemini: ICON_GEMINI }
const GLYPH: Record<AgentName, { mark: string; color: string }> = {
  claude: { mark: '✻', color: 'claude' },
  grok: { mark: '◼', color: 'text' },
  gemini: { mark: '✦', color: 'suggestion' },
}
const SONG: Record<string, string> = { 'i-have-come-alive': 'I Have Come Alive', karitas: 'Karitas', one: 'ONE' }

type Tone = 'working' | 'stalled' | 'review' | 'idle'
const TONE: Record<Tone, string> = { working: 'success', stalled: 'warning', review: 'suggestion', idle: 'inactive' }

export type Row = { agent: AgentName; name: string; task: string; state: string; tone: Tone; detail: string; model: string }

function ago(minutes: number) {
  if (minutes < 1) return 'сейчас'
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function hhmm(iso?: string) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  try {
    return t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return t.toISOString().slice(11, 16)
  }
}

/** What a device without the executors shows of the published state: aged by the time since `at`, or nothing when it is stale. */
export function remoteLive(published: Live | null | undefined, now: number): Live {
  const empty: Live = { grok: [], gemini: [] }
  const at = published?.at ? Date.parse(published.at) : Number.NaN
  if (!published || Number.isNaN(at)) return empty
  const age = Math.max(0, Math.floor((now - at) / 60_000))
  if (age > STALE_MIN) return empty
  return {
    at: published.at,
    grok: (published.grok ?? []).map(r => ({ ...r, minutes: r.minutes + age })),
    gemini: (published.gemini ?? []).map(r => ({ ...r, minutes: r.minutes + age })),
    chats: published.chats ?? [],
    pipeline: (published.pipeline ?? []).map(r => ({ ...r, minutes: r.minutes + age })),
    hygiene: published.hygiene ?? null,
  }
}

/** The states that matter for publishing; minutes, steps and token counts change on every poll. */
export function stateKey(l: Live) {
  return JSON.stringify([l.grok.map(r => [r.name, r.state, r.model ?? '']), l.gemini.map(r => r.slug), (l.chats ?? []).map(c => [c.name, c.state]), (l.pipeline ?? []).map(r => r.title), l.hygiene?.at ?? ''])
}

export function tokens(n?: number) {
  if (!n) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} М`
  return `${Math.round(n / 1e3)} тыс.`
}

/** Executor name from its worktree: `t1-sync` → `Sync`. Worktrees are named t<N>-<codename>. */
export function codename(worktree?: string) {
  const word = (worktree ?? '').replace(/^t\d+[a-z]?-/, '').split('-')[0] ?? ''
  if (word.toLowerCase() === 'iphone') return 'iPhone'
  return word ? word[0]!.toUpperCase() + word.slice(1) : ''
}

const STALE_REVIEW_MIN = 6 * 60

/** Claude first, then each Grok executor with its live state, then Gemini. */
export function agentRows(b: Board | null, l: Live): Row[] {
  if (!b) return []
  const rows: Row[] = [
    { agent: 'claude', name: 'Claude · Lead', task: b.claude ?? 'оркестрирует', state: '', tone: 'working', detail: '', model: b.models?.claude ?? '' },
  ]
  const now = b.tasks.filter(t => t.section === 'now')
  // A finished Grok session older than STALE_REVIEW_MIN was reviewed long ago: drop its row.
  const stale = (r?: Live['grok'][number]) => r?.state === 'finished' && r.minutes > STALE_REVIEW_MIN
  const grokTasks = now.filter(t => t.agent === 'grok' && !stale(t.worktree ? l.grok.find(r => r.name === t.worktree) : undefined))
  // Live folders with a running or stalled Grok that no board task names still get a row.
  const named = new Set(b.tasks.map(t => t.worktree).filter(Boolean))
  for (const r of l.grok.filter(r => (r.state === 'working' || r.state === 'stalled') && !named.has(r.name))) {
    grokTasks.push({ id: r.name, section: 'now', agent: 'grok', worktree: r.name, title: r.name } satisfies Task)
  }
  for (const t of grokTasks) {
    const run = t.worktree ? l.grok.find(r => r.name === t.worktree) : undefined
    const name = `Grok · ${codename(t.worktree) || 'Task'}`
    const model = run?.model || b.models?.grok || ''
    if (!run) {
      rows.push({ agent: 'grok', name, task: t.title, state: t.chip ?? 'ждёт', tone: 'idle', detail: '', model })
      continue
    }
    const state =
      run.state === 'working' ? `работает · ${ago(run.minutes)}`
      : run.state === 'stalled' ? `остановился · ${ago(run.minutes)}`
      : run.state === 'finished' ? 'готово · Claude проверяет'
      : 'ещё не начал'
    const tone: Tone = run.state === 'working' ? 'working' : run.state === 'stalled' ? 'stalled' : run.state === 'finished' ? 'review' : 'idle'
    rows.push({ agent: 'grok', name, task: t.title, state, tone, detail: run.step, model })
  }
  for (const t of now.filter(t => t.agent === 'gemini')) {
    const run = l.gemini[0]
    const state = run ? `${SONG[run.slug] ? `смотрит ${SONG[run.slug]}` : 'работает'} · ${ago(run.minutes)}` : (t.chip ?? 'ждёт')
    rows.push({ agent: 'gemini', name: 'Gemini · Watch', task: t.title, state, tone: run ? 'working' : 'idle', detail: '', model: b.models?.gemini ?? '' })
  }
  return rows
}

export function songRows(songs: Song[]) {
  return songs.flatMap(s => s.groups.map(g => ({ label: s.groups.length > 1 ? `${s.title} · ${g.name.toLowerCase()}` : s.title, group: g })))
}

/** One line per window, all as "used %", so Claude and Gemini read the same way. */
export type Window = { label: string; used: number; reset: string }

export function claudeWindows(lim: Limit[]): Window[] {
  return lim.map(l => ({
    label: l.kind === 'five_hour' ? '5 ч' : l.kind === 'seven_day' ? 'неделя' : l.kind,
    used: l.percentUsed,
    reset: l.resetsAt ? `сброс ${hhmm(l.resetsAt)}` : '',
  }))
}

export function geminiWindows(q?: QuotaGroup): Window[] {
  if (!q) return []
  const out: Window[] = []
  if (q.fiveHourRemaining !== undefined) out.push({ label: '5 ч', used: 100 - q.fiveHourRemaining, reset: q.fiveHourResetIn ? `сброс через ${q.fiveHourResetIn}` : '' })
  if (q.weeklyRemaining !== undefined) out.push({ label: 'неделя', used: 100 - q.weeklyRemaining, reset: q.weeklyResetIn ? `сброс через ${q.weeklyResetIn}` : '' })
  return out
}

function meterSvg(fraction: number, width: number, goal?: number, placed?: number, color?: string) {
  const f = Math.max(0, Math.min(1, fraction))
  const p = placed === undefined ? f : Math.max(f, Math.min(1, placed))
  const fill = color ?? (goal === undefined ? (f >= 0.9 ? '#D9534F' : f >= 0.75 ? '#E0A23B' : '#5BA67A') : '#7F77DD')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 10" width="${width}" height="10">` +
    `<rect y="2.5" width="${width}" height="5" rx="2.5" fill="rgba(128,128,140,0.25)"/>` +
    (p > f ? `<rect y="2.5" width="${(p * width).toFixed(1)}" height="5" rx="2.5" fill="rgba(127,119,221,0.4)"/>` : '') +
    `<rect y="2.5" width="${Math.max(f * width, f > 0 ? 2 : 0).toFixed(1)}" height="5" rx="2.5" fill="${fill}"/>` +
    (goal === undefined ? '' : `<rect x="${(goal * width - 1).toFixed(1)}" y="0" width="2" height="10" rx="1" fill="rgba(128,128,140,0.95)"/>`) +
    `</svg>`
  )
}

function meterText(fraction: number, width = 10) {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

const CHAT_STATE: Record<string, string> = { working: 'работает', waiting: 'ждёт ответа', idle: 'свободен', retired: 'спит', none: 'не запущен' }

/**
 * The dashboard as chat lines (markdown). Where nothing a mod draws is shown (claude.ai/code and the
 * phone over Remote Control, cloud sessions), /dashboard answers with this text, so it carries the
 * pane's content: what waits on the owner, chats, executors and runs, word sync, usage.
 */
export function summaryText(b: Board | null, l: Live, lim: Limit[], u: Usage | null) {
  if (!b) return 'Dashboard: данных пока нет.'
  const head = [`**Living Lyrics** · ${hhmm(b.updated)}`, b.roadmap ? `${b.roadmap.title.toLowerCase()} ${b.roadmap.percent} %` : ''].filter(Boolean)
  // Plain text only: remote windows draw markdown images as click-to-load boxes and bar glyphs as tofu.
  const out = [head.join(' · ')]
  const you = b.tasks.filter(t => t.section === 'you')
  out.push('', you.length ? `⚑ **Нужно от вас:** ${you.map(t => t.title).join('; ')}` : 'От вас ничего не нужно.')

  const chats = l.chats ?? []
  if (chats.length) {
    out.push('', '**Чаты**', ...chats.map((c: ChatRow) => `- ✻ ${c.name.replace(/^LL · /, '')} — ${CHAT_STATE[c.state] ?? c.state}`))
  }
  const rows = agentRows(b, l).filter(r => r.agent !== 'claude')
  const runs = l.pipeline ?? []
  if (rows.length || runs.length) {
    out.push('', '**Исполнители**')
    for (const r of rows) out.push(`- ${GLYPH[r.agent].mark} **${r.name}** — ${r.task}${r.state ? ` · ${r.state}` : ''}`)
    for (const r of runs) out.push(`- ⚙ **GitHub · ${r.name}** — ${r.title} · ${ago(r.minutes)}`)
  }
  if (b.songs.length) {
    out.push('', `**Подсветка по словам**${b.syncGoal === undefined ? '' : ` · цель ${b.syncGoal} %`}`)
    for (const { label, group } of songRows(b.songs)) {
      const pct = Math.round((group.proven / Math.max(1, group.total)) * 100)
      const done = b.syncGoal !== undefined && pct >= b.syncGoal ? ' ✓' : ''
      out.push(`- ${label} — **${pct} %** (${group.proven}/${group.total})${done}`)
    }
  }
  const cl = claudeWindows(lim).map(w => `${w.label} ${Math.round(w.used)} %`).join(', ')
  const gem = geminiWindows(u?.gemini?.quota?.gemini).map(w => `${w.label} ${Math.round(w.used)} %`).join(', ')
  const parts = [cl ? `✻ Claude ${cl}` : '', gem ? `✦ Gemini ${gem}` : '', u?.grok ? `◼ Grok сегодня ${tokens(u.grok.today)} ток.` : ''].filter(Boolean)
  if (parts.length) out.push('', `**Израсходовано:** ${parts.join(' · ')}`)
  const h = l.hygiene
  if (h && (h.fixed.length || h.issues.length)) {
    out.push('', `**Порядок** · ${hhmm(h.at)}${h.fixed.length ? ` · убрано ${h.fixed.length}` : ''}`, ...h.issues.slice(0, 3).map(i => `- ${i}`))
    if (h.issues.length > 3) out.push(`- … ещё ${h.issues.length - 3}`)
  }
  return out.join('\n')
}

export function bandLine(b: Board | null, l: Live) {
  if (!b) return null
  return { rows: agentRows(b, l).filter(r => r.agent !== 'claude'), you: b.tasks.filter(t => t.section === 'you').length }
}

function agentsScript($: EngineInterface) {
  return `${$.plugin.root}/hooks/agents_live.py`
}

/** Where the board comes from: the repo's main checkout on disk, or GitHub. */
type Place = { repo: string | null; orchestrator: boolean }

let place: Place = { repo: null, orchestrator: false }

/** The session's folder when it is the repo's main checkout (a worktree's `.git` is a file). */
async function findPlace($: EngineInterface): Promise<Place> {
  try {
    const cwd = (await $.session.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
    const git = await $.fs.stat(`${cwd}/.git`)
    const file = await $.fs.stat(`${cwd}/${BOARD}`)
    if (git.kind !== 'dir' || file.kind !== 'file') return { repo: null, orchestrator: false }
    const wt = await $.fs.stat(`${cwd.replace(/\/[^/]+$/, '')}/living-lyrics-wt`).catch(() => undefined)
    return { repo: cwd, orchestrator: wt?.kind === 'dir' }
  } catch {
    return { repo: null, orchestrator: false }
  }
}

/**
 * User settings every device of the owner keeps, in every project (docs/process/chat-rotation.md,
 * «История чатов»): chat transcripts are never cleaned up. At session start the mod writes each key
 * that is missing or differs into ~/.claude/settings.json; the other keys stay as they are.
 */
export const USER_SETTINGS: Record<string, unknown> = { cleanupPeriodDays: 36500 }

export function settingsPatch(current: Record<string, unknown>, wanted = USER_SETTINGS) {
  const keys = Object.keys(wanted).filter(k => JSON.stringify(current[k]) !== JSON.stringify(wanted[k]))
  return keys.length ? { ...current, ...Object.fromEntries(keys.map(k => [k, wanted[k]])) } : null
}

async function keepUserSettings($: EngineInterface) {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home && `${home}/.claude`)
    if (!dir) return
    const path = `${dir.replace(/\\/g, '/')}/settings.json`
    const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
    const patched = settingsPatch(JSON.parse(text) as Record<string, unknown>)
    if (patched) await $.fs.write(path, `${JSON.stringify(patched, null, 2)}\n`)
  } catch {
    // A settings file that does not parse is left alone: it is the owner's to fix, never overwritten.
  }
}

async function fetchJson($: EngineInterface, path: string) {
  const res = await $.http.fetch(`${RAW}/${path}`)
  return res.ok ? (JSON.parse(res.text) as unknown) : undefined
}

async function readJson($: EngineInterface, path: string, seen: Record<string, number>) {
  const stat = await $.fs.stat(path)
  if (seen[path] === stat.mtimeMs) return undefined
  seen[path] = stat.mtimeMs
  return JSON.parse(await $.fs.read(path)) as unknown
}

async function refresh($: EngineInterface, seen: Record<string, number>) {
  if (place.repo) {
    try {
      const parsed = await readJson($, `${place.repo}/${BOARD}`, seen)
      if (parsed) await update($, board, () => parsed as Board)
    } catch {
      // No board yet, or a half-written file: keep what is shown.
    }
    try {
      const parsed = await readJson($, `${place.repo}/${USAGE}`, seen)
      if (parsed) await update($, usage, () => parsed as Usage)
    } catch {
      // No usage ledger yet.
    }
  } else if (Date.now() - (seen.remote ?? 0) >= REMOTE_MS) {
    seen.remote = Date.now()
    try {
      const parsed = await fetchJson($, BOARD)
      if (parsed) await update($, board, () => parsed as Board)
      const used = await fetchJson($, USAGE)
      if (used) await update($, usage, () => used as Usage)
      const res = await $.http.fetch(LIVE_URL)
      const next = remoteLive(res.ok ? (JSON.parse(res.text) as Live) : null, Date.now())
      if (JSON.stringify(next) !== JSON.stringify(await read($, live))) await update($, live, () => next)
    } catch {
      // Offline: keep what is shown.
    }
  }
  if (place.orchestrator && place.repo) {
    try {
      const res = await $.process.run(['python', agentsScript($), place.repo], { timeoutMs: 25_000 })
      if (res.exitCode === 0) {
        const next = { ...(JSON.parse(res.stdout) as Live), ...station }
        if (JSON.stringify(next) !== JSON.stringify(await read($, live))) await update($, live, () => next)
        await publishLive($, next)
      }
    } catch {
      // Python missing or slow: the board alone still draws.
    }
  }
  try {
    const u = await $.session.usage()
    const next: Limit[] = u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    if (JSON.stringify(next) !== JSON.stringify(await read($, limits))) await update($, limits, () => next)
    await pushLimit($, next)
    await saveCardState($)
  } catch {
    // Off a subscription the windows are empty.
  }
}

const PUSH_AT = 95

/**
 * The phone push for the weekly Claude limit: once per weekly window (`key`), when it crosses
 * PUSH_AT. `sent` is the window last pushed, kept in $.store, which every session on the machine
 * shares, so several open sessions push once between them.
 */
export function limitPush(lim: Limit[], sent: unknown) {
  const week = lim.find(l => l.kind === 'seven_day')
  if (!week || week.percentUsed < PUSH_AT) return null
  const key = week.resetsAt ?? 'week'
  if (sent === key) return null
  const reset = week.resetsAt ? `, сброс ${new Date(week.resetsAt).toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''
  return { key, text: `Недельный лимит Claude: ${Math.round(week.percentUsed)} %${reset}. Скоро работа встанет.` }
}

async function pushLimit($: EngineInterface, lim: Limit[]) {
  const push = limitPush(lim, await $.store.get('limit-push'))
  if (!push) return
  await $.store.set('limit-push', push.key)
  try {
    await $.tool.call({ tool: 'PushNotification', message: push.text, status: 'proactive' })
  } catch {
    // No push here (Remote Control off, or the tool absent): a desktop notification at least.
    await $.ui.notify(push.text, { title: 'Living Lyrics' }).catch(() => undefined)
  }
}

/**
 * Push the live state to the `live` branch when its states differ from what this load last pushed.
 * `published` is a plain variable, not state: it resets on every (re)load, so a fresh load always
 * pushes once; the script skips an unchanged signature itself and keeps the heartbeat (`heartbeat`).
 */
let published: string | null = null

async function publishLive($: EngineInterface, l: Live, heartbeat = false) {
  if (!place.orchestrator || !place.repo) return
  const key = stateKey(l)
  if (!heartbeat && key === published) return
  try {
    const res = await $.process.run(['python', `${place.repo}/${PUBLISH}`, place.repo, '--stdin'], { cwd: place.repo, stdin: JSON.stringify(l), timeoutMs: 90_000 })
    if (res.exitCode === 0) published = key
  } catch {
    // Offline or no push rights: other devices keep the last published state.
  }
}

/** The orchestrator machine's chats and Actions runs; ops/agents/station_tick.py also pulls the main checkout. */
let station: Pick<Live, 'chats' | 'pipeline' | 'hygiene'> = {}

async function stationTick($: EngineInterface) {
  if (!place.orchestrator || !place.repo) return
  try {
    const res = await $.process.run(['python', `${place.repo}/ops/agents/station_tick.py`, place.repo], { cwd: place.repo, timeoutMs: 60_000 })
    if (res.exitCode !== 0) return
    const tick = JSON.parse(res.stdout) as { chats: ChatRow[]; pipeline: PipelineRun[]; hygiene?: Hygiene | null }
    station = { chats: tick.chats, pipeline: tick.pipeline, hygiene: tick.hygiene ?? null }
  } catch {
    // A tool missing on PATH: the rest of the dashboard still draws.
  }
}

async function collectUsage($: EngineInterface) {
  if (!place.orchestrator || !place.repo) return
  try {
    await $.process.run(['python', `${place.repo}/ops/usage/collect.py`], { cwd: place.repo, timeoutMs: 120_000 })
  } catch {
    // agy or grok missing: the ledger keeps its last snapshot.
  }
}

/** Respawn a work chat the Claude daemon retired after 8 h idle (ops/agents/keep_chats.py). */
async function keepChats($: EngineInterface) {
  if (!place.orchestrator || !place.repo) return
  try {
    await $.process.run(['python', `${place.repo}/ops/agents/keep_chats.py`, place.repo], { cwd: place.repo, timeoutMs: 60_000 })
  } catch {
    // claude missing from PATH: the chats wait for a manual `claude respawn`.
  }
}

/** The dashboard tree, for the pane on a computer and for a chat card on any surface (the phone too). */
async function dashboardTree($: EngineInterface, e: RenderInput<'Pane' | 'UserMessage'>, columns: number) {
  const b = await read($, board)
  const l = await read($, live)
  const lim = await read($, limits)
  const u = await read($, usage)
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Svg = 'Svg' in ui ? ui.Svg : null
  const narrow = columns < NARROW
  const mark = (a: AgentName, size: number) => (Svg ? <Svg source={ICON[a]} alt={NAME[a]} width={size} height={size} /> : <Text color={GLYPH[a].color}>{GLYPH[a].mark}</Text>)
  const meter = (fraction: number, width: number, goal?: number, placed?: number, color?: string) =>
    Svg ? <Svg source={meterSvg(fraction, width, goal, placed, color)} alt={`${Math.round(fraction * 100)} %`} width={width} height={10} /> : <Text dimColor>{meterText(fraction)}</Text>
  const label = (text: string) => (
    <Text size="caption" weight="semibold" dimColor>
      {text}
    </Text>
  )
  const windowRows = (ws: Window[], key: string) =>
    ws.map((w, i) => (
      <Box key={`${key}${i}`} flexDirection="row" columnGap={1} alignItems="center" paddingLeft={3}>
        <Box width={7}>
          <Text size="caption" dimColor>
            {w.label}
          </Text>
        </Box>
        {meter(w.used / 100, narrow ? 48 : 72)}
        <Text size="caption" tabular>
          {Math.round(w.used)} %
        </Text>
        {w.reset && !narrow ? (
          <Text size="caption" dimColor>
            {w.reset}
          </Text>
        ) : null}
      </Box>
    ))
  if (!b) return <Text dimColor>Нет данных: Claude запишет состояние после следующего шага.</Text>

  const rows = agentRows(b, l)
  const you: Task[] = b.tasks.filter(t => t.section === 'you')
  const feed: FeedItem[] = (b.feed ?? []).slice(0, narrow ? 3 : 5)
  const barW = narrow ? 72 : 110
  const gemQuota = u?.gemini?.quota?.gemini

  return (
    <Box flexDirection="column" rowGap={1} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text weight="semibold">Living Lyrics</Text>
        <Text size="caption" dimColor tabular>
          {hhmm(b.updated)}
        </Text>
      </Box>

      {b.roadmap ? (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Text size="footnote" weight="semibold">
              {b.roadmap.title}
            </Text>
            {meter(b.roadmap.percent / 100, narrow ? 72 : 120, undefined, undefined, '#7F77DD')}
            <Text size="footnote" tabular weight="semibold">
              {b.roadmap.percent} %
            </Text>
          </Box>
          {b.roadmap.steps.map((st, i) => (
            <Box key={`rm${i}`} flexDirection="row" columnGap={1} paddingLeft={1}>
              <Text color={st.done >= 1 ? 'success' : st.done > 0 ? 'warning' : 'inactive'}>{st.done >= 1 ? '✓' : st.done > 0 ? '◐' : '○'}</Text>
              <Text size="caption" dimColor={st.done >= 1} wrap="truncate-end">
                {st.name}
                {st.done > 0 && st.done < 1 ? ` · ${Math.round(st.done * 100)} %` : ''}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box flexDirection="column">
        {label('Лимиты · использовано')}
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {mark('gemini', 14)}
          <Text size="footnote" weight="medium">
            Gemini
          </Text>
          <Text size="caption" dimColor>
            {u?.gemini?.plan ?? 'Antigravity'}
            {gemQuota?.at ? ` · ${hhmm(gemQuota.at)}` : ''}
          </Text>
        </Box>
        {gemQuota ? windowRows(geminiWindows(gemQuota), 'g') : (
          <Box paddingLeft={3}>
            <Text size="caption" dimColor>
              нет данных: сборщик ещё не запускался
            </Text>
          </Box>
        )}
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {mark('grok', 14)}
          <Text size="footnote" weight="medium">
            Grok
          </Text>
          <Text size="caption" dimColor>
            {u?.grok?.plan ?? 'Grok Build'}
          </Text>
        </Box>
        <Box paddingLeft={3} flexDirection="row" columnGap={1}>
          <Text size="caption" tabular>
            сегодня {tokens(u?.grok?.today)} ток. · 7 дней {tokens(u?.grok?.week)}
          </Text>
          {narrow ? null : (
            <Text size="caption" dimColor>
              · лимит xAI не сообщает
            </Text>
          )}
        </Box>
        {lim.length ? (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1} alignItems="center">
              {mark('claude', 14)}
              <Text size="footnote" weight="medium">
                Claude
              </Text>
            </Box>
            {windowRows(claudeWindows(lim), 'c')}
          </Box>
        ) : null}
      </Box>

      <Box flexDirection="column" rowGap={1}>
        {label('Агенты')}
        {rows.map((r, i) => (
          <Box key={`r${i}`} flexDirection="row" columnGap={1}>
            {mark(r.agent, 18)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box flexDirection="row" columnGap={1} alignItems="center" flexWrap="wrap">
                <Text weight="semibold">{r.name}</Text>
                {r.model && !narrow ? (
                  <Text size="caption" dimColor>
                    {r.model}
                  </Text>
                ) : null}
              </Box>
              <Text size="footnote" wrap="truncate-end">
                {r.task}
              </Text>
              {r.state ? (
                <Box flexDirection="row" columnGap={1}>
                  <Text color={TONE[r.tone]}>●</Text>
                  <Text size="footnote" dimColor>
                    {r.state}
                  </Text>
                </Box>
              ) : null}
              {r.detail && !narrow ? (
                <Text size="caption" dimColor wrap="truncate-end">
                  {r.detail}
                </Text>
              ) : null}
            </Box>
          </Box>
        ))}
      </Box>

      {you.length ? (
        <Box flexDirection="column">
          {label('Нужно от вас')}
          {you.map(t => (
            <Box key={t.id} flexDirection="column">
              <Text size="footnote" color="warning" weight="semibold">
                ⚑ {t.title}
              </Text>
              {t.how && !narrow ? (
                <Text size="caption" dimColor>
                  {t.how}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {b.songs.length ? (
        <Box flexDirection="column">
          {label(b.syncGoal === undefined ? 'Подсветка по словам' : `Подсветка по словам · цель ${b.syncGoal} %`)}
          {songRows(b.songs).map(({ label: name, group }: { label: string; group: Group }, i) => (
            <Box key={`s${i}`} flexDirection="row" columnGap={1} alignItems="center">
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="truncate-end">
                  {name}
                </Text>
              </Box>
              {meter(group.proven / Math.max(1, group.total), barW, b.syncGoal === undefined ? undefined : b.syncGoal / 100, (group.placed ?? group.proven) / Math.max(1, group.total))}
              <Box width={7} justifyContent="flex-end">
                <Text size="caption" tabular dimColor>
                  {group.proven}/{group.total}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {feed.length ? (
        <Box flexDirection="column">
          {label('Лента')}
          {feed.map((f, i) => (
            <Box key={`f${i}`} flexDirection="row" columnGap={1}>
              <Text size="caption" tabular dimColor>
                {hhmm(f.at)}
              </Text>
              <Text size="caption" weight="medium">
                {NAME[f.from]} → {NAME[f.to]}
              </Text>
              <Box flexShrink={1}>
                <Text size="caption" dimColor wrap="truncate-end">
                  {f.text}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

const ROTATE_AT = 60

/** The rotation signal for a Living Lyrics chat whose context passed the threshold; null otherwise. */
export function rotationNote(percent: number | undefined, cwd: string) {
  if (percent === undefined || percent < ROTATE_AT || !/living-lyrics/i.test(cwd)) return null
  return (
    `Chat rotation: this chat's context is ${Math.round(percent)} % (threshold ${ROTATE_AT} %). ` +
    'Finish the current step to a point you can hand over (commit, report), then rotate this chat per ' +
    'docs/process/chat-rotation.md without waiting for the owner. Do not start it in the middle of a review, a merge or a question to the owner.'
  )
}

/** What Claude is told when the owner types `dashboard`: answer with the summary, nothing else. */
export function dashboardContext(summary: string) {
  return (
    'The owner asked for the Dashboard. Some windows draw it as a card, remote windows do not, so reply with ' +
    'exactly this summary as compact Markdown (keep the lines, no intro, no advice, no tools):\n\n' +
    summary
  )
}

/** The dashboard state the image card draws (card/render.mjs reads it on stdin). */
export function cardDoc(b: Board | null, l: Live, lim: Limit[], u: Usage | null) {
  if (!b) return null
  return {
    at: new Date().toISOString(),
    roadmap: b.roadmap ? { title: b.roadmap.title, percent: b.roadmap.percent } : null,
    goal: b.syncGoal ?? null,
    you: b.tasks.filter(t => t.section === 'you').map(t => ({ title: t.title, how: t.how ?? t.what ?? '' })),
    chats: l.chats ?? [],
    agents: agentRows(b, l).map(r => ({ agent: r.agent, name: r.name, task: r.task, state: r.state, tone: r.tone, detail: r.detail })),
    runs: l.pipeline ?? [],
    songs: songRows(b.songs).map(({ label, group }) => ({ label, proven: group.proven, placed: group.placed ?? group.proven, total: group.total })),
    hygiene: l.hygiene ? { fixed: l.hygiene.fixed.length, issues: l.hygiene.issues.slice(0, 3), more: Math.max(0, l.hygiene.issues.length - 3) } : null,
    limits: {
      claude: claudeWindows(lim).map(w => ({ label: w.label, used: Math.round(w.used), reset: w.reset })),
      gemini: geminiWindows(u?.gemini?.quota?.gemini).map(w => ({ label: w.label, used: Math.round(w.used), reset: w.reset })),
      grok: u?.grok ? { today: tokens(u.grok.today), week: u.grok.week ? tokens(u.grok.week) : '', plan: u.grok.plan ?? '' } : null,
      plans: { claude: b.models?.claude ?? '', gemini: u?.gemini?.plan ?? '' },
    },
  }
}

let cardKey = ''

/** The Station keeps the latest card state on disk, so the card can be redrawn and checked outside a chat. */
async function saveCardState($: EngineInterface) {
  if (!place.orchestrator) return
  const doc = cardDoc(await read($, board), await read($, live), await read($, limits), await read($, usage))
  const dir = await $.env.get('LOCALAPPDATA')
  if (!doc || !dir) return
  const { at: _at, ...rest } = doc
  const key = JSON.stringify(rest)
  if (key === cardKey) return
  cardKey = key
  try {
    await $.fs.write(`${dir}/ll-dashboard/state.json`, JSON.stringify(doc))
  } catch {
    cardKey = ''
  }
}

/** Draws the card; resolves the PNG's path, or null where the repo's Playwright is not at hand. */
async function renderCard($: EngineInterface, doc: object) {
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/card/render.mjs`, '-'], { stdin: JSON.stringify(doc), timeoutMs: 40_000 })
    const path = r.stdout.trim()
    return r.exitCode === 0 && path.endsWith('.png') ? path : null
  } catch {
    return null
  }
}

/** The reply for an image card: send it inline, then one line; the text summary stays as the fallback. */
export function cardContext(path: string, summary: string, waiting: number) {
  return (
    'The owner asked for the Dashboard, drawn as an image. Call SendUserFile once: files ["' + path.replace(/\\/g, '/') + '"], ' +
    'display "render", status "normal", no caption. Then reply with one short line in Russian and nothing else: ' +
    (waiting ? 'what waits on the owner (from the summary below).' : '«От вас ничего не нужно.»') +
    ' No other tools. If SendUserFile is not available, reply with exactly this summary as compact Markdown instead:\n\n' +
    summary
  )
}

const ASKS = new Set(['dashboard', '/dashboard', 'дашборд', '/дашборд', 'штаб'])

export function isDashboardAsk(text: string) {
  return ASKS.has(text.trim().toLowerCase())
}

export const register: Register = on => {
  const seen: Record<string, number> = {}

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'dashboard', description: 'Living Lyrics: агенты, лимиты, прогресс' })
    void keepUserSettings($)
    place = await findPlace($)
    void refresh($, seen)
    $.clock.every(POLL_MS, () => refresh($, seen))
    void stationTick($)
    $.clock.every(REMOTE_MS, () => stationTick($))
    void collectUsage($)
    $.clock.every(COLLECT_MS, async () => {
      await keepChats($)
      await collectUsage($)
      await publishLive($, await read($, live), true)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($, seen)
    return result
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    await refresh($, seen)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const surfaces = await $.session.surfaces()
    const where = `Экраны сессии: ${surfaces.length ? surfaces.join(', ') : 'нет'}; панель ${opened.isPlaced ? 'открыта' : `не открыта (${opened.reason})`}.`
    return { text: `${summaryText(await read($, board), await read($, live), await read($, limits), await read($, usage))}\n\n${where}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const line = bandLine(await read($, board), await read($, live))
    if (!line) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const narrow = e.props.bodyColumns < 72
    const mark = (a: AgentName) => (Svg ? <Svg source={ICON[a]} alt={NAME[a]} width={14} height={14} /> : <Text color={GLYPH[a].color}>{GLYPH[a].mark}</Text>)
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        {line.rows.map((r, i) => (
          <Box key={`a${i}`} flexDirection="row" columnGap={1} alignItems="center">
            {mark(r.agent)}
            <Text size="footnote" weight="medium">
              {narrow ? r.name.split(' · ')[1] : r.name}
            </Text>
            <Text color={TONE[r.tone]}>●</Text>
            {narrow ? null : (
              <Text size="footnote" dimColor>
                {r.state.split(' · ').pop()}
              </Text>
            )}
          </Box>
        ))}
        {line.you > 0 ? <Text color="warning">⚑ {String(line.you)}</Text> : null}
        <Button key="open" label="Dashboard" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => dashboardTree($, e, e.props.bodyColumns))

  // The phone app draws no band and the phone sends "/dashboard" as a plain message: draw the
  // dashboard in that message's row, live, on every surface.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!isDashboardAsk(e.props.text)) return next(e)
    return dashboardTree($, e, e.viewport?.columns ?? 48)
  })

  // A remote window (claude.ai, the phone over Remote Control) draws messages itself and never
  // shows the card, and a session cannot tell which windows watch it: the reply carries the summary.
  // The same hook gives the chat-rotation signal (docs/process/chat-rotation.md) to Living Lyrics chats past the threshold.
  on('prompt.submit', async ($, e, next) => {
    const extra: string[] = []
    if (isDashboardAsk(e.text)) {
      const [b, l, lim, u] = [await read($, board), await read($, live), await read($, limits), await read($, usage)]
      const summary = summaryText(b, l, lim, u)
      const doc = cardDoc(b, l, lim, u)
      const png = doc ? await renderCard($, doc) : null
      const waiting = b?.tasks.filter(t => t.section === 'you').length ?? 0
      extra.push(png ? cardContext(png, summary, waiting) : dashboardContext(summary))
    }
    try {
      const note = rotationNote((await $.session.usage()).context.percent, await $.session.cwd())
      if (note) extra.push(note)
    } catch {
      // No usage figures (a -p run): no signal.
    }
    return extra.length ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e)
  })
}
