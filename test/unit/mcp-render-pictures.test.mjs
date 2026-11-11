// MCP picture tools (task 5.4): the image models, making a picture set, following it, listing, cancelling and
// deleting, called through the real MCP server on source under the test guard, against the fake ComfyUI (design D1,
// D8). One fake and one server for the file. The fake finishes a prompt with a generic answer, so a finished set gets
// its pictures from the test writing them into the fake's history, the way ComfyUI saves them.
//   node --test test/unit/mcp-render-pictures.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const ZIMAGE = 'Z-Image/z_image_turbo_bf16.safetensors'
const FLUX2 = 'Flux2/flux2_klein_9b.safetensors'
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
// Z-Image Turbo and Flux.2 Klein are installed with their text encoders and VAEs; nothing else is
const OBJECT_INFO = {
  UNETLoader: combo('unet_name', [ZIMAGE, FLUX2]),
  CLIPLoader: { input: { required: { clip_name: [['qwen_3_4b.safetensors', 'qwen_3_8b.safetensors']], type: [['lumina2', 'flux2']] } } },
  VAELoader: combo('vae_name', ['ae.safetensors', 'flux2-vae.safetensors']),
  LoraLoaderModelOnly: combo('lora_name', ['zit_style.safetensors'])
}

describe('MCP picture tools', () => {
  let fake, mcp, picture
  const call = (name, args = {}) => mcp.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}) => {
    const r = await call(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const fails = async (name, args, pattern) => {
    const r = await call(name, args)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readData = (...p) => JSON.parse(fs.readFileSync(dataFile(...p), 'utf8'))
  const lastGraph = () => fake.prompts.at(-1).prompt
  const family = async (id) => (await ok('list_image_models')).families.find((f) => f.id === id)
  // ComfyUI saved this picture for the last prompt queued
  const saved = (png = picture) => {
    fake.state.history[fake.prompts.at(-1).id].outputs = { 11: { images: [{ filename: path.basename(png), subfolder: 'iv_studio/images', type: 'output', fullpath: png }] } }
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    picture = path.join(dir, 'fox.png')
    execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', picture])
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- list_image_models ----------
  test('[mcp:list_image_models][ipc:images:status] lists the nine families, none ready on a ComfyUI with no image models', async () => {
    const { families, aspects, defaults } = await ok('list_image_models')
    assert.deepEqual(families.map((f) => f.id), ['flux2', 'flux3', 'krea2', 'moss', 'qwen21', 'zimage', 'sdxl', 'h3image', 'h3'])
    assert.ok(families.every((f) => f.ready === false && f.models.length === 0 && f.edit === false))
    assert.deepEqual(aspects, ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'])
    assert.deepEqual(defaults, { aspect: '1:1', megapixels: 1, count: 1 })
  })

  test('[mcp:list_image_models] marks a family ready with its checkpoints, and says what the others are missing', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const { families } = await ok('list_image_models')
      const by = Object.fromEntries(families.map((f) => [f.id, f]))
      assert.deepEqual([by.zimage.ready, by.zimage.models, by.zimage.te, by.zimage.vae, by.zimage.edit], [true, [ZIMAGE], 'qwen_3_4b.safetensors', 'ae.safetensors', false])
      assert.match(by.zimage.editNote, /Z-Image Turbo makes pictures from a prompt only\./)
      assert.deepEqual([by.flux2.ready, by.flux2.models, by.flux2.edit, by.flux2.maxRefs], [true, [FLUX2], true, 6])
      assert.equal(by.zimage.licence, 'Apache-2.0')
      assert.equal(by.qwen21.ready, false)
      assert.ok(by.qwen21.missing.includes('text encoder qwen3vl_8b_int8_convrot.safetensors'))
      assert.ok(by.qwen21.missing.some((m) => /^ComfyUI support for Qwen Image 2\.1/.test(m)))
      assert.equal(by.qwen21.maxRefs, 3)
    } finally {
      fake.setObjectInfo({})
    }
  })

  // ---------- make_image ----------
  test('[mcp:make_image][ipc:images:create] queues the Z-Image graph with the prompt, LoRA, size, count and seed and saves the set as queued in a project', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const queued = fake.prompts.length
      const set = await ok('make_image', { model: ZIMAGE, prompt: 'A red fox in snow. Photo.', seed: 5, count: 2, aspect: '16:9', loras: [{ name: 'zit_style.safetensors', strength: 0.7 }] })
      assert.equal(fake.prompts.length, queued + 1)
      assert.match(set.id, /^[0-9a-f]{8}$/)
      assert.deepEqual([set.family, set.mode, set.status, set.seed, set.steps, set.cfg, set.count], ['zimage', 'generate', 'queued', 5, 8, 1, 2])
      assert.deepEqual([set.width, set.height], [1376, 768])
      assert.equal(set.name, 'A red fox in snow')
      const g = lastGraph()
      const byClass = (c) => Object.values(g).filter((n) => n.class_type === c)
      assert.equal(byClass('UNETLoader')[0].inputs.unet_name, ZIMAGE)
      assert.deepEqual([byClass('LoraLoaderModelOnly')[0].inputs.lora_name, byClass('LoraLoaderModelOnly')[0].inputs.strength_model], ['zit_style.safetensors', 0.7])
      assert.equal(byClass('CLIPTextEncode')[0].inputs.text, 'A red fox in snow. Photo.')
      assert.deepEqual([byClass('EmptySD3LatentImage')[0].inputs.width, byClass('EmptySD3LatentImage')[0].inputs.height, byClass('EmptySD3LatentImage')[0].inputs.batch_size], [1376, 768, 2])
      assert.deepEqual([byClass('KSampler')[0].inputs.seed, byClass('KSampler')[0].inputs.steps, byClass('KSampler')[0].inputs.sampler_name], [5, 8, 'res_multistep'])
      assert.equal(byClass('SaveImage')[0].inputs.filename_prefix, `iv_studio/images/a_red_fox_in_snow_${set.id}`)
      assert.deepEqual(fake.prompts.at(-1).extra_data.iv_studio, { kind: 'picture:zimage', project: set.projectId, sequence: null })
      // the set is a project with tool image, and is recorded in the images folder
      assert.equal(readData('projects', `${set.projectId}.json`).name, 'Image · A red fox in snow')
      assert.equal(readData('images', 'images.json')[0].id, set.id)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:make_image] uploads the picture to edit and queues Flux.2\'s edit graph with it as a reference', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const uploads = fake.uploads.length
      const set = await ok('make_image', { mode: 'edit', model: FLUX2, prompt: 'Make the fox white. Keep the snow.', refs: [picture], seed: 9 })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['fox.png', 'iv_studio/images']])
      assert.deepEqual([set.family, set.mode, set.width, set.height, set.steps, set.refs], ['flux2', 'edit', null, null, 4, [picture]])
      const g = Object.values(lastGraph())
      assert.equal(g.filter((n) => n.class_type === 'LoadImage')[0].inputs.image, 'iv_studio/images/fox.png')
      assert.ok(g.some((n) => n.class_type === 'ReferenceLatent'), 'the picture goes in as a reference latent')
      assert.equal(g.filter((n) => n.class_type === 'CLIPTextEncode')[0].inputs.text, 'Make the fox white. Keep the snow.')
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:make_image] says what is wrong and queues nothing: no prompt, an unknown or missing model, a family that cannot edit, no picture, a missing file', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const queued = fake.prompts.length
      await fails('make_image', { model: ZIMAGE, prompt: '   ' }, /^Describe the picture first\.$/)
      await fails('make_image', { mode: 'edit', model: FLUX2, prompt: '  ' }, /^Say what to change in the picture\.$/)
      await fails('make_image', { model: 'nope.safetensors', prompt: 'x' }, /"nope\.safetensors" isn't an image model IV Studio knows\. Pick one from list_image_models\./)
      await fails('make_image', { model: 'Qwen/qwen-image-2.1.safetensors', prompt: 'x' }, /Qwen Image 2\.1 has no checkpoint "Qwen\/qwen-image-2\.1\.safetensors" in ComfyUI\./)
      await fails('make_image', { mode: 'edit', model: ZIMAGE, prompt: 'x', refs: [picture] }, /^Z-Image Turbo makes pictures from a prompt only\.$/)
      await fails('make_image', { mode: 'edit', model: FLUX2, prompt: 'x' }, /^Add the picture to edit\.$/)
      await fails('make_image', { mode: 'edit', model: FLUX2, prompt: 'x', refs: [path.join(path.dirname(picture), 'gone.png')] }, /No picture at .*gone\.png\./)
      await fails('make_image', { model: ZIMAGE, prompt: 'x', count: 5 }, /count/i)
      await fails('make_image', { model: ZIMAGE, prompt: 'x', megapixels: 25 }, /megapixels/i)
      assert.equal(fake.prompts.length, queued)
    } finally {
      fake.setObjectInfo({})
    }
    // a family whose text encoder is missing is named as not ready
    fake.setObjectInfo({ ...OBJECT_INFO, CLIPLoader: { input: { required: { clip_name: [['other.safetensors']], type: [['lumina2']] } } } })
    try {
      await fails('make_image', { model: ZIMAGE, prompt: 'x' }, /^Z-Image Turbo needs text encoder qwen_3_4b_fp8_mixed\.safetensors\.$/)
    } finally {
      fake.setObjectInfo({})
    }
  })

  // ---------- get_image ----------
  test('[mcp:get_image][ipc:images:get] shows a waiting set queued, then its pictures copied into the images folder once ComfyUI saves them', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      fake.holdNextPrompt(1)
      const set = await ok('make_image', { model: ZIMAGE, prompt: 'A fox at dawn.' })
      const waiting = await ok('get_image', { imageId: set.id })
      assert.equal(waiting.status, 'queued')
      assert.equal(waiting.queuePosition, 1)
      assert.deepEqual(waiting.files, [])
      fake.releaseHeld()
      saved()
      const done = await ok('get_image', { imageId: set.id })
      assert.equal(done.status, 'success')
      assert.deepEqual(done.files, [dataFile('images', `a_fox_at_dawn_${set.id}_1.png`)])
      assert.ok(done.finishedAt)
      assert.equal(fs.readFileSync(done.files[0]).length, fs.readFileSync(picture).length)
      assert.ok(fs.existsSync(picture), 'ComfyUI\'s own copy stays')
      assert.deepEqual(readData('images', 'images.json').find((r) => r.id === set.id).files, done.files)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:get_image] reports ComfyUI\'s error, says when it saved no pictures, and refuses an unknown set', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      fake.failNextPrompt('Allocation on device would exceed the memory limit')
      const bad = await ok('make_image', { model: ZIMAGE, prompt: 'A fox that fails.' })
      const failed = await ok('get_image', { imageId: bad.id })
      assert.equal(failed.status, 'error')
      assert.match(failed.error, /Allocation on device would exceed the memory limit/)
      // the fake's default answer is a picture-less success
      const empty = await ok('make_image', { model: ZIMAGE, prompt: 'A fox with no file.' })
      fake.state.history[fake.prompts.at(-1).id].outputs = {}
      const none = await ok('get_image', { imageId: empty.id })
      assert.equal(none.status, 'error')
      assert.equal(none.error, 'ComfyUI finished but saved no pictures.')
    } finally {
      fake.setObjectInfo({})
    }
    await fails('get_image', { imageId: 'nope0000' }, /^No picture set nope0000\.$/)
  })

  // ---------- list_images ----------
  test('[mcp:list_images][ipc:images:list] lists every picture set newest first with its status, files, model, prompt and seed', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const first = await ok('make_image', { model: ZIMAGE, prompt: 'List one.', seed: 101 })
      saved()
      fake.holdNextPrompt(1)
      const second = await ok('make_image', { model: ZIMAGE, prompt: 'List two.', seed: 102 })
      const { items } = await ok('list_images')
      const mine = items.filter((s) => [first.id, second.id].includes(s.id))
      assert.deepEqual(mine.map((s) => s.id), [second.id, first.id])
      assert.deepEqual(mine.map((s) => [s.prompt, s.seed, s.model, s.status]), [['List two.', 102, ZIMAGE, 'queued'], ['List one.', 101, ZIMAGE, 'success']])
      assert.deepEqual(mine[1].files, [dataFile('images', `list_one_${first.id}_1.png`)])
      assert.deepEqual(mine[0].files, [])
      fake.releaseHeld()
    } finally {
      fake.setObjectInfo({})
    }
  })

  // ---------- cancel_image ----------
  test('[mcp:cancel_image][ipc:images:cancel] takes a waiting set out of ComfyUI\'s queue and marks it cancelled', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      fake.holdNextPrompt(1)
      const set = await ok('make_image', { model: ZIMAGE, prompt: 'A fox to cancel.' })
      assert.equal(fake.state.pending.length, 1)
      const r = await ok('cancel_image', { imageId: set.id })
      assert.equal(r.result, 'removed from queue')
      assert.equal(r.status, 'cancelled')
      assert.deepEqual(fake.state.pending, [])
      assert.equal(readData('images', 'images.json').find((s) => s.id === set.id).status, 'cancelled')
      assert.equal((await ok('get_image', { imageId: set.id })).status, 'cancelled')
    } finally {
      fake.setObjectInfo({})
    }
    await fails('cancel_image', { imageId: 'nope0000' }, /^No picture set nope0000\.$/)
  })

  // ---------- delete_image ----------
  test('[mcp:delete_image][ipc:images:delete] deletes the set, its pictures and its project, and leaves ComfyUI\'s own copy', async () => {
    fake.setObjectInfo(OBJECT_INFO)
    try {
      const set = await ok('make_image', { model: ZIMAGE, prompt: 'A fox to delete.' })
      saved()
      const done = await ok('get_image', { imageId: set.id })
      assert.ok(fs.existsSync(done.files[0]))
      assert.deepEqual(await ok('delete_image', { imageId: set.id }), { deleted: set.id })
      assert.ok(!fs.existsSync(done.files[0]), 'the copy in the images folder is gone')
      assert.ok(fs.existsSync(picture), 'ComfyUI\'s own copy stays')
      assert.ok(!fs.existsSync(dataFile('projects', `${set.projectId}.json`)))
      assert.ok(!(await ok('list_images')).items.some((s) => s.id === set.id))
      await fails('delete_image', { imageId: set.id }, new RegExp(`^No picture set ${set.id}\\.$`))
      // a set still waiting is taken out of the queue first
      fake.holdNextPrompt(1)
      const waiting = await ok('make_image', { model: ZIMAGE, prompt: 'A fox still waiting.' })
      await ok('delete_image', { imageId: waiting.id })
      assert.deepEqual(fake.state.pending, [])
    } finally {
      fake.setObjectInfo({})
    }
  })
})
