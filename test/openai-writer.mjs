// The OpenAI-compatible prompt writer (llm.js, GitHub #15) against a stand-in server on this PC (no network):
// addresses, headers, the key, the structured-answer fallback (json_schema -> json_object -> plain), pictures,
// and the local writer's calls going to the server when Settings picks OpenAI-compatible.
//   node test/openai-writer.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { llmConfig, normalizeApiBase, openaiChat, openaiModels, openaiStatus, parseHeaders, setLlmSource } from '../src/service/llm.js'
import { localChat, localWriterModel, ollamaJson } from '../src/service/prompter.js'
import { writerOf } from '../src/service/paths.js'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

// the stand-in: /v1/models lists two models; /v1/chat/completions answers with JSON. strict = refuse json_schema.
const seen = []
let strict = false
let needKey = null
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const send = (code, obj) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(obj)))
    if (needKey && req.headers.authorization !== `Bearer ${needKey}`) return send(401, { error: { message: 'Invalid API key' } })
    if (req.method === 'GET' && req.url === '/v1/models') return send(200, { object: 'list', data: [{ id: 'qwen3-vl-8b' }, { id: 'llama-3.2-3b' }] })
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const j = JSON.parse(body)
      seen.push({ headers: req.headers, body: j })
      if (strict && j.response_format?.type === 'json_schema') return send(400, { error: { message: "response_format type 'json_schema' is not supported" } })
      return send(200, { choices: [{ message: { role: 'assistant', content: '<think>hm</think>{"description":"rain on a tin roof","seconds":12}' } }] })
    }
    send(404, { error: 'not found' })
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

await test('addresses: a bare host gets http:// and /v1; endpoints and slashes come off; 0.0.0.0 means this PC', () => {
  assert.equal(normalizeApiBase('localhost:8080'), 'http://localhost:8080/v1')
  assert.equal(normalizeApiBase('http://192.168.1.20:8000/v1/'), 'http://192.168.1.20:8000/v1')
  assert.equal(normalizeApiBase('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1')
  assert.equal(normalizeApiBase('http://0.0.0.0:1234'), 'http://127.0.0.1:1234/v1')
  assert.equal(normalizeApiBase('http://litellm:4000/api/v1/models'), 'http://litellm:4000/api/v1')
  assert.equal(normalizeApiBase(''), '')
  assert.throws(() => normalizeApiBase('ftp://x'))
})

await test('extra headers: "Name: value" lines, comments skipped, bad lines refused', () => {
  assert.deepEqual(parseHeaders('X-Api-Version: 2\n# note\n\nX-Org: a:b'), { 'X-Api-Version': '2', 'X-Org': 'a:b' })
  assert.throws(() => parseHeaders('not a header'), /isn't a header/)
})

await test('models and status from the server', async () => {
  const cfg = { provider: 'openai', url: `${base}/v1`, model: 'qwen3-vl-8b', key: '', headers: {} }
  assert.deepEqual(await openaiModels(cfg), ['qwen3-vl-8b', 'llama-3.2-3b'])
  const st = await openaiStatus(cfg)
  assert.equal(st.ok, true)
  const down = await openaiStatus({ ...cfg, url: 'http://127.0.0.1:9/v1' })
  assert.equal(down.ok, false)
  assert.match(down.error, /Nothing answered/)
})

await test('a structured answer asks for json_schema and sends the key and extra headers', async () => {
  seen.length = 0
  needKey = 'sk-test'
  const cfg = { provider: 'openai', url: `${base}/v1`, model: 'qwen3-vl-8b', key: 'sk-test', headers: { 'X-Org': 'iv' } }
  const text = await openaiChat({ cfg, system: 'sys', messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object' } })
  assert.match(text, /rain on a tin roof/)
  assert.equal(seen[0].body.response_format.type, 'json_schema')
  assert.equal(seen[0].body.model, 'qwen3-vl-8b')
  assert.equal(seen[0].headers['x-org'], 'iv')
  await assert.rejects(openaiChat({ cfg: { ...cfg, key: 'wrong' }, system: 's', messages: [{ role: 'user', content: 'x' }], schema: {} }), /refused the key \(401\)/)
  needKey = null
})

await test('a server without json_schema falls back to json_object, with the schema in the system message, and remembers', async () => {
  seen.length = 0
  strict = true
  const cfg = { provider: 'openai', url: `${base}/v1`, model: 'llama-3.2-3b', key: '', headers: {} }
  await openaiChat({ cfg, system: 'sys', messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object', properties: { a: { type: 'string' } } } })
  assert.deepEqual(seen.map((s) => s.body.response_format?.type), ['json_schema', 'json_object'])
  assert.match(seen[1].body.messages[0].content, /matches this JSON schema/)
  seen.length = 0
  await openaiChat({ cfg, system: 'sys', messages: [{ role: 'user', content: 'again' }], schema: { type: 'object' } })
  assert.deepEqual(seen.map((s) => s.body.response_format?.type), ['json_object'])
  strict = false
})

await test('pictures go as image_url data parts only when the model sees pictures', async () => {
  seen.length = 0
  const cfg = { provider: 'openai', url: `${base}/v1`, model: 'qwen3-vl-8b', key: '', headers: {}, vision: true }
  await openaiChat({ cfg, system: 's', messages: [{ role: 'user', content: 'look', images: ['QUJD'] }], schema: { type: 'object' } })
  const parts = seen[0].body.messages[1].content
  assert.equal(parts[0].text, 'look')
  assert.equal(parts[1].image_url.url, 'data:image/jpeg;base64,QUJD')
  seen.length = 0
  await openaiChat({ cfg: { ...cfg, vision: false }, system: 's', messages: [{ role: 'user', content: 'look', images: ['QUJD'] }], schema: { type: 'object' } })
  assert.equal(seen[0].body.messages[1].content, 'look')
})

await test('Settings: OpenAI-compatible writes as the local writer, with its own model', () => {
  assert.deepEqual(writerOf({ promptEngine: 'openai', openaiModel: 'qwen3-vl-8b', ollamaModel: 'x' }), { engine: 'local', provider: 'openai', model: 'qwen3-vl-8b' })
  assert.equal(writerOf({ promptEngine: 'local', ollamaModel: 'x' }).model, 'x')
})

await test('the local writer goes to the server when it is chosen: model checks, eyes, and a parsed answer', async () => {
  setLlmSource(() => ({ provider: 'openai', url: `${base}/v1`, model: 'qwen3-vl-8b', vision: false }))
  assert.equal(llmConfig().provider, 'openai')
  const m = await localWriterModel('huihui_ai/ollama-only-model')
  assert.deepEqual(m, { name: 'qwen3-vl-8b', vision: false, provider: 'openai' })
  await assert.rejects(localWriterModel(null, { needsEyes: 'review a take' }), /set to not see pictures, so it can't review a take/)
  setLlmSource(() => ({ provider: 'openai', url: `${base}/v1`, model: 'missing-model' }))
  await assert.rejects(localWriterModel(null), /doesn't list the model "missing-model"/)
  setLlmSource(() => ({ provider: 'openai', url: '', model: 'x' }))
  await assert.rejects(localWriterModel(null), /has no address/)
  setLlmSource(() => ({ provider: 'openai', url: `${base}/v1`, model: 'qwen3-vl-8b' }))
  seen.length = 0
  // Sounds' and Projects' writer (ollamaJson) and localChat both come back parsed, <think> removed
  assert.deepEqual(await ollamaJson({ system: 'sys', user: 'a storm', schema: { type: 'object' } }), { description: 'rain on a tin roof', seconds: 12 })
  assert.deepEqual(await localChat({ system: 'sys', messages: [{ role: 'user', content: 'x' }], schema: { type: 'object' } }), { description: 'rain on a tin roof', seconds: 12 })
  assert.equal(seen.length, 2)
  assert.ok(seen[0].body.messages[0].content.startsWith('sys'))
  setLlmSource(() => ({}))
  assert.equal(llmConfig().provider, 'ollama')
})

server.close()
console.log(`\n${passed} passed`)
