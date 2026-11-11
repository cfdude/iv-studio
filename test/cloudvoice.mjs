// Voices on the person's own cloud (src/service/cloudvoice.js, resources/cloud/voicehost.py through the real gate.py),
// without a cloud or a GPU: the gate runs locally with a stand-in voice worker that answers like voice_server.py.
//   node test/cloudvoice.mjs [python-with-aiohttp]
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CloudVoiceEngine } from '../src/service/cloudvoice.js'
import { Comfy } from '../src/service/comfy.js'
import { Voices } from '../src/service/voices.js'
import { RunPod } from '../src/service/runpod.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(ROOT, 'resources')
const PY = process.argv[2] || path.join(process.env.APPDATA || '', 'IV Studio', 'voiceengine', 'venv', 'Scripts', 'python.exe')
let pass = 0
let fail = 0
const ok = (cond, what) => (cond ? (pass++, console.log(`  ok   ${what}`)) : (fail++, console.log(`  FAIL ${what}`)))

// a stand-in for voice_server.py: same protocol, no models. speak copies the reference to out; design writes a
// tiny WAV; transcribe answers with the file's size.
const WORKER = `
import json, sys, os, shutil
replies = sys.stdout
send = lambda o: (replies.write(json.dumps(o) + "\\n"), replies.flush())
send({"ready": True})
for line in sys.stdin:
    req = json.loads(line)
    op = req.get("op")
    try:
        if op == "speak":
            shutil.copyfile(req["ref_wav"], req["out"])
            send({"id": req["id"], "ok": True, "file": req["out"], "duration": 1.0, "said": req["text"], "seed": req.get("seed")})
        elif op == "design":
            open(req["out"], "wb").write(b"RIFF-designed-" + req["description"].encode())
            send({"id": req["id"], "ok": True, "file": req["out"], "duration": 0.5})
        elif op == "transcribe":
            send({"id": req["id"], "ok": True, "text": "heard %d bytes" % os.path.getsize(req["file"])})
        else:
            raise ValueError("unknown op")
    except Exception as e:
        send({"id": req.get("id"), "error": str(e)})
`

function compileTest() {
  console.log('voicehost.py compiles')
  if (!fs.existsSync(PY)) return console.log('  skip (no Python)')
  try {
    execFileSync(PY, ['-c', `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())`, path.join(RES, 'cloud', 'voicehost.py')])
    ok(true, 'voicehost.py')
  } catch (e) {
    ok(false, `voicehost.py: ${e.stderr}`)
  }
}

async function gateTests() {
  console.log('the gate’s voice routes (local, stand-in worker)')
  if (!fs.existsSync(PY)) return console.log(`  skip (no Python with aiohttp at ${PY})`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-cloudvoice-'))
  const models = path.join(tmp, 'voice')
  for (const m of ['voxcpm2', 'whisper']) (fs.mkdirSync(path.join(models, m), { recursive: true }), fs.writeFileSync(path.join(models, m, '.revision'), 'x'))
  const worker = path.join(tmp, 'worker.py')
  fs.writeFileSync(worker, WORKER)
  const port = 18500 + Math.floor(Math.random() * 400)
  const url = `http://127.0.0.1:${port}`
  const gate = spawn(PY, [path.join(RES, 'cloud', 'gate.py')], {
    env: { ...process.env, PYTHONPATH: path.join(RES, 'cloud'), IV_TOKEN: 'tok', IV_PLATFORM: 'runpod', IV_STATUS_FILE: path.join(tmp, 'status.json'), IV_MODELS_DIR: path.join(tmp, 'models'), IV_GATE_PORT: String(port), IV_UPSTREAM: 'http://127.0.0.1:9', IV_VOICE_PYTHON: PY, IV_VOICE_MODELS: models, IV_VOICE_SCRIPT: worker },
    windowsHide: true
  })
  let err = ''
  gate.stderr.on('data', (d) => (err += d))
  try {
    const rp = new RunPod({ resourcesDir: RES, key: () => 'unused' })
    for (let i = 0; i < 50 && !(await rp.health(url)); i++) await new Promise((r) => setTimeout(r, 200))
    ok((await fetch(`${url}/iv/voice`)).status === 401, 'voice routes need the token')
    const c = new Comfy(url, 'test', 'tok')
    const st = await c.req('/iv/voice')
    ok(st.installed && !st.running && st.canInstall, 'status: set up, not running, can be set up here (RunPod)')

    let ready = true
    const engine = new CloudVoiceEngine({ provider: 'runpod', comfy: () => c, ready: () => ready, setUp: async () => {}, pollMs: 100 })
    const ref = path.join(tmp, 'ref.wav')
    fs.writeFileSync(ref, Buffer.from(Array.from({ length: 48000 }, (_, i) => i % 256)))
    const out = path.join(tmp, 'lines', 'line.wav')
    const said = await engine.call('speak', { text: 'Of course it is late.', out, ref_wav: ref, ref_text: 'hi', seed: 41 })
    ok(fs.existsSync(out) && fs.readFileSync(out).equals(fs.readFileSync(ref)) && said.file === out && said.said === 'Of course it is late.' && said.seed === 41, 'speak: the reference goes up, the line comes back into the file asked for, with the words and seed')
    ok((await c.req('/iv/voice')).running, 'the worker stays up between lines')
    const heard = await engine.call('transcribe', { file: ref })
    ok(heard.text === 'heard 48000 bytes', 'transcribe: the recording goes up whole and its words come back')
    const designed = path.join(tmp, 'd.wav')
    await engine.call('design', { text: 'Hi', description: 'warm, low', out: designed, seed: 1 })
    ok(fs.readFileSync(designed, 'utf8') === 'RIFF-designed-warm, low', 'design: the description reaches the worker and the take comes back')
    ok(!fs.readdirSync(os.tmpdir()).some((d) => d.startsWith('ivvoice-') && fs.statSync(path.join(os.tmpdir(), d)).mtimeMs > Date.now() - 60000 && fs.readdirSync(path.join(os.tmpdir(), d)).length), 'the gate leaves no files behind')

    // a render gets the whole GPU: a ComfyUI prompt stops the worker (ComfyUI itself is down here, so it answers 503)
    const prompt = await fetch(`${url}/prompt`, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: '{}' })
    ok(prompt.status === 503 && !(await c.req('/iv/voice')).running, 'a queued render stops the voice engine')
    await engine.call('transcribe', { file: ref })
    ok((await c.req('/iv/voice')).running, 'the next line starts it again')
    await c.req('/iv/voice/release', { method: 'POST', json: {} })
    ok(!(await c.req('/iv/voice')).running, 'release stops it')

    const bad = await c.req('/iv/voice/run', { method: 'POST', json: { op: 'rm -rf' } }).then(() => null, (e) => e)
    ok(bad?.status === 400, 'an unknown op is refused')
    ready = false
    ok(await engine.call('speak', { text: 'x', out, ref_wav: ref }).then(() => false, (e) => /Set up voices for the cloud/.test(e.message)), 'not set up in the cloud: says to set it up, sends nothing')
    ok(engine.status().installed === false && engine.status().setup.where === 'cloud', 'status: not set up, and the setup is the cloud’s')
    ok((() => (engine.release(), true))(), 'release asks nothing of the cloud (it would wake a GPU)')

    // the voice models gone (a new volume): the gate says to set voices up
    fs.rmSync(path.join(models, 'whisper', '.revision'))
    ready = true
    ok(await engine.call('transcribe', { file: ref }).then(() => false, (e) => /Set up voices/.test(e.message)), 'models missing in the cloud: says to set voices up')
  } finally {
    gate.kill()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (err.includes('Traceback')) ok(false, `gate printed a traceback:\n${err.slice(-2000)}`)
}

async function voicesTests() {
  console.log('Voices uses the cloud engine while rendering there')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-voices-cloud-'))
  try {
    const calls = []
    let cloudOn = true
    const stand = { status: () => ({ installed: true, setup: { models: [], size: 1, where: 'cloud' }, cloud: 'modal' }), install: async () => ({}), call: async (op, a) => (calls.push(op), fs.mkdirSync(path.dirname(a.out), { recursive: true }), fs.writeFileSync(a.out, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(24), Buffer.from([0x80, 0xbb, 0, 0]), Buffer.from('data'), Buffer.from([0x80, 0xbb, 0, 0])])), { file: a.out }), release: () => calls.push('release') }
    const v = new Voices({ dataDir: tmp, resourcesDir: RES, ffmpeg: 'ffmpeg', cloud: () => (cloudOn ? stand : null) })
    ok(v.status().cloud === 'modal' && v.status().ready, 'status comes from the cloud engine')
    fs.mkdirSync(path.join(tmp, 'voices', 'v1'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'voices', 'v1', 'reference.wav'), 'x')
    v.write({ id: 'v1', name: 'Tess', text: 'hello', reference: path.join(tmp, 'voices', 'v1', 'reference.wav'), createdAt: new Date().toISOString() })
    const line = await v.speak({ voiceId: 'v1', text: 'Of course it is late.' })
    ok(calls.includes('speak') && fs.existsSync(line.file), 'a line is spoken by the cloud engine')
    cloudOn = false
    ok(v.eng() === v.engine && !v.status().cloud, 'back on this PC: the PC’s engine')
    await v.release()
    clearTimeout(v.idle)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function packagingTests() {
  console.log('what the cloud is given')
  const cloud = JSON.parse(fs.readFileSync(path.join(RES, 'cloud', 'cloud.json'), 'utf8'))
  const local = fs.readFileSync(path.join(ROOT, 'src', 'service', 'voiceengine.js'), 'utf8').match(/VOICE_PACKAGES = (\[[^\]]+\])/)[1]
  ok(JSON.stringify(cloud.voice.packages) === JSON.stringify(JSON.parse(local.replace(/'/g, '"'))), 'the cloud’s voice packages are the PC’s, pin for pin')
  const rp = new RunPod({ resourcesDir: RES, key: () => 'k' })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-voice-bundle-'))
  fs.writeFileSync(path.join(dir, 'b.tgz'), Buffer.from(rp.bundle(), 'base64'))
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xzf', path.join(dir, 'b.tgz'), '-C', dir])
  ok(fs.existsSync(path.join(dir, 'voicehost.py')) && fs.readFileSync(path.join(dir, 'voice_server.py'), 'utf8') === fs.readFileSync(path.join(RES, 'python', 'voice_server.py'), 'utf8'), 'RunPod: the pod gets voicehost.py and the PC’s own voice_server.py')
  fs.rmSync(dir, { recursive: true, force: true })
  const app = fs.readFileSync(path.join(RES, 'cloud', 'modal_app.py'), 'utf8')
  ok(/uv venv \/opt\/voice\/venv/.test(app) && /IV_VOICE_PYTHON/.test(app) && /def fetch_voice/.test(app) && /voicehost\.py/.test(app), 'Modal: the image has the voice environment and files; a CPU function downloads its models')
}

compileTest()
await gateTests()
await voicesTests()
packagingTests()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
