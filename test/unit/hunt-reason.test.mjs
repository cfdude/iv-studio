// Why Create's "Hunt previews" button is greyed: the one thing to fix first, in plain words, or null when it can go.
//   node --test test/unit/hunt-reason.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { huntBlockedReason } from '../../src/service/huntreason.js'

const ready = { busy: false, prompt: 'a dog runs', plan: { resolved: {} }, setup: { ready: true, items: [] }, sd: false, errors: [], anyway: false }

describe('huntBlockedReason', () => {
  test('null when the button can go, and while it is starting', () => {
    assert.equal(huntBlockedReason(ready), null)
    assert.equal(huntBlockedReason({ ...ready, busy: true, prompt: '' }), null)
  })
  test('no prompt', () => {
    assert.match(huntBlockedReason({ ...ready, prompt: '  ' }), /Write what happens in the shot first/)
  })
  test('no plan yet', () => {
    assert.match(huntBlockedReason({ ...ready, plan: null }), /working out/i)
    assert.match(huntBlockedReason({ ...ready, plan: null, planError: 'Pick a character.' }), /Pick a character\./)
  })
  test('Setup not ready names the first missing item', () => {
    const setup = { ready: false, items: [{ id: 'gpu', status: 'ok' }, { id: 'model:fl2va', label: 'H3 video model', status: 'missing', detail: 'Not found (x)' }, { id: 'pack:z', label: 'Z', status: 'missing' }] }
    const r = huntBlockedReason({ ...ready, setup })
    assert.match(r, /Setup isn’t finished/)
    assert.match(r, /H3 video model/)
    assert.ok(!/Z\b/.test(r.replace('H3 video model', '')), 'only the first one')
  })
  test('Seedance only needs ComfyUI', () => {
    const setup = { ready: false, items: [{ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: 'Nothing answers' }] }
    assert.match(huntBlockedReason({ ...ready, sd: true, setup }), /ComfyUI/)
    assert.equal(huntBlockedReason({ ...ready, sd: true, setup: { ready: false, items: [{ id: 'comfyui', status: 'ok' }, { id: 'model:x', label: 'X', status: 'missing' }] } }), null)
  })
  test('prompt errors can be sent anyway', () => {
    assert.match(huntBlockedReason({ ...ready, errors: [{}, {}] }), /2 errors.*Render anyway/)
    assert.equal(huntBlockedReason({ ...ready, errors: [{}], anyway: true }), null)
  })
})
