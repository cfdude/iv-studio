// A fake ComfyUI HTTP server for the default test suite. In-process, ephemeral port, canned answers.
// It covers the routes IV Studio calls (see src/service/comfy.js). Nothing here renders anything.
//
//   const fake = await startFakeComfy({ devices: 'mps' })
//   const comfy = new Comfy(fake.url)
//   ...
//   await fake.close()
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import nodeOs from 'node:os'
import path from 'node:path'
import { registerPort, unregisterPort } from './ports.mjs'

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

const text = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
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
    failNext: null,
    failures: {},
    // ComfyUI-Manager (comfyupdate.js): present, its security level, versions, packs and queue
    manager: {
      present: true,
      security: false,
      version: 'V3.37',
      policy: 'stable',
      current: 'v0.3.99',
      versions: ['v0.3.99', 'v0.4.2', 'nightly'],
      packs: {
        'pack-a': { id: 'pack-a', title: 'Pack A', state: 'enabled', 'update-state': 'true' },
        'pack-b': { id: 'pack-b', title: 'Pack B', state: 'enabled', 'update-state': 'false' }
      },
      snapshots: [],
      restored: null,
      rebooted: 0,
      queued: 0,
      doneCount: 0,
      totalCount: 0
    }
  }
  // a throwaway ComfyUI folder: custom_nodes and one models/<kind> folder per model kind, removed on close
  const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'iv-fake-comfy-')))
  const folderFor = (kind) => {
    const dir = path.join(dataDir, 'models', kind)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  fs.mkdirSync(path.join(dataDir, 'custom_nodes'), { recursive: true })
  const sockets = new Set()
  const wsFrame = (text) => {
    const body = Buffer.from(text)
    const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
    return Buffer.concat([head, body])
  }
  const wsSend = (obj) => {
    for (const s of sockets) s.write(wsFrame(JSON.stringify(obj)))
  }
  const finish = (id, prompt, extra) => {
    if (state.failNext) {
      const message = state.failNext
      state.failNext = null
      state.history[id] = { prompt: [0, id, prompt, extra || {}, []], outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', { prompt_id: id, exception_message: message }]] } }
      return
    }
    state.history[id] = {
      prompt: [0, id, prompt, extra || {}, []],
      outputs: { 1: { images: [{ filename: 'fake_00001_.png', subfolder: '', type: 'output' }] } },
      status: { status_str: 'success', completed: true, messages: [] }
    }
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
      if (route === '/history') {
        const max = Number(url.searchParams.get('max_items'))
        const entries = Object.entries(state.history)
        return json(res, 200, max > 0 ? Object.fromEntries(entries.slice(-max)) : state.history)
      }
      if (route.startsWith('/history/')) {
        const id = decodeURIComponent(route.slice('/history/'.length))
        return json(res, 200, state.history[id] ? { [id]: state.history[id] } : {})
      }
      if (route === '/queue') return json(res, 200, { queue_running: state.running, queue_pending: state.pending })
      if (route === '/view') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': state.view.length })
        return res.end(state.view)
      }
      if (route === '/experiment/models') return json(res, 200, Object.keys(state.models).map((name) => ({ name, folders: [folderFor(name)] })))
      if (route === '/internal/folder_paths') {
        const out = { custom_nodes: [path.join(dataDir, 'custom_nodes')] }
        for (const name of Object.keys(state.models)) out[name] = [folderFor(name)]
        return json(res, 200, out)
      }
      const m = state.manager
      if (/^\/(manager|customnode|comfyui_manager|snapshot)\//.test(route)) {
        if (!m.present) return json(res, 404, {})
        if (m.security) return json(res, 403, {})
        if (route === '/manager/version') return text(res, m.version)
        if (route === '/manager/policy/update') return text(res, m.policy)
        if (route === '/manager/queue/status') return json(res, 200, { is_processing: m.queued > 0, done_count: m.doneCount, total_count: m.totalCount })
        if (route === '/customnode/getlist') return json(res, 200, { node_packs: m.packs })
        if (route === '/comfyui_manager/comfyui_versions') return json(res, 200, { versions: m.versions, current: m.current })
        if (route === '/snapshot/getlist') return json(res, 200, { items: m.snapshots })
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
          finish(id, body?.prompt, body?.extra_data)
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
      if (/^\/(manager|customnode|comfyui_manager|snapshot)\//.test(route)) {
        const m = state.manager
        if (!m.present) return json(res, 404, {})
        if (m.security) return json(res, 403, {})
        if (route === '/customnode/fetch_updates') return json(res, 200, {})
        if (route === '/manager/queue/reset' || route === '/manager/queue/update_all' || route === '/manager/queue/update_comfyui') return json(res, 200, {})
        if (route === '/manager/queue/start') {
          const result = Object.fromEntries(Object.entries(m.packs).map(([id, p]) => [id, p['update-state'] === 'true' ? 'success' : 'skip']))
          m.totalCount = Object.keys(result).length
          m.doneCount = m.totalCount
          // Manager tells the clients connected right now; the test's client may still be connecting, so wait for one (up to 2 s)
          const tell = (tries = 0) => (sockets.size || tries > 200 ? wsSend({ type: 'cm-queue-status', data: { status: 'done', nodepack_result: result } }) : setTimeout(() => tell(tries + 1), 10))
          setTimeout(tell, 10)
          return json(res, 200, {})
        }
        if (route === '/manager/reboot') return (m.rebooted++, json(res, 200, {}))
        if (route === '/snapshot/save') return (m.snapshots.push(`snapshot-${m.snapshots.length + 1}`), json(res, 200, {}))
        if (route === '/snapshot/restore') return ((m.restored = body?.target ?? null), json(res, 200, {}))
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

  // /ws: a handshake and server-to-client text frames, enough for studio.js job progress and Manager's done message
  server.on('upgrade', (req, socket) => {
    if (!String(req.url).startsWith('/ws')) return socket.destroy()
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.on('data', () => {}) // client frames (pings, close) are ignored
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  registerPort(port) // tells the test guard this local port may be reached

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
    // Complete every held job, as if ComfyUI got to it.
    releaseHeld: () => {
      for (const item of state.pending.splice(0)) finish(item[1], item[2], item[3])
    },
    // The next prompt ends in history as an error with this message.
    failNextPrompt: (message = 'fake failure') => (state.failNext = message),
    // ComfyUI-Manager: { present, security, version, policy, current, versions, packs }
    setManager: (patch) => Object.assign(state.manager, patch),
    manager: state.manager,
    dataDir,
    // Push a message to every client connected to /ws.
    wsSend,
    // Make a route answer with an error; pass null to clear it.
    failRoute: (route, status, message = 'fake failure') => (status ? (state.failures[route] = { status, message }) : delete state.failures[route]),
    close: () =>
      new Promise((resolve) => {
        unregisterPort(port)
        for (const sock of sockets) sock.destroy()
        fs.rmSync(dataDir, { recursive: true, force: true })
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
