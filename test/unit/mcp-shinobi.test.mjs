// MCP Shinobi tools (task 5.7, part 2), called through the real MCP server on source under the test guard. Shinobi's
// engine is a Python program installed with uv, so shinobi_setup (downloads uv), shinobi_tools and shinobi (both run
// the engine's Python) have `spawns python` / `spawns uv` gaps and row-less guard tests. shinobi_status and
// shinobi_project only read the folder the engine writes, so they are proven on a folder written the way the engine
// leaves it.
//   node --test test/unit/mcp-shinobi.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startMcp } from '../fakes/mcp.mjs'
import { ENGINE } from '../../src/service/shinobi.js'

describe('MCP Shinobi tools', () => {
  let mcp
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
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  }
  // an engine that looks installed: its Python and the marker, as the installer leaves them
  const installEngine = () => {
    write(dataFile('shinobi', 'venv', 'bin', 'python'), '#!/bin/sh\n')
    fs.chmodSync(dataFile('shinobi', 'venv', 'bin', 'python'), 0o755)
    write(dataFile('shinobi', 'installed.json'), { commit: ENGINE.commit })
  }
  const removeEngine = () => fs.rmSync(dataFile('shinobi'), { recursive: true, force: true })

  before(async () => {
    mcp = await startMcp({ comfyUrl: 'http://127.0.0.1:1' })
  })
  after(async () => {
    removeEngine()
    await mcp?.close()
  })

  // ---------- shinobi_status ----------
  test('[mcp:shinobi_status] says Shinobi is not set up on a fresh folder, with its engine, projects folder and face-model state', async () => {
    const r = await ok('shinobi_status')
    assert.equal(r.installed, false)
    assert.deepEqual(r.engine, ENGINE)
    assert.equal(r.workspace, dataFile('shinobi', 'projects'))
    assert.equal(r.faceModels, false)
    assert.match(r.faceLicence, /non-commercial/)
    assert.equal(r.faceSize, 288621354)
    assert.deepEqual(r.projects, [])
    assert.ok(r.browser === null || typeof r.browser === 'string', 'the browser Shinobi would render with, if the PC has one')
  })

  test('[mcp:shinobi_status][ipc:shinobi:status][ipc:shinobi:projects] lists the projects once the engine is installed, newest first, with media, renders and a cover', async () => {
    installEngine()
    const project = (id, name, assets) => write(dataFile('shinobi', 'projects', id, 'project.json'), { name, created_at: '2026-11-01T10:00:00Z', assets })
    project('older', 'Older film', [])
    const old = new Date(Date.now() - 3600_000)
    fs.utimesSync(dataFile('shinobi', 'projects', 'older', 'project.json'), old, old)
    project('newer', 'Newer film', [{ id: 'a1', name: 'clip', path: 'media/clip.mp4', kind: 'video' }])
    write(dataFile('shinobi', 'projects', 'newer', 'media', 'clip.mp4'), 'x')
    write(dataFile('shinobi', 'projects', 'newer', 'out', 'film.mp4'), 'x')
    write(dataFile('shinobi', 'projects', 'newer', '.openkatana', 'jobs', 'j1', 'job.json'), { id: 'j1', state: 'done', created_at: '2026-11-02T10:00:00Z', video: 'out/film.mp4' })
    const r = await ok('shinobi_status')
    assert.equal(r.installed, true)
    assert.deepEqual(r.projects.map((p) => [p.id, p.name, p.assets, p.renders]), [['newer', 'Newer film', 1, 1], ['older', 'Older film', 0, 0]])
    assert.equal(r.projects[0].cover, dataFile('shinobi', 'projects', 'newer', 'out', 'film.mp4'))
    assert.equal(r.projects[1].cover, null)
  })

  // ---------- shinobi_project ----------
  test('[mcp:shinobi_project][ipc:shinobi:project] gives a project\'s media with full paths, the saved edit\'s shape, its renders and the brief', async () => {
    const dir = dataFile('shinobi', 'projects', 'film-1')
    write(path.join(dir, 'project.json'), { name: 'Film one', assets: [{ id: 'a1', name: 'shot.mp4', path: 'media/shot.mp4' }, { id: 'a2', name: 'song.wav', path: 'media/song.wav' }, { id: 'a3', name: 'logo.png', path: 'media/logo.png' }] })
    write(path.join(dir, 'timeline.json'), { canvas: { w: 1920, h: 1080, fps: 30, frames: 150 }, shots: [{ id: 's1' }, { id: 's2' }], clips: { c1: {}, c2: {}, c3: {} }, text: [{ id: 't1' }] })
    write(path.join(dir, 'iv-brief.md'), '# Film one\nCut it on the beat.\n')
    write(path.join(dir, 'out', 'cut.mp4'), 'x')
    write(path.join(dir, '.openkatana', 'jobs', 'job-a', 'job.json'), { id: 'job-a', request_id: 'r1', state: 'done', created_at: '2026-11-01T10:00:00Z', video: 'out/cut.mp4' })
    write(path.join(dir, '.openkatana', 'jobs', 'job-b', 'job.json'), { id: 'job-b', state: 'failed', created_at: '2026-11-03T10:00:00Z', error: 'out of memory' })
    const r = await ok('shinobi_project', { projectId: 'film-1' })
    assert.equal(r.name, 'Film one')
    assert.equal(r.dir, dir)
    assert.deepEqual(r.assets.map((a) => [a.id, a.kind, a.path]), [['a1', 'video', path.join(dir, 'media/shot.mp4')], ['a2', 'audio', path.join(dir, 'media/song.wav')], ['a3', 'image', path.join(dir, 'media/logo.png')]])
    assert.deepEqual(r.timeline, { width: 1920, height: 1080, fps: 30, seconds: 5, shots: 2, clips: 3, texts: 1 })
    assert.deepEqual(r.renders.map((x) => [x.id, x.state, x.video, x.error]), [['job-b', 'failed', null, 'out of memory'], ['job-a', 'done', path.join(dir, 'out/cut.mp4'), null]], 'newest render first; a render whose video is missing has none')
    assert.equal(r.brief, '# Film one\nCut it on the beat.\n')
  })

  test('[mcp:shinobi_project] has no timeline and an empty brief for a project that was only created, and says when the project is not there', async () => {
    write(dataFile('shinobi', 'projects', 'empty', 'project.json'), { name: 'Empty' })
    const r = await ok('shinobi_project', { projectId: 'empty' })
    assert.equal(r.timeline, null)
    assert.deepEqual(r.assets, [])
    assert.deepEqual(r.renders, [])
    assert.equal(r.brief, '')
    await fails('shinobi_project', { projectId: 'nope' }, /No Shinobi project nope/)
    await fails('shinobi_project', { projectId: '../../etc' }, /Bad project id\./)
  })

  // ---------- the tools that run the engine (shinobi_setup, shinobi_tools, shinobi: no row-id tests) ----------
  test('guard refuses uv for shinobi_setup: the download is turned back and no engine is installed', async () => {
    removeEngine()
    await fails('shinobi_setup', {}, /refused a fetch/)
    assert.ok(!fs.existsSync(dataFile('shinobi', 'installed.json')), 'no install marker')
    assert.ok(!fs.existsSync(dataFile('shinobi', 'venv')), 'no Python environment')
  })

  test('guard refuses python for shinobi_tools and shinobi: without the engine they say to set it up, with it they stop at the Python', async () => {
    removeEngine()
    await fails('shinobi_tools', {}, /Set up Shinobi first/)
    await fails('shinobi', { tool: 'get_project', arguments: { project_id: 'x' } }, /Set up Shinobi first/)
    installEngine()
    const before = (await mcp.refusals()).length
    await fails('shinobi_tools', {}, /refused to start "python"/)
    await fails('shinobi', { tool: 'get_project', arguments: { project_id: 'x' } }, /refused to start "python"/)
    const refused = (await mcp.refusals()).slice(before)
    assert.equal(refused.length, 2)
    assert.ok(refused.every((r) => r.command === 'python'))
  })
})
