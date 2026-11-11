// The window channel contract, checked from source (design D2): every channel main handles that the window is
// given is exposed, every channel preload exposes is handled, every window.ivstudio.<a>.<b> a page uses is
// exposed, and no channel name is built at run time (so none can hide from this check).
//   node --test test/unit/channel-contract.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseHandled, parsePreload } from './surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (/\.(jsx?|mjs)$/.test(e.name)) yield full
  }
}

// call(, on( or handle( whose first argument is not a plain string literal (a template with ${ counts as built at run time)
export function nonLiteralCalls(text, file) {
  const out = []
  const re = /(?<![.\w$])(?<!function\s)(call|on|handle)\(\s*(?!(['"])[^'"\n]*\2\s*[,)])(?!`[^`$]*`\s*[,)])/g
  for (const m of text.matchAll(re)) {
    const line = text.slice(0, m.index).split('\n').length
    out.push(`${file}:${line}: ${m[1]}( is not given a string literal`)
  }
  return out
}

// window.ivstudio.<a>.<b> in page code
export function rendererUses(text, file) {
  const out = []
  for (const m of text.matchAll(/window\.ivstudio\.(\w+)\.(\w+)/g)) out.push({ path: `${m[1]}.${m[2]}`, file, line: text.slice(0, m.index).split('\n').length })
  return out
}

// Everything that is wrong between main, preload and the pages. `renderer` is [{ file, text }].
export function contractProblems({ mainText, preloadText, renderer }) {
  const problems = []
  const handled = new Set(parseHandled(mainText).map((h) => h.channel))
  const pre = parsePreload(preloadText)
  for (const e of pre.filter((x) => x.kind === 'call')) if (!handled.has(e.channel)) problems.push(`exposed channel ${e.channel} (${e.path}) has no handler in main`)
  // every path preload gives the window, and every object on the way to it (setup.updates.check -> setup.updates)
  const paths = new Set()
  for (const e of pre) {
    const parts = e.path.split('.')
    for (let i = 2; i <= parts.length; i++) paths.add(parts.slice(0, i).join('.'))
  }
  for (const { file, text } of renderer) {
    for (const u of rendererUses(text, file)) if (!paths.has(u.path)) problems.push(`${file}:${u.line}: window.ivstudio.${u.path} is not exposed by preload`)
  }
  return problems
}

describe('window channel contract', () => {
  const mainText = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
  const preloadText = fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8')
  const renderer = [...walk(path.join(root, 'src/renderer/src'))].map((f) => ({ file: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }))

  test('every exposed channel is handled and every page call is exposed', () => {
    assert.deepEqual(contractProblems({ mainText, preloadText, renderer }), [])
  })

  test('no call(), on() or handle() is given anything but a string literal', () => {
    const found = [['src/main/index.js', mainText], ['src/preload/index.js', preloadText]].flatMap(([f, t]) => nonLiteralCalls(t, f))
    assert.deepEqual(found, [])
  })

  test('a page calling an unexposed channel fails, naming it', () => {
    const problems = contractProblems({ mainText: "handle('a:b', () => 1)", preloadText: "exposeInMainWorld('ivstudio', { a: { b: call('a:b') } })", renderer: [{ file: 'Fixture.jsx', text: 'await window.ivstudio.a.nope()' }] })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /Fixture\.jsx:1.*a\.nope/)
  })

  test('an exposed channel with no handler fails, naming it', () => {
    const problems = contractProblems({ mainText: "handle('a:b', () => 1)", preloadText: "exposeInMainWorld('ivstudio', { a: { b: call('a:b'), c: call('a:orphan') } })", renderer: [] })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /a:orphan/)
  })

  test('a channel name built at run time fails; literals and definitions do not', () => {
    assert.equal(nonLiteralCalls("a: call('x:y'), b: call(name), c: on(`ev:${n}`)", 'f.js').length, 2)
    assert.equal(nonLiteralCalls('function handle(channel, fn) {}\nipcRenderer.on(channel, l)', 'f.js').length, 0)
    assert.equal(nonLiteralCalls("handle(`a:b`, f)\nhandle('a:c', f)", 'f.js').length, 0)
  })
})
