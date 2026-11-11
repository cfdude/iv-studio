// Tour text names the platform's own key: Cmd on a Mac, Ctrl elsewhere (src/renderer/src/tours.js tourText).
//   node --test test/unit/tours-keys.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { TOURS, tourText } from '../../src/renderer/src/tours.js'

describe('tour keyboard hints', () => {
  test('{mod+Key} is Cmd on a Mac and Ctrl elsewhere, including when the platform is unknown', () => {
    assert.equal(tourText('press {mod+Enter}', 'darwin'), 'press ⌘Enter')
    assert.equal(tourText('press {mod+Enter}', 'win32'), 'press Ctrl+Enter')
    assert.equal(tourText('press {mod+Enter}', 'linux'), 'press Ctrl+Enter')
    assert.equal(tourText('press {mod+Enter}', null), 'press Ctrl+Enter')
    assert.equal(tourText('no key here', 'darwin'), 'no key here')
  })
  test('the Lines tour speaks the line with the platform key', () => {
    const step = TOURS.lines.steps.find((s) => s.title === 'Say a line')
    assert.match(tourText(step.text, 'darwin'), /⌘Enter/)
    assert.match(tourText(step.text, 'win32'), /Ctrl\+Enter/)
  })
  test('no tour step hard-codes Ctrl: it goes through {mod+Key}', () => {
    for (const [id, t] of Object.entries(TOURS)) for (const s of t.steps) assert.doesNotMatch(s.title + s.text, /Ctrl|Cmd|⌘/, `${id}: ${s.title}`)
  })
  test('every resolved step still fits the length limit test/tours.mjs holds it to', () => {
    for (const t of Object.values(TOURS)) for (const s of t.steps) for (const p of ['darwin', 'win32']) assert.ok(tourText(s.text, p).length <= 260, s.title)
  })
})
