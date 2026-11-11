// The window-channel map (task 6.1): every handled channel is mapped to the service method its one-line handler
// calls, or listed for hand mapping, and every mapped method exists on its service class.
//   node --test test/unit/ipc-map.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { classFile, mapIpc, readMap, receivers } from './ipc-map.mjs'
import { parseHandled } from './surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('window channel map', () => {
  const { mapped, hand, imports } = readMap(root)
  const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')

  test('mapped plus hand-listed channels are the 384 handled channels, each once', () => {
    const handled = parseHandled(main).map((h) => h.channel)
    const all = [...mapped.map((m) => m.channel), ...hand.map((h) => h.channel)]
    assert.equal(handled.length, 384)
    assert.equal(all.length, 384)
    assert.equal(new Set(all).size, 384)
    assert.deepEqual([...all].sort(), [...handled].sort())
  })

  test('every mapped channel names a method its service class really has', () => {
    const recv = receivers(main)
    assert.ok(mapped.length > 100, `only ${mapped.length} channels mapped`)
    for (const m of mapped) {
      assert.equal(recv[m.receiver], m.className, `${m.channel}: ${m.receiver} is not a service object`)
      const file = classFile(m.className, imports)
      assert.ok(file, `${m.channel}: no source file for ${m.className}`)
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      const start = text.search(new RegExp(`^export class ${m.className}\\b|^class ${m.className}\\b`, 'm'))
      assert.ok(start >= 0, `${m.channel}: no class ${m.className} in ${file}`)
      // a method (`name(`, `async name(`) or a class field (`name = `) in the class body
      const defined = new RegExp(`^  (?:async |static |get )?${m.method}\\s*(?:\\(|=)`, 'm').test(text.slice(start))
      assert.ok(defined, `${m.channel}: ${m.className} has no method ${m.method} in ${file}`)
    }
  })

  test('a handler is mapped only when it is one line calling a service object', () => {
    const text = [
      "import { Music } from '../service/music'",
      'let music = null',
      'music = new Music({})',
      "  handle('a:one', (id) => music.get(id))",
      "  handle('a:wrapped', async (id) => rebuilds.view(await music.get(id)))",
      "  handle('a:built', () => ({ engines: 1 }))",
      "  handle('a:other', (u) => shell.openPath(u))",
      "  handle('a:many', (id) => {",
      '    return music.get(id)',
      '  })'
    ].join('\n')
    const r = mapIpc(text)
    assert.deepEqual(r.mapped.map((m) => `${m.channel}=${m.className}.${m.method}`), ['a:one=Music.get', 'a:wrapped=Music.get'])
    assert.deepEqual(r.hand.map((h) => h.channel), ['a:built', 'a:other', 'a:many'])
  })
})
