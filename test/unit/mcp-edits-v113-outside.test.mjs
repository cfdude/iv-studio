// comfy_balance and the checksummed part of download_recommended_lora, which talk to hosts the MCP server has no setting
// for: api.comfy.org (IV_STUDIO_COMFY_API moves it only in the app's main process, src/main/index.js, not in this
// server) and huggingface.co (fixed in src/service/recommended.js). The server is a child process, so this file
// starts it the way startMcp does with one more test-only preload, written to a temp folder, that
//   - puts a stand-in Comfy.org API key in the server's environment (the guard removes the real one), and
//   - sends fetch calls for https://api.comfy.org and https://huggingface.co to local stand-ins started here.
// The guard still applies in the child: only these loopback ports are reachable. Nothing leaves the machine.
//   node --test test/unit/mcp-edits-v113-outside.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { seedSettings } from '../fakes/mcp.mjs'
import { guardState, registerPort, unregisterPort } from '../fakes/ports.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fakes = path.join(root, 'test/fakes')
const KEY = 'stand-in-comfy-org-key'

// a loopback server on an ephemeral port that the guard lets through
async function serve(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers })
    handler(req, res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  registerPort(port)
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        unregisterPort(port)
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers })
  res.end(text)
}

// startMcp's child, plus the preload. redirects: { 'https://host': 'http://127.0.0.1:port' }; env: set after the guard ran.
async function startMcpVia({ comfyUrl, redirects, env = {} }) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-mcp-')))
  const dataDir = path.join(base, 'data')
  const runDir = path.join(base, 'run')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(runDir, { recursive: true })
  seedSettings(dataDir, { comfyUrl })
  const preload = path.join(base, 'preload.mjs')
  fs.writeFileSync(
    preload,
    `const map = ${JSON.stringify(redirects)}
Object.assign(process.env, ${JSON.stringify(env)})
const guarded = globalThis.fetch
globalThis.fetch = (input, init) => {
  let u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  for (const [from, to] of Object.entries(map)) if (u.startsWith(from)) u = to + u.slice(from.length)
  return guarded(u, init)
}
`
  )
  const href = (f) => pathToFileURL(f).href
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', href(path.join(fakes, 'guard.mjs')), '--import', href(path.join(fakes, 'resolve.mjs')), '--import', href(path.join(fakes, 'dirname.mjs')), '--import', href(preload), path.join(root, 'src/mcp/server.js')],
    env: { ...process.env, IV_STUDIO_DATA: dataDir, IV_TEST_RUN_DIR: runDir, IV_TEST_ALLOW_PORTS: [...guardState().ports].join(','), IV_TEST_SHIM_DIRS: [...guardState().shimDirs].join(path.delimiter) },
    stderr: 'pipe'
  })
  const client = new Client({ name: 'iv-test', version: '1' })
  await client.connect(transport)
  return {
    client,
    dataDir,
    close: async () => {
      await client.close().catch(() => {})
      fs.rmSync(base, { recursive: true, force: true })
    }
  }
}

describe('MCP tools that reach api.comfy.org and Hugging Face, on local stand-ins', () => {
  let account, mode, plain, withKey
  const call = (name, args = {}, who = withKey) => who.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}, who = withKey) => {
    const r = await call(name, args, who)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const fails = async (name, args, pattern, who = withKey) => {
    const r = await call(name, args, who)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  let fake

  before(async () => {
    // Comfy.org: GET /customers/balance with X-API-KEY, the answer set per test through `mode`
    mode = { status: 200, body: {} }
    account = await serve((req, res) => {
      if (req.url !== '/customers/balance') return send(res, 404, {})
      if (req.headers['x-api-key'] !== KEY) return send(res, 401, { message: 'bad key' })
      send(res, mode.status, mode.body)
    })
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] }, objectInfo: { LoraLoaderModelOnly: { input: { required: { lora_name: [[]] } } } } })
    withKey = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://api.comfy.org': account.url }, env: { COMFY_ORG_API_KEY: KEY } })
    plain = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://api.comfy.org': account.url } })
  })
  after(async () => {
    await withKey?.close()
    await plain?.close()
    await fake?.close()
    await account?.close()
  })

  // ---------- comfy_balance ----------
  test('[mcp:comfy_balance] says what is missing when this server has no COMFY_ORG_API_KEY, and asks nobody', async () => {
    const before = account.requests.length
    await fails('comfy_balance', {}, /^This server has no COMFY_ORG_API_KEY in its environment\. The person can see their balance in the IV Studio window \(title bar, or Settings → Comfy account\), or add the key to this server’s environment\.$/, plain)
    assert.equal(account.requests.length, before, 'no call went out without a key')
  })

  test('[mcp:comfy_balance] returns the credits and dollars Comfy.org reports (211 credits = $1), asking with the key in X-API-KEY', async () => {
    mode = { status: 200, body: { effective_balance_cents: 4220, effective_balance_currency: 'usd', amount_cents: 5000, prepaid_balance_cents: 3000, cloud_credit_balance_cents: 1220 } }
    const b = await ok('comfy_balance')
    assert.deepEqual({ credits: b.credits, usd: b.usd, newCustomer: b.newCustomer }, { credits: 8904, usd: 42.2, newCustomer: false })
    assert.match(b.checkedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/)
    const req = account.requests.at(-1)
    assert.equal(req.method, 'GET')
    assert.equal(req.url, '/customers/balance')
    assert.equal(req.headers['x-api-key'], KEY)
    assert.deepEqual(Object.keys(b).sort(), ['checkedAt', 'credits', 'newCustomer', 'usd'], 'only what the tool names')
  })

  test('[mcp:comfy_balance] reads the figure Comfy.org gives in micros the same way (they are cents too), and rounds dollars to cents', async () => {
    mode = { status: 200, body: { amount_micros: 1234 } }
    const b = await ok('comfy_balance')
    assert.deepEqual({ credits: b.credits, usd: b.usd }, { credits: 2604, usd: 12.34 })
    mode = { status: 200, body: { effective_balance_cents: 3333 } }
    assert.equal((await ok('comfy_balance')).usd, 33.33)
  })

  test('[mcp:comfy_balance] a key with no Comfy.org customer yet is an empty balance, flagged newCustomer, not an error', async () => {
    mode = { status: 404, body: {} }
    const b = await ok('comfy_balance')
    assert.deepEqual({ credits: b.credits, usd: b.usd, newCustomer: b.newCustomer }, { credits: 0, usd: 0, newCustomer: true })
  })

  test('[mcp:comfy_balance] says so when Comfy.org refuses the key, answers an error, or cannot be reached', async () => {
    mode = { status: 403, body: {} }
    await fails('comfy_balance', {}, /^Comfy\.org refused this API key\. Make a new one at platform\.comfy\.org and paste it again\.$/)
    mode = { status: 500, body: {} }
    await fails('comfy_balance', {}, /^Comfy\.org answered 500 for the balance\.$/)
    // no stand-in behind the redirect: nothing listens, so the guard and the network both say no
    const lost = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://api.comfy.org': 'http://127.0.0.1:9' }, env: { COMFY_ORG_API_KEY: KEY } })
    try {
      await fails('comfy_balance', {}, /^Could not reach Comfy\.org\. Check the internet connection\.$/, lost)
    } finally {
      await lost.close()
    }
    mode = { status: 200, body: {} }
  })

  test('[mcp:comfy_balance] a wrong key at Comfy.org is refused the same as a bad one', async () => {
    const wrong = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://api.comfy.org': account.url }, env: { COMFY_ORG_API_KEY: 'some-other-key' } })
    try {
      await fails('comfy_balance', {}, /^Comfy\.org refused this API key\./, wrong)
      assert.equal(account.requests.at(-1).headers['x-api-key'], 'some-other-key')
    } finally {
      await wrong.close()
    }
  })

  // ---------- download_recommended_lora: the checksum ----------
  const FPV = 'fpv_headbob_h3_50.safetensors'
  const recommendedDir = () => path.join(fake.dataDir, 'models', 'loras', 'MiniMax H3', 'Recommended')
  test('[mcp:download_recommended_lora] removes a download whose bytes do not match the pinned SHA-256, leaves nothing in ComfyUI and says so', async () => {
    const bytes = Buffer.from('not the file the shelf pinned')
    const hf = await serve((req, res) => {
      const headers = { 'x-linked-etag': `"${createHash('sha256').update(bytes).digest('hex')}"`, 'x-linked-size': String(bytes.length), 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream' }
      res.writeHead(200, headers)
      res.end(req.method === 'HEAD' ? undefined : bytes)
    })
    const who = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://huggingface.co': hf.url } })
    try {
      const started = await ok('download_recommended_lora', { id: 'rec-fpv' }, who)
      assert.deepEqual(started, { status: 'queued', error: null })
      let d
      for (let i = 0; i < 200 && !(d && d.status === 'error'); i++) {
        d = (await ok('recommended_loras', {}, who)).items.find((x) => x.id === 'rec-fpv').download
        await new Promise((r) => setTimeout(r, 25))
      }
      assert.deepEqual({ status: d.status, error: d.error }, { status: 'error', error: 'The download did not match its published checksum and was removed. Try again.' })
      const wanted = hf.requests.find((r) => r.method === 'GET')
      assert.equal(wanted.url, '/neph1/minimax_h3_headmounted_fpv_cam/resolve/cd2619e00df748aff4ed93bab26ab40a8176d132/fpv_headbob_h3_50.safetensors', 'the one file at the one commit the shelf pins')
      assert.equal(wanted.headers.authorization, undefined, 'no Hugging Face login was sent')
      assert.deepEqual(hf.requests.map((r) => r.method).slice(0, 2), ['HEAD', 'GET'], 'size and checksum asked for first')
      assert.equal(fs.existsSync(path.join(recommendedDir(), FPV)), false, 'nothing under its name')
      assert.deepEqual(fs.existsSync(recommendedDir()) ? fs.readdirSync(recommendedDir()) : [], [], 'and no .part left')
    } finally {
      await who.close()
      await hf.close()
    }
  })

  test('[mcp:download_recommended_lora] a gated or missing file shows the host\'s refusal in words and writes nothing', async () => {
    let status = 403
    const hf = await serve((req, res) => {
      res.writeHead(status)
      res.end()
    })
    const who = await startMcpVia({ comfyUrl: fake.url, redirects: { 'https://huggingface.co': hf.url } })
    try {
      await ok('download_recommended_lora', { id: 'rec-orbit-360' }, who)
      const gated = await settleVia(who, 'rec-orbit-360')
      assert.equal(gated.status, 'error')
      assert.match(gated.error, /^This model is gated: open https:\/\/huggingface\.co\/pablodawson\/MiniMax-H3-360-Orbit-LoRA while logged in to Hugging Face, accept its licence, then add a Read token in Settings → Setup → Optional tools \(or run hf auth login\) and try again\.$/)
      status = 404
      await ok('download_recommended_lora', { id: 'rec-orbit-360' }, who)
      const missing = await settleVia(who, 'rec-orbit-360')
      assert.deepEqual({ status: missing.status, error: missing.error }, { status: 'error', error: 'The host answered 404.' })
      assert.equal(fs.existsSync(path.join(recommendedDir(), 'minimax_h3_flf2v_lora_v1.safetensors')), false)
    } finally {
      await who.close()
      await hf.close()
    }
  })
  const settleVia = async (who, id) => {
    let d
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 25))
      d = (await ok('recommended_loras', {}, who)).items.find((x) => x.id === id).download
      if (d && d.status === 'error') break
    }
    return d
  }
})
