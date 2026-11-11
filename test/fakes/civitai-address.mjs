// Test-only preload for the MCP child (design D9). The server's Civitai address is the mutable `CIVITAI_SITES` object in
// src/service/civitai.js and no setting or variable moves it, so this imports that same module (same file URL the server
// imports through the resolve hook, so the same instance) and points it at the fake before the server starts. Added by
// startMcp only when it is given `civitai: <fake url>`; without it the real address stays and the guard refuses it.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { CIVITAI_SITES } = await import(pathToFileURL(path.join(root, 'src/service/civitai.js')).href)
if (process.env.IV_TEST_CIVITAI) {
  CIVITAI_SITES.safe = process.env.IV_TEST_CIVITAI
  CIVITAI_SITES.mature = process.env.IV_TEST_CIVITAI
}
// the guard has removed CIVITAI_API_KEY from the environment; a test that wants a saved key gives it here
if (process.env.IV_TEST_CIVITAI_KEY) process.env.CIVITAI_API_KEY = process.env.IV_TEST_CIVITAI_KEY
