// Create -> Image: every family's Generate and Edit graph, built and checked against the live ComfyUI's
// node list (classes, required inputs, links to real nodes and outputs). No renders.   node test/image-graphs.mjs
import assert from 'node:assert/strict'
import { IMAGE_FAMILIES, imageGraph, imageSize } from '../src/service/images.js'

const info = await (await fetch('http://127.0.0.1:8188/object_info')).json()
const check = (g, label) => {
  for (const [id, n] of Object.entries(g)) {
    const spec = info[n.class_type]
    assert.ok(spec, `${label} #${id}: ComfyUI has no ${n.class_type}`)
    for (const [name] of Object.entries(spec.input.required || {})) {
      if (name === 'images' || name === 'resolution') continue // dynamic inputs, written as images.imageN / resolution.megapixels
      assert.ok(name in n.inputs, `${label} #${id} ${n.class_type}: missing ${name}`)
    }
    for (const [name, v] of Object.entries(n.inputs))
      if (Array.isArray(v)) {
        assert.ok(g[v[0]], `${label} #${id}.${name}: links to missing #${v[0]}`)
        assert.ok(v[1] < (info[g[v[0]].class_type].output || []).length, `${label} #${id}.${name}: #${v[0]} has no output ${v[1]}`)
      }
  }
  assert.ok(Object.values(g).some((n) => n.class_type === 'SaveImage'), `${label}: saves`)
}
assert.deepEqual(imageSize('1:1', 1), { width: 1024, height: 1024 })
assert.deepEqual(imageSize('16:9', 1), { width: 1376, height: 768 })
let built = 0
const skipped = []
for (const f of IMAGE_FAMILIES) {
  // a family built on a node newer than this ComfyUI (MiniMax H3 Image) can't be checked here until it's updated
  if (f.node && !info[f.node]) {
    skipped.push(`${f.label} (this ComfyUI has no ${f.node}: update ComfyUI to check it)`)
    continue
  }
  for (const mode of ['generate', ...(f.edit ? ['edit'] : [])]) {
    for (const count of [1, 3]) {
      const g = imageGraph({ family: f.id, mode, unet: 'x.safetensors', te: 't.safetensors', vae: 'v.safetensors', loras: [{ name: 'a.safetensors', strength: 0.8 }], prompt: 'a red fox', width: 1024, height: 1024, count, seed: 1, steps: f.steps, cfg: f.cfg, refs: mode === 'edit' ? ['iv_studio/images/a.png', 'iv_studio/images/b.png'].slice(0, f.id === 'krea2' ? 1 : 2) : [], megapixels: 1, editLora: f.edit === 'lora' ? 'krea2_identity_edit.safetensors' : null, prefix: 'iv_studio/images/test' })
      check(g, `${f.id} ${mode} x${count}`)
      built++
    }
    console.log(`ok  ${f.label}: ${mode}`)
  }
}
console.log(`${built} graphs check out against this ComfyUI`)
for (const s of skipped) console.log(`SKIPPED ${s}`)
