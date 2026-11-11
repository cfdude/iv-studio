// One derivation of "the surfaces" (design D4): every MCP tool, window channel, event, page and start-menu journey,
// each with a source citation and a row id (design D5). The coverage test and the feature board writer both read it,
// so the two cannot drift.
//   const { rows } = await surfaces(root)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROW_ID = /^[a-z]+:[A-Za-z0-9_.:-]+$/
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const lineOf = (text, index) => text.slice(0, index).split('\n').length

// handle('channel', …) in src/main/index.js, leaving out protocol.handle and the definition `function handle(channel, fn)`
export function parseHandled(text) {
  const out = []
  for (const m of text.matchAll(/(?<![.\w])handle\(\s*(['"`])([^'"`]+)\1/g)) out.push({ channel: m[2], line: lineOf(text, m.index) })
  return out
}

// The ivstudio object in src/preload/index.js: `key: call('x')` and `key: on('x')` at their object paths.
export function parsePreload(text) {
  const start = text.indexOf("exposeInMainWorld('ivstudio'")
  const body = start < 0 ? text : text.slice(start)
  const stack = []
  const out = []
  let depth = 0
  const token = /(\w+)\s*:\s*\{|\{|\}|(\w+)\s*:\s*(call|on)\(\s*(['"`])([^'"`]*)\4\s*\)/g
  for (const m of body.matchAll(token)) {
    if (m[0] === '}') {
      depth--
      if (stack.length > depth - 1) stack.length = Math.max(0, depth - 1)
    } else if (m[0] === '{') {
      depth++ // the exposeInMainWorld object itself
    } else if (m[1] !== undefined) {
      depth++
      stack[depth - 2] = m[1]
    } else {
      out.push({ path: [...stack.slice(0, depth - 1), m[2]].join('.'), kind: m[3], channel: m[5], line: lineOf(text, (start < 0 ? 0 : start) + m.index) })
    }
  }
  return out
}

// {page === 'x' && … in App.jsx: the pages
export function parseRoutes(text) {
  const seen = new Map()
  for (const m of text.matchAll(/\{page === '([^']+)'/g)) if (!seen.has(m[1])) seen.set(m[1], lineOf(text, m.index))
  return [...seen].map(([route, line]) => ({ route, line }))
}

// Starts the MCP server on source (under the guard) and asks it, the way an agent would.
async function listTools(root) {
  const { startMcp } = await import(pathToFileURL(path.join(root, 'test/fakes/mcp.mjs')).href)
  const mcp = await startMcp({ comfyUrl: 'http://127.0.0.1:9' })
  try {
    const { tools } = await mcp.client.listTools()
    return tools.map((t) => t.name)
  } finally {
    await mcp.close()
  }
}

export async function surfaces(root = defaultRoot, { tools } = {}) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')
  const app = read('src/renderer/src/App.jsx')
  const menu = read('src/service/startmenu.js')
  const server = read('src/mcp/server.js')

  const toolNames = tools || (await listTools(root))
  const serverLines = server.split('\n')
  const toolRows = toolNames.map((name) => {
    const i = serverLines.findIndex((l) => l.includes(`'${name}'`) || l.includes(`"${name}"`))
    return { id: `mcp:${name}`, surface: 'mcp', name, source: `src/mcp/server.js:${i + 1}` }
  })

  const handled = parseHandled(main)
  const pre = parsePreload(preload)
  const exposed = pre.filter((e) => e.kind === 'call')
  const events = pre.filter((e) => e.kind === 'on')
  const routes = parseRoutes(app)
  const ids = [...menu.matchAll(/^\s+id: '([^']+)'/gm)].map((m) => ({ id: m[1], line: lineOf(menu, m.index) }))

  const rows = [
    ...toolRows,
    ...handled.map((h) => ({ id: `ipc:${h.channel}`, surface: 'ipc', name: h.channel, source: `src/main/index.js:${h.line}` })),
    ...events.map((e) => ({ id: `event:${e.channel}`, surface: 'event', name: e.channel, source: `src/preload/index.js:${e.line}` })),
    ...routes.map((r) => ({ id: `page:${r.route}`, surface: 'page', name: r.route, source: `src/renderer/src/App.jsx:${r.line}` })),
    ...ids.map((j) => ({ id: `journey:${j.id}`, surface: 'journey', name: j.id, source: `src/service/startmenu.js:${j.line}` }))
  ]
  return { rows, tools: toolRows, handled, exposed, events, routes, journeys: ids }
}
