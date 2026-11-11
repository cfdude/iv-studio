// Drift checks for the tests that cannot run main's handler (src/main/index.js starts Electron, so it cannot be imported
// into a test). Those tests carry a COPY of a handler's glue; these helpers read the handler out of main's source text
// and fail when the copy no longer appears there, so changing main's handler fails the test that mirrors it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/index.js')

const squash = (text) => String(text).replace(/\s+/g, '')

// The text of handle('<channel>', ...) from main's source, the whole call.
export function mainHandler(channel, source = fs.readFileSync(MAIN, 'utf8')) {
  const start = source.indexOf(`handle('${channel}'`)
  if (start === -1) throw new Error(`main has no handle('${channel}')`)
  const open = source.indexOf('(', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`handle('${channel}') in main never closes`)
}

// Fails unless the copied logic appears in main's handler for the channel, ignoring whitespace. `swaps` maps a piece of
// main's text to what the copy uses in its place (for example the data folder variable), applied to main's side first.
export function assertCopiesMain(assert, channel, copied, swaps = {}, source) {
  let handler = squash(mainHandler(channel, source))
  for (const [from, to] of Object.entries(swaps)) handler = handler.split(squash(from)).join(squash(to))
  assert.ok(handler.includes(squash(copied)), `main's handle('${channel}') no longer contains the logic this test copies:\n${copied}`)
}

// Fails unless main's handler for the channel names every one of these (the constants the test checks are what main hands over).
export function assertHandlerNames(assert, channel, names, source) {
  const handler = mainHandler(channel, source)
  for (const n of names) assert.ok(new RegExp(`\\b${n}\\b`).test(handler), `main's handle('${channel}') no longer hands over ${n}`)
}

// Fails unless main's source still holds this exact piece of code (whitespace ignored): for a payload a test copies from
// a `send(...)` call, which is not inside any handle(...).
export function assertMainSends(assert, copied, source = fs.readFileSync(MAIN, 'utf8')) {
  assert.ok(squash(source).includes(squash(copied)), `main no longer contains the code this test copies:\n${copied}`)
}
