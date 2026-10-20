# T26: research — how professionals build multi-agent systems, what we should adopt

Owner: LL · Tech. Fan the research out to Grok and Gemini as you see fit, in parallel. Report to `LL · Main` in short English after each step. The final document is for the owner, so write it in Russian, plainly.

Owner's words (2026-10-20): «нужна полноценная агентная система… изучить, какие инструменты готовые есть, фреймворки, репо и т. д., как это делают профи, чтобы нам внедрить». The owner also said we scale (no cap on chats or agents). Everything must be set up through git so every agent knows who does what. Nothing gets forgotten, and stale things are deleted and reported.

## Our setup and constraints (hard)

- Orchestrator: Claude Code chat `LL · Main`, the only chat the owner talks to. Workers: Claude Code chats LL · Site, LL · Tech and LL · Business (background sessions under the Claude daemon with Remote Control). Grok Build (plugin bridge, grok-4.7) writes code. Gemini via Antigravity `agy` watches videos.
- Subscriptions only, no paid APIs or service keys. Claude Pro/Max, Grok, and Google via Antigravity.
- Minimal services: Claude Code, GitHub (code and Actions), Vercel, Grok Build, Antigravity. Add something new only if none of these can do it.
- State lives in the repo: `AGENTS.md`, `docs/STATUS.md`, `docs/tasks/`, `ops/board.json`, `ops/handoff/`. Today everything runs on one Windows PC («Станция»). The goal is no PC dependency (cloud server later). The owner is remote (laptop and phone).
- The repo is public: no secrets, and no transcripts in it.

## Research

1. **Survey** the ready tools: frameworks, repos, products, protocols. Check what is current in 2026; don't trust memory. Starting points to verify, not a closed list:
   - Claude Code's own: subagents, agent teams, background sessions, `claude agents`, hooks, plugins, Agent SDK, Routines.
   - Orchestrators for coding agents: claude-squad, Conductor, vibe-kanban, ccmanager, Claude Flow, OpenHands, Gas Town and the like.
   - General frameworks: LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK, MetaGPT.
   - Protocols: MCP, A2A.
   - Git-native task tracking: Backlog.md, Task Master, GitHub Issues/Projects driven by agents, GitHub Agentic Workflows.
2. **How pros run it.** Role registry, task handoff, review and acceptance, memory and state, cost control, hygiene (stale branches, worktrees and docs), observability. Cite real write-ups from engineering blogs and repos: Anthropic's multi-agent research system, and other teams running many coding agents.
3. **Fit check per candidate.** Does it work with subscriptions (not API keys)? On Windows? With Claude Code + Grok + Gemini together? Does it keep state in git? What does it replace from what we already built (rotate_chat.py, handoffs, board, Dashboard mod, grok_status.py)? Cost, maturity, lock-in.

## Deliverable

`docs/research/agent-system.md` (Russian):
- A short answer first: what to adopt, what to keep, what to drop.
- A comparison table.
- A migration plan in steps; each step is a task for a worker.
- Sources with links.

Then 2–3 key choices for the owner, given to `LL · Main` to ask by buttons. Don't build anything before the owner chooses. Your queue item 4 (registry + hygiene) waits for this result; it may be replaced by a ready tool.

Done when: the document is in `main`, every claim has a source, the options are checked against the constraints above, and the choices are sent to `LL · Main`.
