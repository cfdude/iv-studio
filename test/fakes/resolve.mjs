// A tiny resolve hook for the MCP server on source (design D1). src/mcp and src/main import their neighbours
// without an extension ('../service/paths'), which electron-vite resolves and plain Node does not. This adds `.js`
// to a relative specifier when plain resolution fails, and does nothing else.
//   node --import ./test/fakes/resolve.mjs src/mcp/server.js
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      const retry = err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
      if (!relative || !retry || /\.[cm]?[jt]s$|\.json$/.test(specifier)) throw err
      return nextResolve(`${specifier}.js`, context)
    }
  }
})
