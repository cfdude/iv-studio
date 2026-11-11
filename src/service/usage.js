// Anonymous usage counting, and the cloud beta signup. Both are off until the person says yes.
//
// Counting: Settings → Privacy → "Help improve IV Studio" (asked once in the welcome wizard, off by default).
// When it's on, IV Studio counts four things: the app was opened, a render started, a render finished, and the
// first render ever finished on this copy. Each count carries a random id made for this copy (not tied to the
// person, the PC's name or any account), the day, the app version, the platform and the kind of render. Nothing
// else: no prompts, pictures, file names, folders, keys or addresses. `preview()` is exactly what is sent, and
// Settings shows it. Incognito never counts. Turning it off deletes the id and anything waiting to be sent.
//
// Where it goes: resources/links.json `usageUrl`. While that is empty nothing is ever sent; counts wait in
// <data>/usage.json (the newest 500) and are dropped when counting is turned off.
//
// The beta signup posts an email address to links.json `betaUrl`, only when the person types one and presses
// Join. While `betaUrl` is empty the app doesn't offer it.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const EVENTS = ['app_opened', 'render_started', 'render_finished', 'first_render']
export const RENDER_KINDS = ['previews', 'finish', 'sequence', 'image', 'edit', 'other']
const MAX_WAITING = 500
const BATCH = 100
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export const validEmail = (v) => EMAIL.test(String(v || '').trim()) && String(v).trim().length <= 254

// The kind of render as it's counted: one of RENDER_KINDS, never anything a job happens to carry.
export const kindOf = (kind) => (RENDER_KINDS.includes(kind) ? kind : 'other')

export class Usage {
  // settings(): { usage, incognito }; save(patch) writes settings; links: { usageUrl, betaUrl }
  constructor({ dataDir, version, platform, settings, save, links = {}, fetch: f = globalThis.fetch, now = () => new Date() }) {
    this.file = path.join(dataDir, 'usage.json')
    this.version = version
    this.platform = platform
    this.settings = settings
    this.save = save
    this.usageUrl = String(links.usageUrl || '').trim()
    this.betaUrl = String(links.betaUrl || '').trim()
    this.fetch = f
    this.now = now
    this.sending = null
  }

  state() {
    return readJson(this.file, { id: null, waiting: [], firstRender: false })
  }
  write(s) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2))
  }

  // 'on', 'off', or null when the person hasn't been asked yet
  choice() {
    const u = this.settings().usage
    return u === 'on' || u === 'off' ? u : null
  }
  get on() {
    return this.choice() === 'on' && !this.settings().incognito
  }

  // What Settings and the welcome wizard show.
  status() {
    const s = this.state()
    return { choice: this.choice(), counting: this.on, sends: !!this.usageUrl, waiting: s.waiting.length, betaOpen: !!this.betaUrl, betaJoined: !!this.settings().betaJoined, events: EVENTS }
  }

  setChoice(on) {
    this.save({ usage: on ? 'on' : 'off' })
    const s = this.state()
    if (on) {
      if (!s.id) this.write({ ...s, id: randomUUID() })
    } else this.write({ id: null, waiting: [], firstRender: s.firstRender })
    return this.status()
  }

  // One count as it is sent: these fields and no others.
  row(event, kind, s = this.state()) {
    return { install_id: s.id, event, kind: event === 'app_opened' ? null : kindOf(kind), day: this.now().toISOString().slice(0, 10), version: this.version, platform: this.platform }
  }

  // Exactly what the next send would carry (or an example row when nothing is waiting).
  preview() {
    const s = this.state()
    return s.waiting.length ? s.waiting.slice(-3) : [this.row('render_finished', 'previews', { ...s, id: s.id || '(a random id, made when you turn this on)' })]
  }

  count(event, kind) {
    if (!this.on || !EVENTS.includes(event)) return false
    const s = this.state()
    if (!s.id) s.id = randomUUID()
    s.waiting.push(this.row(event, kind, s))
    if (event === 'render_finished' && !s.firstRender) {
      s.firstRender = true
      s.waiting.push(this.row('first_render', kind, s))
    }
    if (s.waiting.length > MAX_WAITING) s.waiting = s.waiting.slice(-MAX_WAITING)
    this.write(s)
    return true
  }

  // Sends what's waiting, a batch at a time. Never throws: a failed send keeps the rows for next time.
  async flush() {
    if (!this.on || !this.usageUrl || this.sending) return { sent: 0 }
    this.sending = (async () => {
      let sent = 0
      try {
        for (;;) {
          const s = this.state()
          const rows = s.waiting.slice(0, BATCH)
          if (!rows.length || !this.on) break
          const res = await this.fetch(this.usageUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }), signal: AbortSignal.timeout(15000) })
          if (!res.ok) break
          // drop only what was sent; counts added meanwhile stay
          const after = this.state()
          this.write({ ...after, waiting: after.waiting.slice(rows.length) })
          sent += rows.length
        }
      } catch {}
      return { sent }
    })()
    try {
      return await this.sending
    } finally {
      this.sending = null
    }
  }

  // The cloud beta waitlist: the address the person typed, the app version and the platform. Nothing else.
  async joinBeta(email) {
    const address = String(email || '').trim()
    if (!validEmail(address)) throw new Error('That doesn’t look like an email address.')
    if (!this.betaUrl) throw new Error('The cloud beta signup isn’t open yet.')
    let res
    try {
      res = await this.fetch(this.betaUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address, version: this.version, platform: this.platform }), signal: AbortSignal.timeout(15000) })
    } catch {
      throw new Error('Couldn’t reach the signup. Check your connection and try again.')
    }
    if (!res.ok) throw new Error(res.status === 429 ? 'Too many tries. Give it a minute.' : 'The signup didn’t go through. Try again in a moment.')
    this.save({ betaJoined: true })
    return this.status()
  }
}
