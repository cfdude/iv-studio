// The chat shows the agent's markdown as formatting (src/renderer/src/chatText.js): bold, italics, code, headings
// and lists, with plain text, names and file paths left exactly as written.
import assert from 'node:assert/strict'
import { chatLines, inlineParts } from '../src/renderer/src/chatText.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('bold, italic and code', () => {
  assert.deepEqual(inlineParts('**Last Watch** has 3 shots'), [{ t: 'Last Watch', b: true }, { t: ' has 3 shots' }])
  assert.deepEqual(inlineParts('a *quick* one'), [{ t: 'a ' }, { t: 'quick', i: true }, { t: ' one' }])
  assert.deepEqual(inlineParts('run `npm ci` first'), [{ t: 'run ' }, { t: 'npm ci', code: true }, { t: ' first' }])
  assert.deepEqual(inlineParts('__also bold__'), [{ t: 'also bold', b: true }])
})

ok('plain text is left alone', () => {
  for (const s of ['5 * 3 = 15', 'the_seed_farmer_s_field_4.mp4', 'C:\\Users\\you\\IV Studio', '2 MP → 1952×1088', 'Tess’s line: “Of course.”', ''])
    assert.deepEqual(inlineParts(s), s ? [{ t: s }] : [])
})

ok('lines: headings, bullets, numbers, rules', () => {
  const l = chatLines('## Today\n- Shot 1, **2 takes**\n  * nested\n3. Third\n---\nplain')
  assert.deepEqual(l.map((x) => x.kind), ['head', 'bullet', 'bullet', 'bullet', 'rule', 'text'])
  assert.deepEqual(l[0].parts, [{ t: 'Today' }])
  assert.deepEqual(l[1].parts, [{ t: 'Shot 1, ' }, { t: '2 takes', b: true }])
  assert.equal(l[2].indent, 2)
  assert.equal(l[3].mark, '3.')
})

ok('the reply that showed raw asterisks', () => {
  const l = chatLines('**Dry Seat** has 1 shot waiting for a pick: shot 5, where Tess and Theo freeze face to face (2 takes).')
  assert.equal(l[0].parts[0].t, 'Dry Seat')
  assert.equal(l[0].parts[0].b, true)
  assert.ok(!l[0].parts.some((p) => p.t.includes('*')))
})

console.log(`chat-text: ${n} passed`)
