// The Library's render details (studio.js renderFacts): what a preview, a final and an enhanced copy say about
// how they were made, from their own job and the jobs above them; nothing made up when a job didn't record it.
import assert from 'node:assert/strict'
import { renderFacts } from '../src/service/studio.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))
const fact = (r, k) => r.facts.find(([x]) => x === k)?.[1]

const run = { id: 'p1', kind: 'previews', seconds: 147, plan: { request: { mode: 'frames', character: 'tess', extraLoras: [{ name: ['MiniMax H3', 'Styles', 'Disney v2.safetensors'].join(String.fromCharCode(92)), strength: 0.8 }] }, resolved: { width: 480, height: 864, seconds: 5.167, fps: 24, previews: 2, seeds: [602775, 603775], model: 'fl2va' }, asked: { prompt: 'Tess waits at the bus stop.' } } }
const fin = { id: 'f1', kind: 'finish', parent: 'p1', seconds: 157, plan: { finish: { candidate: 2, megapixels: 1, enhancer: 'dlss', upscale2x: true, dlssStrength: 1.2, dlssStyle: 'Cinematic' }, resolved: { width: 768, height: 1376, fps: 24, seconds: 5.167 } } }
const enh = { id: 'e1', kind: 'enhance', parent: 'f1', seconds: 222, plan: { enhance: { engine: 'seedvr2', resolution: 1080, detail: 0.1 }, resolved: { width: 1080, height: 1938, fps: 24, seconds: 5.167 } } }
const jobs = [run, fin, enh]
const characters = [{ id: 'tess', name: 'Tess Marlow' }]

ok('a preview: its take, seed and settings', () => {
  const r = renderFacts({ job: run, jobs, output: { kind: 'preview', candidate: 2 }, request: run.plan.request, characters })
  assert.equal(fact(r, 'Model'), 'MiniMax H3')
  assert.equal(fact(r, 'Kind'), 'First / last frame')
  assert.equal(fact(r, 'Size'), '480 × 864')
  assert.equal(fact(r, 'Length'), '5.2 s at 24 fps')
  assert.equal(fact(r, 'Character'), 'Tess Marlow')
  assert.equal(fact(r, 'LoRAs'), 'Disney v2 0.8')
  assert.equal(fact(r, 'Seed'), '603775')
  assert.equal(fact(r, 'Take'), 'Preview 2 of 2')
  assert.equal(fact(r, 'Render time'), '2 min 27 s')
  assert.equal(fact(r, 'Cost'), 'Free, on this PC')
  assert.equal(r.prompt, 'Tess waits at the bus stop.')
  assert.equal(r.tile, '480×864 · 5 s · H3')
})

ok('a final and its enhanced copy: how each was finished', () => {
  const f = renderFacts({ job: fin, jobs, output: { kind: 'final' }, request: run.plan.request, characters })
  assert.equal(fact(f, 'Size'), '768 × 1376')
  assert.equal(fact(f, 'Seed'), '603775', 'the seed of the take it was finished from')
  assert.equal(fact(f, 'Finish'), '1 MP from preview 2, DLSS 5 and RTX 2× (strength 1.2, Cinematic)')
  assert.equal(f.prompt, 'Tess waits at the bus stop.')
  const e = renderFacts({ job: enh, jobs, output: { kind: 'final' }, request: run.plan.request, characters })
  assert.equal(fact(e, 'Size'), '1080 × 1938')
  assert.equal(fact(e, 'Enhanced'), 'SeedVR2 1080p, detail 0.1')
  assert.equal(fact(e, 'Render time'), '3 min 42 s')
})

ok('a paid Seedance take shows its cost; nothing is made up when a job lacks a fact', () => {
  const sd = { id: 's1', kind: 'previews', plan: { engine: 'seedance', cost: { usd: 0.7411 }, request: { mode: 'text' }, resolved: { width: 854, height: 480, seconds: 5, fps: 24, previews: 1, seeds: [4242], model: 'Seedance 2.5 Draft' } } }
  const r = renderFacts({ job: sd, jobs: [sd], output: { kind: 'preview', candidate: 1 }, request: sd.plan.request })
  assert.equal(fact(r, 'Model'), 'Seedance 2.5 Draft')
  assert.equal(fact(r, 'Cost'), '$0.74 of Comfy credits')
  assert.equal(fact(r, 'Steps'), undefined)
  assert.equal(r.model, 'seedance')
  const bare = renderFacts({ job: { id: 'x', kind: 'previews', plan: {} }, jobs: [], output: { kind: 'preview' } })
  assert.equal(fact(bare, 'Size'), undefined)
  assert.equal(fact(bare, 'Render time'), undefined)
  assert.equal(bare.prompt, null)
})

console.log(`\n${n} passed`)
