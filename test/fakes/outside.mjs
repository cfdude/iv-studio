// Small local fakes for the outside services the default suite can reach (design D9). Each runs on an ephemeral
// loopback port, registers it with the test guard, and is reached through the address the code already lets a test
// change. Nothing here reaches the network. RunPod, Modal and Comfy Cloud stay unfaked.
//
//   Civitai   CIVITAI_SITES.safe / .mature in src/service/civitai.js  (a mutable exported object). The MCP server
//             is a child process, so startMcp({ civitai: fake.url }) sets it there through test/fakes/civitai-address.mjs.
//   Ollama    setOllamaSource(() => fake.url) in src/service/prompter.js (the Settings address)
//   GitHub    GUIDE_FILES[...].url / .sha256 in src/service/h3guide.js (raw.githubusercontent.com content)
//             and the releases JSON a future update check would read
import { createHash } from 'node:crypto'
import http from 'node:http'
import { registerPort, unregisterPort } from './ports.mjs'

const send = (res, status, body, type = 'application/json') => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

const readJson = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })

async function serve(handler) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake')
    const body = req.method === 'POST' ? await readJson(req) : undefined
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), json: body })
    if (!handler(req, res, url, body)) send(res, 404, { error: `no ${req.method} ${url.pathname}` })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  registerPort(port)
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise((resolve) => {
        unregisterPort(port)
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

// ---------- Civitai: search, one model, a file by hash, a file to download ----------
// The bytes the fake serves as the LoRA file, and their SHA-256 (what Civitai publishes for the file).
export const CIVITAI_FILE_BYTES = Buffer.from('fake lora weights for tests')
export const CIVITAI_FILE_SHA256 = createHash('sha256').update(CIVITAI_FILE_BYTES).digest('hex')
// a 1x1 JPEG the fake serves for any preview address
const PREVIEW_BYTES = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64')

export const CIVITAI_MODEL = {
  id: 101,
  name: 'Fake Neon Street',
  type: 'LORA',
  nsfw: false,
  nsfwLevel: 1,
  poi: false,
  minor: false,
  description: '<p>A fake LoRA for tests.</p>',
  creator: { username: 'fake_maker' },
  tags: ['style'],
  stats: { downloadCount: 12, thumbsUpCount: 3, rating: 5, ratingCount: 1 },
  allowCommercialUse: ['Image'],
  allowDerivatives: true,
  allowNoCredit: true,
  modelVersions: [
    {
      id: 2001,
      name: 'v1',
      baseModel: 'MiniMax H3',
      publishedAt: '2026-01-01T00:00:00Z',
      trainedWords: ['neonstreet'],
      description: 'First version',
      images: [{ url: 'https://image.civitai.com/fake/preview.jpeg', type: 'image', nsfwLevel: 1, width: 512, height: 512 }],
      files: [{ id: 3001, name: 'fake_neon_street.safetensors', type: 'Model', sizeKB: 1024, primary: true, downloadUrl: 'https://civitai.com/api/download/models/2001', hashes: { SHA256: CIVITAI_FILE_SHA256.toUpperCase() }, metadata: { format: 'SafeTensor' } }]
    }
  ]
}

export function startFakeCivitai({ models = [CIVITAI_MODEL] } = {}) {
  return serve((req, res, url) => {
    if (url.pathname === '/api/v1/models') return send(res, 200, { items: models, metadata: { nextCursor: null } }), true
    const one = /^\/api\/v1\/models\/(\d+)$/.exec(url.pathname)
    if (one) {
      const m = models.find((x) => x.id === Number(one[1]))
      return m ? (send(res, 200, m), true) : (send(res, 404, {}), true)
    }
    const byHash = /^\/api\/v1\/model-versions\/by-hash\/([0-9a-fA-F]+)$/.exec(url.pathname)
    if (byHash) {
      for (const m of models) {
        const v = m.modelVersions.find((x) => x.files.some((f) => f.hashes?.SHA256?.toLowerCase() === byHash[1].toLowerCase()))
        if (v) return send(res, 200, { id: v.id, modelId: m.id, name: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords, images: v.images, model: { name: m.name, nsfw: m.nsfw, poi: m.poi, minor: m.minor } }), true
      }
      return send(res, 404, {}), true
    }
    // a file download: like Civitai, only with the person's key in the query
    const file = /^\/api\/download\/models\/(\d+)$/.exec(url.pathname)
    if (file) {
      if (!url.searchParams.get('token')) return send(res, 401, { error: 'no key' }), true
      if (!models.some((m) => m.modelVersions.some((v) => v.id === Number(file[1])))) return send(res, 404, {}), true
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': CIVITAI_FILE_BYTES.length })
      return res.end(CIVITAI_FILE_BYTES), true
    }
    // a preview picture (the shape previewUrl() asks for: /<key>/<id>/width=450,optimized=true/<name>)
    if (/^\/[^/]+\/[^/]+\/(transcode=true,)?width=\d+/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': PREVIEW_BYTES.length })
      return res.end(PREVIEW_BYTES), true
    }
    return false
  })
}

// ---------- Ollama: /api/tags, /api/ps, /api/generate, /api/chat ----------
// answer: the reply text, or fn(requestBody) returning the text (an object is sent as its JSON), for the callers that
// ask for structured output (a script, a shot list) and need a different answer per request.
// loaded: the names /api/ps says are in memory; a /api/generate with keep_alive 0 for one of them unloads it.
// /api/pull streams the lines Ollama does (a status, two download steps, success), or one error line for the name
// `missing`; the requests list what was asked for.
export function startFakeOllama({ models = [{ name: 'fake-vl:8b', size: 5_000_000_000 }], answer = 'a canned prompt from the fake Ollama', loaded = [] } = {}) {
  const inMemory = new Set(loaded)
  const reply = (body) => {
    const a = typeof answer === 'function' ? answer(body) : answer
    return typeof a === 'string' ? a : JSON.stringify(a)
  }
  return serve((req, res, url, body) => {
    if (url.pathname === '/api/tags') return send(res, 200, { models }), true
    if (url.pathname === '/api/ps') return send(res, 200, { models: [...inMemory].map((name) => ({ name })) }), true
    if (url.pathname === '/api/pull') {
      const lines = body?.model === 'missing' ? [{ error: 'pull model manifest: file does not exist' }] : [{ status: 'pulling manifest' }, { status: 'downloading', total: 1000, completed: 400 }, { status: 'downloading', total: 1000, completed: 1000 }, { status: 'success' }]
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      return res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'), true
    }
    if (url.pathname === '/api/generate' && body?.keep_alive === 0) return inMemory.delete(body.model), send(res, 200, { model: body.model, done: true }), true
    if (url.pathname === '/api/generate') return send(res, 200, { model: 'fake', response: reply(body), done: true }), true
    if (url.pathname === '/api/chat') return send(res, 200, { model: 'fake', message: { role: 'assistant', content: reply(body) }, done: true }), true
    return false
  })
}

// ---------- GitHub: the releases JSON, and raw files ----------
export function startFakeGithub({ releases = { tag_name: 'v9.9.9', name: 'Fake release', html_url: 'https://github.com/fake/fake/releases/tag/v9.9.9', assets: [{ name: 'IV-Studio-arm64.dmg', browser_download_url: 'https://github.com/fake/fake/releases/download/v9.9.9/IV-Studio-arm64.dmg' }] }, raw = {} } = {}) {
  return serve((req, res, url) => {
    if (/^\/repos\/[^/]+\/[^/]+\/releases\/latest$/.test(url.pathname)) return send(res, 200, releases), true
    if (url.pathname in raw) return send(res, 200, raw[url.pathname], 'text/plain'), true
    return false
  })
}
