// startMcp(): starts src/mcp/server.js as a real process under the test guard, with a seeded temp data folder, and
// returns an MCP SDK client (design D1, D8).
//   const mcp = await startMcp({ comfyUrl: fake.url })
//   await mcp.client.callTool({ name: 'check_setup', arguments: {} })
//   await mcp.close()
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { guardState } from './ports.mjs'
import { withShims } from './shims.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

// The settings every test run is seeded with (design D8): the fake, temp folders, no key or token.
export function seedSettings(dir, { comfyUrl, extra = {} }) {
  const folders = { comfyFolder: path.join(dir, 'comfy'), videosFolder: path.join(dir, 'videos') }
  for (const f of Object.values(folders)) fs.mkdirSync(f, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ comfyUrl, ...folders, outputFolder: '', comfyAutoStart: false, comfyLauncher: '', comfyApiKey: null, civitaiKey: null, runpodKey: null, runpodToken: null, cloudToken: null, ...extra }, null, 2)
  )
}

export async function startMcp({ comfyUrl, shims = false, settings = {} } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-mcp-')))
  const dataDir = path.join(base, 'data')
  const runDir = path.join(base, 'run')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(runDir, { recursive: true })
  seedSettings(dataDir, { comfyUrl, extra: settings })
  const shim = shims ? withShims() : null
  const env = {
    ...process.env,
    IV_STUDIO_DATA: dataDir,
    IV_TEST_RUN_DIR: runDir,
    IV_TEST_ALLOW_PORTS: [...guardState().ports].join(','),
    IV_TEST_SHIM_DIRS: [...guardState().shimDirs].join(':')
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', pathToFileURL(path.join(here, 'guard.mjs')).href, '--import', pathToFileURL(path.join(here, 'resolve.mjs')).href, '--import', pathToFileURL(path.join(here, 'dirname.mjs')).href, path.join(root, 'src/mcp/server.js')],
    env,
    stderr: 'pipe'
  })
  const client = new Client({ name: 'iv-test', version: '1' })
  await client.connect(transport)
  return {
    client,
    dataDir,
    runDir,
    // what the child's guard refused, read from its run folder
    refusals: async () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(runDir, 'guard-refusals.json'), 'utf8'))
      } catch {
        return []
      }
    },
    close: async () => {
      await client.close().catch(() => {})
      shim?.restore()
      fs.rmSync(base, { recursive: true, force: true })
    }
  }
}
