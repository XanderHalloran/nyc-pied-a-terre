// Renders scripts/og-card.html to a 1200x630 PNG share card.
//
//   npm run og
//
// Headless Chrome over CDP rather than an image library: the card is HTML so it inherits the
// site's own type scale, and the browser is already a dependency of every dev machine.

import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = 'public/og.png'
const CARD = 'file:///' + resolve('scripts/og-card.html').replace(/\\/g, '/')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!CHROME) { console.error('no chrome/edge found — install one or render the card by hand'); process.exit(1) }

const port = 9366
const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630',
  '--user-data-dir=' + (process.env.TEMP ?? '/tmp') + '/cdp-og', 'about:blank',
], { stdio: 'ignore' })

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))

let ws
for (let i = 0; i < 60; i++) {
  await sleep(250)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    ws = list.find((/** @type {any} */ t) => t.type === 'page')?.webSocketDebuggerUrl
    if (ws) break
  } catch {}
}
if (!ws) { console.error('devtools never came up'); proc.kill(); process.exit(1) }

const sock = new WebSocket(ws)
await new Promise((r) => (sock.onopen = r))
let id = 0
const pending = new Map()
sock.onmessage = (/** @type {any} */ e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (/** @type {string} */ method, /** @type {any} */ params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })) })

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: CARD })
await sleep(1800) // let the webfont fall back and lay out
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } })

mkdirSync('public', { recursive: true })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(`  ${OUT}  (${(Buffer.from(shot.data, 'base64').length / 1024).toFixed(0)} kB)`)
sock.close(); proc.kill(); process.exit(0)
