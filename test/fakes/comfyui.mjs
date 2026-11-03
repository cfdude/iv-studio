// A fake ComfyUI HTTP server for the default test suite. In-process, ephemeral port, canned answers.
// It covers the routes IV Studio calls (see src/service/comfy.js). Nothing here renders anything.
//
//   const fake = await startFakeComfy({ devices: 'mps' })
//   const comfy = new Comfy(fake.url)
//   ...
//   await fake.close()
import { randomUUID } from 'node:crypto'
import http from 'node:http'

const GB = 1024 ** 3

// What /system_stats reports as "devices". 'mps' is what ComfyUI reports on Apple Silicon. system.os is sys.platform: 'linux', 'win32' or 'darwin'.
export const DEVICE_PROFILES = {
  cuda: { name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 25757220864, vram_free: 24000000000, torch_vram_total: 25757220864, torch_vram_free: 24000000000 },
  mps: { name: 'mps', type: 'mps', index: null, vram_total: 68719476736, vram_free: 60000000000, torch_vram_total: 68719476736, torch_vram_free: 60000000000 }
}

const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

// Just enough multipart to find the file part and the plain fields.
function parseMultipart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '')
  const fields = {}
  let file = null
  if (!boundary) return { fields, file }
  const parts = buf.toString('latin1').split(`--${boundary[1] || boundary[2]}`).slice(1, -1)
  for (const part of parts) {
    const cut = part.indexOf('\r\n\r\n')
    const head = part.slice(0, cut)
    const body = part.slice(cut + 4, part.length - 2)
    const name = /name="([^"]*)"/.exec(head)?.[1]
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    if (filename !== undefined) file = { name: filename, size: Buffer.byteLength(body, 'latin1') }
    else if (name) fields[name] = body
  }
  return { fields, file }
}

export async function startFakeComfy({ devices = 'cuda', os = 'linux', version = '0.3.99', objectInfo = {}, models = {} } = {}) {
  const state = {
    devices,
    os,
    version,
    objectInfo,
    models,
    view: Buffer.from('fake-bytes'),
    history: {},
    pending: [],
    running: [],
    hold: 0,
    failures: {}
  }
  const requests = []
  const prompts = []
  const uploads = []

  const stats = () => ({
    system: { os: state.os, comfyui_version: state.version, python_version: '3.12.0', pytorch_version: '2.9.0', embedded_python: false, argv: ['main.py'], ram_total: 64 * GB, ram_free: 32 * GB },
    devices: Array.isArray(state.devices) ? state.devices : [DEVICE_PROFILES[state.devices] || DEVICE_PROFILES.cuda]
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake')
    const route = url.pathname
    const raw = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req)
    const isJson = (req.headers['content-type'] || '').includes('application/json')
    const body = isJson && raw.length ? JSON.parse(raw.toString('utf8')) : undefined
    requests.push({ method: req.method, path: route, query: Object.fromEntries(url.searchParams), json: body })

    const fail = state.failures[route]
    if (fail) return json(res, fail.status, { error: { type: 'fake_failure', message: fail.message } })

    if (req.method === 'GET') {
      if (route === '/system_stats') return json(res, 200, stats())
      if (route === '/object_info') return json(res, 200, state.objectInfo)
      if (route.startsWith('/object_info/')) {
        const cls = decodeURIComponent(route.slice('/object_info/'.length))
        return json(res, 200, state.objectInfo[cls] ? { [cls]: state.objectInfo[cls] } : {})
      }
      if (route === '/history') return json(res, 200, state.history)
      if (route.startsWith('/history/')) {
        const id = decodeURIComponent(route.slice('/history/'.length))
        return json(res, 200, state.history[id] ? { [id]: state.history[id] } : {})
      }
      if (route === '/queue') return json(res, 200, { queue_running: state.running, queue_pending: state.pending })
      if (route === '/view') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': state.view.length })
        return res.end(state.view)
      }
      if (route === '/models') return json(res, 200, Object.keys(state.models))
      if (route.startsWith('/models/')) {
        const folder = decodeURIComponent(route.slice('/models/'.length))
        return state.models[folder] ? json(res, 200, state.models[folder]) : json(res, 404, {})
      }
    }

    if (req.method === 'POST') {
      if (route === '/prompt') {
        const id = randomUUID()
        prompts.push({ id, prompt: body?.prompt, client_id: body?.client_id, extra_data: body?.extra_data, front: !!body?.front })
        if (state.hold > 0) {
          state.hold--
          state.pending.push([state.pending.length + 1, id, body?.prompt, body?.extra_data || {}, []])
        } else {
          state.history[id] = {
            prompt: [0, id, body?.prompt, body?.extra_data || {}, []],
            outputs: { 1: { images: [{ filename: 'fake_00001_.png', subfolder: '', type: 'output' }] } },
            status: { status_str: 'success', completed: true, messages: [] }
          }
        }
        return json(res, 200, { prompt_id: id, number: prompts.length, node_errors: {} })
      }
      if (route === '/queue') {
        const gone = new Set(body?.delete || [])
        if (body?.clear) state.pending = []
        state.pending = state.pending.filter((item) => !gone.has(item[1]))
        return json(res, 200, {})
      }
      if (route === '/interrupt') {
        state.running = state.running.filter((item) => item[1] !== body?.prompt_id)
        return json(res, 200, {})
      }
      if (route === '/free') return json(res, 200, {})
      if (route === '/history') {
        for (const id of body?.delete || []) delete state.history[id]
        if (body?.clear) state.history = {}
        return json(res, 200, {})
      }
      if (route === '/upload/image') {
        const { fields, file } = parseMultipart(raw, req.headers['content-type'])
        const up = { name: file?.name, size: file?.size, subfolder: fields.subfolder || '', type: fields.type || 'input' }
        uploads.push(up)
        return json(res, 200, { name: up.name, subfolder: up.subfolder, type: up.type })
      }
    }

    json(res, 404, { error: `fake ComfyUI has no ${req.method} ${route}` })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    prompts,
    uploads,
    state,
    setDevices: (d) => (state.devices = d),
    setObjectInfo: (info) => (state.objectInfo = info),
    setModels: (m) => (state.models = m),
    setView: (buf) => (state.view = buf),
    // The next n prompts sit in the queue instead of finishing.
    holdNextPrompt: (n = 1) => (state.hold = n),
    // Make a route answer with an error; pass null to clear it.
    failRoute: (route, status, message = 'fake failure') => (status ? (state.failures[route] = { status, message }) : delete state.failures[route]),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
