// Usage counting is opt-in, sends only its six fields, and never sends without an address; the beta signup.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EVENTS, Usage, kindOf, validEmail } from '../src/service/usage.js'

let failed = 0
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

const make = ({ links = {}, respond = () => ({ ok: true, status: 200 }), settings = {} } = {}) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-usage-'))
  const store = { usage: null, incognito: false, betaJoined: false, ...settings }
  const calls = []
  const usage = new Usage({
    dataDir,
    version: '1.1.0',
    platform: 'win32',
    settings: () => store,
    save: (p) => Object.assign(store, p),
    links,
    fetch: async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), respond(url, init)),
    now: () => new Date('2026-11-10T08:00:00Z')
  })
  return { usage, store, calls, dataDir, file: path.join(dataDir, 'usage.json') }
}

// not asked yet: nothing counted, nothing written
{
  const t = make({ links: { usageUrl: 'https://example.test/u' } })
  check('before the person answers, nothing is counted', t.usage.count('app_opened') === false && !fs.existsSync(t.file))
  check('…and its choice reads as not asked', t.usage.status().choice === null && t.usage.status().counting === false)
  await t.usage.flush()
  check('…and nothing is sent', t.calls.length === 0)
}

// off: same
{
  const t = make({ links: { usageUrl: 'https://example.test/u' } })
  t.usage.setChoice(false)
  t.usage.count('render_finished', 'previews')
  await t.usage.flush()
  check('turned off: nothing counted or sent, no id made', t.calls.length === 0 && t.usage.state().id === null && t.usage.state().waiting.length === 0)
}

// on: rows carry exactly six fields
{
  const t = make({ links: { usageUrl: 'https://example.test/u' } })
  t.usage.setChoice(true)
  t.usage.count('app_opened')
  t.usage.count('render_started', 'previews')
  t.usage.count('render_finished', 'previews')
  t.usage.count('render_finished', 'finish')
  const rows = t.usage.state().waiting
  const keys = 'day,event,install_id,kind,platform,version'
  check('turned on: every count has exactly the six fields', rows.length === 5 && rows.every((r) => Object.keys(r).sort().join(',') === keys))
  check('the first finished render is counted once', rows.filter((r) => r.event === 'first_render').length === 1)
  check('the day has no time in it', rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day)))
  check('an unknown event is not counted', t.usage.count('prompt_text', 'x') === false && t.usage.state().waiting.length === 5)
  check('a render kind is one of the known ones', kindOf('C:\\Users\\me\\secret.mp4') === 'other' && kindOf('finish') === 'finish')
  const r = await t.usage.flush()
  check('flush sends what was waiting and clears it', r.sent === 5 && t.calls.length === 1 && t.calls[0].body.rows.length === 5 && t.usage.state().waiting.length === 0)
  check('nothing but rows is in the body', Object.keys(t.calls[0].body).join() === 'rows')
  check('every event name is a known one', t.calls[0].body.rows.every((x) => EVENTS.includes(x.event)))
}

// no address: counts wait, never sent, capped
{
  const t = make()
  t.usage.setChoice(true)
  for (let i = 0; i < 520; i++) t.usage.count('app_opened')
  await t.usage.flush()
  check('with no address nothing is sent, and at most 500 wait', t.calls.length === 0 && t.usage.state().waiting.length === 500 && t.usage.status().sends === false)
}

// a failed send keeps the rows
{
  const t = make({ links: { usageUrl: 'https://example.test/u' }, respond: () => ({ ok: false, status: 500 }) })
  t.usage.setChoice(true)
  t.usage.count('app_opened')
  const r = await t.usage.flush()
  check('a failed send keeps the counts for next time', r.sent === 0 && t.usage.state().waiting.length === 1)
}
{
  const t = make({ links: { usageUrl: 'https://example.test/u' }, respond: () => Promise.reject(new Error('offline')) })
  t.usage.setChoice(true)
  t.usage.count('app_opened')
  const r = await t.usage.flush()
  check('being offline never throws', r.sent === 0 && t.usage.state().waiting.length === 1)
}

// turning it off deletes the id and what was waiting
{
  const t = make({ links: { usageUrl: 'https://example.test/u' } })
  t.usage.setChoice(true)
  t.usage.count('app_opened')
  const id = t.usage.state().id
  t.usage.setChoice(false)
  check('turning it off deletes the id and the waiting counts', !!id && t.usage.state().id === null && t.usage.state().waiting.length === 0)
  t.usage.setChoice(true)
  check('turning it back on makes a new id', t.usage.state().id && t.usage.state().id !== id)
}

// Incognito never counts
{
  const t = make({ links: { usageUrl: 'https://example.test/u' }, settings: { incognito: true } })
  t.usage.setChoice(true)
  check('Incognito never counts', t.usage.count('render_finished', 'finish') === false && t.usage.state().waiting.length === 0)
}

// the preview is what would be sent
{
  const t = make()
  check('the preview shows an example before anything is counted', t.usage.preview().length === 1 && t.usage.preview()[0].event === 'render_finished')
  t.usage.setChoice(true)
  t.usage.count('app_opened')
  check('the preview shows the real waiting counts', JSON.stringify(t.usage.preview()) === JSON.stringify(t.usage.state().waiting))
}

// beta signup
check('email check', validEmail('a@b.co') && validEmail(' a.b+c@d.example ') && !validEmail('a@b') && !validEmail('nope') && !validEmail(''))
{
  const t = make()
  let err = null
  await t.usage.joinBeta('a@b.co').catch((e) => (err = e.message))
  check('with no signup address, joining says it isn’t open and sends nothing', /isn’t open/.test(err) && t.calls.length === 0 && t.usage.status().betaOpen === false)
}
{
  const t = make({ links: { betaUrl: 'https://example.test/b' } })
  let err = null
  await t.usage.joinBeta('not an email').catch((e) => (err = e.message))
  check('a bad address is refused before anything is sent', /email/.test(err) && t.calls.length === 0)
  const s = await t.usage.joinBeta('  me@example.com ')
  check('joining sends the address, version and platform only', t.calls.length === 1 && Object.keys(t.calls[0].body).sort().join() === 'email,platform,version' && t.calls[0].body.email === 'me@example.com')
  check('…and remembers it joined', s.betaJoined === true && t.store.betaJoined === true)
  check('joining the beta doesn’t turn counting on', t.usage.choice() === null)
}
{
  const t = make({ links: { betaUrl: 'https://example.test/b' }, respond: () => ({ ok: false, status: 500 }) })
  let err = null
  await t.usage.joinBeta('me@example.com').catch((e) => (err = e.message))
  check('a failed signup says so and isn’t remembered as joined', /didn’t go through/.test(err) && t.store.betaJoined === false)
}

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
