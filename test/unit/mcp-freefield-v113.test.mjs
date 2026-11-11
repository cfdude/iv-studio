// MCP tools new in upstream v1.1.3, part 2: Freefield's apps (clip effects), the one-step picture tools and turnaround
// sheets, called through the real MCP server on source under the test guard, against the fake ComfyUI. The fake
// finishes a prompt at once; setOutputs says what ComfyUI saved for it (real files made with the bundled ffmpeg, given by
// fullpath, so nothing is downloaded). The graph a tool queued is read from fake.prompts.
//   node --test test/unit/mcp-freefield-v113.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { CLIP_FX, loadApp, offeredFx, withoutPromptWriter } from '../../src/service/freefield.js'
import { TURNAROUND_LORA } from '../../src/service/turnaround.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const resources = new URL('../../resources', import.meta.url).pathname
const node = (required = {}) => ({ input: { required } })
const combo = (name, options) => node({ [name]: [options] })
// every node class the offered effects use, with no combo lists: ComfyUI "has" the nodes and the models are not checked
const effectInfo = (only = offeredFx()) => {
  const info = {}
  for (const fx of only) for (const n of Object.values(withoutPromptWriter(loadApp(resources, CLIP_FX[fx].app).graph))) info[n.class_type] ||= node()
  return info
}

describe('MCP effect tools', () => {
  let fake, mcp, dir, clip, still, still2
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const lastGraph = () => fake.prompts.at(-1).prompt
  const nodesOf = (cls) => Object.entries(lastGraph()).filter(([, n]) => n.class_type === cls)
  let saves = 0
  // what ComfyUI saved: one mp4 per SaveVideo node of the graph, one png per SaveImage
  const savesEveryNode = () =>
    fake.setOutputs((prompt) => {
      const out = {}
      for (const [id, n] of Object.entries(prompt)) {
        if (n.class_type === 'SaveVideo') {
          const f = path.join(dir, `saved${++saves}.mp4`)
          ff('-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-pix_fmt', 'yuv420p', f)
          out[id] = { videos: [{ filename: path.basename(f), subfolder: 'iv_studio/clipfx', type: 'output', fullpath: f }] }
        }
      }
      return out
    })
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
      fake.setOutputs(null)
    }
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    clip = path.join(dir, 'walk.mp4')
    still = path.join(dir, 'fox.png')
    still2 = path.join(dir, 'fox_end.png')
    ff('-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-pix_fmt', 'yuv420p', clip)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'color=c=white:s=64x64', '-frames:v', '1', still2)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- effects_list ----------
  test('[mcp:effects_list] lists the ten effects IV Studio offers (New angle is left out) with what each takes, and none ready on a bare ComfyUI', async () => {
    const { items, status } = await ok('effects_list')
    assert.deepEqual(items.map((i) => i.fx), ['dub', 'cleanplate', 'night', 'water', 'hdr', 'removebg', 'smooth', 'effects', 'morph', 'transitions'])
    assert.deepEqual(items.filter((i) => i.media === 'image').map((i) => i.fx), ['effects', 'morph', 'transitions'])
    assert.equal(items.find((i) => i.fx === 'removebg').label, 'Remove background')
    assert.ok(!items.some((i) => i.fx === 'reshoot'))
    assert.deepEqual(Object.keys(status), items.map((i) => i.fx))
    assert.ok(Object.values(status).every((s) => s.ready === false && s.missingNodes.length > 0))
    assert.ok(status.removebg.missingNodes.includes('LoadBackgroundRemovalModel'))
  })

  test('[mcp:effects_list] says every effect is ready once ComfyUI has their nodes (and no model file is listed as missing)', async () => {
    await withInfo(effectInfo(), async () => {
      const { status } = await ok('effects_list')
      assert.ok(Object.values(status).every((s) => s.ready === true && !s.missingNodes.length && !s.missingModels.length), JSON.stringify(status))
    })
  })

  test('[mcp:effects_list] with fx gives that effect\'s inputs (ids, types, options, limits, defaults), outputs and models, and whether it can run', async () => {
    const e = await ok('effects_list', { fx: 'removebg' })
    assert.deepEqual([e.fx, e.app, e.media], ['removebg', 'video-remove-bg', 'video'])
    assert.deepEqual(e.inputs.map((i) => [i.id, i.type]), [['clip', 'video'], ['background', 'select'], ['seconds', 'slider']])
    const bg = e.inputs.find((i) => i.id === 'background')
    assert.deepEqual([bg.default, bg.options.map((o) => o.value)], ['green', ['green', 'white', 'black', 'blue']])
    const secs = e.inputs.find((i) => i.id === 'seconds')
    assert.deepEqual([secs.min, secs.max, secs.default], [1, 20, 10])
    assert.deepEqual(e.outputs.map((o) => o.label), ['Cutout', 'Matte'])
    assert.ok(e.models.length > 0)
    assert.equal(e.status.ready, false)
    assert.ok(e.status.missingNodes.includes('RemoveBackground'))
  })

  test('[mcp:effects_list] with fx names a model file ComfyUI lacks, and refuses an effect that is not offered', async () => {
    await withInfo({ ...effectInfo(['smooth']), FrameInterpolationModelLoader: combo('model_name', ['other_model.safetensors']) }, async () => {
      const e = await ok('effects_list', { fx: 'smooth' })
      assert.equal(e.status.ready, false)
      assert.deepEqual([e.status.missingNodes, e.status.missingModels], [[], ['film_net_fp16.safetensors']])
    })
    await fails('effects_list', { fx: 'reshoot' }, /fx/i)
    await fails('effects_list', { fx: 'nonsense' }, /fx/i)
  })

  // ---------- run_effect ----------
  test('[mcp:run_effect] uploads the clip, fills Remove background with the values given, saves under IV Studio\'s folder and returns the result files, main video first then the matte', async () => {
    await withInfo(effectInfo(['removebg']), async () => {
      savesEveryNode()
      const uploads = fake.uploads.length
      const queued = fake.prompts.length
      const r = await ok('run_effect', { fx: 'removebg', file: clip, values: { background: 'white', seconds: 5 } })
      assert.equal(fake.prompts.length, queued + 1)
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['walk.mp4', 'iv_studio/clipfx']])
      assert.equal(nodesOf('LoadVideo')[0][1].inputs.file, 'iv_studio/clipfx/walk.mp4')
      assert.equal(lastGraph()['2'].inputs.duration, 5)
      assert.equal(lastGraph()['8'].inputs.color, 16777215)
      const prefixes = nodesOf('SaveVideo').map(([, n]) => n.inputs.filename_prefix)
      assert.equal(prefixes.length, 2)
      assert.match(prefixes[0], /^iv_studio\/clipfx\/remove_background_walk_[0-9a-z]+$/)
      assert.equal(new Set(prefixes).size, 1)
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'clipfx:removebg')
      assert.deepEqual([r.fx, r.title], ['removebg', 'Remove background · walk'])
      assert.match(r.id, /^removebg_[0-9a-z]+$/)
      assert.deepEqual(r.files.map((f) => [f.label, f.kind]), [['Cutout', 'video'], ['Matte', 'video']])
      for (const f of r.files) {
        assert.equal(path.dirname(f.file), dataFile('clipfx'))
        assert.ok(fs.existsSync(f.file) && fs.statSync(f.file).size > 0)
      }
      assert.match(path.basename(r.files[1].file), /^remove_background_walk_[0-9a-z]+_matte\.mp4$/)
    })
  })

  test('[mcp:run_effect] uses the effect\'s own defaults for what it is not given (green, 10 seconds) and a name given becomes the title', async () => {
    await withInfo(effectInfo(['removebg']), async () => {
      savesEveryNode()
      const r = await ok('run_effect', { fx: 'removebg', file: clip, name: 'My cutout' })
      assert.equal(lastGraph()['8'].inputs.color, 45376)
      assert.equal(lastGraph()['2'].inputs.duration, 10)
      assert.equal(r.title, 'My cutout')
      assert.match(path.basename(r.files[0].file), /^my_cutout_[0-9a-z]+_cutout\.mp4$/)
    })
  })

  test('[mcp:run_effect] fills Smooth\'s frame multiplier and mode from the values, by their option value', async () => {
    await withInfo(effectInfo(['smooth']), async () => {
      savesEveryNode()
      const r = await ok('run_effect', { fx: 'smooth', file: clip, values: { factor: 4, mode: false } })
      assert.equal(lastGraph()['16:9'].inputs.value, 4)
      assert.equal(lastGraph()['16:13'].inputs.value, false)
      assert.deepEqual(r.files.map((f) => f.label), ['Video'])
    })
  })

  test('[mcp:run_effect] runs a picture effect: the chosen effect\'s LoRA and sentence, the size, length and seed, and the unload-first node when ComfyUI has it', async () => {
    await withInfo({ ...effectInfo(['effects']), IVFreeMemory: node() }, async () => {
      savesEveryNode()
      const r = await ok('run_effect', { fx: 'effects', file: still, values: { effect: 'laughing', subject: 'a young woman', aspect: 'square', frames: 49, seed: 11, strength: 0.8 } })
      const g = lastGraph()
      assert.equal(g.ff_effect.inputs.lora_name, 'laughing_15_epochs.safetensors')
      assert.equal(g.ff_effect.inputs.strength_model, 0.8)
      assert.match(g['6'].inputs.text, /a young woman/)
      assert.deepEqual([g['50'].inputs.width, g['50'].inputs.height, g['50'].inputs.length], [624, 624, 49])
      assert.equal(g['3'].inputs.seed, 11)
      assert.equal(g['52'].inputs.image, 'iv_studio/clipfx/fox.png')
      assert.ok(nodesOf('IVFreeMemory').length >= 1, 'the text encoder leaves the GPU before the video model loads')
      assert.equal(r.files.length, 1)
    })
    // the same effect on a ComfyUI without that node queues the plain graph
    await withInfo(effectInfo(['effects']), async () => {
      savesEveryNode()
      await ok('run_effect', { fx: 'effects', file: still, values: { seed: 3 } })
      assert.equal(nodesOf('IVFreeMemory').length, 0)
    })
  })

  test('[mcp:run_effect] Transition takes the first and the last picture, and queues without the prompt rewriter and its model', async () => {
    await withInfo(effectInfo(['transitions']), async () => {
      savesEveryNode()
      const uploads = fake.uploads.length
      const r = await ok('run_effect', { fx: 'transitions', file: still, last: still2, values: { prompt: 'the fox turns to smoke', duration: 4, seed: 5 } })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => u.name), ['fox.png', 'fox_end.png'])
      const g = lastGraph()
      assert.equal(g['31'].inputs.image, 'iv_studio/clipfx/fox.png')
      assert.equal(g['39'].inputs.image, 'iv_studio/clipfx/fox_end.png')
      assert.equal(g['251:198'].inputs.value, 4)
      assert.equal(g['251:196'].inputs.noise_seed, 5)
      assert.equal(nodesOf('TextGenerateLTX2Prompt').length, 0)
      assert.equal(nodesOf('ComfySwitchNode').length, 0)
      assert.ok(Object.values(g).some((n) => n.inputs?.value === 'the fox turns to smoke'), 'the person\'s words are the prompt, as written')
      assert.equal(r.files.length, 1)
    })
  })

  test('[mcp:run_effect] says what is wrong and queues nothing: no file, a missing last frame, a value outside the effect\'s choices or limits', async () => {
    await withInfo(effectInfo(['removebg', 'effects', 'transitions']), async () => {
      const queued = fake.prompts.length
      await fails('run_effect', { fx: 'removebg', file: path.join(dir, 'gone.mp4') }, /^Pick a clip\.$/)
      await fails('run_effect', { fx: 'effects', file: path.join(dir, 'gone.png') }, /^Pick a picture\.$/)
      await fails('run_effect', { fx: 'transitions', file: still }, /^Transition needs a .* too\.$/)
      await fails('run_effect', { fx: 'transitions', file: still, last: path.join(dir, 'gone.png') }, /^Transition needs a .* too\.$/)
      await fails('run_effect', { fx: 'removebg', file: clip, values: { background: 'purple' } }, /^Background is one of: .*green.*white.*black.*\.$/i)
      await fails('run_effect', { fx: 'removebg', file: clip, values: { seconds: 50 } }, /^.* is 1 to 20\.$/)
      await fails('run_effect', { fx: 'reshoot', file: clip }, /fx/i)
      assert.equal(fake.prompts.length, queued)
    })
  })

  test('[mcp:run_effect] names the missing node packs, or the missing model file, and queues nothing', async () => {
    const queued = fake.prompts.length
    await fails('run_effect', { fx: 'removebg', file: clip }, /^Remove background needs ComfyUI nodes this one doesn’t have \(.*LoadVideo.*\)\. Install missing node packs on Setup, then restart ComfyUI\.$/)
    await withInfo({ ...effectInfo(['smooth']), FrameInterpolationModelLoader: combo('model_name', ['other_model.safetensors']) }, () => fails('run_effect', { fx: 'smooth', file: clip }, /^Smooth or slow motion needs film_net_fp16\.safetensors\. Download on Setup\.$/))
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:run_effect] reports ComfyUI\'s error and says when the effect saved nothing, and both are kept in the run list', async () => {
    await withInfo(effectInfo(['smooth']), async () => {
      fake.failNextPrompt('CUDA out of memory (fake)')
      await fails('run_effect', { fx: 'smooth', file: clip, name: 'Fails' }, /CUDA out of memory \(fake\)/)
      fake.setOutputs(() => ({}))
      await fails('run_effect', { fx: 'smooth', file: clip, name: 'Empty' }, /^Smooth or slow motion finished but saved nothing\.$/)
      const runs = (await ok('list_effect_runs')).items
      assert.equal(runs.find((r) => r.title === 'Fails').status, 'error')
      assert.match(runs.find((r) => r.title === 'Fails').error, /out of memory/)
    })
  })

  // ---------- list_effect_runs ----------
  test('[mcp:list_effect_runs] lists the runs newest first with effect, source, values, status and result files', async () => {
    await withInfo(effectInfo(['smooth']), async () => {
      savesEveryNode()
      await new Promise((r) => setTimeout(r, 5))
      const made = await ok('run_effect', { fx: 'smooth', file: clip, values: { factor: 3 }, name: 'Latest run' })
      const { items } = await ok('list_effect_runs')
      assert.equal(items[0].id, made.id)
      assert.deepEqual([items[0].fx, items[0].label, items[0].title, items[0].from, items[0].values, items[0].status], ['smooth', 'Smooth or slow motion', 'Latest run', clip, { factor: 3 }, 'success'])
      assert.deepEqual(items[0].files.map((f) => f.file), made.files.map((f) => f.file))
      assert.ok(items[0].finishedAt && items[0].jobId)
      assert.ok(items.length >= 2, 'the earlier runs are still listed')
      assert.deepEqual(items.map((r) => r.createdAt), [...items.map((r) => r.createdAt)].sort().reverse())
      assert.equal(readData('clipfx', 'runs.json')[0].id, made.id)
    })
  })
})

describe('MCP picture tools', () => {
  let fake, mcp, dir, pic, wide, mask
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const lastGraph = () => fake.prompts.at(-1).prompt
  const byClass = (cls) => Object.values(lastGraph()).find((n) => n.class_type === cls)
  const FLUX3 = 'Flux3/flux3_image_klein_9b.safetensors'
  const MODELS = {
    UNETLoader: combo('unet_name', [FLUX3, 'qwen_image_edit_2509_fp8_e4m3fn.safetensors']),
    CLIPLoader: node({ clip_name: [['qwen3vl_4b_int8_convrot.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors']], type: [['flux3', 'qwen_image']] }),
    VAELoader: combo('vae_name', ['flux2-vae.safetensors', 'qwen_image_vae.safetensors']),
    LoraLoaderModelOnly: combo('lora_name', ['Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors', 'Qwen-Image-Edit-2509-Relight.safetensors']),
    LoadBackgroundRemovalModel: combo('bg_removal_name', ['birefnet.safetensors']),
    LoadMoGeModel: combo('model_name', ['moge_2_vitl_normal_fp16.safetensors']),
    SeedVR2LoadDiTModel: combo('model', ['seedvr2_ema_3b_fp16.safetensors'])
  }
  const NODES = ['ReferenceMultiLatent', 'TextEncodeQwenImageEditPlus', 'RemoveBackground', 'MoGeInference', 'MoGeRender', 'SeedVR2VideoUpscaler']
  const everything = () => ({ ...MODELS, ...Object.fromEntries(NODES.map((n) => [n, node()])) })
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
    }
  }
  const toolOf = async (id) => (await ok('picture_tools_status')).tools.find((t) => t.id === id)

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    pic = path.join(dir, 'fox.png')
    wide = path.join(dir, 'wide.png')
    mask = path.join(dir, 'mask.png')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', pic)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=3000x100', '-frames:v', '1', wide)
    ff('-f', 'lavfi', '-i', 'color=c=white:s=64x64', '-frames:v', '1', mask)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- picture_tools_status ----------
  test('[mcp:picture_tools_status] lists the five tools, none ready on a bare ComfyUI, with what each is missing and the relight presets and depth outputs', async () => {
    const s = await ok('picture_tools_status')
    assert.deepEqual(s.tools.map((t) => [t.id, t.ready]), [['inpaint', false], ['relight', false], ['removebg', false], ['upscale', false], ['depth', false]])
    assert.deepEqual((await toolOf('relight')).missing.map((m) => m.id), ['relight_unet', 'relight_te', 'relight_vae', 'relight_lightning', 'relight_lora'])
    assert.deepEqual((await toolOf('removebg')).missing.map((m) => m.id), ['birefnet'])
    assert.deepEqual((await toolOf('depth')).missing.map((m) => m.id), ['moge'])
    // this fake is an Apple GPU, where SeedVR2 (the upscale tool) can't run: it says so instead of what it lacks
    assert.match((await toolOf('upscale')).note, /SeedVR2 isn't available on an Apple GPU yet/)
    assert.match((await toolOf('inpaint')).note, /Needs Flux 3 Klein/)
    assert.deepEqual(s.depthOutputs.map(([v]) => v), ['depth_colored', 'depth', 'normal_opengl', 'normal_directx'])
    assert.equal(s.relight.light[0][1], 'Golden hour')
    assert.deepEqual(s.relight.direction[0], ['', 'Any'])
  })

  test('[mcp:picture_tools_status] marks each tool ready once its models and nodes are there, and gives the files it will use', async () => {
    await withInfo(everything(), async () => {
      const s = await ok('picture_tools_status')
      assert.deepEqual(s.tools.map((t) => [t.id, t.ready]), [['inpaint', true], ['relight', true], ['removebg', true], ['upscale', false], ['depth', true]])
      assert.equal(s.files.birefnet, 'birefnet.safetensors')
      assert.equal(s.files.moge, 'moge_2_vitl_normal_fp16.safetensors')
      assert.equal(s.files.dit, 'seedvr2_ema_3b_fp16.safetensors')
      assert.equal(s.files.relight_lora, 'Qwen-Image-Edit-2509-Relight.safetensors')
      assert.equal(s.flux3.unet, FLUX3)
    })
  })

  // ---------- picture_tool ----------
  test('[mcp:picture_tool] removebg: uploads the picture, queues BiRefNet with the matte inverted onto the alpha, and records the result in the picture gallery', async () => {
    await withInfo(everything(), async () => {
      const uploads = fake.uploads.length
      const set = await ok('picture_tool', { tool: 'removebg', image: pic })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['fox.png', 'iv_studio/images']])
      assert.equal(byClass('LoadImage').inputs.image, 'iv_studio/images/fox.png')
      assert.equal(byClass('LoadBackgroundRemovalModel').inputs.bg_removal_name, 'birefnet.safetensors')
      assert.ok(byClass('RemoveBackground') && byClass('InvertMask') && byClass('JoinImageWithAlpha'))
      assert.match(byClass('SaveImage').inputs.filename_prefix, new RegExp(`^iv_studio/images/remove_background_fox_${set.id}$`))
      assert.deepEqual([set.mode, set.tool, set.family, set.familyLabel, set.name, set.status, set.refs], ['tool', 'removebg', 'tool-removebg', 'Remove background', 'Remove background · fox', 'queued', [pic]])
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'picture:tool-removebg')
      assert.equal(readData('projects', `${set.projectId}.json`).name, 'Image · Remove background · fox')
      assert.equal(readData('images', 'images.json')[0].id, set.id)
      // and it follows like any picture set
      const saved = path.join(dir, 'cutout.png')
      ff('-f', 'lavfi', '-i', 'color=c=green:s=64x64', '-frames:v', '1', saved)
      fake.state.history[fake.prompts.at(-1).id].outputs = { 6: { images: [{ filename: 'cutout.png', subfolder: 'iv_studio/images', type: 'output', fullpath: saved }] } }
      const done = await ok('get_image', { imageId: set.id })
      assert.equal(done.status, 'success')
      assert.deepEqual(done.files, [dataFile('images', `remove_background_fox_${set.id}_1.png`)])
    })
  })

  test('[mcp:picture_tool] depth: asks MoGe-2 for the chosen output, and scales a picture over 2048 px down first, never up', async () => {
    await withInfo(everything(), async () => {
      await ok('picture_tool', { tool: 'depth', image: pic, output: 'normal_opengl' })
      assert.equal(byClass('MoGeRender').inputs.output, 'normal_opengl')
      assert.equal(byClass('LoadMoGeModel').inputs.model_name, 'moge_2_vitl_normal_fp16.safetensors')
      assert.equal(byClass('ImageScaleToMaxDimension'), undefined)
      await ok('picture_tool', { tool: 'depth', image: wide })
      assert.equal(byClass('MoGeRender').inputs.output, 'depth_colored')
      assert.equal(byClass('ImageScaleToMaxDimension').inputs.largest_size, 2048)
    })
  })

  test('[mcp:picture_tool] relight: writes the Relight LoRA\'s sentence from the preset words and the optional controls, with the seed', async () => {
    await withInfo(everything(), async () => {
      const set = await ok('picture_tool', { tool: 'relight', image: pic, light: 'neon night lighting, magenta and cyan rim light, dark moody background', direction: ', the light coming from the left', brightness: ', dim and low-key', details: 'Keep the fur orange.', seed: 21 })
      const texts = Object.values(lastGraph()).filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus').map((n) => n.inputs.prompt)
      assert.deepEqual(texts, ['重新照明, relight the image using neon night lighting, magenta and cyan rim light, dark moody background, the light coming from the left, dim and low-key. Keep the fur orange.', ''])
      assert.equal(byClass('KSampler').inputs.seed, 21)
      assert.equal(byClass('UNETLoader').inputs.unet_name, 'qwen_image_edit_2509_fp8_e4m3fn.safetensors')
      assert.deepEqual(Object.values(lastGraph()).filter((n) => n.class_type === 'LoraLoaderModelOnly').map((n) => n.inputs.lora_name), ['Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors', 'Qwen-Image-Edit-2509-Relight.safetensors'])
      assert.equal(set.seed, 21)
      assert.match(set.prompt, /^重新照明, relight the image using neon night lighting/)
      // with no light named, the first preset (golden hour) is used
      await ok('picture_tool', { tool: 'relight', image: pic })
      assert.match(Object.values(lastGraph()).find((n) => n.class_type === 'TextEncodeQwenImageEditPlus').inputs.prompt, /^重新照明, relight the image using golden hour sunlight/)
    })
  })

  test('[mcp:picture_tool] inpaint: uploads the picture and its mask and has Flux 3 Klein redraw only the painted part', async () => {
    await withInfo(everything(), async () => {
      const uploads = fake.uploads.length
      const set = await ok('picture_tool', { tool: 'inpaint', image: pic, mask, prompt: 'a red scarf', seed: 4 })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => u.name), ['fox.png', 'mask.png'])
      const images = Object.values(lastGraph()).filter((n) => n.class_type === 'LoadImage').map((n) => n.inputs.image)
      assert.deepEqual(images, ['iv_studio/images/fox.png', 'iv_studio/images/mask.png'])
      assert.equal(byClass('UNETLoader').inputs.unet_name, FLUX3)
      assert.equal(byClass('CLIPTextEncode').inputs.text, 'a red scarf')
      assert.equal(byClass('KSampler').inputs.seed, 4)
      assert.ok(byClass('SetLatentNoiseMask') && byClass('ImageCompositeMasked'))
      assert.deepEqual([set.mask, set.prompt], [mask, 'a red scarf'])
    })
  })

  test('[mcp:picture_tool] upscale: asks SeedVR2 for the 2x or 4x size, from the short side, on a ComfyUI with a CUDA card', async () => {
    const cuda = await startFakeComfy({ devices: 'cuda', os: 'linux' })
    const cudaMcp = await startMcp({ comfyUrl: cuda.url })
    try {
      cuda.setObjectInfo(everything())
      const call2 = (args) => cudaMcp.client.callTool({ name: 'picture_tool', arguments: args })
      let r = await call2({ tool: 'upscale', image: pic })
      assert.ok(!r.isError, JSON.stringify(r.content))
      const g = () => cuda.prompts.at(-1).prompt
      const up = () => Object.values(g()).find((n) => n.class_type === 'SeedVR2VideoUpscaler')
      assert.equal(up().inputs.resolution, 128, '2x of a 64 px short side')
      assert.equal(Object.values(g()).find((n) => n.class_type === 'SeedVR2LoadDiTModel').inputs.model, 'seedvr2_ema_3b_fp16.safetensors')
      assert.equal(r.structuredContent.request.scale, 2)
      r = await call2({ tool: 'upscale', image: pic, scale: 4 })
      assert.equal(up().inputs.resolution, 256)
      r = await call2({ tool: 'upscale', image: wide, scale: 4 })
      assert.equal(up().inputs.resolution, 400, '4x of a 100 px short side')
      assert.equal(Object.values(g()).find((n) => n.class_type === 'SeedVR2LoadDiTModel').inputs.device, 'cuda:0')
      // what it can't do, on a CUDA card: a scale other than 2 or 4, and no SeedVR2 node pack
      const queued = cuda.prompts.length
      r = await call2({ tool: 'upscale', image: pic, scale: 3 })
      assert.ok(r.isError && /scale/i.test(r.content[0].text), JSON.stringify(r.content))
      cuda.setObjectInfo({})
      r = await call2({ tool: 'upscale', image: pic })
      assert.match(r.content[0].text, /^Needs the SeedVR2 node pack: Install missing node packs on Setup\.$/)
      assert.equal(cuda.prompts.length, queued)
    } finally {
      await cudaMcp.close()
      await cuda.close()
    }
  })

  // SeedVR2 runs on CUDA only (gpu.js seedvr2Refusal): the upscale tool is refused on an Apple GPU, as Enhance is
  test('[mcp:picture_tool] upscale on an Apple GPU is refused in the same words as Enhance, and queues nothing', async () => {
    await withInfo(everything(), async () => {
      const queued = fake.prompts.length
      await fails('picture_tool', { tool: 'upscale', image: pic }, /SeedVR2 isn't available on an Apple GPU yet/)
      assert.equal(fake.prompts.length, queued)
    })
  })

  test('[mcp:picture_tool] says what is wrong and queues nothing: no picture, a tool that is not ready, no words or mask for an inpaint, an output it does not make', async () => {
    const queued = fake.prompts.length
    await fails('picture_tool', { tool: 'removebg', image: path.join(dir, 'gone.png') }, /^Pick the picture first\.$/)
    await fails('picture_tool', { tool: 'removebg', image: pic }, /^Remove background needs BiRefNet \(background removal\)\. Download on Setup\.$/)
    await fails('picture_tool', { tool: 'sharpen', image: pic }, /tool/i)
    await withInfo(everything(), async () => {
      await fails('picture_tool', { tool: 'inpaint', image: pic, mask }, /^Say what the painted part should become\.$/)
      await fails('picture_tool', { tool: 'inpaint', image: pic, prompt: 'a scarf' }, /^Paint over the part to change first\.$/)
      await fails('picture_tool', { tool: 'inpaint', image: pic, prompt: 'a scarf', mask: path.join(dir, 'gone.png') }, /^Paint over the part to change first\.$/)
      await fails('picture_tool', { tool: 'depth', image: pic, output: 'bump' }, /output/i)
    })
    assert.equal(fake.prompts.length, queued)
  })
})

describe('MCP turnaround tools', () => {
  let fake, mcp, dir, face
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const lastGraph = () => fake.prompts.at(-1).prompt
  const READY = { H3ContactSheet: node(), H3ContactSheetDecode: node(), LoraLoaderModelOnly: combo('lora_name', [`MiniMax H3/Recommended/${TURNAROUND_LORA.match}`]) }
  // ComfyUI saved five views and a strip
  const savesViews = (count = 5) =>
    fake.setOutputs((prompt, id) => {
      const mk = (name) => {
        const f = path.join(dir, `${id}_${name}.png`)
        ff('-f', 'lavfi', '-i', 'color=c=gray:s=32x32', '-frames:v', '1', f)
        return { filename: path.basename(f), subfolder: 'iv_studio/turnaround', type: 'output', fullpath: f }
      }
      return { s1views: { images: Array.from({ length: count }, (_, i) => mk(`view_${i + 1}`)) }, s2strip: { images: [mk('strip')] } }
    })
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
      fake.setOutputs(null)
    }
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    face = path.join(dir, 'face.png')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  test('[mcp:turnaround_status] says what is missing on a bare ComfyUI (the contact-sheet nodes and the LoRA), and that no sheet has been made', async () => {
    const s = await ok('turnaround_status')
    assert.deepEqual([s.nodes, s.lora, s.ready, s.lora_id, s.sheets], [false, null, false, 'rec-turnaround', []])
    assert.equal(s.size, TURNAROUND_LORA.size)
  })

  test('[mcp:turnaround_status] is ready when both nodes are there and the LoRA is listed, and gives the LoRA as ComfyUI lists it', async () => {
    await withInfo(READY, async () => {
      const s = await ok('turnaround_status')
      assert.deepEqual([s.nodes, s.lora, s.ready], [true, `MiniMax H3/Recommended/${TURNAROUND_LORA.match}`, true])
    })
    await withInfo({ H3ContactSheet: node(), LoraLoaderModelOnly: READY.LoraLoaderModelOnly }, async () => {
      const s = await ok('turnaround_status')
      assert.deepEqual([s.nodes, s.ready], [false, false], 'both contact-sheet nodes are needed')
    })
  })

  test('[mcp:make_turnaround] queues the five-view graph (H3 with the LoRA at 1.3, 512 px) from a picture, waits, and returns five views and a strip kept in the data folder', async () => {
    await withInfo(READY, async () => {
      savesViews()
      const uploads = fake.uploads.length
      const queued = fake.prompts.length
      const sheet = await ok('make_turnaround', { picture: face, seed: 99 })
      assert.equal(fake.prompts.length, queued + 1)
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['face.png', 'iv_studio/turnaround']])
      const g = lastGraph()
      assert.equal(g.ref.inputs.image, 'iv_studio/turnaround/face.png')
      assert.deepEqual([g.unet.inputs.unet_name, g.clip.inputs.type], ['minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'minimax'])
      assert.deepEqual([g.lora.inputs.lora_name, g.lora.inputs.strength_model], [`MiniMax H3/Recommended/${TURNAROUND_LORA.match}`, 1.3])
      assert.deepEqual([g.sheet.inputs.size, g.noise.inputs.noise_seed, g.sigmas.inputs.steps, g.sampler.inputs.sampler_name], [512, 99, 28, 'res_multistep'])
      assert.equal(g.sheet.inputs.prompt, 'the camera orbits the subject of <Picture 1> ninety degrees clockwise')
      assert.match(g.s1views.inputs.filename_prefix, /^iv_studio\/turnaround\/ta[0-9a-z]+_view$/)
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'turnaround')
      assert.match(sheet.id, /^ta[0-9a-z]+$/)
      assert.deepEqual([sheet.characterId, sheet.name, sheet.size, sheet.seed, sheet.strength, sheet.ref], [null, 'face.png', 512, 99, 1.3, face])
      assert.equal(sheet.views.length, 5)
      assert.match(path.basename(sheet.strip), /_strip\.png$/)
      for (const f of [...sheet.views, sheet.strip]) {
        assert.equal(path.dirname(f), dataFile('turnarounds', sheet.id))
        assert.ok(fs.existsSync(f))
      }
      assert.deepEqual(JSON.parse(fs.readFileSync(dataFile('turnarounds', sheet.id, 'sheet.json'), 'utf8')).views, sheet.views)
    })
  })

  test('[mcp:make_turnaround] takes a character\'s own face picture, and size and strength as given', async () => {
    await withInfo(READY, async () => {
      savesViews()
      const uploads = fake.uploads.length
      const sheet = await ok('make_turnaround', { characterId: 'tess', size: 768, strength: 1.5, seed: 1 })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => u.name), ['tess.jpg'])
      assert.deepEqual([sheet.characterId, sheet.name, sheet.size, sheet.strength], ['tess', 'Tess Marlow', 768, 1.5])
      assert.deepEqual([lastGraph().sheet.inputs.size, lastGraph().lora.inputs.strength_model], [768, 1.5])
      assert.equal(fake.state.history[fake.prompts.at(-1).id] !== undefined, true)
      // without a seed each sheet rolls a new one
      const a = await ok('make_turnaround', { picture: face })
      const b = await ok('make_turnaround', { picture: face })
      assert.notEqual(a.seed, b.seed)
    })
  })

  test('[mcp:make_turnaround] says what is wrong and queues nothing: no character or picture, a size not offered, a strength out of range, missing nodes or LoRA', async () => {
    const queued = fake.prompts.length
    await withInfo(READY, async () => {
      await fails('make_turnaround', {}, /^Pick a picture of the character\.$/)
      await fails('make_turnaround', { picture: path.join(dir, 'gone.png') }, /^Pick a picture of the character\.$/)
      await fails('make_turnaround', { characterId: 'nobody' }, /^No such character\.$/)
      await fails('make_turnaround', { picture: face, size: 640 }, /^Size is 512, 768, 1024 pixels a view\.$/)
      await fails('make_turnaround', { picture: face, strength: 2 }, /strength/i)
      await fails('make_turnaround', { picture: face, strength: 0.2 }, /strength/i)
    })
    await fails('make_turnaround', { picture: face }, /^Turnaround sheets need the H3 Contact Sheet node pack\. Install it from Settings → Setup, then restart ComfyUI\.$/)
    await withInfo({ H3ContactSheet: node(), H3ContactSheetDecode: node() }, () => fails('make_turnaround', { picture: face }, /^Turnaround sheets need the Turnaround LoRA \(63 MB\)\. Download it from LoRAs → Recommended\.$/))
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:make_turnaround] reports ComfyUI\'s error, and a sheet that came back short of five views', async () => {
    await withInfo(READY, async () => {
      fake.failNextPrompt('Contact sheet could not pack the views (fake)')
      await fails('make_turnaround', { picture: face }, /Contact sheet could not pack the views \(fake\)/)
      savesViews(3)
      await fails('make_turnaround', { picture: face }, /^The sheet came back with 3 views instead of 5\.$/)
    })
  })

  test('[mcp:turnaround_status] lists the sheets made, newest first, and only a character\'s own when characterId is given', async () => {
    await withInfo(READY, async () => {
      const all = await ok('turnaround_status')
      assert.ok(all.sheets.length >= 4)
      assert.deepEqual(all.sheets.map((s) => s.at), [...all.sheets.map((s) => s.at)].sort().reverse())
      const tess = await ok('turnaround_status', { characterId: 'tess' })
      assert.equal(tess.sheets.length, 1)
      assert.equal(tess.sheets[0].characterId, 'tess')
      assert.deepEqual((await ok('turnaround_status', { characterId: 'nobody' })).sheets, [])
    })
  })
})
