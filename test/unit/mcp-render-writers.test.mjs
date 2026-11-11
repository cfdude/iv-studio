// MCP tools for reviewing a take and writing prompts (task 5.4), called through the real MCP server on source under
// the test guard, against the fake ComfyUI and the claude and codex shims (design D1, D8). The shims are replaced per
// test with ones that record how they were called and answer in the shape the app asks for. One fake and one server
// for the file.
//   node --test test/unit/mcp-render-writers.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { guardState } from '../fakes/ports.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'

// what the claude shim and the codex shim answer for a text-mode writer, a story and a take review
const WRITER = { direction: { purpose: 'A walk in the rain.', staging: 'She walks screen-left to screen-right.' }, style: 'Live-action, soft light.', shots: [{ start_seconds: 0, description: 'A woman in a red coat walks along a rainy street, the camera holds a static shot.' }], soundscape: 'Rain.', music: 'N/A' }
const REVIEW = { verdict: 'usable_with_fixes', works: ['The light holds'], issues: [{ from: 1, to: 2, kind: 'anatomy', what: 'A hand glitches', unmet: false }], fix: { kind: 'revise_prompt', why: 'Say what the hands do.', clean_from: 0, clean_to: 0 }, revised_prompt: 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street with her hands in her coat pockets.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A' }

describe('MCP review and prompt writer tools', () => {
  let fake, mcp, shimDir, take
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
  const readData = (...p) => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, ...p), 'utf8'))
  // a previews job that has finished on the fake and been read back, with one take on disk for each candidate
  const finished = async (args = {}) => {
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none', ...args })
    const gif = { gifs: [{ filename: 'take.mp4', subfolder: 'H3/previews', type: 'output', fullpath: take }] }
    fake.state.history[job.promptId].outputs = { 42: gif, 118: gif, 128: gif }
    return ok('get_job', { jobId: job.id })
  }
  // replaces a shim with one that records its arguments and input beside it and answers with `body`
  const shim = (name, body) => {
    const file = path.join(shimDir, name)
    fs.rmSync(`${file}.args`, { force: true })
    fs.writeFileSync(file, `#!/bin/sh\necho "$@" > "$0.args"\ncat > "$0.stdin"\n${body}`, { mode: 0o755 })
  }
  const claudeAnswers = (obj) => shim('claude', `cat <<'JSON'\n${JSON.stringify({ is_error: false, result: '', structured_output: obj })}\nJSON\n`)
  const codexAnswers = (obj) => shim('codex', `out=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done\ncat > "$out" <<'JSON'\n${JSON.stringify(obj)}\nJSON\n`)
  const sawArgs = (name) => fs.readFileSync(path.join(shimDir, `${name}.args`), 'utf8')
  const sawInput = (name) => fs.readFileSync(path.join(shimDir, `${name}.stdin`), 'utf8')

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url, shims: true, settings: { promptEngine: 'claude' } })
    shimDir = [...guardState().shimDirs].at(-1)
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    take = path.join(dir, 'take.mp4')
    execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', take])
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- review_take ----------
  test('[mcp:review_take] has Claude Code look at six frames of the take and saves the review on the job', async () => {
    const job = await finished({ projectName: 'Reviewed shot' })
    claudeAnswers(REVIEW)
    const review = await ok('review_take', { jobId: job.id, candidate: 2 })
    assert.equal(review.verdict, 'usable_with_fixes')
    assert.deepEqual(review.works, ['The light holds'])
    assert.deepEqual(review.issues, [{ from: 1, to: 2, kind: 'anatomy', what: 'A hand glitches', unmet: false }])
    assert.deepEqual(review.fix, { kind: 'revise_prompt', label: 'Revise the prompt', why: 'Say what the hands do.' })
    assert.match(review.revisedPrompt, /with her hands in her coat pockets/)
    assert.deepEqual(review.revisedErrors, [])
    assert.equal(review.engine, 'claude')
    // saved under the take's number, and what Claude Code was given
    assert.equal(readData('jobs', `${job.id}.json`).reviews['2'].fix.kind, 'revise_prompt')
    assert.match(sawArgs('claude'), /^-p --output-format json --json-schema .* --tools Read --strict-mcp-config --no-session-persistence --system-prompt-file /)
    const input = sawInput('claude')
    assert.equal(input.match(/^frame-\d-at-[\d.]+s\.jpg:/gm).length, 6)
    assert.match(input, /A woman walks along a rainy street/)
    assert.match(input, /made in Text mode/)
    assert.deepEqual(await mcp.refusals(), [])
  })

  test('[mcp:review_take] keeps a clean stretch\'s bounds and drops guesses about words nobody heard', async () => {
    const job = await finished({ projectName: 'Stretch shot' })
    claudeAnswers({ ...REVIEW, issues: [{ from: 0, to: 1, kind: 'words', what: 'A line is cut off', unmet: true }, { from: 1.234, to: 2, kind: 'identity', what: 'The face changes', unmet: true }], fix: { kind: 'clean_stretch', why: 'The first second is clean.', clean_from: 0.04, clean_to: 1.26 }, revised_prompt: '' })
    const review = await ok('review_take', { jobId: job.id, candidate: 1 })
    assert.deepEqual(review.issues.map((i) => [i.kind, i.from]), [['identity', 1.2]])
    assert.deepEqual(review.fix, { kind: 'clean_stretch', label: 'Use the clean stretch', why: 'The first second is clean.', from: 0, to: 1.3 })
    assert.equal(review.revisedPrompt, '')
  })

  test('[mcp:review_take] says when there is no take to look at and refuses an unknown job', async () => {
    fake.holdNextPrompt(1)
    const waiting = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    await fails('review_take', { jobId: waiting.id, candidate: 1 }, /That take has no video on this PC to review\./)
    fake.releaseHeld()
    await fails('review_take', { jobId: 'nope' }, /No job nope/)
    await fails('review_take', { jobId: waiting.id, candidate: 4 }, /candidate/i)
  })

  // ---------- write_prompt ----------
  test('[mcp:write_prompt] writes an H3 prompt through the claude shim from the idea, in the app\'s shape', async () => {
    claudeAnswers(WRITER)
    const r = await ok('write_prompt', { idea: 'a woman walks in the rain', engine: 'claude', character: 'none' })
    assert.deepEqual(r, { prompt: 'integrated_multimodal_description: [Shot 1] Live-action, soft light. A woman in a red coat walks along a rainy street, the camera holds a static shot.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A', engine: 'claude' })
    assert.match(sawArgs('claude'), /^-p --output-format json --json-schema /)
    assert.match(sawInput('claude'), /a woman walks in the rain/)
    assert.match(sawInput('claude'), /Answer with the JSON object only\./)
    assert.deepEqual(await mcp.refusals(), [])
  })

  test('[mcp:write_prompt] writes the same through the codex shim, which answers in the file it is given', async () => {
    codexAnswers(WRITER)
    const r = await ok('write_prompt', { idea: 'a woman walks in the rain', engine: 'codex', character: 'none' })
    assert.equal(r.engine, 'codex')
    assert.match(r.prompt, /^integrated_multimodal_description: \[Shot 1\] Live-action, soft light\. A woman in a red coat walks/)
    assert.match(sawArgs('codex'), /^exec --skip-git-repo-check --ephemeral --ignore-user-config .*--sandbox read-only .*--output-schema .* -o .* -\n$/)
    assert.match(sawInput('codex'), /a woman walks in the rain/)
  })

  test('[mcp:write_prompt] uses the writer chosen in Settings when no engine is passed, and names the character as {char}', async () => {
    claudeAnswers({ ...WRITER, shots: [{ start_seconds: 0, description: 'Tess stands at a bus stop in the rain, the camera holds a static shot.' }] })
    const r = await ok('write_prompt', { idea: 'Tess waits for the bus' })
    assert.equal(r.engine, 'claude')
    assert.match(r.prompt, /\[Shot 1\] Live-action, soft light\. \{char\} stands at a bus stop/)
    assert.match(sawInput('claude'), /Tess waits for the bus/)
  })

  test('[mcp:write_prompt] says so when there is no idea, when the writer stops, and when it returns nothing usable', async () => {
    await fails('write_prompt', { idea: '  ', engine: 'claude' }, /Describe the idea first\./)
    shim('claude', 'echo "login expired, run claude to sign in" >&2\nexit 1\n')
    await fails('write_prompt', { idea: 'a woman walks', engine: 'claude', character: 'none' }, /login expired, run claude to sign in/)
    claudeAnswers({ canned: true })
    await fails('write_prompt', { idea: 'a woman walks', engine: 'claude', character: 'none' }, /The writer returned no shots\. Try again\./)
    await fails('write_prompt', { idea: 'a woman walks', engine: 'gemini' }, /engine/i)
  })

  // ---------- write_shots_from_story ----------
  test('[mcp:write_shots_from_story] splits a story into one H3 prompt per shot through the claude shim', async () => {
    const shot = (text) => ({ ...WRITER, shots: [{ start_seconds: 0, description: text }] })
    claudeAnswers({ prompts: [shot('A woman walks into the bus shelter, the camera holds a static shot.'), shot('She sits down and looks at the rain, the camera holds a static shot.')] })
    const { shots } = await ok('write_shots_from_story', { story: 'A woman walks into a bus shelter. She sits and watches the rain.', shots: 2, character: 'none' })
    assert.equal(shots.length, 2)
    assert.match(shots[0], /^integrated_multimodal_description: \[Shot 1\] Live-action, soft light\. A woman walks into the bus shelter/)
    assert.match(shots[1], /She sits down and looks at the rain/)
    assert.ok(shots.every((s) => /overall_soundscape: Rain\./.test(s) && /non_diegetic_music: N\/A/.test(s)))
    assert.match(sawInput('claude'), /Story: A woman walks into a bus shelter\. She sits and watches the rain\./)
    assert.match(sawArgs('claude'), /--system-prompt-file/)
    assert.deepEqual(await mcp.refusals(), [])
  })

  test('[mcp:write_shots_from_story] needs a story, a shot count from 1 to 8 and a writer that answers with a shot list', async () => {
    await fails('write_shots_from_story', { story: '   ' }, /Write the story first\./)
    await fails('write_shots_from_story', { story: 'x', shots: 9 }, /shots/i)
    await fails('write_shots_from_story', { story: 'x', shots: 0 }, /shots/i)
    claudeAnswers({})
    await fails('write_shots_from_story', { story: 'A woman walks.', shots: 1, character: 'none' }, /The writer did not return a shot list\. Try again\./)
  })
})
