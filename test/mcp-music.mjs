// MCP music test: music tools over stdio on a temporary data folder, against the ComfyUI on this computer. It makes
// one 20 s ACE-Step song (about 15 s on a 4090) and, with --minimax, one 30 s MiniMax Music 3 song (a few
// minutes). Both engines' models must be downloaded (Audio > Music).
//   node test/mcp-music.mjs [--minimax]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-music-'))
const withMinimax = process.argv.includes('--minimax')
let failures = 0
const transport = new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: temp } })
const c = new Client({ name: 'music-test', version: '1' })
await c.connect(transport)
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args })
  return { error: r.isError ? r.content[0].text : null, value: r.structuredContent }
}
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const finished = async (id, limit) => {
  const t0 = Date.now()
  for (;;) {
    const s = (await call('get_music', { songId: id })).value
    if (['success', 'error', 'cancelled'].includes(s.status) && (s.status !== 'success' || s.file)) return { ...s, took: Math.round((Date.now() - t0) / 1000) }
    if (Date.now() - t0 > limit * 1000) return { ...s, timedOut: true }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

const st = await call('music_status')
const ready = Object.fromEntries((st.value?.engines || []).map((e) => [e.id, e.ready]))
expect('music_status', !st.error && ready.ace && (!withMinimax || ready.minimax), JSON.stringify(ready))
if (!ready.ace) process.exit(1)

expect('make_music without a style -> error', !!(await call('make_music', { engine: 'ace', caption: ' ' })).error)
expect('make_music too long -> error', !!(await call('make_music', { engine: 'minimax', caption: 'Lo-fi', seconds: 400 })).error)
expect('make_music bad key -> error', !!(await call('make_music', { engine: 'ace', caption: 'Lo-fi', key: 'H major' })).error)

const ace = await call('make_music', { engine: 'ace', name: 'Test sunny', caption: 'Upbeat indie pop, jangly guitars, driving drums, female lead vocal, sunny.', lyrics: '[Verse]\nMorning light on the window frame\n\n[Chorus]\nWe run into the sun', seconds: 20, seed: 7, bpm: 124, key: 'G major' })
expect('make_music ace queues', !ace.error && ace.value.status !== 'error', ace.error || ace.value.id)
const a = await finished(ace.value.id, 300)
expect('ace song finishes with a file', a.status === 'success' && fs.existsSync(a.file) && Math.abs(a.duration - 20) < 1.5, a.error || `${a.duration}s in ${a.took}s, ${a.file}`)

const inst = await call('make_music', { engine: 'ace', caption: 'Calm ambient piano, soft pads, slow.', instrumental: true, seconds: 10 })
const i = await finished(inst.value.id, 300)
expect('instrumental', i.status === 'success' && i.instrumental && i.lyrics === '', i.error || `${i.duration}s`)

if (withMinimax) {
  const mm = await call('make_music', { engine: 'minimax', caption: 'Warm neo-soul, live drums behind the beat, Rhodes, round bass, soft female vocal, late night.', lyrics: '[Verse]\nLate night glow on the window pane\nCity hums and it calls my name\n\n[Chorus]\nStay right here, we arrive late', seconds: 30, seed: 41 })
  const m = await finished(mm.value.id, 1200)
  expect('minimax song finishes with a file', m.status === 'success' && fs.existsSync(m.file) && m.duration > 5 && m.duration <= 31, m.error || `${m.duration}s in ${m.took}s, ${m.file}`)
}

const list = (await call('list_music')).value.items
expect('list_music', list.length === (withMinimax ? 3 : 2) && list[0].createdAt >= list.at(-1).createdAt, `${list.length} songs`)
expect('rename_music', (await call('rename_music', { songId: a.id, name: 'Renamed' })).value?.name === 'Renamed')

// a song onto a new edit's A1 through the edit tools
const e = (await call('create_edit', { name: 'Music test' })).value
const added = await call('add_media', { editId: e.id, files: [a.file], append: true })
const edit = (await call('get_edit', { editId: e.id })).value
expect('add_media puts the song on A1', !added.error && JSON.stringify(edit).includes('A1'), added.error || '')

const del = await call('delete_music', { songId: i.id })
expect('delete_music removes its file', !del.error && !fs.existsSync(i.file) && (await call('list_music')).value.items.length === list.length - 1)

await c.close()
console.log(failures ? `${failures} failed` : 'all passed', `| files in ${temp}`)
process.exit(failures ? 1 : 0)
