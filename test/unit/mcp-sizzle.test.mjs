// MCP website-sizzle tools (task 5.7, part 1), called through the real MCP server on source under the test guard,
// against the fake ComfyUI (design D1, D8). A sizzle starts with a headless-browser capture of a website, which the
// guard refuses (sizzle_capture has a `spawns a browser` gap); every other tool is given a saved sizzle whose capture
// is real pictures made with ffmpeg, written where the product keeps them. The Shinobi hand-off (sizzle_to_shinobi,
// sizzle_first_cut) needs the Shinobi Python engine, so those two have `spawns python` gaps and a row-less guard test.
//   node --test test/unit/mcp-sizzle.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const manifest = JSON.parse(fs.readFileSync(new URL('../../resources/models.json', import.meta.url), 'utf8'))
const node = () => ({ input: { required: {} } })
// ComfyUI's lists of model files: the two ACE-Step files the music needs and Z-Image Turbo for the pictures
function objectInfo() {
  const info = { 'TextEncodeAceStepAudio1.5': node(), 'EmptyAceStep1.5LatentAudio': node(), LoadAudio: node(), VAEEncodeAudio: node() }
  for (const id of ['music3_dit', 'music3_te', 'music3_vae', 'ace15']) {
    const m = manifest.models.find((x) => x.id === id)
    const [cls, input] = m.loader.split('.')
    info[cls] ||= node()
    info[cls].input.required[input] = [[...(info[cls].input.required[input]?.[0] || []), m.match]]
  }
  const combo = (cls, input, files) => {
    info[cls] ||= node()
    info[cls].input.required[input] = [[...(info[cls].input.required[input]?.[0] || []), ...files]]
  }
  combo('UNETLoader', 'unet_name', ['z_image_turbo_bf16.safetensors'])
  combo('CLIPLoader', 'clip_name', ['qwen_3_4b.safetensors'])
  combo('VAELoader', 'vae_name', ['ae.safetensors'])
  return info
}

describe('MCP website sizzle tools', () => {
  let fake, mcp, dir
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readSizzle = (id) => JSON.parse(fs.readFileSync(dataFile('sizzle', id, 'sizzle.json'), 'utf8'))
  let count = 0
  // a saved sizzle, as the capture step leaves it: real pictures for the hero, a screen, the phone layout, the logo and one site picture
  const saved = (extra = {}) => {
    const id = `sz${String(++count).padStart(6, '0')}`
    const site = path.join(dataFile('sizzle', id), 'site')
    fs.mkdirSync(path.join(site, 'images'), { recursive: true })
    const shot = (file, color, size) => ff('-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', file)
    const cap = (name, color, size, what) => ({ name, file: path.join(site, `${name}.png`), width: Number(size.split('x')[0]), height: Number(size.split('x')[1]), what, color, size })
    const captures = [cap('hero', 'red', '192x108', 'The top of the page'), cap('screen-2', 'green', '192x108', 'One screen down'), cap('mobile', 'blue', '78x168', 'On a phone'), cap('logo', 'white', '60x30', 'The logo')]
    for (const c of captures) {
      shot(c.file, c.color, c.size)
      delete c.color
      delete c.size
    }
    const image = path.join(site, 'images', 'image-1.png')
    shot(image, 'yellow', '96x54')
    const sizzle = {
      id,
      name: 'Acme',
      url: 'https://acme.test/',
      format: '16:9',
      status: 'planning',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      site: {
        url: 'https://acme.test/',
        title: 'Acme: rockets for everyone',
        description: 'We make rockets.',
        siteName: 'Acme',
        headings: ['Rockets for everyone'],
        ctas: ['Get a rocket'],
        nav: ['Home', 'Pricing'],
        paragraphs: ['Every rocket is built by hand in our own workshop and checked twice before it ships.'],
        colors: ['#d33a2c', '#101820'],
        fonts: ['Inter'],
        captures,
        images: [{ file: image, src: 'https://acme.test/a.png', alt: 'A rocket', width: 96, height: 54 }]
      },
      plan: null,
      approvedAt: null,
      assets: {},
      shinobi: null,
      ...extra
    }
    fs.writeFileSync(dataFile('sizzle', id, 'sizzle.json'), JSON.stringify(sizzle, null, 2))
    return sizzle
  }
  const PLAN = {
    scenes: [
      { kind: 'screen', seconds: 3, capture: 'hero' },
      { kind: 'h3', seconds: 5, prompt: 'A rocket lifts off at dawn, slow push in.' },
      { kind: 'image', seconds: 2.5, prompt: 'A workshop bench with rocket parts' },
      { kind: 'title', seconds: 2, text: 'Rockets for everyone' }
    ],
    music: { engine: 'ace', caption: 'driving synthwave, 120 bpm', seconds: 20 }
  }
  const approved = async (plan = PLAN) => {
    const s = saved()
    await ok('save_sizzle_plan', { sizzleId: s.id, plan })
    await ok('approve_sizzle_plan', { sizzleId: s.id })
    return s
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: objectInfo() })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- sizzle_capture (spawns a browser: no row-id test) ----------
  test('guard keeps sizzle_capture from opening a browser: a bad address is turned down first and nothing is started', async () => {
    await fails('sizzle_capture', { url: 'https://not a web address' }, /That is not a web address\./)
    await fails('sizzle_capture', { url: 'https://acme.test', format: '4:3' }, /format/i)
    assert.deepEqual(await mcp.refusals(), [], 'the product turned both down before it tried to start anything')
    assert.deepEqual(fs.existsSync(dataFile('sizzle')) ? fs.readdirSync(dataFile('sizzle')).filter((n) => !n.startsWith('sz')) : [], [], 'no sizzle was made')
  })

  // ---------- view_sizzle_capture ----------
  test('[mcp:view_sizzle_capture] gives a capture as a JPEG picture at the width asked, by capture name or image-N', async () => {
    const s = saved()
    const hero = await call('view_sizzle_capture', { sizzleId: s.id, name: 'hero', width: 480 })
    assert.ok(!hero.isError, JSON.stringify(hero.content))
    const pic = hero.content.find((c) => c.type === 'image')
    assert.equal(pic.mimeType, 'image/jpeg')
    const jpg = path.join(dir, 'hero-view.jpg')
    fs.writeFileSync(jpg, Buffer.from(pic.data, 'base64'))
    const size = execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', jpg]).toString().trim()
    assert.equal(size, '480,270', 'scaled to the width, in the capture\'s own shape')
    assert.deepEqual(hero.structuredContent, { name: 'hero', file: s.site.captures[0].file })
    const img = await call('view_sizzle_capture', { sizzleId: s.id, name: 'image-1' })
    assert.ok(!img.isError)
    assert.equal(img.structuredContent.file, s.site.images[0].file)
  })

  test('[mcp:view_sizzle_capture] says which capture or sizzle is missing and refuses a width outside 240 to 1600', async () => {
    const s = saved()
    await fails('view_sizzle_capture', { sizzleId: s.id, name: 'screen-9' }, /No capture screen-9\./)
    await fails('view_sizzle_capture', { sizzleId: 'nope', name: 'hero' }, /No sizzle nope/)
    await fails('view_sizzle_capture', { sizzleId: s.id, name: 'hero', width: 100 }, /width/i)
  })

  // ---------- list_sizzles ----------
  test('[mcp:list_sizzles][ipc:sizzle:list] lists the saved sizzles newest first with their site, status, scene count and cover', async () => {
    const older = saved({ name: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' })
    const newer = saved({ name: 'Newer', updatedAt: '2030-01-01T00:00:00.000Z' })
    const { items } = await ok('list_sizzles')
    const ids = items.map((i) => i.id)
    assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id), 'newest first')
    assert.equal(ids[0], newer.id)
    assert.deepEqual(items[0], { id: newer.id, name: 'Newer', url: 'https://acme.test/', status: 'planning', scenes: 0, cover: newer.site.captures[0].file, final: null, updatedAt: '2030-01-01T00:00:00.000Z' })
  })

  // ---------- save_sizzle_plan ----------
  test('[mcp:save_sizzle_plan][ipc:sizzle:savePlan] saves the storyboard with scene ids, whole-second H3 lengths, a total and the music, and leaves it unapproved', async () => {
    const s = saved()
    const r = await ok('save_sizzle_plan', { sizzleId: s.id, plan: { ...PLAN, notes: 'Keep it fast.' } })
    assert.equal(r.status, 'planning')
    assert.equal(r.approvedAt, null)
    assert.deepEqual(r.plan.scenes.map((x) => [x.id, x.kind, x.seconds]), [['s1', 'screen', 3], ['s2', 'h3', 5], ['s3', 'image', 2.5], ['s4', 'title', 2]])
    assert.equal(r.plan.seconds, 12.5)
    assert.deepEqual(r.plan.music, { engine: 'ace', caption: 'driving synthwave, 120 bpm', lyrics: '', instrumental: true, seconds: 20 })
    assert.equal(r.plan.voiceover, null)
    assert.equal(r.plan.notes, 'Keep it fast.')
    assert.equal(r.site.captures.length, 4)
    assert.deepEqual(r.site.images.map((i) => i.name), ['image-1'])
    assert.deepEqual(readSizzle(s.id).plan, r.plan, 'saved to the sizzle on disk')
  })

  test('[mcp:save_sizzle_plan] defaults the music to MiniMax, sets its length from the film and keeps lyrics when given', async () => {
    const s = saved()
    const r = await ok('save_sizzle_plan', { sizzleId: s.id, plan: { scenes: PLAN.scenes, music: { caption: 'warm folk', lyrics: 'la la la' }, voiceover: { voiceId: 'v1', lines: ['Hello.'] } } })
    assert.equal(r.plan.music.engine, 'minimax')
    assert.equal(r.plan.music.instrumental, false)
    assert.equal(r.plan.music.seconds, 15, 'the film is 12.5 s, the song runs 2 s longer and rounds up')
    assert.deepEqual(r.plan.voiceover, { voiceId: 'v1', lines: ['Hello.'] })
  })

  test('[mcp:save_sizzle_plan] turns down a plan that cannot be made and says which scene and why', async () => {
    const s = saved()
    const music = PLAN.music
    const scenes = (...extra) => ({ scenes: [{ kind: 'screen', seconds: 3, capture: 'hero' }, ...extra], music })
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ kind: 'h3', seconds: 5 }) }, /Scene 2: an h3 scene needs a prompt\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ kind: 'h3', seconds: 9, prompt: 'x' }) }, /Scene 2: H3 shots are 3, 4, 5, 6, 7, 8, 10 seconds\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ kind: 'image', seconds: 20, prompt: 'x' }) }, /Scene 2: seconds runs from 0\.5 to 15\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ kind: 'screen', seconds: 3, capture: 'screen-7' }) }, /Scene 2: capture is one of hero, screen-2, mobile, logo, image-1\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ kind: 'title', seconds: 2 }) }, /Scene 2: a title scene needs its text\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: scenes({ id: 's1', kind: 'title', seconds: 2, text: 'x' }) }, /Scene ids must be different\./)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: { scenes: PLAN.scenes, music: { caption: '' } } }, /Describe the music/)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: { scenes: PLAN.scenes, music, voiceover: { voiceId: '', lines: ['Hi'] } } }, /voiceover\.voiceId/)
    await fails('save_sizzle_plan', { sizzleId: s.id, plan: { scenes: [PLAN.scenes[0]], music } }, /scenes|at least/i)
    assert.equal(readSizzle(s.id).plan, null, 'nothing was saved')
  })

  // ---------- approve_sizzle_plan ----------
  test('[mcp:approve_sizzle_plan][ipc:sizzle:approve] needs a storyboard first, then records the approval; saving the plan again takes it back', async () => {
    const s = saved()
    await fails('approve_sizzle_plan', { sizzleId: s.id }, /Write the storyboard first\./)
    await ok('save_sizzle_plan', { sizzleId: s.id, plan: PLAN })
    const a = await ok('approve_sizzle_plan', { sizzleId: s.id })
    assert.equal(a.status, 'approved')
    assert.match(a.approvedAt, /^\d{4}-\d\d-\d\dT/)
    const again = await ok('save_sizzle_plan', { sizzleId: s.id, plan: PLAN })
    assert.equal(again.approvedAt, null)
    assert.equal(again.status, 'planning')
    await fails('approve_sizzle_plan', { sizzleId: 'nope' }, /No sizzle nope/)
  })

  // ---------- make_sizzle_assets ----------
  test('[mcp:make_sizzle_assets] needs the person\'s OK first and queues nothing without it', async () => {
    const s = saved()
    await ok('save_sizzle_plan', { sizzleId: s.id, plan: PLAN })
    const queued = fake.prompts.length
    await fails('make_sizzle_assets', { sizzleId: s.id }, /needs the person's OK first/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:make_sizzle_assets][ipc:sizzle:makeAssets] queues the picture, the song and one small H3 preview per shot, then the 1 MP finish of a preview that is done', async () => {
    const s = await approved()
    const before = fake.prompts.length
    const r = await ok('make_sizzle_assets', { sizzleId: s.id })
    const queued = fake.prompts.slice(before).map((p) => p.prompt)
    const has = (g, cls) => Object.values(g).some((n) => n.class_type === cls)
    const nodeOf = (g, cls) => Object.values(g).find((n) => n.class_type === cls)
    assert.equal(queued.length, 4, 'a picture, a song, a shot and the shot\'s finish (the fake finishes a preview at once)')
    const still = queued.find((g) => has(g, 'EmptySD3LatentImage'))
    const size = nodeOf(still, 'EmptySD3LatentImage').inputs
    assert.deepEqual([size.width, size.height], [1920, 1088], 'the 16:9 film\'s size')
    assert.match(nodeOf(still, 'CLIPTextEncode').inputs.text, /A workshop bench with rocket parts/)
    assert.match(nodeOf(still, 'SaveImage').inputs.filename_prefix, /^IV Studio\/sizzle\/acme_sz\d+\/s3$/)
    assert.equal(nodeOf(queued.find((g) => has(g, 'TextEncodeAceStepAudio1.5')), 'TextEncodeAceStepAudio1.5').inputs.tags, 'driving synthwave, 120 bpm')
    const preview = queued.find((g) => has(g, 'MiniMaxH3ImageToVideo') && !has(g, 'LTXVSeparateAVLatent'))
    assert.ok(preview, 'the H3 preview graph')
    assert.match(JSON.stringify(preview), /A rocket lifts off at dawn, slow push in\./)
    assert.ok(has(queued.find((g) => has(g, 'LTXVSeparateAVLatent')), 'MinimaxH3LatentUpscaler3D'), 'the 1 MP finish graph')
    assert.equal(r.status, 'rendering')
    assert.deepEqual(Object.keys(r.assets).sort(), ['music', 's2', 's3'])
    assert.equal(r.assets.s2.kind, 'h3')
    assert.equal(r.assets.s2.status, 'finishing')
    assert.equal(r.assets.s3.kind, 'image')
    assert.deepEqual(r.scenes.filter((x) => x.id === 's1' || x.id === 's4').map((x) => [x.id, x.status]), [['s1', 'ready'], ['s4', 'ready']], 'screens and titles need nothing made')
    assert.equal(r.scenes.find((x) => x.id === 's1').file, s.site.captures[0].file)
    assert.equal(readSizzle(s.id).status, 'rendering')
  })

  test('[mcp:make_sizzle_assets] makes nothing twice: a second call keeps the pieces already queued', async () => {
    const s = await approved()
    const first = await ok('make_sizzle_assets', { sizzleId: s.id })
    const queued = fake.prompts.length
    const second = await ok('make_sizzle_assets', { sizzleId: s.id })
    assert.equal(fake.prompts.length, queued)
    assert.deepEqual(second.assets.s2.previewJob, first.assets.s2.previewJob)
  })

  // ---------- get_sizzle ----------
  test('[mcp:get_sizzle][ipc:sizzle:get] reads a planning sizzle without queuing anything', async () => {
    const s = saved()
    const queued = fake.prompts.length
    const r = await ok('get_sizzle', { sizzleId: s.id })
    assert.equal(r.id, s.id)
    assert.equal(r.status, 'planning')
    assert.deepEqual(r.scenes, [])
    assert.equal(r.final, null)
    assert.equal(r.site.title, 'Acme: rockets for everyone')
    assert.equal(fake.prompts.length, queued)
    await fails('get_sizzle', { sizzleId: 'nope' }, /sizzle[\\/]nope/)
  })

  test('[mcp:get_sizzle] moves rendering along until every piece is made: the picture is kept in the sizzle\'s folder, the shot is finished at 1 MP, the song has its file', async () => {
    const preview = path.join(dir, 'preview.mp4')
    const final = path.join(dir, 'final.mp4')
    const song = path.join(dir, 'song.flac')
    for (const f of [preview, final]) ff('-f', 'lavfi', '-i', 'testsrc=s=64x36:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f)
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=2', song)
    const gif = (file, sub) => ({ 42: { gifs: [{ filename: path.basename(file), subfolder: sub, type: 'output', fullpath: file }] } })
    fake.setOutputs((g) => {
      const has = (cls) => Object.values(g).some((n) => n.class_type === cls)
      if (has('SaveAudio')) return { 8: { audio: [{ filename: 'song.flac', subfolder: 'iv_studio/music', type: 'output', fullpath: song }] } }
      if (has('VHS_LoadVideoPath')) return { 51: { text: [final] } }
      if (has('MiniMaxH3ImageToVideo')) return gif(preview, 'H3/previews')
      return undefined
    })
    try {
      const s = await approved()
      const made = await ok('make_sizzle_assets', { sizzleId: s.id })
      assert.equal(made.assets.s2.status, 'finishing')
      assert.equal(made.assets.s2.preview, preview)
      const r = await ok('get_sizzle', { sizzleId: s.id })
      assert.equal(r.assets.s3.status, 'success', 'the picture finished')
      assert.ok(r.assets.s3.file.startsWith(dataFile('sizzle', s.id, 'pieces')) && fs.existsSync(r.assets.s3.file), 'the picture file is copied into the sizzle')
      assert.deepEqual([r.assets.s2.status, r.assets.s2.file], ['success', final], 'the shot is finished')
      assert.equal(r.assets.music.status, 'success')
      assert.ok(fs.existsSync(r.assets.music.file), 'the song has its file')
      assert.equal(r.status, 'ready')
      assert.deepEqual(r.scenes.map((x) => [x.id, x.status]), [['s1', 'ready'], ['s2', 'success'], ['s3', 'success'], ['s4', 'ready']])
    } finally {
      fake.setOutputs(null)
    }
  })

  // ---------- delete_sizzle ----------
  test('[mcp:delete_sizzle][ipc:sizzle:delete] removes the sizzle and its capture, and the list no longer shows it', async () => {
    const s = saved()
    assert.ok(fs.existsSync(s.site.captures[0].file))
    const r = await ok('delete_sizzle', { sizzleId: s.id })
    assert.deepEqual(r, { items: true })
    assert.ok(!fs.existsSync(dataFile('sizzle', s.id)))
    const { items } = await ok('list_sizzles')
    assert.ok(!items.some((i) => i.id === s.id))
  })

  // ---------- sizzle_to_shinobi and sizzle_first_cut (spawn python: no row-id tests) ----------
  test('guard refuses python for sizzle_to_shinobi and sizzle_first_cut: without Shinobi they say to set it up, with it they stop at the engine', async () => {
    const s = saved({ status: 'ready' })
    await ok('save_sizzle_plan', { sizzleId: s.id, plan: { scenes: [PLAN.scenes[0], PLAN.scenes[3]], music: PLAN.music } })
    const j = readSizzle(s.id)
    j.status = 'ready'
    j.assets = { music: { status: 'success', songId: 'none', file: null } }
    fs.writeFileSync(dataFile('sizzle', s.id, 'sizzle.json'), JSON.stringify(j))
    await fails('sizzle_to_shinobi', { sizzleId: s.id }, /Set up Shinobi first/)
    // an engine that looks installed: its Python and the marker, as the installer leaves them
    const venv = dataFile('shinobi', 'venv', 'bin')
    fs.mkdirSync(venv, { recursive: true })
    fs.writeFileSync(path.join(venv, 'python'), '#!/bin/sh\n')
    fs.chmodSync(path.join(venv, 'python'), 0o755)
    const { ENGINE } = await import('../../src/service/shinobi.js')
    fs.writeFileSync(dataFile('shinobi', 'installed.json'), JSON.stringify({ commit: ENGINE.commit }))
    const before = (await mcp.refusals()).length
    await fails('sizzle_to_shinobi', { sizzleId: s.id }, /refused to start/)
    await fails('sizzle_first_cut', { sizzleId: s.id }, /refused to start/)
    const refused = (await mcp.refusals()).slice(before)
    assert.ok(refused.length >= 2 && refused.every((r) => r.command === 'python'), JSON.stringify(refused))
    assert.equal(readSizzle(s.id).shinobi, null, 'no Shinobi project was made')
    fs.rmSync(dataFile('shinobi'), { recursive: true, force: true })
  })
})
