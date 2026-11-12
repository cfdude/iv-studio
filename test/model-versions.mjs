// Other versions of the H3 models (setup.js resolveModel/modelFileMap, comfy.js renameFiles): a ComfyUI set up
// from ComfyUI's own H3 templates, or with files in subfolders, passes Setup and renders with what it has.
//   node test/model-versions.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelFileMap, resolveModel } from '../src/service/setup.js'
import { renameFiles } from '../src/service/comfy.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'models.json'), 'utf8'))
const template = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'workflows', 'iv_studio_api.json'), 'utf8'))
const byId = Object.fromEntries(manifest.models.map((m) => [m.id, m]))
let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
// object_info for the loaders, with these files in each list
const info = (lists) => Object.fromEntries(Object.entries(lists).map(([cls, [input, files]]) => [cls, { input: { required: { [input]: [files] } } }]))

// What ComfyUI's own MiniMax H3 templates download (comfyui_workflow_templates 0.11.96), plus a DMAD LoRA in a subfolder.
const TEMPLATES = info({
  UNETLoader: ['unet_name', ['minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'z_image_turbo_bf16.safetensors']],
  CLIPLoader: ['clip_name', ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'qwen_3_4b.safetensors']],
  VAELoader: ['vae_name', ['minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_video_vae_int8_convrot.safetensors']],
  LoraLoaderModelOnly: ['lora_name', ['MiniMax H3\\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors', 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors']],
  MinimaxH3LatentUpscaler3D: ['model_name', []]
})

// GitHub #32: the gated Lightricks files had "****…" as their SHA-256 (Hugging Face masks the hash of a gated file
// for anyone without access), so every download failed its check and was deleted. Every pinned hash is real hex.
ok('every pinned SHA-256 in models.json and cloud.json is 64 hex characters', () => {
  const bad = []
  const walk = (v, where) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) /^sha256$/i.test(k) && x != null ? !/^[0-9a-f]{64}$/.test(String(x)) && bad.push(`${where}.${k}`) : walk(x, `${where}.${k}`)
  }
  walk(manifest, 'models.json')
  walk(JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'cloud', 'cloud.json'), 'utf8')), 'cloud.json')
  assert.deepEqual(bad, [])
})

ok('every required model says which other versions count', () => {
  for (const m of manifest.models.filter((m) => !m.optional)) assert.ok(m.accept?.length, m.id)
})

ok('IV Studio’s own build wins; another version is next; the Settings → Models pick last', () => {
  assert.deepEqual(resolveModel(byId.fl2va, ['minimax_h3_fl2va_fp8.safetensors', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors']), { file: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', how: 'exact' })
  assert.deepEqual(resolveModel(byId.text_encoder, ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']), { file: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', how: 'version' })
  assert.deepEqual(resolveModel(byId.ref2va, ['my_h3_merge.safetensors'], { reference: 'my_h3_merge.safetensors' }), { file: 'my_h3_merge.safetensors', how: 'picked' })
  assert.equal(resolveModel(byId.ref2va, ['my_h3_merge.safetensors'], { text: 'my_h3_merge.safetensors' }), null, 'a pick for an fl2va workflow is not a ref2va')
})

ok('the 8-step turbo LoRA is not taken for the 4-step DMAD LoRA', () => {
  assert.equal(resolveModel(byId.dmad, ['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors']), null)
})

ok('a ComfyUI set up from the templates: the encoder and the subfolder LoRA are swapped in, the upscaler is missing', () => {
  const map = modelFileMap(manifest, TEMPLATES)
  assert.equal(map['qwen3vl_32b_minimax_h3_int4_convrot.safetensors'], 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
  assert.equal(map['minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors'], 'MiniMax H3\\minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors')
  // files at the top of their folder are mapped too, so a graph naming a subfolder finds them (GitHub #29)
  assert.equal(map['minimax_h3_fl2va_pruned_int8_convrot.safetensors'], 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
  for (const m of manifest.models.filter((m) => /Upscaler/.test(m.loader || ''))) assert.equal(map[m.match], undefined, m.id)
})

ok('#29: H3 at the top of diffusion_models while the graph names "Minimax H3\\": every loader gets the listed name', () => {
  const graph = structuredClone(template)
  const unets = () => Object.values(graph).filter((n) => n.class_type === 'UNETLoader').map((n) => n.inputs.unet_name)
  assert.ok(unets().some((v) => /^Minimax H3[\\/]/.test(v)), 'the bundled graph names a subfolder')
  renameFiles(graph, modelFileMap(manifest, TEMPLATES))
  for (const v of unets()) assert.ok(!/[\\/]/.test(v), v)
  // the other way round: a ComfyUI keeping the file in a subfolder, Linux-style
  const sub = info({ UNETLoader: ['unet_name', ['Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors']] })
  assert.equal(renameFiles({ a: { inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' } } }, modelFileMap(manifest, sub)).a.inputs.unet_name, 'Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors')
  // a Settings → Models pick saved with the old subfolder name
  assert.equal(renameFiles({ a: { inputs: { unet_name: 'Minimax H3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors' } } }, modelFileMap(manifest, TEMPLATES)).a.inputs.unet_name, 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
  // text that isn't a model file name is never touched
  assert.equal(renameFiles({ a: { inputs: { text: 'x' } } }, { x: 'y' }).a.inputs.text, 'x')
})

ok('the swap reaches every loader of the H3 workflow, and nothing else', () => {
  const graph = structuredClone(template)
  const before = JSON.stringify(graph)
  renameFiles(graph, modelFileMap(manifest, TEMPLATES))
  const after = JSON.stringify(graph)
  assert.ok(!after.includes('"qwen3vl_32b_minimax_h3_int4_convrot.safetensors"'))
  assert.ok(after.includes('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'))
  const changed = Object.keys(graph).filter((id) => JSON.stringify(graph[id]) !== JSON.stringify(JSON.parse(before)[id]))
  for (const id of changed) assert.match(graph[id].class_type, /Loader/, `${id} ${graph[id].class_type}`)
  assert.equal(renameFiles({ a: { inputs: { text: 'hello' } } }, {}).a.inputs.text, 'hello')
})

ok('an optional model is found in any folder by its own name, never swapped for another version', () => {
  const qma = byId.qma
  const lists = (files) => info({ LoraLoaderModelOnly: ['lora_name', files], UNETLoader: ['unet_name', []] })
  // IV Studio puts it in "Qwen 2.1\"; someone keeps it at the top of loras: the graph's name follows
  assert.equal(modelFileMap(manifest, lists([qma.match]))[qma.match], qma.match)
  assert.equal(renameFiles({ a: { inputs: { lora_name: `Qwen 2.1\\${qma.match}` } } }, modelFileMap(manifest, lists([qma.match]))).a.inputs.lora_name, qma.match)
  // a Flux.2 fine-tune in the Flux 2 folder is another version: optional models aren't swapped for it
  const flux = byId.flux2_unet
  const map = modelFileMap(manifest, info({ UNETLoader: ['unet_name', ['Flux 2\\my_flux2_finetune.safetensors']] }))
  assert.equal(map[flux.match], undefined)
})

await ok('a ComfyUI on Linux or a Mac gets forward slashes in every job; its OS is asked once', async () => {
  const { posixModelNames } = await import('../src/service/remote.js')
  const { Comfy } = await import('../src/service/comfy.js')
  const g = { 1: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength_model: 0.8 } }, 2: { class_type: 'X', inputs: { text: 'a\\b', LoraLoaderState: JSON.stringify({ loras: [{ name: 'Styles\\a.safetensors' }] }) } } }
  posixModelNames(g)
  assert.equal(g[1].inputs.lora_name, 'MiniMax H3/tess/tess_mmh3-000040.safetensors')
  assert.equal(g[2].inputs.text, 'a\\b', 'text that isn’t a model file is left alone')
  assert.equal(JSON.parse(g[2].inputs.LoraLoaderState).loras[0].name, 'Styles/a.safetensors')
  const asked = []
  const local = new Comfy('http://127.0.0.1:8188')
  local.systemStats = async () => (asked.push(1), { system: { os: 'posix' } })
  assert.equal(await local.posix(), true)
  assert.equal(await local.posix(), true)
  assert.equal(asked.length, 1, 'asked once per address')
  const win = new Comfy('http://127.0.0.1:8188')
  win.systemStats = async () => ({ system: { os: 'nt' } })
  assert.equal(await win.posix(), false)
  const cloud = new Comfy('https://example.invalid', 'iv-studio', 't')
  cloud.systemStats = async () => assert.fail('the cloud is Linux without asking (asking would wake the GPU)')
  assert.equal(await cloud.posix(), true)
})

console.log(`\n${n} checks passed`)
