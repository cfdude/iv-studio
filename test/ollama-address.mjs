// The writer's Ollama address (src/service/prompter.js): the setting, OLLAMA_HOST, and an Ollama elsewhere
// (another container or computer), stood in for by a fake Ollama on 127.0.0.2 (on a Mac, which has only 127.0.0.1, on this
// machine's own network address).
//   node test/ollama-address.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import { cpuOptions, ensureOllama, normalizeOllamaUrl, ollamaIsLocal, ollamaJson, ollamaStatus, ollamaUrl, setOllamaSource } from '../src/service/prompter.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}

await ok('addresses are tidied: scheme and port added, 0.0.0.0 means this computer, trailing slash dropped', () => {
  assert.equal(normalizeOllamaUrl(''), '')
  assert.equal(normalizeOllamaUrl('192.168.1.20'), 'http://192.168.1.20:11434')
  assert.equal(normalizeOllamaUrl('ollama:11434'), 'http://ollama:11434')
  assert.equal(normalizeOllamaUrl('http://host.containers.internal:11434/'), 'http://host.containers.internal:11434')
  assert.equal(normalizeOllamaUrl('0.0.0.0:11434'), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaUrl('https://ollama.example.com'), 'https://ollama.example.com')
  assert.throws(() => normalizeOllamaUrl('http://bad host'))
})

await ok('the setting wins, then OLLAMA_HOST, then this computer', () => {
  setOllamaSource(() => '')
  assert.equal(ollamaUrl({}), 'http://127.0.0.1:11434')
  assert.equal(ollamaUrl({ OLLAMA_HOST: '10.0.0.5' }), 'http://10.0.0.5:11434')
  setOllamaSource(() => 'ollama:8080')
  assert.equal(ollamaUrl({ OLLAMA_HOST: '10.0.0.5' }), 'http://ollama:8080')
  setOllamaSource(() => 'http://bad host')
  assert.equal(ollamaUrl({}), 'http://127.0.0.1:11434')
})

await ok('only this computer counts as local; the CPU option applies only there', () => {
  assert.equal(ollamaIsLocal('http://127.0.0.1:11434'), true)
  assert.equal(ollamaIsLocal('http://localhost:11434'), true)
  assert.equal(ollamaIsLocal('http://ollama:11434'), false)
  setOllamaSource(() => '')
  assert.deepEqual(cpuOptions(true), { num_gpu: 0 })
  setOllamaSource(() => '192.168.1.20')
  assert.deepEqual(cpuOptions(true), {})
  assert.deepEqual(cpuOptions(false), {})
})

// A fake Ollama on another address.
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push({ url: req.url, body: body && JSON.parse(body) })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'writer:8b', size: 6e9 }, { name: 'qwen3-vl:8b', size: 6e9 }] }))
    if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: JSON.stringify({ hello: 'from the container' }) } }))
    res.statusCode = 404
    res.end('{}')
  })
})
const HOST = process.platform === 'darwin' ? Object.values(os.networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal)?.address : '127.0.0.2'
if (!HOST) throw new Error('No network address to stand in for another machine.')
await new Promise((r) => server.listen(0, HOST, r))
const { port } = server.address()

try {
  await ok('an Ollama elsewhere is found and its models listed', async () => {
    setOllamaSource(() => `${HOST}:${port}`)
    const s = await ollamaStatus()
    assert.equal(s.url, `http://${HOST}:${port}`)
    assert.equal(s.local, false)
    assert.equal(s.running, true)
    assert.equal(s.installed, true)
    assert.deepEqual(s.models.map((m) => [m.name, m.vision]), [['writer:8b', false], ['qwen3-vl:8b', true]])
  })

  await ok('writing goes to that Ollama and is never sent to the CPU there', async () => {
    const out = await ollamaJson({ system: 's', user: 'u', schema: { type: 'object' }, model: 'writer:8b', cpu: true })
    assert.deepEqual(out, { hello: 'from the container' })
    const chat = seen.find((x) => x.url === '/api/chat')
    assert.equal(chat.body.model, 'writer:8b')
    assert.equal(chat.body.options.num_gpu, undefined)
  })

  await ok('an Ollama elsewhere that is down is reported, not started', async () => {
    setOllamaSource(() => `${HOST}:9`)
    const s = await ollamaStatus()
    assert.equal(s.running, false)
    assert.equal(s.installed, true)
    await assert.rejects(ensureOllama(), new RegExp(`isn't answering at http://${HOST.replace(/\./g, '\\.')}:9`))
  })
} finally {
  server.close()
}

console.log(`\n${n} passed`)
