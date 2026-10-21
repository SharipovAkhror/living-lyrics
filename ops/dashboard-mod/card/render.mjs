#!/usr/bin/env node
// The /dashboard card as one PNG: the side panel's own page (ops/dashboard-mod/panel.html), drawn in
// headless Chromium (the repo's Playwright) from a dashboard document, the one the mod writes to the
// panel. One design for both: the panel beside the chat, the picture in the chat.
//
//   node ops/dashboard-mod/card/render.mjs [state.json|-] [out.png] [--light]
//
// Prints the PNG's path. Without out.png it writes %LOCALAPPDATA%\ll-dashboard\dashboard.png, the
// copy the mod keeps fresh so /dashboard only has to send it. Inter is fetched once from Google Fonts
// and cached as a data URI; offline, the page falls back to the system face.
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(process.env.LOCALAPPDATA || tmpdir(), 'll-dashboard')
const WIDTH = 440

/** Inter (Latin and Cyrillic) as inline @font-face rules, cached for a month. */
async function fonts() {
  const file = join(CACHE, 'fonts-inter.css')
  try {
    if (Date.now() - statSync(file).mtimeMs < 30 * 86400_000) return readFileSync(file, 'utf8')
  } catch {}
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=block', { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(6000) })).text()
    const out = []
    for (const b of css.split(/(?=\/\* )/).filter(x => /^\/\* (latin|cyrillic) \*\//.test(x))) {
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
    try { return readFileSync(file, 'utf8') } catch { return '' }
  }
}

/** The panel page with its database answered from `doc`, and no network font link. */
export function cardPage(panel, doc, fontCss, theme) {
  const stub = `window.claude={use:async()=>({doc:()=>({onSnapshot:cb=>cb({exists:true,data:()=>(${JSON.stringify(doc).replace(/</g, '\\u003c')})})})})};`
  const body = panel.replace(/<link[^>]+fonts\.google[^>]+>/g, '')
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${fontCss}</style><script>${stub}</script></head><body style="margin:0">${body}</body></html>`
}

async function main() {
  const args = process.argv.slice(2)
  const theme = args.includes('--light') ? 'light' : 'dark'
  const [inPath, outArg] = args.filter(a => !a.startsWith('--'))
  const doc = JSON.parse(inPath && inPath !== '-' ? readFileSync(inPath, 'utf8') : readFileSync(0, 'utf8'))
  mkdirSync(CACHE, { recursive: true })
  const out = outArg || join(CACHE, 'dashboard.png')
  const html = cardPage(readFileSync(join(HERE, '..', 'panel.html'), 'utf8'), doc, await fonts(), theme)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    // Write beside and rename, so a reader never sends a half-written picture.
    const tmp = `${out}.tmp.png`
    await page.locator('main').screenshot({ path: tmp })
    renameSync(tmp, out)
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
