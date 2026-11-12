// @ mentions (src/service/cast.js): handles, resolution in each mode, and saving places on temporary data.
//   node test/cast.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cast, handleOf, mentionsIn, resolveMentions, withCast } from '../src/service/cast.js'
import { lintPrompt } from '../src/service/lint.js'

let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log(`ok  ${name}`)
}
const members = [
  { handle: 'Tess', kind: 'character', id: 'tess', name: 'Tess Marlow', picture: 'C:/faces/tess.jpg' },
  { handle: 'Theo', kind: 'character', id: 'theo', name: 'Theo Lindqvist', picture: 'C:/faces/theo.png' },
  { handle: 'Mara', kind: 'character', id: 'mara', name: 'Mara', picture: null },
  { handle: 'BusStop', kind: 'place', id: 'p1', name: 'Bus Stop', picture: 'C:/places/bus.png', description: 'a rain-slicked shelter.' }
]
const TEXT = `integrated_multimodal_description: [Shot 1] Live-action. @Tess waits at @BusStop. @Theo (S1) runs up and says: <d>[English] Mine.</d> [Shot 2] At 00:04.000, the camera cuts to @Tess laughing.

overall_soundscape: Rain.

non_diegetic_music: N/A`

ok('handles: first names for characters, joined words for places, mentions found', () => {
  assert.equal(handleOf('Tess Marlow', 'character'), 'Tess')
  assert.equal(handleOf('Bus Stop', 'place'), 'BusStop')
  assert.equal(handleOf("Gran's kitchen", 'place'), 'GranSKitchen')
  assert.deepEqual(mentionsIn('@Tess at @BusStop, mail me at a@b.com, <Picture 1>'), ['Tess', 'BusStop'])
})
ok('no mentions: the request is untouched', () => {
  const req = { mode: 'text', prompt: 'integrated_multimodal_description: [Shot 1] A cat.', character: 'tess' }
  assert.equal(resolveMentions(req, members).request, req)
})
ok('the picked character becomes {char}; text mode stays text when nobody else is mentioned', () => {
  const { request, notes } = resolveMentions({ mode: 'text', prompt: 'integrated_multimodal_description: [Shot 1] @Tess smiles.', character: 'tess' }, members)
  assert.equal(request.prompt, 'integrated_multimodal_description: [Shot 1] {char} smiles.')
  assert.equal(request.mode, 'text')
  assert.deepEqual(notes, [])
})
ok('others with pictures: References mode, pictures attached, subjects defined and kept', () => {
  const { request, notes } = resolveMentions({ mode: 'text', prompt: TEXT, character: 'tess', media: [] }, members)
  assert.equal(request.mode, 'reference')
  assert.deepEqual(request.media, [{ kind: 'picture', file: 'C:/places/bus.png' }, { kind: 'picture', file: 'C:/faces/theo.png' }])
  assert.match(request.prompt, /^subject_definitions:\n<Subject 1> is the place in <Picture 1>: Bus Stop, a rain-slicked shelter\.\n<Subject 2> is Theo Lindqvist, the person in <Picture 2>\.\n\nsummary:\n\[reference generation\] /)
  assert.match(request.prompt, /\n<Subject 1> \(appears in \[Shot 1\], \[Shot 2\]\): fully_preserved - the place/)
  assert.match(request.prompt, /\ndetailed_description:\n\[Shot 1\] Live-action\. \{char\} waits at <Subject 1>\. <Subject 2> \(S1\) runs up and says: <d>\[English\] Mine\.<\/d>\n\[Shot 2\] At 00:04\.000, the camera cuts to \{char\} laughing\.\n\noverall_soundscape:\nRain\.\n\nnon_diegetic_music:\nN\/A$/)
  assert.ok(notes.some((x) => x.level === 'info' && /References mode/.test(x.message)))
  // the resolved prompt passes the checker's reference rules
  const errors = lintPrompt(request.prompt, { mode: 'reference', seconds: 8, media: request.media }).filter((f) => f.level === 'error')
  assert.deepEqual(errors, [])
})
ok('a reference prompt keeps its own subjects and pictures and numbers on from them', () => {
  const prompt = 'subject_definitions:\n<Subject 1> is the dog in <Picture 1>.\n\ndetailed_description:\n[Shot 1] <Subject 1> chases @Theo.\n\noverall_soundscape:\nPark.\n\nnon_diegetic_music:\nN/A'
  const { request } = resolveMentions({ mode: 'reference', prompt, media: [{ kind: 'picture', file: 'C:/dog.png' }] }, members)
  assert.match(request.prompt, /<Subject 1> is the dog in <Picture 1>\.\n<Subject 2> is Theo Lindqvist, the person in <Picture 2>\./)
  assert.match(request.prompt, /\[Shot 1\] <Subject 1> chases <Subject 2>\./)
  assert.equal(request.media.length, 2)
})
ok('no picture, unknown names, and frames mode', () => {
  const r1 = resolveMentions({ mode: 'text', prompt: 'integrated_multimodal_description: [Shot 1] @Mara waves.' }, members)
  assert.equal(r1.request.prompt, 'integrated_multimodal_description: [Shot 1] Mara waves.')
  assert.equal(r1.notes[0].level, 'warning')
  assert.equal(resolveMentions({ mode: 'text', prompt: '[Shot 1] @Zed waves.' }, members).notes[0].level, 'error')
  const r3 = resolveMentions({ mode: 'frames', prompt: 'integrated_multimodal_description: [Shot 1] @Theo waves.', media: [{ kind: 'picture', file: 'f.png' }] }, members)
  assert.equal(r3.request.mode, 'frames')
  assert.match(r3.request.prompt, /\] Theo waves\./)
  assert.equal(r3.request.media.length, 1)
})
ok('places save with their picture, refuse a clash, and films offer theirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-cast-'))
  const pic = path.join(root, 'shelter.png')
  fs.writeFileSync(pic, 'png')
  fs.mkdirSync(path.join(root, 'productions'))
  fs.writeFileSync(path.join(root, 'productions', 'f1.json'), JSON.stringify({ id: 'f1', name: 'Dry Seat', locations: [{ id: 'l1', name: 'Pier', description: 'old boards', pictures: [pic] }, { id: 'l2', name: 'Nowhere', pictures: [] }] }))
  const cast = new Cast({ dataDir: root, characters: () => [{ id: 'tess', name: 'Tess Marlow' }], facePicture: () => null })
  const place = cast.savePlace({ name: 'Bus Stop', description: 'a shelter', picture: pic })
  assert.ok(fs.existsSync(place.picture) && place.picture.startsWith(path.join(root, 'places')))
  assert.throws(() => cast.savePlace({ name: 'Tess', picture: pic }), /already a character/)
  assert.throws(() => cast.savePlace({ name: 'Gate' }), /needs a picture/)
  assert.deepEqual(cast.members().map((m) => `${m.kind}:@${m.handle}`), ['character:@Tess', 'place:@BusStop', 'place:@Pier'])
  cast.deletePlace(place.id)
  assert.equal(cast.places().length, 0)
  fs.rmSync(root, { recursive: true, force: true })
})
ok('#30: others picked in "Who\'s in it" join as mentions: a name in the prompt, else a line in [Shot 1]', () => {
  const named = withCast({ mode: 'text', character: 'tess', with: ['theo'], prompt: 'integrated_multimodal_description: [Shot 1] {char} hands Theo Lindqvist a cup. Theo smiles.' }, members)
  assert.equal(named.with, undefined)
  assert.equal(named.prompt, 'integrated_multimodal_description: [Shot 1] {char} hands @Theo a cup. @Theo smiles.')
  const unnamed = withCast({ mode: 'text', character: 'tess', with: ['theo', 'mara'], prompt: 'integrated_multimodal_description: [Shot 1] {char} waits in the rain.' }, members)
  assert.equal(unnamed.prompt, 'integrated_multimodal_description: [Shot 1] @Theo and @Mara are also in the shot. {char} waits in the rain.')
  // already mentioned, the lead themselves, and unknown ids change nothing
  const same = 'integrated_multimodal_description: [Shot 1] @Theo waves.'
  assert.equal(withCast({ mode: 'text', character: 'tess', with: ['theo', 'tess', 'gone'], prompt: same }, members).prompt, same)
  // "Theodore" is not Theo
  assert.equal(withCast({ mode: 'text', character: 'tess', with: ['theo'], prompt: 'Theodore waves.' }, members).prompt, 'Theodore waves. @Theo is also in the shot.')
})
ok('#30: with a lead and another character, the shot renders in References mode with the other\'s face', () => {
  const asked = withCast({ mode: 'text', character: 'tess', with: ['theo'], prompt: 'integrated_multimodal_description: [Shot 1] {char} hands Theo a cup.\n\noverall_soundscape: Cafe.\n\nnon_diegetic_music: N/A' }, members)
  const { request } = resolveMentions(asked, members)
  assert.equal(request.mode, 'reference')
  assert.equal(request.character, 'tess')
  assert.deepEqual(request.media, [{ kind: 'picture', file: 'C:/faces/theo.png' }])
  assert.match(request.prompt, /\{char\} hands <Subject 1> a cup/)
  assert.match(request.prompt, /<Subject 1> is Theo Lindqvist, the person in <Picture 1>/)
})
console.log(`${n} checks passed`)
