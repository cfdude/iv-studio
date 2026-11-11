// Civitai downloads against a mock Civitai on this computer (no key, no network, nothing written to ComfyUI): a good
// download lands in loras/Civitai/<model>/ with its library entry, a file whose bytes don't match Civitai's
// SHA-256 is removed, no key is a clear error, and real-person (poi) models are refused.
//   node test/civitai-download.mjs
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Civitai } from '../src/service/civitai.js'

let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-civitai-'))
const loras = path.join(temp, 'loras')
fs.mkdirSync(loras)
const good = Buffer.from('a pretend safetensors file '.repeat(5000))
const sha = createHash('sha256').update(good).digest('hex').toUpperCase()
const model = (id, poi = false, fileSha = sha) => ({
  id,
  name: `Test Style ${id}`,
  nsfw: false,
  nsfwLevel: 1,
  poi,
  minor: false,
  allowCommercialUse: ['Image'],
  allowNoCredit: true,
  tags: ['style'],
  stats: { downloadCount: 10, thumbsUpCount: 2 },
  creator: { username: 'tester' },
  modelVersions: [{ id: id * 10, name: 'v1', baseModel: 'MiniMax H3', trainedWords: ['t3st'], images: [], files: [{ id: 1, name: `test_style_${id}.safetensors`, type: 'Model', primary: true, sizeKB: good.length / 1024, hashes: { SHA256: fileSha } }] }]
})
const models = { 1: model(1), 2: model(2, false, 'A'.repeat(64)), 3: model(3, true) }
const server = http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const m = u.pathname.match(/^\/api\/v1\/models\/(\d+)$/)
    if (m) return models[m[1]] ? res.end(JSON.stringify(models[m[1]])) : (res.writeHead(404), res.end())
    const d = u.pathname.match(/^\/api\/download\/models\/(\d+)$/)
    if (d) {
      if (!u.searchParams.get('token')) return res.writeHead(401), res.end()
      res.writeHead(200, { 'content-length': good.length })
      return res.end(good)
    }
    res.writeHead(404)
    res.end()
  })
  .listen(0)
await new Promise((r) => server.once('listening', r))
const port = server.address().port

let key = null
const cv = new Civitai({ dataDir: temp, comfy: null, key: () => key })
cv.site = () => `http://127.0.0.1:${port}`
cv.loraFolders = async () => [loras]

const noKey = await cv.download({ modelId: 1 }).catch((e) => e)
expect('no key -> a clear error', noKey instanceof Error && /API key/.test(noKey.message), noKey.message)

key = 'test-key'
const r = await cv.download({ modelId: 1 })
const file = path.join(loras, 'Civitai', 'Test_Style_1', 'test_style_1.safetensors')
expect('download lands in loras/Civitai/<model>/', fs.existsSync(file) && r.lora === path.join('Civitai', 'Test_Style_1', 'test_style_1.safetensors'), r.lora)
expect('the file is byte-exact', fs.existsSync(file) && createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sha.toLowerCase())
expect('trigger words come back', r.trainedWords?.[0] === 't3st')
const lib = cv.library()
expect('library entry with Civitai info', lib.files[r.lora]?.civitai?.modelId === 1 && lib.files[r.lora]?.sha256 === sha.toLowerCase())
expect('it shows as installed', cv.installedShas().has(sha.toLowerCase()))

const bad = await cv.download({ modelId: 2 }).catch((e) => e)
const badFile = path.join(loras, 'Civitai', 'Test_Style_2', 'test_style_2.safetensors')
expect('wrong checksum -> removed', bad instanceof Error && /checksum/.test(bad.message) && !fs.existsSync(badFile) && !fs.existsSync(`${badFile}.part`), bad.message)

const poi = await cv.download({ modelId: 3 }).catch((e) => e)
expect('real-person model refused', poi instanceof Error && !fs.existsSync(path.join(loras, 'Civitai', 'Test_Style_3')), poi.message)

server.close()
fs.rmSync(temp, { recursive: true, force: true })
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
