// Characterization: src/service/graph.js against the shipped template in resources/workflows/.
// Unlike test/graph-parity.mjs this needs no outside fixtures, so it runs anywhere.
//   node --test test/unit/graph-builder.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { buildPrompt, checkPrompt } from '../../src/service/graph.js'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const meta = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.groups.json', 'utf8'))
const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'

describe('buildPrompt', () => {
  test('the template has 132 nodes and 19 switchable groups (a template update must be deliberate)', () => {
    assert.equal(Object.keys(template).length, 132)
    assert.equal(Object.keys(meta.groups).length, 19)
  })

  test('every group id names a node in the template', () => {
    for (const [group, ids] of Object.entries(meta.groups)) {
      for (const id of ids) assert.ok(id in template, `${group} owns missing node ${id}`)
    }
  })

  test('the default switches give a 63-node graph with no dangling links', () => {
    const g = buildPrompt(template, meta, meta.default_on)
    assert.equal(Object.keys(g).length, 63)
    assert.deepEqual(checkPrompt(g), [])
  })

  test('all groups on gives the whole template', () => {
    const g = buildPrompt(template, meta, Object.keys(meta.groups))
    assert.deepEqual(Object.keys(g).sort(), Object.keys(template).sort())
    assert.deepEqual(checkPrompt(g), [])
  })

  test('every single group on its own leaves no dangling links', () => {
    for (const group of Object.keys(meta.groups)) {
      assert.deepEqual(checkPrompt(buildPrompt(template, meta, [group])), [], group)
    }
  })

  test('turning a group off removes its nodes', () => {
    const on = buildPrompt(template, meta, meta.default_on)
    const off = buildPrompt(template, meta, meta.default_on.filter((x) => x !== 'mode1'))
    for (const id of meta.groups.mode1) {
      assert.ok(id in on)
      assert.ok(!(id in off))
    }
  })

  test('does not change the template it is given', () => {
    const before = JSON.stringify(template)
    buildPrompt(template, meta, [])
    assert.equal(JSON.stringify(template), before)
  })

  test('a bypass group (refmods) that is off re-routes its consumer to the pass-through source', () => {
    const consumer = Object.entries(template).find(([, n]) => Object.values(n.inputs).some((v) => isLink(v) && v[0] === '1103'))
    const [cid, node] = consumer
    const input = Object.keys(node.inputs).find((k) => isLink(node.inputs[k]) && node.inputs[k][0] === '1103')
    const withMods = buildPrompt(template, meta, ['refmods', ...meta.default_on])
    const without = buildPrompt(template, meta, meta.default_on)
    assert.deepEqual(withMods[cid].inputs[input], ['1103', 0])
    assert.deepEqual(without[cid].inputs[input], template['1103'].inputs[meta.bypass_groups.refmods['1103']])
  })

  test('values: "node.field" sets that input, a bare node id sets "value", an unknown node is ignored', () => {
    const [id, field] = ['101', 'unet_name']
    const g = buildPrompt(template, meta, meta.default_on, { [`${id}.${field}`]: 'x.safetensors', 'nope.field': 1 })
    assert.equal(g[id].inputs[field], 'x.safetensors')
    assert.ok(!('nope' in g))
    const bare = buildPrompt(template, meta, meta.default_on, { 101: 'y' })
    assert.equal(bare['101'].inputs.value, 'y')
  })
})

describe('checkPrompt', () => {
  test('reports a link to a node that is not in the graph', () => {
    const g = { 1: { class_type: 'A', inputs: { x: ['2', 0], y: 5 } } }
    assert.deepEqual(checkPrompt(g), ['1.x -> missing 2'])
  })
  test('an empty graph is fine', () => {
    assert.deepEqual(checkPrompt({}), [])
  })
})
