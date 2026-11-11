// What the page and journey tests share (tasks 7.2 to 7.4): clicking through the sidebar the way a person does, reading
// a page's text, and the per-route check (text length, console errors, renderer crashes; one retry, both attempts kept).
// Pages are React state, not URLs, so every route is reached by clicks: a sidebar item, the Library link, a Workflows
// card, a Settings tab, or a record's tile on its list page.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ENGINE } from '../../src/service/shinobi.js'
import { tempDirReal } from '../fakes/tmp.mjs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Waits for a condition (a function returning a truthy value, maybe a promise); never a bare sleep.
export async function waitFor(what, fn, { timeoutMs = 15000, every = 100 } = {}) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e
    }
    await sleep(every)
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`)
}

// ---------- clicking ----------

// How each kind of control is found. `text` is what it says; the digits in front of a sidebar label are its number.
const FINDERS = {
  nav: (text) => `[...document.querySelectorAll('.nav .nav-item')].find((e) => e.textContent.trim().replace(/^\\d+/, '').trim() === ${JSON.stringify(text)})`,
  library: () => `document.querySelector('.nav-library')`,
  section: (text) => `[...document.querySelectorAll('.section-switch [role=tab]')].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`,
  card: (text) => `[...document.querySelectorAll('.workflow-card')].find((e) => e.querySelector('.workflow-name')?.textContent.trim() === ${JSON.stringify(text)})`,
  tab: (text) => `[...document.querySelectorAll('main.page [role=tab]')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`,
  // a record's tile on a list page: the smallest element that says the name, then its button
  record: (text) =>
    `(() => { const t = ${JSON.stringify(text.toLowerCase())}; const hit = [...document.querySelectorAll('main.page *')].filter((e) => e.children.length === 0 && e.textContent.toLowerCase().includes(t))[0]; return hit && (hit.closest('button, [role=button], a') || hit) })()`,
  button: (text) => `[...document.querySelectorAll('main.page button')].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`
}

export async function click(app, kind, text, { timeoutMs = 15000 } = {}) {
  const find = FINDERS[kind](text)
  await waitFor(`${kind} "${text ?? ''}" to be on the page`, () => app.evaluate(`(() => { const el = ${find}; if (!el) return false; el.click(); return true })()`), { timeoutMs })
}

// The page's own text (not the title bar's, which has a live meter), once it has stopped changing.
export async function pageText(app, { timeoutMs = 15000 } = {}) {
  const until = Date.now() + timeoutMs
  let prev = null
  let stable = 0
  while (Date.now() < until) {
    const text = await app.evaluate(`document.querySelector('main.page')?.innerText ?? ''`)
    if (text && text === prev) stable++
    else stable = 0
    prev = text
    if (stable >= 3) return text
    await sleep(200)
  }
  return prev ?? ''
}

// ---------- the routes ----------

// A route is the clicks that reach it and a pattern its text must match (so a click that missed shows up as a wrong
// page, not as a page with text). Every one starts by choosing the Visual or Audio half of the sidebar.
const video = (...steps) => [['section', 'Visual'], ...steps]
const audio = (...steps) => [['section', 'Audio'], ...steps]
const tool = (name) => video(['nav', 'Workflows'], ['card', name])

export const ROUTES = {
  home: { steps: video(['nav', 'Dashboard']), marker: /what if\?/i },
  create: { steps: video(['nav', 'Create']), marker: /new shot/i },
  projects: { steps: video(['nav', 'Projects']), marker: /a short film, step by step/i },
  library: { steps: video(['nav', 'Shots']), marker: /every shot you've made/i },
  edits: { steps: video(['nav', 'Edit']), marker: /cut your shots/i },
  workflows: { steps: video(['nav', 'Workflows']), marker: /take a video further/i },
  sequences: { steps: tool('Sequences'), marker: /several shots, one con/i },
  sizzle: { steps: tool('Sizzle'), marker: /a website, made into a fi/i },
  reel: { steps: tool('Reel'), marker: /pictures and a song/i },
  shinobi: { steps: tool('Shinobi'), marker: /shinobi/i },
  replace: { steps: tool('Replace'), marker: /swap who's in the shot/i },
  rebuild: { steps: tool('Rebuild'), marker: /a video, taken apart/i },
  characters: { steps: video(['nav', 'Characters']), marker: /your recurring actors/i },
  loras: { steps: video(['nav', 'LoRAs']), marker: /looks, moves and styles/i },
  cloud: { steps: video(['nav', 'Cloud']), marker: /your own gpu/i },
  settings: { steps: video(['nav', 'Settings']), marker: /your pc/i },
  setup: { steps: video(['nav', 'Settings'], ['tab', 'Setup']), marker: /reuses the ComfyUI you already have/i },
  media: { steps: video(['library']), marker: /everything you've made/i },
  voices: { steps: audio(['nav', 'Voices']), marker: /a voice for every character/i },
  lines: { steps: audio(['nav', 'Lines']), marker: /say it in their voice/i },
  music: { steps: audio(['nav', 'Music']), marker: /songs and scores/i }
}

export async function runSteps(app, steps, { timeoutMs = 15000 } = {}) {
  for (const [kind, text] of steps) await click(app, kind, text, { timeoutMs })
}

// Opens a route and checks it. Returns { id, textLength, consoleErrors, crashes, attempts: [...] }, or throws with the
// error text of both attempts. `inject` is page code run once the page has settled: the failing-path fixture throws
// from it, so a page error is proved without touching the product.
export async function checkRoute(app, id, { steps = ROUTES[id].steps, marker = ROUTES[id].marker, inject = null, minText = 150, clickMs = 15000, settleMs = 15000, allow = [] } = {}) {
  const attempts = []
  for (let n = 1; n <= 2; n++) {
    const errors0 = app.consoleErrors.length
    const crashes0 = app.crashes.length
    const t0 = Date.now()
    const attempt = { attempt: n, ok: false, problems: [] }
    try {
      await runSteps(app, steps, { timeoutMs: clickMs })
      const text = await pageText(app, { timeoutMs: settleMs })
      if (inject) {
        await app.evaluate(inject)
        await sleep(300) // a thrown error reaches the console a moment later
      }
      attempt.textLength = text.length
      attempt.consoleErrors = app.consoleErrors.slice(errors0)
      attempt.crashes = app.crashes.slice(crashes0)
      if (text.length < minText) attempt.problems.push(`the page said only ${text.length} characters: ${JSON.stringify(text.slice(0, 120))}`)
      if (marker && !marker.test(text)) attempt.problems.push(`the page does not look like ${id} (no ${marker}): ${JSON.stringify(text.slice(0, 120))}`)
      // an error a test says is expected (the guard refusing a program the page asked for) is kept in the record, not a failure
      attempt.allowed = attempt.consoleErrors.filter((e) => allow.some((a) => a.test(e)))
      for (const e of attempt.consoleErrors) if (!attempt.allowed.includes(e)) attempt.problems.push(`console error: ${e}`)
      for (const c of attempt.crashes) attempt.problems.push(`renderer crash: ${c}`)
    } catch (e) {
      attempt.problems.push(e.message)
    }
    attempt.ms = Date.now() - t0
    attempt.ok = attempt.problems.length === 0
    attempts.push(attempt)
    if (attempt.ok) break
  }
  const last = attempts.at(-1)
  const result = { id, textLength: last.textLength ?? 0, consoleErrors: (last.consoleErrors?.length ?? 0) - (last.allowed?.length ?? 0), allowedErrors: last.allowed?.length ?? 0, crashes: last.crashes?.length ?? 0, ok: last.ok, attempts }
  if (!last.ok) {
    const e = new Error(`page ${id} failed ${attempts.length} time(s):\n${attempts.map((a) => `  attempt ${a.attempt}: ${a.problems.join(' | ')}`).join('\n')}`)
    e.result = result
    throw e
  }
  return result
}

// ---------- small media fixtures (ffmpeg is allowed under the guard) ----------

const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])

export function makeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const f = (n) => path.join(dir, n)
  const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
  // three solid shots (so scene detection finds a cut) over sound
  ff('-f', 'lavfi', '-i', 'color=c=black:s=192x108:r=24:d=2', '-f', 'lavfi', '-i', 'color=c=white:s=192x108:r=24:d=2', '-f', 'lavfi', '-i', 'color=c=gray:s=192x108:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-shortest', ...h264, '-c:a', 'aac', f('clip.mp4'))
  ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', f('picture.png'))
  ff('-f', 'lavfi', '-i', 'sine=f=523:d=3', f('song.flac'))
  return { clip: f('clip.mp4'), picture: f('picture.png'), song: f('song.flac') }
}

export const tempBase = () => tempDirReal('iv-ui-fixtures-') // removed when this process ends

// ---------- what the fake ComfyUI lists when the ACE-Step music nodes and models are installed ----------

const manifest = JSON.parse(fs.readFileSync(new URL('../../resources/models.json', import.meta.url), 'utf8'))
const node = () => ({ input: { required: {} } })
export function musicObjectInfo() {
  const info = { 'TextEncodeAceStepAudio1.5': node(), 'EmptyAceStep1.5LatentAudio': node(), LoadAudio: node(), VAEEncodeAudio: node() }
  for (const id of ['music3_dit', 'music3_te', 'music3_vae', 'ace15']) {
    const m = manifest.models.find((x) => x.id === id)
    const [cls, input] = m.loader.split('.')
    info[cls] ||= node()
    info[cls].input.required[input] = [[...(info[cls].input.required[input]?.[0] || []), m.match]]
  }
  return info
}

// ---------- records the window cannot make free ----------
// A sizzle starts with a headless-browser capture and a Shinobi film with its Python engine; the guard refuses both
// programs, so these two are written where the product keeps them (the way test/unit/mcp-sizzle.test.mjs and
// mcp-shinobi.test.mjs do). Everything else is made through window.ivstudio.

const writeJson = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
}

// a saved sizzle as the capture step leaves it, with real small pictures for the screens
export function writeSizzle(dataDir, { id = 'sz000001', name = 'Acme', plan = null } = {}) {
  const site = path.join(dataDir, 'sizzle', id, 'site')
  fs.mkdirSync(path.join(site, 'images'), { recursive: true })
  const shot = (file, color, size) => ff('-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', file)
  const cap = (n, color, size, what) => {
    const file = path.join(site, `${n}.png`)
    shot(file, color, size)
    return { name: n, file, width: Number(size.split('x')[0]), height: Number(size.split('x')[1]), what }
  }
  const captures = [cap('hero', 'red', '192x108', 'The top of the page'), cap('screen-2', 'green', '192x108', 'One screen down'), cap('mobile', 'blue', '78x168', 'On a phone'), cap('logo', 'white', '60x30', 'The logo')]
  const image = path.join(site, 'images', 'image-1.png')
  shot(image, 'yellow', '96x54')
  const sizzle = {
    id,
    name,
    url: 'https://acme.test/',
    format: '16:9',
    status: 'planning',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    site: { url: 'https://acme.test/', title: 'Acme: rockets for everyone', description: 'We make rockets.', siteName: name, headings: ['Rockets for everyone'], ctas: ['Get a rocket'], nav: ['Home', 'Pricing'], paragraphs: ['Every rocket is built by hand in our own workshop.'], colors: ['#d33a2c', '#101820'], fonts: ['Inter'], captures, images: [{ file: image, src: 'https://acme.test/a.png', alt: 'A rocket', width: 96, height: 54 }] },
    plan,
    approvedAt: null,
    assets: {},
    shinobi: null
  }
  writeJson(path.join(dataDir, 'sizzle', id, 'sizzle.json'), sizzle)
  return sizzle
}

// an engine that looks installed (its Python and the marker, as the installer leaves them) and one film in it
export function writeShinobi(dataDir, { id = 'film0001', name = 'Rig film cut' } = {}) {
  const python = path.join(dataDir, 'shinobi', 'venv', 'bin', 'python')
  writeJson(python, '#!/bin/sh\n')
  fs.chmodSync(python, 0o755)
  writeJson(path.join(dataDir, 'shinobi', 'installed.json'), { commit: ENGINE.commit })
  writeJson(path.join(dataDir, 'shinobi', 'projects', id, 'project.json'), { name, created_at: '2026-11-01T10:00:00Z', assets: [] })
  return { id, name }
}
