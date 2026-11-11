import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertCopiesMain, assertHandlerNames, mainHandler } from './main-source.mjs'

const source = "handle('a:b', async (x) => {\n  const out = [] // ) in a comment-free string: ')'\n  return out.map((v) => v + 1)\n})\nhandle('c:d', () => ({ k: KEPT }))"

test('the drift check finds a handler in main\'s text, whatever its spacing, and refuses a changed one', () => {
  assert.match(mainHandler('c:d', source), /KEPT/)
  assert.throws(() => mainHandler('nope', source), /no handle\('nope'\)/)
  assertCopiesMain(assert, 'a:b', "const out = [] return out.map((v) => v + 1)", {}, source.replace('// ) in a comment-free string: \')\'', ''))
  assert.throws(() => assertCopiesMain(assert, 'a:b', "return out.map((v) => v + 2)", {}, source), /no longer contains the logic/)
})

test('a swap maps main\'s names to the test\'s own before comparing', () => {
  assertCopiesMain(assert, 'c:d', "() => ({ k: mine })", { KEPT: 'mine' }, source)
})

test('the name check fails when main\'s handler stops handing a constant over', () => {
  assertHandlerNames(assert, 'c:d', ['KEPT'], source)
  assert.throws(() => assertHandlerNames(assert, 'c:d', ['GONE'], source), /no longer hands over GONE/)
})
