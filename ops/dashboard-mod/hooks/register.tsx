import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { AgentName, Board, FeedItem, Group, Limit, Live, QuotaGroup, Song, Task, Usage } from '../types'
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
  }
}

/** The states that matter for publishing; minutes, steps and token counts change on every poll. */
export function stateKey(l: Live) {
  return JSON.stringify([l.grok.map(r => [r.name, r.state, r.model ?? '']), l.gemini.map(r => r.slug)])
}

export function tokens(n?: number) {
  if (!n) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} М`
  return `${Math.round(n / 1e3)} тыс.`
}

/** Executor name from its worktree: `t1-sync` → `Sync`. Worktrees are named t<N>-<codename>. */
export function codename(worktree?: string) {
  const word = (worktree ?? '').replace(/^t\d+[a-z]?-/, '').split('-')[0] ?? ''
  return word ? word[0]!.toUpperCase() + word.slice(1) : ''
}

/** Claude first, then each Grok executor with its live state, then Gemini. */
export function agentRows(b: Board | null, l: Live): Row[] {
  if (!b) return []
  const rows: Row[] = [
    { agent: 'claude', name: 'Claude · Lead', task: b.claude ?? 'оркестрирует', state: '', tone: 'working', detail: '', model: b.models?.claude ?? '' },
  ]
  const now = b.tasks.filter(t => t.section === 'now')
  for (const t of now.filter(t => t.agent === 'grok')) {
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

/**
 * The dashboard as a few chat lines: the phone app places no panes and draws no band, but it
 * shows a command's output row, so /dashboard answers with this everywhere.
 */
export function summaryText(b: Board | null, l: Live, lim: Limit[], u: Usage | null) {
  if (!b) return 'Dashboard: данных пока нет.'
  const out = [`**Living Lyrics** · ${hhmm(b.updated)}`, '']
  for (const r of agentRows(b, l).filter(r => r.agent !== 'claude')) {
    out.push(`- **${r.name}** — ${r.task}${r.state ? ` · ${r.state}` : ''}`)
  }
  const gem = geminiWindows(u?.gemini?.quota?.gemini).map(w => `${w.label} ${Math.round(w.used)} %`).join(', ')
  const cl = claudeWindows(lim).map(w => `${w.label} ${Math.round(w.used)} %`).join(', ')
  const parts = [
    gem ? `Gemini ${gem}` : '',
    u?.grok ? `Grok сегодня ${tokens(u.grok.today)} ток.` : '',
    cl ? `Claude ${cl}` : '',
  ].filter(Boolean)
  if (parts.length) out.push('', `Израсходовано: ${parts.join(' · ')}`)
  if (b.roadmap) out.push(`${b.roadmap.title}: ${b.roadmap.percent} %`)
  if (b.songs.length) {
    out.push(`Подсветка (нужно 80 %): ${songRows(b.songs).map(s => `${s.label} ${s.group.proven}/${s.group.total}`).join(', ')}`)
  }
  const you = b.tasks.filter(t => t.section === 'you')
  out.push(you.length ? `Нужно от вас: ${you.map(t => t.title).join('; ')}` : 'От вас ничего не нужно.')
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
        const next = JSON.parse(res.stdout) as Live
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
  } catch {
    // Off a subscription the windows are empty.
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

async function collectUsage($: EngineInterface) {
  if (!place.orchestrator || !place.repo) return
  try {
    await $.process.run(['python', `${place.repo}/ops/usage/collect.py`], { cwd: place.repo, timeoutMs: 120_000 })
  } catch {
    // agy or grok missing: the ledger keeps its last snapshot.
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
          {label('Подсветка по словам · порог 80 %')}
          {songRows(b.songs).map(({ label: name, group }: { label: string; group: Group }, i) => (
            <Box key={`s${i}`} flexDirection="row" columnGap={1} alignItems="center">
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="truncate-end">
                  {name}
                </Text>
              </Box>
              {meter(group.proven / Math.max(1, group.total), barW, 0.8, (group.placed ?? group.proven) / Math.max(1, group.total))}
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

/** What Claude is told when the owner types `dashboard`: answer with the summary, nothing else. */
export function dashboardContext(summary: string) {
  return (
    'The owner asked for the Dashboard. Some windows draw it as a card, remote windows do not, so reply with ' +
    'exactly this summary as compact Markdown (keep the lines, no intro, no advice, no tools):\n\n' +
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
    place = await findPlace($)
    void refresh($, seen)
    $.clock.every(POLL_MS, () => refresh($, seen))
    void collectUsage($)
    $.clock.every(COLLECT_MS, async () => {
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
  on('prompt.submit', async ($, e, next) => {
    if (!isDashboardAsk(e.text)) return next(e)
    const summary = summaryText(await read($, board), await read($, live), await read($, limits), await read($, usage))
    return next({ ...e, context: [...(e.context ?? []), dashboardContext(summary)] })
  })
}
