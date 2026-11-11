// Seedance 2.5 as IV Studio's second engine (src/service/seedance.js, seedlint.js): plans for the four modes, the
// order references are attached in, the role lines written for a character's face and a voice line, graphs that
// ComfyUI 0.44.1's own node definitions accept, prices, the checker, reading takes back, and @ mentions.
// No ComfyUI, no network, no spend.   node test/seedance.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { finalGraph, graphProblems, NODES, planSeedance, seedanceGraph, seedanceMentions, sizeOf, takesFrom } from '../src/service/seedance.js'
import { lintSeedance, toSeedanceTags } from '../src/service/seedlint.js'
import { priceGraph } from '../src/service/pricing.js'
import { fillDefaults, missingInputs } from '../src/service/nodeschema.js'
import { h3Frames, refineGraph } from '../src/service/h3refine.js'
import { dlssLook } from '../src/service/studio.js'

const info = JSON.parse(fs.readFileSync(new URL('./fixtures/partner-info.json', import.meta.url)))
let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.0005, `${a} is not ${b}`)
const tess = { id: 'tess', name: 'Tess Marlow' }
const staged = (plan) => ({ pictures: plan.refs.pictures.map((f) => f.split('/').pop()), videos: plan.refs.videos.map((f) => f.split('/').pop()), audios: plan.refs.audios.map((f) => f.split('/').pop()) })
const build = (req, opts = {}) => {
  const plan = planSeedance(req, [tess], opts)
  return { plan, graph: seedanceGraph(plan, staged(plan), info, 'test') }
}

await ok('text, no references: the text node, one take per preview, each saved with its draft task id', async () => {
  const { plan, graph } = build({ mode: 'text', prompt: 'A fox in the snow, slow push in.', tier: 'draft', previews: 2, seconds: 5 })
  assert.equal(plan.node.cls, NODES.text)
  assert.deepEqual(Object.keys(graph), ['take1', 'save1', 'tid1', 'take2', 'save2', 'tid2'])
  assert.equal(graph.take1.inputs.model, 'Seedance 2.5 Draft')
  assert.equal(graph.take1.inputs['model.resolution'], '480p')
  assert.equal(graph.take1.inputs['model.ratio'], '16:9')
  assert.equal(graph.take2.inputs.seed, 5242)
  assert.deepEqual(graphProblems(graph, info), [])
  near((await priceGraph(graph, info)).max, 2 * (Math.floor(400.3125 * 121) / 1000) * 0.015301)
})

await ok('text with a character: their face becomes @image1 with a role line, on the reference node; {char} is their name', async () => {
  const { plan, graph } = build({ mode: 'text', prompt: '{char} waves.', character: 'tess', tier: '720p', previews: 1, seconds: 6 }, { face: 'C:/faces/tess.png' })
  assert.equal(plan.node.cls, NODES.reference)
  assert.equal(plan.node.task, 'reference')
  assert.equal(plan.refs.faceTag, '@image1')
  assert.equal(graph.take1.inputs['model.prompt'], "@image1 defines Tess's face, hair and build. Do not use the image background.\n\nTess waves.")
  assert.deepEqual(graph.take1.inputs['model.reference_images.image_1'], ['img1', 0])
  assert.equal(graph.tid1, undefined, '720p takes are finals: no draft task id')
  assert.deepEqual(graphProblems(graph, info), [])
})

await ok('references: the person\'s own first, then the face, then the voice line; named roles are not repeated', async () => {
  const { plan, graph } = build({ mode: 'reference', prompt: '@image1 is the kitchen. @image2 defines Tess. @audio2 is her voice.', character: 'tess', voiceLine: 'C:/v/line.wav', media: [{ kind: 'picture', file: 'C:/x/kitchen.png' }, { kind: 'audio', file: 'C:/x/rain.wav' }], tier: 'draft', previews: 1, seconds: 8 }, { face: 'C:/faces/tess.png' })
  assert.deepEqual(plan.refs.pictures, ['C:/x/kitchen.png', 'C:/faces/tess.png'])
  assert.deepEqual(plan.refs.audios, ['C:/x/rain.wav', 'C:/v/line.wav'])
  assert.ok(graph.take1.inputs['model.prompt'].startsWith('@image1 is the kitchen.'), 'roles already named: nothing added')
  assert.deepEqual(graph.take1.inputs['model.reference_audios.audio_2'], ['aud2', 0])
  assert.deepEqual(graphProblems(graph, info), [])
})

await ok('frames: first and last frame on the first/last node, no ratio; the character is only named', async () => {
  const { plan, graph } = build({ mode: 'frames', prompt: 'The input images are the first and last frames: @image1 … @image2.', character: 'tess', media: [{ kind: 'picture', file: 'C:/a.png' }, { kind: 'picture', file: 'C:/b.png' }], tier: 'draft', previews: 3, seconds: 6 }, { face: 'C:/faces/tess.png' })
  assert.equal(plan.node.cls, NODES.frames)
  assert.equal(plan.refs.pictures.length, 2)
  assert.deepEqual(graph.take1.inputs.first_frame, ['img1', 0])
  assert.deepEqual(graph.take1.inputs.last_frame, ['img2', 0])
  assert.equal(graph.take1.inputs['model.ratio'], undefined)
  assert.match(plan.notes.join(' '), /only named/)
  assert.deepEqual(graphProblems(graph, info), [])
})

await ok('continue: the reference node set to extend, one take, the clip as @video1', async () => {
  const { plan, graph } = build({ mode: 'continue', prompt: 'Extend @video1 forward: she walks off.', media: [{ kind: 'video', file: 'C:/v.mp4' }], tier: '1080p', previews: 3, seconds: 5 })
  assert.equal(plan.node.task, 'extend')
  assert.equal(plan.resolved.previews, 1)
  assert.equal(graph.take1.inputs['model.task_type'], 'extend')
  assert.deepEqual(graph.take1.inputs['model.reference_videos.video_1'], ['vid1', 0])
  assert.deepEqual(graphProblems(graph, info), [])
})

await ok('the rules: length 4-30, the six ratios, frames needs a picture, references need something, limits', async () => {
  assert.throws(() => planSeedance({ prompt: 'x', seconds: 3 }), /4 to 30 seconds/)
  assert.throws(() => planSeedance({ prompt: 'x', seconds: 31 }), /4 to 30 seconds/)
  assert.throws(() => planSeedance({ prompt: 'x', aspect: '3:2' }), /Seedance makes/)
  assert.throws(() => planSeedance({ prompt: 'x', mode: 'frames' }), /1 picture/)
  assert.throws(() => planSeedance({ prompt: 'x', mode: 'reference' }), /at least one/)
  assert.throws(() => planSeedance({ prompt: 'x', mode: 'continue' }), /exactly one source video/)
  assert.throws(() => planSeedance({ prompt: 'x', mode: 'reference', media: Array.from({ length: 31 }, (_, i) => ({ kind: 'picture', file: `C:/${i}.png` })) }), /at most 30/)
  assert.throws(() => planSeedance({ prompt: '' }), /prompt is required/)
  assert.equal(planSeedance({ prompt: 'x', seconds: 7.4 }).resolved.seconds, 7)
})

await ok('sizes: 480p 16:9 is 854x480, 1080p 9:16 is 1080x1920', async () => {
  assert.deepEqual(sizeOf(480, '16:9'), { width: 854, height: 480 })
  assert.deepEqual(sizeOf(1080, '9:16'), { width: 1080, height: 1920 })
  assert.deepEqual(sizeOf(720, '1:1'), { width: 720, height: 720 })
})

await ok('Draft to Final: from the task id, priced as ComfyUI prices it', async () => {
  const g = finalGraph('task-123', info, 'x')
  assert.equal(g.final.inputs.draft_task_id, 'task-123')
  assert.deepEqual(graphProblems(g, info), [])
  const p = await priceGraph(g, info)
  near(p.min, 3.2864)
  near(p.max, 29.3964)
})

await ok('reading takes back: SaveVideo under images or videos, the task id from PreviewAny', async () => {
  const takes = takesFrom({ save1: { images: [{ filename: 'a_take1_00001_.mp4', subfolder: 'IV Studio/seedance', type: 'output' }] }, tid1: { text: ['  cgt-2026-abc  '] }, save2: { videos: [{ filename: 'a_take2.mp4' }] } }, 3)
  assert.equal(takes.length, 2)
  assert.equal(takes[0].draftTaskId, 'cgt-2026-abc')
  assert.equal(takes[1].candidate, 2)
  assert.equal(takes[1].draftTaskId, null)
})

await ok('checker: H3 tags are refused with a fix; unnamed and missing references; late timestamps; extend words', async () => {
  const refs = { pictures: [1, 2], videos: [], audios: [1] }
  const h3 = lintSeedance('In the room from <Picture 1>, she says <d>[English] Hi there.</d> and @image2 smiles.', { refs })
  assert.equal(h3[0].code, 'h3-tags')
  assert.equal(h3[0].fix, 'In the room from @image1, she says "Hi there." and @image2 smiles.')
  const codes = lintSeedance('@image1 is the room. @image3 is a dog. 0-3 seconds: walk. 3-9 seconds: sit.', { seconds: 6, refs }).map((f) => f.code)
  assert.ok(codes.includes('ref-missing') && codes.includes('ref-unused') && codes.includes('time-late'))
  assert.ok(lintSeedance('She walks off down the road into the rain, the camera following slowly behind her.', { mode: 'continue', refs: { videos: [1] } }).some((f) => f.code === 'extend-word'))
  assert.deepEqual(lintSeedance('@image1 defines Tess. She waves at the camera from a rainy bus stop at night, smiling.', { refs: { pictures: [1] } }), [])
  assert.equal(toSeedanceTags('<Video 2> and <Audio 1>'), '@video2 and @audio1')
  // a face IV Studio names itself isn't flagged
  assert.deepEqual(lintSeedance('Tess waits at a rainy bus stop at night and checks her phone, then sighs.', { refs: { pictures: [1] }, auto: ['@image1'] }), [])
})

await ok('@ mentions: a pictured member becomes the next @image with a role line; Seedance tags are not mentions', async () => {
  const members = [
    { handle: 'BusStop', kind: 'place', name: 'Bus stop', picture: 'C:/p/bus.png' },
    { handle: 'Theo', kind: 'character', id: 'theo', name: 'Theo Lindqvist', picture: 'C:/p/theo.png' },
    { handle: 'Ghost', kind: 'character', id: 'ghost', name: 'Ghost', picture: null }
  ]
  const { request, notes } = seedanceMentions({ mode: 'text', prompt: '@Theo waits at @BusStop. @image1 stays. @Ghost hides.', media: [] }, members)
  assert.equal(request.mode, 'reference')
  assert.equal(request.media.length, 2)
  assert.match(request.prompt, /^@image1 defines Theo's face, hair and build\. Do not use the image background\.\n@image2 defines the place: Bus stop\./)
  assert.match(request.prompt, /Theo waits at Bus stop\. @image1 stays\. Ghost hides\./)
  assert.deepEqual(notes, [])
  assert.match(seedanceMentions({ prompt: '@Nobody' }, members).notes[0].message, /isn't in your cast/)
})

await ok('nodeschema: defaults follow the dynamic combo picked, and missing inputs are named', async () => {
  const filled = fillDefaults(info.ByteDance2TextToVideoNode, { model: 'Seedance 2.0 Fast' })
  assert.equal(filled['model.resolution'], '480p')
  assert.equal(filled.watermark, false)
  assert.ok(missingInputs(info.ByteDance2TextToVideoNode, { model: 'Seedance 2.5' }).includes('model.prompt'))
  assert.deepEqual(missingInputs(info.SaveVideo, fillDefaults(info.SaveVideo, { video: ['1', 0], format: 'mp4' })), [])
})

await ok('the free H3 finish: 121 frames pad to 124 and trim back, the 480p draft encodes at 864x480, sound kept or silenced', async () => {
  assert.equal(h3Frames(121), 124)
  assert.equal(h3Frames(124), 124)
  assert.equal(h3Frames(97), 107)
  const template = JSON.parse(fs.readFileSync(new URL('../resources/workflows/iv_studio_api.json', import.meta.url)))
  const { graph, resolved } = refineGraph(template, { source: { path: 'C:/t.mp4', width: 854, height: 480, frames: 121 }, prompt: '{char} waves', character: { name: 'Tess Marlow', lora: 'MiniMax H3/tess/t.safetensors' }, trigger: 't3ss4', name: 'x', denoise: 0.1 })
  assert.deepEqual([resolved.encodeWidth, resolved.encodeHeight, resolved.padded, resolved.width, resolved.height], [864, 480, 124, 1952, 1088])
  assert.equal(graph.tail.inputs.num_frames, 3)
  assert.equal(graph.trim.inputs.num_frames, 121)
  assert.equal(graph.sigmas.inputs.denoise, 0.1)
  assert.equal(graph.cond.inputs.prompt, 't3ss4 waves')
  assert.match(graph.char.inputs.LoraLoaderState, /tess/)
  assert.deepEqual(graph.save.inputs.audio, ['load', 2])
  const quiet = refineGraph(template, { source: { path: 'C:/t.mp4', width: 854, height: 480, frames: 124 }, prompt: 'x', name: 'x', silence: 'iv_studio/silence_51.wav' }).graph
  assert.equal(quiet.save.inputs.audio, undefined)
  assert.deepEqual(quiet.aenc.inputs.audio, ['quiet', 0])
  assert.equal(quiet.tail, undefined, '124 frames need no padding')
})

await ok('local upscaler strengths: DLSS 5 strength and style reach its node, H3 + SeedVR2 leaves DLSS out', async () => {
  const template = JSON.parse(fs.readFileSync(new URL('../resources/workflows/iv_studio_api.json', import.meta.url)))
  const src = { path: 'C:/t.mp4', width: 854, height: 480, frames: 121 }
  const look = refineGraph(template, { source: src, prompt: 'x', name: 'x', denoise: 0.15, dlss: dlssLook({ strength: 1.4, style: 'Cinematic' }) }).graph
  assert.equal(look.dlss.inputs['NR Intensity'], 1.4)
  assert.equal(look.dlss.inputs['NR Style'], 'Cinematic')
  assert.equal(look.sigmas.inputs.denoise, 0.15)
  const plain = refineGraph(template, { source: src, prompt: 'x', name: 'x', dlss: dlssLook({}) }).graph
  assert.ok(plain.dlss, 'no strength picked still runs DLSS 5 with its own settings')
  const noDlss = refineGraph(template, { source: src, prompt: 'x', name: 'x', dlss: false }).graph
  assert.equal(noDlss.dlss, undefined)
  assert.equal(noDlss.out, undefined)
  assert.deepEqual(dlssLook({ strength: 9, style: 'Weird' }), { 'NR Intensity': 2 })
  assert.deepEqual(dlssLook({ strength: 0.5, style: 'Natural' }, true), { strength: 0.5, style: 'Natural' })
})

console.log(`\n${n} passed`)
