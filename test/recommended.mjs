// The Recommended LoRAs shelf (src/service/recommended.js), its pinned downloads (ModelInstaller honours the pinned
// SHA-256) and turnaround sheets (src/service/turnaround.js), all without ComfyUI or the network: a stand-in host
// serves the file, and a stand-in Studio answers for ComfyUI.
//   node test/recommended.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { ModelInstaller } from '../src/service/models.js'
import { RECOMMENDED, recommendedManifest, recommendedOnDisk } from '../src/service/recommended.js'
import { TURNAROUND_LORA, turnaroundGraph, turnaroundReady, Turnarounds } from '../src/service/turnaround.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-rec-'))

await ok('every shelf entry is pinned to a Hugging Face commit and a SHA-256, and says how to use it', () => {
  const ids = new Set()
  for (const r of RECOMMENDED) {
    assert.match(r.url, /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//, `${r.id}: pinned to a commit`)
    assert.ok(r.url.endsWith(encodeURIComponent(r.match)), `${r.id}: the URL names its file`)
    assert.match(r.sha256, /^[0-9a-f]{64}$/)
    assert.ok(r.size > 1e6 && r.name && r.author && r.what && r.how && r.licence && r.page.startsWith('https://'), r.id)
    assert.ok(['shot', 'turnaround'].includes(r.use))
    assert.ok(!ids.has(r.id), 'unique ids')
    ids.add(r.id)
  }
  for (const want of ['Camera Motion', 'Natural Face Speech', 'Motion Continuity Repair', 'Spatial Physics', 'Head-mounted FPV', '360° Orbit', 'Transformation', 'Turnaround']) assert.ok(RECOMMENDED.some((r) => r.name === want), want)
  const m = recommendedManifest().models
  assert.ok(m.every((x) => x.folder === 'loras/MiniMax H3/Recommended' && x.sha256 && x.match && x.url))
})
await ok('a LoRA already in ComfyUI is found by file name, in any folder', () => {
  const got = recommendedOnDisk(['MiniMax H3\\Enhancements\\Motion_Repair_V2.safetensors', 'other/thing.safetensors'])
  assert.deepEqual(got, { 'rec-motion-repair': 'MiniMax H3\\Enhancements\\Motion_Repair_V2.safetensors' })
})

// a stand-in host and ComfyUI's models folder
const body = Buffer.from('pretend lora weights '.repeat(5000))
const good = createHash('sha256').update(body).digest('hex')
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-length': body.length })
  res.end(req.method === 'HEAD' ? undefined : body)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}/x.safetensors`
const loras = path.join(root, 'loras')
const comfy = { req: async () => [{ name: 'loras', folders: [loras] }] }
const run = async (sha256, match) => {
  const inst = new ModelInstaller({ comfy, manifest: { models: [{ id: 'r', match, folder: 'loras/MiniMax H3/Recommended', url, size: body.length, sha256 }] } })
  inst.enqueue(['r'])
  while (inst.running || inst.queue.length) await new Promise((r) => setTimeout(r, 20))
  return inst.status().r
}
await ok('a download matching its pinned SHA-256 lands; one that doesn’t is removed', async () => {
  const done = await run(good, 'good.safetensors')
  assert.equal(done.status, 'done', JSON.stringify(done))
  assert.ok(fs.existsSync(path.join(loras, 'MiniMax H3', 'Recommended', 'good.safetensors')))
  const bad = await run('0'.repeat(64), 'bad.safetensors')
  assert.equal(bad.status, 'error')
  assert.match(bad.error, /did not match/)
  assert.ok(!fs.existsSync(path.join(loras, 'MiniMax H3', 'Recommended', 'bad.safetensors')))
  assert.ok(!fs.existsSync(path.join(loras, 'MiniMax H3', 'Recommended', 'bad.safetensors.part')))
})
srv.close()

await ok('the turnaround graph follows the Contact Sheet example: ref2va, the LoRA, res_multistep / simple, 28 steps', () => {
  const g = turnaroundGraph({ ref: 'iv_studio/turnaround/face.png [input]', lora: 'MiniMax H3\\Recommended\\minimax_h3_five_view_512_s1500.safetensors', size: 512, seed: 7, prefix: 'iv_studio/turnaround/ta1' })
  assert.equal(g.unet.inputs.unet_name, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors')
  assert.equal(g.clip.inputs.type, 'minimax')
  assert.deepEqual(g.lora.inputs.model, ['unet', 0])
  assert.match(g.sheet.inputs.prompt, /<Picture 1>/)
  assert.deepEqual([g.sampler.inputs.sampler_name, g.sigmas.inputs.scheduler, g.sigmas.inputs.steps], ['res_multistep', 'simple', 28])
  assert.deepEqual(g.run.inputs.latent_image, ['sheet', 1])
  assert.deepEqual(Object.keys(g).filter((k) => g[k].class_type === 'SaveImage').sort(), ['s1views', 's2strip'], 'views save before the strip')
  assert.match(turnaroundGraph({ ref: 'a', lora: 'b', studio: true, prefix: 'p' }).sheet.inputs.prompt, /neutral studio background/)
})
await ok('ready only with both the nodes and the LoRA', () => {
  const info = (names, nodes) => ({ LoraLoaderModelOnly: { input: { required: { lora_name: [names] } } }, ...(nodes ? { H3ContactSheet: {}, H3ContactSheetDecode: {} } : {}) })
  assert.deepEqual(turnaroundReady(info([], false)), { nodes: false, lora: null, ready: false })
  assert.equal(turnaroundReady(info([`x/${TURNAROUND_LORA.match}`], false)).ready, false)
  assert.deepEqual(turnaroundReady(info([`x/${TURNAROUND_LORA.match}`], true)), { nodes: true, lora: `x/${TURNAROUND_LORA.match}`, ready: true })
})
await ok('a sheet: the face picture goes in, five views and a strip come back into the data folder', async () => {
  const out = path.join(root, 'comfy-out')
  fs.mkdirSync(out, { recursive: true })
  const face = path.join(root, 'tess.png')
  fs.writeFileSync(face, 'png')
  const files = ['ta_view_00001_.png', 'ta_view_00002_.png', 'ta_view_00003_.png', 'ta_view_00004_.png', 'ta_view_00005_.png', 'ta_strip_00001_.png'].map((f) => (fs.writeFileSync(path.join(out, f), f), path.join(out, f)))
  let submitted = null
  const studio = {
    comfy: { hosted: false, objectInfo: async () => ({ H3ContactSheet: {}, H3ContactSheetDecode: {}, LoraLoaderModelOnly: { input: { required: { lora_name: [[`MiniMax H3/Recommended/${TURNAROUND_LORA.match}`]] } } } }), upload: async (p) => `iv_studio/turnaround/${path.basename(p)} [input]` },
    characters: () => [{ id: 'tess', name: 'Tess Marlow' }],
    facePicture: () => face,
    submitGraph: async (j) => ((submitted = j), { id: 'job1' }),
    refreshJob: async () => ({ id: 'job1', status: 'success', outputs: files.map((p) => ({ kind: 'image', path: p })) }),
    localCopy: async (o) => o.path
  }
  const t = new Turnarounds({ dataDir: root, studio: () => studio })
  const sheet = await t.make({ characterId: 'tess', size: 512, seed: 9 })
  assert.equal(submitted.kind, 'turnaround')
  assert.equal(submitted.plan.images, true)
  assert.equal(submitted.graph.lora.inputs.lora_name, `MiniMax H3/Recommended/${TURNAROUND_LORA.match}`)
  assert.equal(submitted.graph.ref.inputs.image, 'iv_studio/turnaround/tess.png [input]')
  assert.equal(sheet.views.length, 5)
  assert.match(sheet.strip, /_strip_/)
  assert.ok([...sheet.views, sheet.strip].every((f) => f.startsWith(path.join(root, 'turnarounds')) && fs.existsSync(f)), 'copied into the data folder')
  assert.deepEqual(t.list('tess').map((s) => s.id), [sheet.id])
  assert.deepEqual(t.list('theo'), [])
  t.remove(sheet.id)
  assert.deepEqual(t.list(), [])
  await assert.rejects(() => t.make({ characterId: 'nobody' }), /No such character/)
  await assert.rejects(() => t.make({ characterId: 'tess', size: 333 }), /Size is/)
  studio.comfy.objectInfo = async () => ({})
  await assert.rejects(() => t.make({ characterId: 'tess' }), /Contact Sheet node pack/)
})
fs.rmSync(root, { recursive: true, force: true })
console.log(`${n} checks passed`)
