export type Group = { name: string; proven: number; placed?: number; total: number }

export type Song = { id: string; title: string; state?: string; groups: Group[]; note?: string }

export type AgentName = 'claude' | 'grok' | 'gemini'

export type Task = {
  id: string
  section: 'you' | 'now' | 'done' | 'later'
  /** Who does it. Absent on owner items and done/later rows. */
  agent?: AgentName
  status?: string
  chip?: string
  title: string
  what?: string
  now?: string
  how?: string
  next?: string
  who?: string
  date?: string
  /** Folder in living-lyrics-wt whose Grok session this task is. */
  worktree?: string
}

/** One hand-off between agents, newest first in the file. */
export type FeedItem = { at: string; from: AgentName | 'owner'; to: AgentName | 'owner'; text: string }

/** Readiness for a milestone (e.g. adding new songs): weighted steps, each 0…1 done. */
export type Roadmap = { title: string; percent: number; steps: { name: string; weight: number; done: number }[] }

export type Board = {
  updated?: string
  headline?: string
  /** What Claude is doing now, one line. */
  claude?: string
  /** Model names shown beside each agent. */
  models?: Partial<Record<AgentName, string>>
  tasks: Task[]
  songs: Song[]
  feed?: FeedItem[]
  roadmap?: Roadmap
  /** Word-sync goal per group, in % of lines proven (the mark on each bar). */
  syncGoal?: number
}

export type GrokRun = {
  name: string
  state: 'working' | 'stalled' | 'finished' | 'none'
  minutes: number
  /** Minutes since the session started. */
  age?: number
  step: string
  tokens?: number
  model?: string
}

export type GeminiRun = { slug: string; minutes: number }

/** `at` is set on a published state (ops/live.json on the `live` branch): when it was produced. */
/** A chat of the registry (.claude/agents/ll-*.md) and its state on the orchestrator machine. */
export type ChatRow = { name: string; role?: string; reports_to?: string; state: string; /** When waiting: the tool call it waits on. */ waiting_for?: string; /** Its last line to its user, and when (ISO). */ last?: string; last_at?: string }

/** A GitHub Actions run in progress. */
export type PipelineRun = { name: string; title: string; minutes: number }

/** The last hygiene run on the Station (ops/agents/hygiene.py): what it deleted, what needs someone. */
export type Hygiene = { at: string; fixed: string[]; issues: string[] }

export type Live = { grok: GrokRun[]; gemini: GeminiRun[]; chats?: ChatRow[]; pipeline?: PipelineRun[]; hygiene?: Hygiene | null; at?: string }

/** Claude plan windows as the status line has them. The mod fills these from session.usage(); latest.json does not. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * One Antigravity model group from /usage.
 * Remaining percents are what is left. A reset field is absent when the screen says "Quota available".
 * `source` and `at` say where the numbers were read and when.
 */
export type QuotaGroup = {
  weeklyRemaining?: number
  weeklyResetIn?: string
  fiveHourRemaining?: number
  fiveHourResetIn?: string
  source?: string
  at?: string
}

/** Grok's weekly allowance as the /usage modal prints it. Percent is already used, not remaining. */
export type GrokWeekly = {
  percentUsed: number
  /** Reset line copied from the screen. It is not a UTC timestamp. */
  resetsAt?: string
  /** False when that line names no timezone. Do not convert it. */
  timezoneLabeled: boolean
  source: string
  at: string
}

/**
 * ops/usage/latest.json, written by ops/usage/collect.py.
 * Claude's 5-hour and 7-day windows are not here: the mod already has them in `limits`.
 * Credit baskets (extra usage, unlabelled caches) are not here either.
 */
export type Usage = {
  updated?: string
  claude?: { plan?: string; planSource?: string; at?: string }
  grok?: {
    plan?: string
    planSource?: string
    planAt?: string
    today?: number
    todaySource?: string
    todayAt?: string
    week?: number
    weekSource?: string
    weekAt?: string
    todayByTask?: Record<string, number>
    todayByTaskSource?: string
    todayByTaskAt?: string
    weekly?: GrokWeekly
    /** Older files only. The collector no longer writes this sentence. */
    limit?: string
  }
  gemini?: {
    plan?: string
    planSource?: string
    at?: string
    /** Gemini Flash / Gemini Pro. The mod reads `quota.gemini`. */
    quota?: { gemini?: QuotaGroup; 'claude-gpt'?: QuotaGroup }
    /** Same numbers as `quota['claude-gpt']`: Antigravity's Claude and GPT bucket, not Claude Pro. */
    claudeGpt?: QuotaGroup
    runsToday?: number
    runsTodaySource?: string
    runsTodayAt?: string
    secondsToday?: number
    secondsTodaySource?: string
    secondsTodayAt?: string
  }
  /** Waste caps crossed (ops/usage/collect.py, docs/process/executor-budget.md R2/R4): flags, never kills. */
  alerts?: UsageAlert[]
  /** What the spend bought (LL · Ops, ops/usage/review.py), weekly or on demand. Tokens in millions. */
  value?: {
    weekTokens: number
    tokensInMain: number
    tokensNotInMain: number
    mergedTasks: number
    mTokPerMergedTask: number
    source: string
    at: string
  }
}

/** `value`: tokens for kind tokens and no-commit, seconds for wall, percent for weekly, runs for agy-unlogged. */
export type UsageAlert = { kind: 'tokens' | 'wall' | 'no-commit' | 'weekly' | 'agy-unlogged'; task: string; session: string; value: number; at: string }

declare module 'claude-code' {
  interface PluginState {
    'll-dashboard': { board: Board | null; live: Live; limits: Limit[]; usage: Usage | null }
  }
}
