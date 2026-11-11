// IV Studio's voice engine on the person's own cloud (RunPod, Modal): the same worker as on a PC
// (resources/python/voice_server.py), run beside ComfyUI by the gate (resources/cloud/voicehost.py). It has the
// local engine's interface (status, install, call, release), so Voices uses either without knowing which. Files go
// both ways as base64; a job is started and then asked about, so a first line (which loads VoxCPM2) never runs
// into a web timeout.
import fs from 'node:fs'
import path from 'node:path'
import { VOICE_SETUP } from './voiceengine.js'

export class CloudVoiceEngine {
  // comfy: () => the ComfyUI client for the cloud (its token, and on RunPod the waker that starts a pod).
  // ready: () => whether voices were set up there. setUp: async () => sets them up (provider-specific, the app).
  constructor({ comfy, ready, setUp, provider, pollMs = 1500 }) {
    this.comfy = comfy
    this.ready = ready
    this.setUp = setUp
    this.provider = provider
    this.pollMs = pollMs
    this.installing = null
  }

  status() {
    return { installed: !!this.ready(), installing: !!this.installing, running: false, cloud: this.provider, setup: { ...VOICE_SETUP, where: 'cloud' } }
  }

  install() {
    if (this.ready()) return Promise.resolve(this.status())
    this.installing ||= Promise.resolve(this.setUp()).finally(() => (this.installing = null))
    return this.installing.then(() => this.status())
  }

  async call(op, args = {}) {
    if (!this.ready()) throw new Error('Set up voices for the cloud first: Audio > Voices > Set up voices.')
    const c = this.comfy()
    const body = { op }
    for (const k of ['text', 'description', 'ref_text', 'seed']) if (args[k] !== undefined) body[k] = args[k]
    if (args.ref_wav) body.ref_wav = fs.readFileSync(args.ref_wav).toString('base64')
    if (args.file) body.file = fs.readFileSync(args.file).toString('base64')
    // a cold GPU takes a few minutes to answer the first request
    const { id } = await c.req('/iv/voice/run', { method: 'POST', json: body, timeout: 600000 })
    for (;;) {
      await new Promise((r) => setTimeout(r, this.pollMs))
      let job
      try {
        job = await c.req(`/iv/voice/job?id=${encodeURIComponent(id)}`, { timeout: 60000 })
      } catch (err) {
        if (err.status === 404) throw new Error('The cloud GPU restarted while it was speaking. Try again.')
        if (err.busy || err.starting) continue
        throw err
      }
      if (job.state === 'running') continue
      if (job.state === 'error') throw new Error(job.error || 'The voice engine in the cloud stopped.')
      const { wav, ...result } = job.result || {}
      if (wav && args.out) {
        fs.mkdirSync(path.dirname(args.out), { recursive: true })
        fs.writeFileSync(`${args.out}.part`, Buffer.from(wav, 'base64'))
        fs.renameSync(`${args.out}.part`, args.out)
        result.file = args.out
      }
      return result
    }
  }

  // Nothing to do here: the gate stops the worker by itself (when a render is queued, and after 10 idle minutes).
  // Asking it would wake a GPU that has already shut down (Modal starts a container, RunPod's waker a pod).
  release() {}
}
