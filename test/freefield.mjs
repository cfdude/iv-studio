// Freefield's apps as IV Studio runs them (src/service/freefield.js): every vendored app loads, its inputs bind to
// real nodes, filling sets the values (templates, random seeds, select checks), and model files this PC has as
// another build are swapped in.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CLIP_FX, cameraOverrides, fillGraph, loadApp, sizeOf, swapModels, upstream, withFreeMemory, withoutPromptWriter } from '../src/service/freefield.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))
const RES = new URL('../resources', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const manifest = JSON.parse(fs.readFileSync(`${RES}/models.json`, 'utf8'))

ok('every effect has its Freefield app, and every input binds to a node in it', () => {
  for (const [fx, spec] of Object.entries(CLIP_FX)) {
    const { app, graph } = loadApp(RES, spec.app)
    assert.equal(app.id, spec.app, fx)
    for (const input of app.inputs) for (const b of input.bind || []) assert.ok(graph[b.node], `${spec.app}: ${input.id} binds to missing node ${b.node}`)
    assert.ok((app.inputs || []).some((i) => i.type === spec.media || (spec.media === 'image' && i.type === 'image')), `${fx} takes a ${spec.media}`)
  }
  assert.ok(fs.existsSync(`${RES}/licenses/Freefield-MIT.txt`), 'Freefield’s licence ships with the app')
})

ok('filling: values, templates, random seeds, and select and slider checks', () => {
  const { app, graph } = loadApp(RES, 'reshoot')
  const g = fillGraph(app, graph, { clip: 'iv_studio/clipfx/a.mp4', azimuth: 45, prompt: 'a calm street', seed: -1 })
  assert.equal(g['1'].inputs.file, 'iv_studio/clipfx/a.mp4')
  assert.equal(g['5'].inputs.azimuth, 45)
  assert.equal(g['20'].inputs.prompt, 'crossview. a calm street')
  assert.ok(Number.isInteger(g['30'].inputs.noise_seed) && g['30'].inputs.noise_seed >= 0, 'a random seed')
  assert.equal(graph['1'].inputs.file === 'iv_studio/clipfx/a.mp4', false, 'the vendored graph itself is untouched')
  assert.throws(() => fillGraph(app, graph, { azimuth: 400 }), /-90 to 90/)
  const fx = loadApp(RES, 'effects')
  const effect = fx.app.inputs.find((i) => i.id === 'effect')
  assert.throws(() => fillGraph(fx.app, fx.graph, { effect: 'no-such-effect' }), /one of/)
  assert.doesNotThrow(() => fillGraph(fx.app, fx.graph, { effect: effect.options[0].value }))
})

ok('a chosen option writes its sets: the effect’s LoRA and its prompt, with {subject} and {details} filled', () => {
  const { app, graph } = loadApp(RES, 'effects')
  const opt = app.inputs.find((i) => i.id === 'effect').options.find((o) => o.value === 'crying')
  const g = fillGraph(app, graph, { effect: 'crying', subject: 'an old fisherman', details: 'Rain on the window.' })
  for (const s of opt.sets) {
    const got = g[s.node].inputs[s.field]
    if (/\{subject\}/.test(s.value)) {
      assert.ok(got.includes('an old fisherman') && got.includes('Rain on the window.') && !/\{\w+\}/.test(got), `the prompt is filled: ${got}`)
    } else assert.equal(got, s.value)
  }
  assert.equal(g.ff_effect.inputs.lora_name, 'crying_20_epochs.safetensors')
  // another choice, another LoRA
  assert.notEqual(fillGraph(app, graph, { effect: 'laughing' }).ff_effect.inputs.lora_name, 'crying_20_epochs.safetensors')
  // every app's options' sets point at real nodes
  for (const spec of Object.values(CLIP_FX)) {
    const a = loadApp(RES, spec.app)
    for (const i of a.app.inputs) for (const o of i.options || []) for (const s of o.sets || []) assert.ok(a.graph[s.node], `${spec.app}: ${i.id}=${o.value} sets missing node ${s.node}`)
  }
})

ok('model files this PC has as another build are swapped in; the rest are reported', () => {
  const { app, graph } = loadApp(RES, 'reshoot')
  const te = Object.values(graph).find((nd) => /qwen3vl_32b_minimax_h3/.test(JSON.stringify(nd.inputs)))
  const field = Object.entries(te.inputs).find(([, v]) => /qwen3vl_32b/.test(v))[0]
  const ivTe = manifest.models.find((m) => m.id === 'text_encoder').match
  const info = {}
  // a ComfyUI that lists only IV Studio's own H3 text encoder for that loader, and nothing else for any loader
  for (const nd of Object.values(graph)) {
    for (const [f, v] of Object.entries(nd.inputs || {})) {
      if (typeof v !== 'string' || !/\.(safetensors|gguf)$/i.test(v)) continue
      info[nd.class_type] ||= { input: { required: {} } }
      const list = (info[nd.class_type].input.required[f] ||= [[]])[0]
      list.push(nd === te && f === field ? ivTe : v)
    }
  }
  const r = swapModels(fillGraph(app, graph, {}), info, manifest)
  assert.deepEqual(r.missing, [])
  assert.equal(Object.values(r.graph).find((nd) => nd.class_type === te.class_type && nd.inputs[field]).inputs[field], ivTe, 'the int8 encoder is swapped for IV Studio’s')
  info[te.class_type].input.required[field] = [['something_else.safetensors']]
  assert.ok(swapModels(graph, info, manifest).missing.some((m) => /qwen3vl_32b/.test(m)), 'nothing to swap in: reported missing')
})

ok('New angle preview: only the depth and warp half, and the advanced camera is checked', () => {
  const { app, graph } = loadApp(RES, 'reshoot')
  const part = upstream(fillGraph(app, graph, { clip: 'a.mp4', azimuth: 40 }), CLIP_FX.reshoot.preview)
  const kinds = Object.values(part).map((n) => n.class_type)
  for (const k of ['LoadVideo', 'CrossViewPrepareClip', 'MoGeInference', 'CrossViewWarp', 'SaveVideo']) assert.ok(kinds.includes(k), k)
  assert.ok(!kinds.some((k) => /MiniMax|UNETLoader|KSampler|SamplerCustom/.test(k)), 'no H3 in the preview')
  assert.equal(part['5'].inputs.azimuth, 40)
  assert.deepEqual(cameraOverrides({ hfov: 35, keep_source_aim: 0, vertical_shift: '0.2', nope: 1 }), { hfov: 35, keep_source_aim: false, vertical_shift: 0.2 })
  assert.throws(() => cameraOverrides({ hfov: 200 }), /0 to 120/)
})

ok('the GPU is cleared before the first sampler loads its model, and only when ComfyUI has the node', () => {
  for (const spec of Object.values(CLIP_FX)) {
    const { graph } = loadApp(RES, spec.app)
    assert.equal(withFreeMemory(graph, {}), graph, `${spec.app}: unchanged without the node`)
    const g = withFreeMemory(graph, { IVFreeMemory: {} })
    const frees = Object.entries(g).filter(([, n]) => n.class_type === 'IVFreeMemory')
    const samplers = Object.values(graph).filter((n) => /Guider$|^KSampler|^SamplerCustom$/.test(n.class_type))
    if (samplers.length) assert.ok(frees.length >= 1, `${spec.app}: a free step before sampling`)
    for (const [fid, f] of frees) {
      const user = Object.values(g).find((n) => Object.values(n.inputs || {}).some((v) => Array.isArray(v) && v[0] === fid))
      assert.ok(user && /Guider$|^KSampler|^SamplerCustom/.test(user.class_type), `${spec.app}: ${fid} feeds the sampler`)
      assert.ok(!Object.values(upstream(graph, f.inputs.value[0])).some((n) => /^(KSampler|SamplerCustom)/.test(n.class_type)), `${spec.app}: only before the first stage`)
    }
  }
  const { graph } = loadApp(RES, 'reshoot')
  const g = withFreeMemory(graph, { IVFreeMemory: {} })
  assert.deepEqual(g['33'].inputs.conditioning, ['ivfree_33', 0])
  assert.deepEqual(g.ivfree_33.inputs.value, graph['33'].inputs.conditioning)
})

ok('New angle starts gentle: 15° / 5°, the lens read from the clip, 0.35 MP', () => {
  const spec = CLIP_FX.reshoot
  assert.deepEqual(spec.defaults, { azimuth: -15, elevation: 5 })
  assert.equal(spec.cameraDefaults.hfov, 0)
  assert.equal(sizeOf(spec, null), 0.35)
  assert.equal(sizeOf(spec, 0.5), 0.5)
  assert.equal(sizeOf(spec, 2), 0.35, 'only its own choices')
  const { graph } = loadApp(RES, 'reshoot')
  assert.equal(graph['2'].inputs.megapixels, 0.5, 'the vendored graph is unchanged')
})

ok('the LTX apps lose their in-graph prompt rewriter and its Gemma model; the prompt goes straight in', () => {
  for (const app of ['dub', 'vfx-clean-plate', 'vfx-day-to-night', 'vfx-water', 'morph', 'transitions']) {
    const { app: a, graph } = loadApp(RES, app)
    const prompt = a.inputs.find((i) => i.id === 'prompt' || i.id === 'details')
    const filled = fillGraph(a, graph, prompt ? { [prompt.id]: 'A test prompt.' } : {})
    const g = withoutPromptWriter(filled)
    const kinds = Object.values(g).map((n) => n.class_type)
    assert.ok(!kinds.includes('TextGenerateLTX2Prompt'), `${app}: no rewriter`)
    assert.ok(!JSON.stringify(g).includes('gemma4_e2b'), `${app}: no Gemma E2B model`)
    for (const [id, n] of Object.entries(g)) for (const v of Object.values(n.inputs || {})) if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'number') assert.ok(g[String(v[0])], `${app}: ${id} points at a node still there`)
    assert.ok(Object.values(g).some((n) => 'filename_prefix' in (n.inputs || {})), `${app}: still saves`)
  }
  const { graph } = loadApp(RES, 'smooth')
  assert.equal(withoutPromptWriter(graph), graph, 'apps without a rewriter are untouched')
})

console.log(`\n${n} passed`)
