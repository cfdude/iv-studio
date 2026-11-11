// src/service/paths.js:64 reads the CommonJS `__dirname`, which electron-vite supplies in the bundle and plain ESM
// does not. Only paths.js uses it in the service layer, and it only builds `<repo>/resources` from it, so the
// MCP server on source gets that value here. (Found while building startMcp; resolve.mjs stays as designed.)
import path from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.__dirname ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/service')
