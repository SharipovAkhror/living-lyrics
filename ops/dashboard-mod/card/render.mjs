#!/usr/bin/env node
// The /dashboard card as one PNG: the mod passes the dashboard state (JSON) on stdin, this draws it
// as an HTML card in headless Chromium (the repo's Playwright) and prints the PNG's path.
//
//   node ops/dashboard-mod/card/render.mjs [state.json] [out.png]
//
// Chat windows on the desktop app and the phone show an image sent with SendUserFile inline, while
// markdown images and box-drawing glyphs come out as click-to-load boxes and tofu. Fonts (Inter,
// JetBrains Mono, Latin and Cyrillic) are fetched once from Google Fonts and cached as data URIs;
// offline, the card falls back to Segoe UI and Consolas.
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(process.env.LOCALAPPDATA || tmpdir(), 'll-dashboard')
const WIDTH = 440

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function icon(name) {
  try {
    return readFileSync(join(HERE, '..', 'icons', `${name}.svg`), 'utf8')
      .replace(/<title>.*?<\/title>/, '')
      .replace(/ (height|width|style)="[^"]*"/g, '')
  } catch {
    return ''
  }
}
const GITHUB = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'
const ICONS = { claude: icon('claude-color'), gemini: icon('gemini-color'), grok: icon('grok'), github: GITHUB }

/** Google Fonts CSS with every Latin and Cyrillic face inlined, cached for a month. */
async function fonts() {
  const file = join(CACHE, 'fonts.css')
  try {
    if (Date.now() - statSync(file).mtimeMs < 30 * 86400_000) return readFileSync(file, 'utf8')
  } catch {}
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
    const url = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=block'
    const css = await (await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(6000) })).text()
    const blocks = css.split(/(?=\/\* )/).filter(b => /^\/\* (latin|cyrillic) \*\//.test(b))
    const out = []
    for (const b of blocks) {
      const m = b.match(/url\((https:[^)]+\.woff2)\)/)
      if (!m) continue
      const buf = Buffer.from(await (await fetch(m[1], { signal: AbortSignal.timeout(6000) })).arrayBuffer())
      out.push(b.replace(m[1], `data:font/woff2;base64,${buf.toString('base64')}`))
    }
    if (!out.length) throw new Error('no faces')
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(file, out.join('\n'))
    return out.join('\n')
  } catch {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }
}

const CHAT = { working: 'работает', waiting: 'ждёт ответа', idle: 'свободен', retired: 'спит', none: 'не запущен' }
const level = used => (used >= 90 ? 'bad' : used >= 75 ? 'warn' : '')

function hhmm(iso) {
  const t = new Date(iso || '')
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
}

/** 'сброс 05:00' → '05:00', 'сброс через 4h 57m' → '4 ч 57 м', 'через 89h 3m' → '3,7 дн'. */
function shortReset(text) {
  const m = text.match(/через\s+(?:(\d+)d\s*)?(?:(\d+)h)?\s*(?:(\d+)m)?/)
  if (!m) return text.replace(/^сброс\s+/, '')
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0), min = Number(m[3] || 0)
  if (h >= 24) return `${(h / 24).toFixed(1).replace('.', ',').replace(',0', '')} дн`
  return h ? `${h} ч ${min} м` : `${min} м`
}

function ring(w, color) {
  const r = 15, c = 2 * Math.PI * r, used = Math.max(0, Math.min(100, w.used))
  return `<div class="ring ${level(used)}" style="--c:${color}">
    <svg viewBox="0 0 38 38"><circle cx="19" cy="19" r="${r}" class="bg"/><circle cx="19" cy="19" r="${r}" class="fg" stroke-dasharray="${((used / 100) * c).toFixed(2)} ${c.toFixed(2)}"/></svg>
    <b>${Math.round(used)}</b>
    <span>${esc(w.label)}</span>
    ${w.reset ? `<small>${esc(shortReset(w.reset))}</small>` : ''}
  </div>`
}

function tile(key, name, plan, body) {
  return `<div class="tile"><div class="th"><i class="ic">${ICONS[key]}</i><b>${name}</b></div>${plan ? `<div class="plan">${esc(plan)}</div>` : ''}<div class="tb">${body}</div></div>`
}

export function cardHtml(d, fontCss = '') {
  const L = d.limits || {}
  const P = L.plans || {}
  const rings = (list, color) => (list && list.length ? list.map(w => ring(w, color)).join('') : '<span class="none">нет данных</span>')
  const g = L.grok
  const grokBody = g ? `<div class="big">${esc(g.today)}</div><span class="cap">токенов сегодня</span>${g.week ? `<span class="cap dim">${esc(g.week)} за 7 дней</span>` : ''}` : '<span class="none">нет данных</span>'
  const you = d.you || []
  const agents = (d.agents || []).filter(r => r.agent !== 'claude')
  const runs = d.runs || []
  const songs = d.songs || []
  const chats = d.chats || []
  const h = d.hygiene
  const fresh = d.at && Date.now() - Date.parse(d.at) < 45 * 60_000

  const agentRows = agents.map(r => `
    <div class="ag">
      <i class="ic">${ICONS[r.agent] || ''}</i>
      <div class="who"><b>${esc(r.name)}</b><span>${esc(r.task)}</span></div>
      ${r.state ? `<em class="chip ${esc(r.tone)}">${esc(r.state)}</em>` : ''}
      ${r.detail ? `<div class="det">${esc(r.detail)}</div>` : ''}
    </div>`)
  for (const run of runs) agentRows.push(`
    <div class="ag">
      <i class="ic gh">${ICONS.github}</i>
      <div class="who"><b>GitHub · ${esc(run.name)}</b><span>${esc(run.title)}</span></div>
      <em class="chip working">идёт · ${run.minutes} мин</em>
    </div>`)

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss}
:root {
  --bg: #08090c; --card: #0f1116; --raise: #161921; --line: rgba(255,255,255,.07); --line-2: rgba(255,255,255,.12);
  --ink: #eef0f5; --ink-2: #a3a9b6; --ink-3: #697080;
  --accent: #7c6cff; --accent-2: #b46cff; --ok: #34d399; --warn: #fbbf24; --bad: #f87171;
  --claude: #e58a68; --gemini: #4d94ff; --grok: #eef0f5; --you: #fbbf24;
  --sans: Inter, 'Segoe UI', system-ui, sans-serif; --mono: 'JetBrains Mono', Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; }
html, body { background: var(--bg); }
body { font-family: var(--sans); color: var(--ink); font-size: 12.5px; line-height: 1.35; -webkit-font-smoothing: antialiased; font-feature-settings: 'cv11', 'ss01'; }
#card { width: ${WIDTH}px; padding: 14px; position: relative; overflow: hidden; background: var(--card);
  background-image: radial-gradient(420px 220px at 0% -10%, rgba(124,108,255,.22), transparent 70%), radial-gradient(300px 200px at 110% 0%, rgba(180,108,255,.10), transparent 70%);
  border-radius: 20px; box-shadow: inset 0 0 0 1px var(--line-2); display: grid; gap: 10px; }
.num, .big, .ring b, .pct { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum', 'cv11'; }
.ic { width: 16px; height: 16px; display: inline-flex; flex: none; color: var(--grok); }
.ic svg { width: 100%; height: 100%; display: block; }

header { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
.mark { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: grid; place-items: center; box-shadow: 0 4px 14px rgba(124,108,255,.35), inset 0 0 0 1px rgba(255,255,255,.18); }
.mark svg { width: 16px; height: 16px; }
.title b { font-size: 14.5px; font-weight: 650; letter-spacing: -.01em; display: block; }
.title span { color: var(--ink-3); font-size: 11px; }
.live { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ok); padding: 3px 9px; border-radius: 99px; background: rgba(52,211,153,.10); box-shadow: inset 0 0 0 1px rgba(52,211,153,.22); }
.live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px rgba(52,211,153,.18); }
.live.stale { color: var(--warn); background: rgba(251,191,36,.10); box-shadow: inset 0 0 0 1px rgba(251,191,36,.22); }

.road { display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; align-items: baseline; padding: 0 2px; }
.road span { color: var(--ink-2); font-size: 11.5px; }
.road .pct { font-size: 11.5px; color: var(--ink); }
.road .bar { grid-column: 1 / 3; height: 4px; }

.bar { position: relative; height: 6px; border-radius: 99px; background: rgba(255,255,255,.07); }
.bar i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.bar i.soft { background: rgba(124,108,255,.25); }
.bar .goal { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px; background: var(--ink-2); }
.met .bar i:not(.soft) { background: linear-gradient(90deg, #10b981, var(--ok)); }

.you { border-radius: 14px; padding: 9px 11px; background: rgba(251,191,36,.08); box-shadow: inset 0 0 0 1px rgba(251,191,36,.25); display: grid; gap: 6px; }
.you h3 { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--you); font-weight: 600; display: flex; align-items: center; gap: 6px; }
.you h3 i { font-style: normal; min-width: 16px; height: 16px; border-radius: 99px; background: var(--you); color: #1a1302; font-size: 10px; display: grid; place-items: center; letter-spacing: 0; }
.you li { list-style: none; display: grid; gap: 1px; }
.you li b { font-weight: 600; }
.you li span { color: var(--ink-2); font-size: 11.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.you ul { padding: 0; display: grid; gap: 6px; }

section { background: rgba(255,255,255,.025); border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line); padding: 9px 11px; display: grid; gap: 8px; }
h2 { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
h2 span { letter-spacing: 0; text-transform: none; font-weight: 500; color: var(--ink-3); }

.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.tile { background: var(--raise); border-radius: 11px; padding: 8px 8px 9px; box-shadow: inset 0 0 0 1px var(--line); display: grid; gap: 6px; align-content: start; }
.th { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.th b { font-weight: 600; }
.plan { color: var(--ink-3); font-size: 10px; margin-top: -4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb { display: flex; gap: 2px; align-items: flex-start; flex-wrap: wrap; }
.ring { position: relative; width: 46px; display: grid; justify-items: center; gap: 1px; }
.ring svg { width: 38px; height: 38px; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 4; }
.ring .bg { stroke: rgba(255,255,255,.08); }
.ring .fg { stroke: var(--c); stroke-linecap: round; }
.ring.warn .fg { stroke: var(--warn); } .ring.bad .fg { stroke: var(--bad); }
.ring b { position: absolute; top: 10.5px; left: 0; right: 0; text-align: center; font-size: 11px; font-weight: 600; }
.ring span { font-size: 10px; color: var(--ink-2); }
.ring small { font-size: 9px; color: var(--ink-3); white-space: nowrap; }
.big { font-size: 22px; font-weight: 650; letter-spacing: -.02em; line-height: 1.1; width: 100%; }
.cap { font-size: 10px; color: var(--ink-2); width: 100%; margin-top: -4px; }
.cap.dim { color: var(--ink-3); margin-top: -2px; }
.none { color: var(--ink-3); font-size: 11px; }

.chats { display: flex; flex-wrap: wrap; gap: 5px; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px 2px 6px; border-radius: 99px; background: var(--raise); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink-2); }
.pill b { color: var(--ink); font-weight: 500; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); }
.dot.working { background: var(--ok); box-shadow: 0 0 0 2px rgba(52,211,153,.2); }
.dot.waiting, .dot.stalled { background: var(--warn); }
.dot.retired, .dot.none { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ink-3); }

.ags { display: grid; }
.ag { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 2px 9px; align-items: center; padding: 6px 0; }
.ag + .ag { border-top: 1px solid var(--line); }
.ic.gh { color: var(--ink-2); }
.who { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who b { font-weight: 600; margin-right: 6px; }
.who span { color: var(--ink-2); }
.det { grid-column: 2 / 4; color: var(--ink-3); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip { font-style: normal; font-size: 10.5px; font-weight: 500; padding: 2px 8px; border-radius: 99px; white-space: nowrap; color: var(--ink-2); background: rgba(255,255,255,.06); }
.chip.working { color: var(--ok); background: rgba(52,211,153,.12); }
.chip.stalled { color: var(--warn); background: rgba(251,191,36,.12); }
.chip.review { color: #a99dff; background: rgba(124,108,255,.16); }

.song { display: grid; grid-template-columns: minmax(0, 1fr) 120px 84px; gap: 10px; align-items: center; }
.song > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song .pct { text-align: right; font-size: 11px; color: var(--ink-3); white-space: nowrap; }
.song .pct b { margin-right: 4px; }
.song .pct b { color: var(--ink); font-weight: 600; }
.met .pct b { color: var(--ok); }

footer { display: flex; justify-content: space-between; gap: 10px; color: var(--ink-3); font-size: 10.5px; padding: 0 2px; }
footer .ok { color: var(--ok); }
footer .warn { color: var(--warn); }
</style></head><body><div id="card">
  <header>
    <div class="mark"><svg viewBox="0 0 16 16" fill="#fff"><rect x="1.5" y="6" width="2" height="4" rx="1"/><rect x="5" y="3" width="2" height="10" rx="1"/><rect x="8.5" y="5" width="2" height="6" rx="1"/><rect x="12" y="2" width="2" height="12" rx="1"/></svg></div>
    <div class="title"><b>Living Lyrics</b><span>штаб · ${esc(hhmm(d.at))}</span></div>
    <span class="live ${fresh ? '' : 'stale'}"><i></i>${fresh ? 'онлайн' : 'Станция молчит'}</span>
  </header>
  ${d.roadmap ? `<div class="road"><span>${esc(d.roadmap.title)}</span><span class="pct">${d.roadmap.percent} %</span><div class="bar"><i style="width:${d.roadmap.percent}%"></i></div></div>` : ''}
  ${you.length ? `<div class="you"><h3><i>${you.length}</i>Нужно от вас</h3><ul>${you.map(t => `<li><b>${esc(t.title)}</b>${t.how ? `<span>${esc(t.how)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
  <section>
    <h2>Лимиты</h2>
    <div class="tiles">
      ${tile('claude', 'Claude', P.claude, rings(L.claude, 'var(--claude)'))}
      ${tile('gemini', 'Gemini', P.gemini, rings(L.gemini, 'var(--gemini)'))}
      ${tile('grok', 'Grok', g?.plan, grokBody)}
    </div>
  </section>
  <section>
    <h2>Кто работает <span>${agents.length + runs.length ? `${agents.length + runs.length} в деле` : ''}</span></h2>
    ${chats.length ? `<div class="chats">${chats.map(c => `<span class="pill"><span class="dot ${esc(c.state)}"></span><b>${esc(c.name.replace(/^LL · /, ''))}</b>${esc(CHAT[c.state] || c.state)}</span>`).join('')}</div>` : ''}
    ${agentRows.length ? `<div class="ags">${agentRows.join('')}</div>` : '<span class="none">Исполнители сейчас не заняты.</span>'}
  </section>
  ${songs.length ? `<section><h2>Подсветка по словам <span>${d.goal ? `цель ${d.goal} %` : ''}</span></h2>
    ${songs.map(s => {
      const p = s.total ? s.proven / s.total : 0
      const pl = s.total ? Math.max(p, (s.placed ?? s.proven) / s.total) : 0
      const pct = Math.round(p * 100)
      return `<div class="song${d.goal && pct >= d.goal ? ' met' : ''}"><span>${esc(s.label)}</span><div class="bar"><i class="soft" style="width:${(pl * 100).toFixed(1)}%"></i><i style="width:${(p * 100).toFixed(1)}%"></i>${d.goal ? `<span class="goal" style="left:calc(${d.goal}% - 1px)"></span>` : ''}</div><span class="pct"><b>${pct} %</b> ${s.proven}/${s.total}</span></div>`
    }).join('')}</section>` : ''}
  <footer>
    <span>${h ? (h.issues?.length ? `<span class="warn">Порядок: ${h.issues.length + (h.more || 0)} на заметку</span>` : `<span class="ok">Порядок: чисто</span>`) + (h.fixed ? ` · убрано ${h.fixed}` : '') : ''}</span>
    <span>Станция → /dashboard</span>
  </footer>
</div></body></html>`
}

async function main() {
  const [inPath, outArg] = process.argv.slice(2)
  const raw = inPath && inPath !== '-' ? readFileSync(inPath, 'utf8') : readFileSync(0, 'utf8')
  const d = JSON.parse(raw)
  const dir = join(CACHE, 'cards')
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) {
    try {
      if (Date.now() - statSync(join(dir, f)).mtimeMs > 3600_000) unlinkSync(join(dir, f))
    } catch {}
  }
  const out = outArg || join(dir, `dashboard-${Date.now()}.png`)
  const html = cardHtml(d, await fonts())
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH + 40, height: 800 }, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.locator('#card').screenshot({ path: out, omitBackground: true })
  } finally {
    await browser.close()
  }
  process.stdout.write(out)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    process.stderr.write(String(err?.stack || err))
    process.exit(1)
  })
}
