// MCP LoRA test: the LoRA tools over stdio on a temporary data folder, against live Civitai (search, details)
// and the ComfyUI on this computer (installed LoRAs, one looked up by hash). Downloads nothing: download_lora is only
// checked to refuse without CIVITAI_API_KEY.
//   node test/mcp-loras.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-loras-'))
let failures = 0
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: temp }
delete env.CIVITAI_API_KEY
const transport = new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env })
const c = new Client({ name: 'loras-test', version: '1' })
await c.connect(transport)
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 300000 })
  return { error: r.isError ? r.content[0].text : null, value: r.structuredContent }
}
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}

const page = await call('search_loras', { limit: 12 })
const items = page.value?.items || []
expect('search_loras', !page.error && items.length > 0 && items.every((m) => m.version?.baseModel === 'MiniMax H3'), page.error || `${items.length} H3 LoRAs, first: ${items[0]?.name}`)
expect('search_loras is safe by default', page.value?.mature === false && items.every((m) => !m.mature))
expect('cards carry previews and files', items.some((m) => m.previews.length && /^https:\/\/image\.civitai\.com\//.test(m.previews[0].url)) && items.every((m) => !m.file || m.file.sha256?.length === 64))
const more = await call('search_loras', { limit: 12, cursor: page.value?.next })
expect('next page', !more.error && more.value.items.length > 0 && more.value.items[0].id !== items[0].id)
const styled = await call('search_loras', { query: 'cinematic', tag: 'style', limit: 6 })
expect('query + tag', !styled.error && styled.value.items.length > 0, styled.value?.items.map((m) => m.name).slice(0, 3).join(' | '))

const withPreview = items.find((m) => m.previews.length) || items[0]
const d = await call('get_lora', { modelId: withPreview.id })
expect('get_lora', !d.error && d.value.versions.length > 0 && typeof d.value.licence.commercial === 'boolean' && d.value.url.startsWith('https://civitai.com/models/'), d.error || `${d.value.name}: ${d.value.versions.length} versions, commercial ${d.value.licence.commercial}`)
const r = await fetch(d.value.versions.find((v) => v.previews.length)?.previews[0].url || withPreview.previews[0].url, { method: 'HEAD' })
expect('a preview clip loads', r.ok && /^(video|image)\//.test(r.headers.get('content-type')), `${r.status} ${r.headers.get('content-type')}`)

const mine = await call('list_my_loras')
const h3 = mine.value?.items || []
expect('list_my_loras (H3)', !mine.error && h3.length > 0 && h3.every((x) => x.h3), mine.error || `${h3.length} H3 LoRAs in ComfyUI`)
const small = [...h3].filter((x) => x.size).sort((a, b) => a.size - b.size)[0]
const t0 = Date.now()
const id = await call('identify_lora', { name: small.name })
expect('identify_lora', !id.error && id.value.sha256?.length === 64, id.error || `${small.name}: ${id.value.civitai ? `${id.value.civitai.name} (${id.value.civitai.baseModel})` : 'not on Civitai'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const dl = await call('download_lora', { modelId: withPreview.id })
expect('download_lora without a key -> error', !!dl.error && /API key/.test(dl.error), dl.error)

await c.close()
console.log(failures ? `${failures} failed` : 'all passed', `| data in ${temp}`)
process.exit(failures ? 1 : 0)
