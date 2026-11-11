// Settings -> About -> Credits (src/renderer/src/credits.js) stays complete: every model in resources/models.json,
// every picture model family and every node pack is credited, and every entry says what it does here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CREDITS } from '../src/renderer/src/credits.js'
import { IMAGE_FAMILIES } from '../src/service/images.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))
const manifest = JSON.parse(fs.readFileSync(new URL('../resources/models.json', import.meta.url), 'utf8'))
const items = CREDITS.flatMap((g) => g.items)
const covered = new Set(items.flatMap((i) => i.covers || []))
const urls = new Set(items.map((i) => i.url).filter(Boolean))

ok('every model IV Studio downloads is credited', () => {
  const missing = manifest.models.map((m) => m.id).filter((id) => !covered.has(id))
  assert.deepEqual(missing, [], `add these to credits.js (covers): ${missing.join(', ')}`)
})
ok('every picture model family is credited', () => {
  const missing = IMAGE_FAMILIES.map((f) => `image:${f.id}`).filter((id) => !covered.has(id))
  assert.deepEqual(missing, [], `add these to credits.js (covers): ${missing.join(', ')}`)
})
ok('every node pack Setup installs is credited, linking its own repository', () => {
  const missing = manifest.node_packs.filter((p) => !urls.has(p.url)).map((p) => p.label)
  assert.deepEqual(missing, [], `add these node packs to credits.js: ${missing.join(', ')}`)
})
ok('every entry has a name and what it does here; ids and names are unique', () => {
  for (const i of items) assert.ok(i.name && i.use, JSON.stringify(i))
  assert.equal(new Set(items.map((i) => i.name)).size, items.length, 'a name appears twice')
  const all = items.flatMap((i) => i.covers || [])
  assert.equal(new Set(all).size, all.length, 'an id is credited twice')
})
ok('Fizgig and the libraries the app bundles are credited', () => {
  for (const name of ['Fizgig', 'ComfyUI', 'Electron', 'React', 'FFmpeg', 'js-yaml', 'JSONata']) assert.ok(items.some((i) => i.name === name), name)
})
console.log(`\n${n} passed`)
