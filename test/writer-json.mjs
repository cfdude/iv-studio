// Reading a writer's JSON answer (prompter.js parseJson, salvageJson): fences and chatter around the object are
// dropped, and an answer cut off at the token limit keeps the objects it finished (GitHub #27: the storyboard of a
// 5-minute film stopped with "The writer returned something unreadable").
//   node test/writer-json.mjs
import assert from 'node:assert/strict'
import { parseJson, salvageJson } from '../src/service/prompter.js'

let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log(`ok  ${name}`)
}

ok('plain, fenced, thinking and chatty answers all read', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('<think>hmm {not json}</think>\n{"a":1}'), { a: 1 })
  assert.deepEqual(parseJson('Here is the plan:\n{"a": {"b": [1, 2]}}\nHope that helps!'), { a: { b: [1, 2] } })
})

ok('garbage still says the writer was unreadable', () => {
  assert.throws(() => parseJson('I could not do that.'), /unreadable/)
  assert.throws(() => parseJson('{"shots": [{"action": "She wal'), /unreadable/)
})

ok('a shot list cut off mid-shot keeps every finished shot', () => {
  const shot = (k) => ({ action: `Shot ${k}: she says "hi" {and} [waves]`, staging: 'screen-left', camera: 'Wide', characters: ['Tess'], speaker: '', line: '', seconds: 5, ends: 'still' })
  const whole = JSON.stringify({ shots: [shot(1), shot(2), shot(3)] })
  const cut = whole.slice(0, whole.indexOf('Shot 3') + 20)
  assert.throws(() => parseJson(cut))
  const saved = salvageJson(cut)
  assert.equal(saved._cut, true)
  assert.deepEqual(saved.shots, [shot(1), shot(2)])
})

ok('a runaway field inside the first shot leaves nothing to keep', () => {
  assert.equal(salvageJson(`{"shots": [{"action": "${'and then '.repeat(500)}`), null)
  assert.equal(salvageJson('nothing here'), null)
})

ok('escaped quotes and brackets inside strings don’t confuse the cut', () => {
  const t = '{"shots": [{"action": "a \\"quoted\\" }] word", "seconds": 4}, {"action": "b'
  assert.deepEqual(salvageJson(t).shots, [{ action: 'a "quoted" }] word', seconds: 4 }])
})

console.log(`\n${n} checks passed`)
