import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { buildSha } from './src/service/buildinfo.js'

// The commit this build is made from, shown beside the version (src/service/buildinfo.js). IV_STUDIO_BUILD_SHA
// overrides git, for a build made outside a checkout.
let head = ''
try {
  head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' })
} catch {
  /* no git: the label says "dev" */
}
const define = { __IV_BUILD_SHA__: JSON.stringify(buildSha(process.env, head)) }

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The MCP server ships beside the app and shares the same service code.
        input: { index: resolve('src/main/index.js'), mcp: resolve('src/mcp/server.js') }
      }
    }
  },
  preload: {},
  renderer: {
    define,
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
