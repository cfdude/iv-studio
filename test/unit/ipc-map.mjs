// Maps each window channel to the service method its one-line handler calls (design D2, task 6.1), derived from
// source so the lists cannot go stale. `handle('x', (a, b) => studio.method(a, b))` is mapped; a handler that spans
// lines, builds its own answer, or calls something that is not a service object is listed for hand mapping (6.3).
//   const { mapped, hand } = mapIpc(mainText)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

// `import { A, B as C } from '../service/mod'` -> { A: 'src/service/mod.js', C: ... } (only ../service/ imports)
export function serviceImports(text) {
  const out = {}
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/service\/([\w/]+)'/g)) {
    for (const part of m[1].split(',')) {
      const [name, alias] = part.trim().split(/\s+as\s+/)
      if (name) out[alias || name] = `src/service/${m[2]}.js`
    }
  }
  return out
}

// `voices = new Voices(` and `const edits = new Edits(` -> { voices: 'Voices', edits: 'Edits' } for service classes.
// `studio.cast` is the Cast the Studio builds for itself (studio.js).
export function receivers(text) {
  const imports = serviceImports(text)
  const out = {}
  for (const m of text.matchAll(/^\s*(?:const |let )?(\w+) = new (\w+)\(/gm)) if (imports[m[2]]) out[m[1]] = m[2]
  if (out.studio === 'Studio') out['studio.cast'] = 'Cast'
  return out
}

// The class's home file: Cast lives in cast.js, the rest from the imports of the file that built them.
export function classFile(className, imports) {
  return className === 'Cast' ? 'src/service/cast.js' : imports[className]
}

// One-line handlers: `handle('channel', <params> => <body>)` with the whole handler on a line.
const ONE_LINE = /^\s*handle\('([^']+)',\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*(.+)\)\s*$/
// A body that is one call on a service object: `recv.method(`, optionally awaited, optionally in a wrapper that only
// reshapes the result (`rebuilds.view(`, `track(`).
const CALL = /^(?:(?:rebuilds\.view|track)\(\s*)?(?:await\s+)?(\w+(?:\.\w+)?)\.(\w+)\(/

export function mapIpc(mainText) {
  const recv = receivers(mainText)
  const mapped = []
  const hand = []
  const lines = mainText.split('\n')
  for (const m of mainText.matchAll(/(?<![.\w])handle\(\s*(['"`])([^'"`]+)\1/g)) {
    const line = lineOf(mainText, m.index)
    const channel = m[2]
    const one = ONE_LINE.exec(lines[line - 1])
    const call = one && CALL.exec(one[2].trim())
    if (call && recv[call[1]]) mapped.push({ channel, receiver: call[1], className: recv[call[1]], method: call[2], line })
    else hand.push({ channel, line, why: one ? 'builds its own answer or calls something that is not a service object' : 'spans several lines' })
  }
  return { mapped, hand }
}

export function readMap(root = defaultRoot) {
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const { mapped, hand } = mapIpc(main)
  return { mapped, hand, imports: serviceImports(main) }
}
