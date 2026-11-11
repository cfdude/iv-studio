// Chat batch 3: Edit by talking (captions.js and the chat's undo points), recipes (recipes.js), overnight batches
// (batches.js), and the parts of them inside the built MCP server (out/main/mcp.js; run `npx electron-vite build`
// first) in an isolated data folder. The short film is the chat's instructions (agentchat.js chatPrompt), checked here
// for its stages.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captionEdit, captionLines, peakDb, phantom, QUIET_DB, spokenClips } from '../src/service/captions.js'
import { listRecipes, MAX_RECIPES, removeRecipe, saveRecipe } from '../src/service/recipes.js'
import { batchReport, batchState, bestTake, Batches } from '../src/service/batches.js'
import { applyChatEvent, chatPrompt, newChat, undoEditChange } from '../src/service/agentchat.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
let failed = 0
const check = (name, ok, more = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${String(more).slice(0, 400)}`}`)
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

// ---------- captions ----------
let lines = captionLines('Good morning. I made you coffee, the strong kind you like, with a little cinnamon on top.', 2, 6)
check('captions: split into short lines', lines.length >= 2 && lines.every((l) => l.content.split(' ').length <= 9), JSON.stringify(lines))
check('captions: they fill the clip exactly', Math.abs(lines[0].start - 2) < 1e-6 && Math.abs(lines.at(-1).start + lines.at(-1).duration - 8) < 0.002, JSON.stringify(lines))
check('captions: a sentence end closes a line', lines[0].content === 'Good morning.', lines[0].content)
check('captions: nothing said, no lines', captionLines('  ', 0, 5).length === 0)
check('captions: a comma closes a line, and no line ends on "the"', captionLines('Good morning. I made you coffee, the strong kind you like. Shall we take it out to the garden before the rain comes?', 0, 10).every((l) => !/\b(the|to|a)$/i.test(l.content)) && captionLines('I made you coffee, the strong kind you like.', 0, 4)[0].content === 'I made you coffee,', JSON.stringify(captionLines('Good morning. I made you coffee, the strong kind you like. Shall we take it out to the garden before the rain comes?', 0, 10).map((l) => l.content)))
lines = captionLines('one two three four five six seven eight nine ten eleven twelve thirteen fourteen', 0, 1.2)
check('captions: too many lines for a short clip merge', lines.length === 1, JSON.stringify(lines))
lines = captionLines('This is a line that ends with yes', 0, 4, { maxWords: 7 })
check('captions: a lone last word joins the line before', lines.length === 1 && lines[0].content.endsWith('yes'), JSON.stringify(lines))

const edit = {
  media: { m1: { id: 'm1', kind: 'video', hasAudio: true, path: 'a.mp4', duration: 10 }, m2: { id: 'm2', kind: 'image', path: 'b.png' }, m3: { id: 'm3', kind: 'video', hasAudio: false, path: 'c.mp4', duration: 5 }, m4: { id: 'm4', kind: 'audio', path: 'song.mp3', duration: 60 } },
  clips: [
    { id: 'c1', track: 'V1', media: 'm1', start: 0, in: 2, out: 7, fadeIn: 0, fadeOut: 0, volume: 1, muted: false },
    { id: 'c2', track: 'V1', media: 'm2', start: 5, in: 0, out: 4, fadeIn: 0, fadeOut: 0 },
    { id: 'c3', track: 'V1', media: 'm3', start: 9, in: 0, out: 5, fadeIn: 0, fadeOut: 0 },
    { id: 'c4', track: 'V2', media: 'm1', start: 14, in: 0, out: 3, fadeIn: 0, fadeOut: 0, muted: true },
    { id: 'c5', track: 'A1', media: 'm4', start: 0, in: 0, out: 20, fadeIn: 0, fadeOut: 0 },
    { id: 't1', track: 'T1', start: 0, in: 0, out: 2, fadeIn: 0, fadeOut: 0, text: { content: 'MY FILM', size: 10, position: 'center', color: '#ffffff', box: false } }
  ],
  tracks: null,
  markers: []
}
check('captions: hears video clips with sound, not pictures, silent or muted ones, or the music', spokenClips(edit).map((c) => c.id).join() === 'c1')
check('captions: an A track when asked', spokenClips(edit, ['A1']).map((c) => c.id).join() === 'c5')
const heardFrom = []
let out = await captionEdit(edit, async (c, m) => (heardFrom.push([c.id, m.path]), 'Hello there. This is a test of the captions.'))
const caps = out.clips.filter((c) => c.caption)
check('captions: the words go on T1 at the bottom, in a box, marked', caps.length >= 2 && caps.every((c) => c.track === 'T1' && c.text.position === 'bottom' && c.text.box === true), JSON.stringify(caps.map((c) => c.text)))
check('captions: timed over that clip', Math.abs(caps[0].start - 0) < 1e-6 && Math.abs(caps.at(-1).start + caps.at(-1).out - caps.at(-1).in - 5) < 0.002)
check('captions: the edit’s own title stays', out.clips.some((c) => c.id === 't1' && !c.caption))
check('captions: heard reported per clip', out.heard.length === 1 && out.heard[0].clip === 'c1' && heardFrom[0][1] === 'a.mp4')
out = await captionEdit({ ...edit, clips: out.clips }, async () => 'Different words now.')
check('captions: again replaces its own captions, not the title', out.clips.filter((c) => c.caption).length === 1 && out.clips.filter((c) => c.caption)[0].text.content === 'Different words now.' && out.clips.some((c) => c.id === 't1'))
out = await captionEdit(edit, async () => ' You. ')
check('captions: a lone "you" (Whisper hearing silence) makes no caption', out.lines === 0 && out.heard[0].words === '')
check('captions: phantom words only when that’s all it heard', phantom('Thank you.') && phantom('you') && !phantom('Thank you for the coffee.'))
const sil = path.join(tmp('ivs-sil-'), 's.wav')
spawnSync(require('ffmpeg-ffprobe-static').ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', sil])
const tone = sil.replace('s.wav', 't.wav')
spawnSync(require('ffmpeg-ffprobe-static').ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', tone])
check('captions: silence measures as quiet, a tone doesn’t', (await peakDb(require('ffmpeg-ffprobe-static').ffmpegPath, sil)) < QUIET_DB && (await peakDb(require('ffmpeg-ffprobe-static').ffmpegPath, tone)) > QUIET_DB)
out = await captionEdit(edit, async () => 'Big words.', { style: { size: 9, position: 'top' } })
check('captions: a style is kept', out.clips.filter((c) => c.caption).every((c) => c.text.size === 9 && c.text.position === 'top'))

// ---------- the chat's undo points ----------
const chatDir = tmp('ivs-undo-')
fs.mkdirSync(path.join(chatDir, 'undo'))
fs.writeFileSync(path.join(chatDir, 'undo', 'u1.json'), JSON.stringify({ id: 'u1', editId: 'e1', name: 'Cut', fields: { clips: [{ id: 'x' }], name: 'Cut' } }))
let saved = null
const r = undoEditChange(chatDir, 'u1', (id, fields) => (saved = { id, fields }))
check('undo: puts the edit’s fields back', saved?.id === 'e1' && saved.fields.clips[0].id === 'x' && r.name === 'Cut')
let threw = ''
try {
  undoEditChange(chatDir, '../x', () => {})
} catch (e) {
  threw = e.message
}
check('undo: a bad id is refused', /No such change/.test(threw))
const c = newChat({ id: 'c', engine: 'claude' })
applyChatEvent(c, { type: 'undo', undo: { id: 'u1', editId: 'e1', name: 'Cut', label: 'Edit timeline' } })
check('undo: the chat gets an Undo entry', c.entries.at(-1).kind === 'undo' && c.entries.at(-1).done === false)
fs.rmSync(chatDir, { recursive: true, force: true })

// ---------- recipes ----------
const rdir = tmp('ivs-recipes-')
const r1 = saveRecipe(rdir, { name: 'Vertical teaser', instruction: 'A 15 second vertical teaser from my latest finished shot, fast speed.', note: '15 s, 9:16' })
check('recipes: saved', listRecipes(rdir).length === 1 && r1.id && r1.name === 'Vertical teaser')
saveRecipe(rdir, { name: 'vertical TEASER', instruction: 'A 10 second vertical teaser from my latest finished shot.' })
check('recipes: the same name replaces it', listRecipes(rdir).length === 1 && /10 second/.test(listRecipes(rdir)[0].instruction) && listRecipes(rdir)[0].id === r1.id)
threw = ''
try {
  saveRecipe(rdir, { name: 'x', instruction: 'short' })
} catch (e) {
  threw = e.message
}
check('recipes: a request too short to work alone is refused', /request itself/.test(threw))
for (let i = 0; i < MAX_RECIPES - 1; i++) saveRecipe(rdir, { name: `R${i}`, instruction: `Recipe number ${i}, a real request.` })
threw = ''
try {
  saveRecipe(rdir, { name: 'one too many', instruction: 'This would be one more recipe.' })
} catch (e) {
  threw = e.message
}
check(`recipes: at most ${MAX_RECIPES}`, /already 24/.test(threw), threw)
removeRecipe(rdir, r1.id)
check('recipes: removed', !listRecipes(rdir).some((x) => x.id === r1.id))
fs.rmSync(rdir, { recursive: true, force: true })

// ---------- overnight batches ----------
const bdir = tmp('ivs-batches-')
const store = new Batches({ dir: bdir })
const b = store.create({ name: 'Fox at dawn', chatId: 'chat1', projectId: 'p1', takes: 3, jobs: [{ jobId: 'j1', prompt: 'A fox in snow', label: 'Snow' }, { jobId: 'j2', prompt: 'A fox in rain' }, { jobId: 'j3', prompt: 'A fox in fog' }] })
check('batches: saved and running', store.running().length === 1 && store.get(b.id).name === 'Fox at dawn')
const take = (candidate, score, best = false, reasons = []) => ({ candidate, score, best, reasons })
let jobs = { j1: { status: 'success', projectId: 'p1', ranking: { takes: [take(1, 0.6), take(2, 0.91, true, ['every word heard']), take(3, 0.5)] } }, j2: { status: 'running' }, j3: { status: 'error', error: 'CUDA out of memory' } }
check('batches: not done while one still renders', !batchState(b, jobs).done && batchState(b, jobs).waiting === 1)
jobs.j2 = { status: 'success', projectId: 'p1', ranking: { takes: [take(1, 0.7), take(2, 0.71), take(3, 0.4)] } }
const st = batchState(b, jobs)
check('batches: done, 2 rendered and 1 failed', st.done && st.finished === 2 && st.failed === 1)
check('batches: the best take is the clear winner, else the top score', bestTake(jobs.j1).candidate === 2 && bestTake(jobs.j2).candidate === 2)
check('batches: no ranking falls back to take 1', bestTake({ outputs: [{ kind: 'preview', candidate: 1 }] }).candidate === 1)
const rep = batchReport(b, jobs)
check('batches: the report says what rendered and failed', /“Fox at dawn” is done: 2 of 3 shots rendered \(6 takes\), 1 didn’t/.test(rep.text) && /Didn’t render: shot 3 \(CUDA out of memory\)/.test(rep.text), rep.text)
check('batches: the best first, with its reason', rep.picks[0].jobId === 'j1' && rep.picks[0].candidate === 2 && /1\) shot 1, take 2 \(91\), every word heard/.test(rep.text), rep.text)
check('batches: picks link to the project', rep.picks.every((p) => p.projectId === 'p1') && /^Shot 1, take 2: Snow/.test(rep.picks[0].label), JSON.stringify(rep.picks))
check('batches: a missing job counts as not rendered', batchState(b, { j1: jobs.j1, j2: jobs.j2 }).failed === 1)
fs.rmSync(bdir, { recursive: true, force: true })

// ---------- the short film's stages, in the chat's instructions ----------
const p = chatPrompt()
check('short film: stage by stage with an OK after each', /stage by stage and stop for the person's OK/.test(p) && /create_film/.test(p) && /break_down_film/.test(p) && /render_film_scene/.test(p) && /build_rough_cut/.test(p))
check('short film: rendering only after an OK on the board', /Only after an OK on the board, render_film_scene/.test(p))
check('chat: knows captions, undo, recipes and batches', /caption_edit/.test(p) && /Undo this change/.test(p) && /save_recipe/.test(p) && /start_batch/.test(p))

// ---------- inside the built MCP server ----------
const data = tmp('ivs-batch3mcp-')
const askDir = path.join(data, 'asks')
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl: 'http://127.0.0.1:8199', ollamaUrl: 'http://127.0.0.1:9' }))
const ffmpeg = require('ffmpeg-ffprobe-static').ffmpegPath
const clip = path.join(data, 'clip.mp4')
spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x223344:s=320x180:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip])
check('server: a test clip', fs.existsSync(clip))
const transport = new StdioClientTransport({
  command: require('electron'),
  args: [path.resolve(here, '..', 'out', 'main', 'mcp.js')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: data, IV_STUDIO_AGENT_RUN: 'chat', IV_STUDIO_AGENT_ASK: askDir, IV_STUDIO_AGENT_ASK_MS: '4000', IV_STUDIO_CHAT_ID: 'chat-x' }
})
const mcp = new Client({ name: 'batch3', version: '1' })
await mcp.connect(transport)
const call = async (name, args = {}) => {
  const res = await mcp.callTool({ name, arguments: args })
  return { error: res.isError ? res.content[0].text : null, value: res.isError ? null : JSON.parse(res.content.find((x) => x.type === 'text').text) }
}
const undos = () => (fs.existsSync(askDir) ? fs.readdirSync(askDir).filter((n) => n.endsWith('.undo.json')) : [])
const answerNext = (allow) =>
  new Promise((resolve) => {
    const iv = setInterval(() => {
      const f = fs.existsSync(askDir) && fs.readdirSync(askDir).find((n) => n.endsWith('.ask.json'))
      if (!f) return
      clearInterval(iv)
      const a = JSON.parse(fs.readFileSync(path.join(askDir, f), 'utf8'))
      fs.writeFileSync(path.join(askDir, `${a.id}.answer.json`), JSON.stringify({ allow }))
      resolve(a)
    }, 100)
  })

let res = await call('create_edit', { name: 'Talk test' })
const editId = res.value?.id
check('server: an edit to change', !!editId, res.error)
check('server: making a new edit is no change to undo', undos().length === 0)
res = await call('add_media', { editId, files: [clip], append: true })
check('server: adding media leaves an undo point', !res.error && undos().length === 1, res.error)
const u1 = JSON.parse(fs.readFileSync(path.join(askDir, undos()[0]), 'utf8'))
check('server: the undo point is the edit as it was (empty)', u1.editId === editId && u1.fields.clips.length === 0 && u1.tool === 'add_media' && u1.name === 'Talk test')
const clipId = (await call('get_edit', { editId })).value.tracks.V1[0].clip
res = await call('edit_timeline', { editId, ops: [{ op: 'update_clip', clip: clipId, out: 2 }] })
check('server: a trim leaves another', !res.error && undos().length === 2, res.error)
res = await call('edit_timeline', { editId, ops: [{ op: 'update_clip', clip: 'nope', out: 2 }] })
check('server: a change that fails leaves none', res.error && undos().length === 2)
res = await call('caption_edit', { editId })
check('server: captions without the voice engine say how to set it up', /Set up voices/.test(res.error || ''), res.error)
res = await call('save_recipe', { name: 'Vertical teaser', instruction: 'A 15 second vertical teaser from my latest finished shot.', note: '15 s' })
check('server: save_recipe needs no Allow card, and saves', !res.error && listRecipes(data).length === 1, res.error)
const [ask1, del] = await Promise.all([answerNext(true), call('delete_recipe', { id: listRecipes(data)[0].id })])
check('server: delete_recipe asks first', ask1.tool === 'delete_recipe' && !del.error && listRecipes(data).length === 0, del.error)
res = await call('start_batch', { name: 'Bad batch', shots: [{ prompt: 'A fox crosses a frozen lake at dawn.' }, { prompt: '' }] })
check('server: a batch with an empty prompt is refused before anything runs', !!res.error && !fs.existsSync(path.join(data, 'batches')), res.error)
res = await call('start_batch', { name: 'Too many', shots: Array.from({ length: 13 }, () => ({ prompt: 'A fox crosses a frozen lake at dawn.' })) })
check('server: at most 12 shots', !!res.error)
const { tools } = await mcp.listTools()
check('server: the new tools are there', ['caption_edit', 'save_recipe', 'list_recipes', 'delete_recipe', 'start_batch', 'get_batch'].every((n) => tools.some((t) => t.name === n)))
await mcp.close()
fs.rmSync(data, { recursive: true, force: true, maxRetries: 3 })

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
