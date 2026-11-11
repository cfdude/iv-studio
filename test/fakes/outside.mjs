// Small local fakes for the outside services the default suite can reach (design D9). Each runs on an ephemeral
// loopback port, registers it with the test guard, and is reached through the address the code already lets a test
// change. Nothing here reaches the network. RunPod, Modal and Comfy Cloud stay unfaked.
//
//   Civitai   CIVITAI_SITES.safe / .mature in src/service/civitai.js  (a mutable exported object)
//   Ollama    setOllamaSource(() => fake.url) in src/service/prompter.js (the Settings address)
//   GitHub    GUIDE_FILES[...].url / .sha256 in src/service/h3guide.js (raw.githubusercontent.com content)
//             and the releases JSON a future update check would read
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

// ---------- Civitai: search, one model, a file by hash ----------
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
      files: [{ id: 3001, name: 'fake_neon_street.safetensors', type: 'Model', sizeKB: 1024, primary: true, downloadUrl: 'https://civitai.com/api/download/models/2001', hashes: { SHA256: 'AB'.repeat(32) }, metadata: { format: 'SafeTensor' } }]
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
    if (url.pathname.startsWith('/api/v1/model-versions/by-hash/')) return send(res, 404, {}), true
    return false
  })
}

// ---------- Ollama: /api/tags, /api/ps, /api/generate, /api/chat ----------
// answer: the reply text, or fn(requestBody) returning the text (an object is sent as its JSON), for the callers that
// ask for structured output (a script, a shot list) and need a different answer per request.
export function startFakeOllama({ models = [{ name: 'fake-vl:8b', size: 5_000_000_000 }], answer = 'a canned prompt from the fake Ollama' } = {}) {
  const reply = (body) => {
    const a = typeof answer === 'function' ? answer(body) : answer
    return typeof a === 'string' ? a : JSON.stringify(a)
  }
  return serve((req, res, url, body) => {
    if (url.pathname === '/api/tags') return send(res, 200, { models }), true
    if (url.pathname === '/api/ps') return send(res, 200, { models: [] }), true
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
