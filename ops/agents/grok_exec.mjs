// Grok launcher for executor runs (the grok-build bridge picks it up through GROK_BINARY).
// Headless runs (`-p`) start without tools our tasks never use; their definitions are sent with every
// model call (~17 KB of 56 KB, LL · Ops setup audit G2, docs/research/setup-audit-2026-10-22.md).
// Every other call (version, models, usage, interactive) passes through unchanged.
//
//   GROK_BINARY="node C:/Users/User/Documents/GitHub/living-lyrics/ops/agents/grok_exec.mjs"
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const UNUSED = ['reference_to_video', 'image_to_video', 'image_edit', 'send_feedback', 'scheduler_create', 'workflow']
const GROK = process.env.GROK_REAL_BINARY || join(homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok')

const args = process.argv.slice(2)
const headless = args.includes('-p') || args.includes('--prompt')
const full = headless && !args.includes('--disallowed-tools') ? ['--disallowed-tools', UNUSED.join(','), ...args] : args

const out = spawnSync(GROK, full, { stdio: 'inherit', shell: false, windowsHide: true })
if (out.error) {
  console.error(`grok_exec: ${out.error.message}`)
  process.exit(127)
}
process.exit(out.status ?? 1)
