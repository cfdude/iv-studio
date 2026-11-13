// The two agent buttons on a run say what each does. node --test test/unit/run-ask-words.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { runAskWords } from '../../src/renderer/src/runAsk.js'

describe('runAskWords', () => {
  test('one chats about the run, the other has the agent pick the best take', () => {
    const w = runAskWords('Claude')
    assert.equal(w.chat.label, 'Chat with Claude about this run')
    assert.equal(w.pick.label, 'Have Claude pick the best take')
    assert.notEqual(w.chat.label, w.pick.label)
    assert.match(w.chat.title, /nothing is sent until you do/)
    assert.match(w.pick.title, /right away.*ranks the takes/)
  })
  test('the Shot page uses them, and no longer has the two near-identical "Ask" labels', () => {
    const src = fs.readFileSync('src/renderer/src/components/Shot.jsx', 'utf8')
    assert.match(src, /runAskWords\(agent\)\.chat\.label/)
    assert.match(src, /runAskWords\(agent\)\.pick\.label/)
    assert.doesNotMatch(src, /Ask \{agent\}/)
  })
})
