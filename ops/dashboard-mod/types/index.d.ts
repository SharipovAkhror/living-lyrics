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
export type ChatRow = { name: string; role?: string; reports_to?: string; state: string; /** When waiting: the tool call it waits on. */ waiting_for?: string }

/** A GitHub Actions run in progress. */
export type PipelineRun = { name: string; title: string; minutes: number }

/** The last hygiene run on the Station (ops/agents/hygiene.py): what it deleted, what needs someone. */
export type Hygiene = { at: string; fixed: string[]; issues: string[] }

export type Live = { grok: GrokRun[]; gemini: GeminiRun[]; chats?: ChatRow[]; pipeline?: PipelineRun[]; hygiene?: Hygiene | null; at?: string }

/** Claude plan windows as the status line has them. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Quota windows Antigravity's /usage shows, per model group. */
export type QuotaGroup = { weeklyRemaining?: number; weeklyResetIn?: string; fiveHourRemaining?: number; fiveHourResetIn?: string; at?: string }

/** ops/usage/latest.json, written by ops/usage/collect.py. */
export type Usage = {
  updated?: string
  grok?: { plan?: string; today?: number; week?: number; todayByTask?: Record<string, number>; limit?: string }
  gemini?: { plan?: string; quota?: Record<string, QuotaGroup>; runsToday?: number; secondsToday?: number }
}

declare module 'claude-code' {
  interface PluginState {
    'll-dashboard': { board: Board | null; live: Live; limits: Limit[]; usage: Usage | null }
  }
}
