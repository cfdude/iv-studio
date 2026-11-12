// Projects: a shot's spoken line always reaches its H3 prompt.   node test/productions.mjs
import assert from 'node:assert/strict'
import { shotName } from '../src/service/studio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Productions, animaticPlan, asFirstFrame, beatOf, facePrompt, heading, isOutside, keepLines, oneTake, placePicture, placePrompt, sceneParts, scriptText, shotSchemaFor, sketchPrompt, spokenWords, withLine, withRoom, withSilence, wordMatch } from '../src/service/productions.js'
import { parseScript } from '../src/service/screenplay.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log(`ok  ${name}`))
const P = 'integrated_multimodal_description:\n[Shot 1] Medium static shot: {char} lifts a bowl. She smiles.\n\noverall_soundscape:\nRain taps.\n\nnon_diegetic_music:\nN/A'

ok('a missing line goes at the end of the shot paragraph', () => {
  const out = withLine(P, '{char}', "That's the one.")
  assert.match(out, /She smiles\. \{char\} says: <d>\[English\] That's the one\.<\/d>\n\noverall_soundscape:/)
})
ok('a line already tagged is left alone', () => {
  const q = P.replace('She smiles.', 'She says: <d>[English] That’s the one!</d>')
  assert.equal(withLine(q, '{char}', "That's the one."), q)
})
ok('no line, no change', () => assert.equal(withLine(P, 'Tess', ''), P))
ok('quotes around the words are dropped', () => assert.match(withLine(P, 'Tess', '"Go."'), /<d>\[English\] Go\.<\/d>/))
ok('a prompt without sections still gets the line', () => assert.equal(withLine('[Shot 1] A bowl.', 'Tess', 'Hi.'), '[Shot 1] A bowl. Tess says: <d>[English] Hi.</d>'))
ok('a written script reads back as scenes, cues and lines', () => {
  const text = scriptText({ title: 'Clay', scenes: [{ place: 'Pottery studio', time: 'day', inside: true, beats: [{ kind: 'action', text: 'Tess lifts a bowl.', who: '', how: '' }, { kind: 'line', text: '"That’s the one."', who: 'Tess', how: 'to herself' }] }, { place: 'Street', time: 'NIGHT', inside: false, beats: [{ kind: 'line', text: 'Run!', who: 'Theo', how: '' }] }] })
  const s = parseScript(text)
  assert.equal(s.title, 'Clay')
  assert.deepEqual(s.scenes.map((x) => x.heading), ['INT. POTTERY STUDIO - DAY', 'EXT. STREET - NIGHT'])
  assert.deepEqual(s.scenes[0].elements[1], { type: 'dialogue', who: 'Tess', paren: 'to herself', text: 'That’s the one.' })
  assert.deepEqual(s.speakers.sort(), ['Tess', 'Theo'])
})
ok('a line keeps only the words said out loud', () => {
  assert.equal(spokenWords('Theo: "It\'s mine," he says, voice tight.'), "It's mine.")
  assert.equal(spokenWords('Tess: “I’m not wasting anything,” she says, and holds out the umbrella.'), 'I’m not wasting anything.')
  assert.equal(spokenWords('"Run!" she shouts. "Now!"'), 'Run! Now!')
  assert.equal(spokenWords('That’s the one.'), 'That’s the one.')
  assert.equal(spokenWords('I said "no" twice.'), 'I said "no" twice.')
  assert.equal(spokenWords('"Go."'), 'Go.')
  assert.equal(spokenWords("Tess (quiet, steady): 'We both got this.'"), 'We both got this.')
  assert.equal(spokenWords("'Tis the season."), "'Tis the season.")
})
ok('a beat with its fields swapped is put right', () => {
  assert.deepEqual(beatOf({ kind: 'line', speaker: 'Tess', delivery: "it's not my fault you're a wet dog.", words: 'Tess (sharper)' }), { kind: 'line', speaker: 'Tess', delivery: '', words: "it's not my fault you're a wet dog." })
  assert.deepEqual(beatOf({ kind: 'line', speaker: 'Theo', delivery: 'flat', words: 'Theo: "It\'s mine," he says.' }), { kind: 'line', speaker: 'Theo', delivery: 'flat', words: "It's mine." })
  assert.deepEqual(beatOf({ kind: 'line', speaker: 'Tess', delivery: '(soft)', words: 'Theo, wait.' }), { kind: 'line', speaker: 'Tess', delivery: 'soft', words: 'Theo, wait.' })
  assert.deepEqual(beatOf({ kind: 'line', speaker: 'Tess', delivery: '', words: '', action: 'She sits.' }), { kind: 'action', action: 'She sits.' })
  assert.deepEqual(beatOf({ kind: 'action', text: 'Rain falls.', who: '', how: '' }), { kind: 'action', action: 'Rain falls.' })
})
ok('a heading keeps one place and one time', () => {
  assert.deepEqual(heading('Bus stop – rainy afternoon', 'AFTERNOON'), { place: 'Bus stop', time: 'DAY' })
  assert.deepEqual(heading('Lighthouse tower', 'NIGHT - NIGHT'), { place: 'Lighthouse tower', time: 'NIGHT' })
  assert.deepEqual(heading('Living room', 'MIDNIGHT'), { place: 'Living room', time: 'NIGHT' })
  assert.deepEqual(heading('Pier', ''), { place: 'Pier', time: 'DAY' })
})
ok('a shot with no line says nobody speaks', () => {
  const q = P.replace('{char} lifts', '{char} (S1) lifts')
  const out = withSilence(q)
  assert.match(out, /She smiles\. Nobody speaks in this shot: no dialogue, only the sounds of the place\.\n\noverall_soundscape:/)
  assert.ok(!out.includes('(S1)'))
  const talk = withLine(P, 'Tess', 'Hi.')
  assert.equal(withSilence(talk), talk)
})
ok('a spoken take is scored by the words heard', () => {
  assert.equal(wordMatch('Nope. Mine.', 'Nope.'), 0.5)
  assert.equal(wordMatch('Then let’s share it.', 'And let\'s share.'), 0.5)
  assert.equal(wordMatch('That’s mine.', "That's mine."), 1)
  assert.equal(wordMatch('You’re not faster than me.', "you're not faster than me."), 1)
  assert.equal(wordMatch('Mine.', 'Mine swept'), 0.5)
})
ok('a sketch prompt names the face, framing and place', () => {
  const t = sketchPrompt({ action: 'Tess lifts a bowl.', camera: 'Medium shot, static.', place: 'Pottery studio', time: 'DAY', description: 'shelves of bowls', look: 'muted earthy colours', faces: ['Tess Marlow'] })
  assert.match(t, /^Cinematic film still, medium shot, static framing\. Tess Marlow is the person in picture 1; keep their face\. Tess lifts a bowl\. Pottery studio, day: shelves of bowls\. Look: muted earthy colours\./)
})
ok('a place is drawn empty, in its time and look', () => {
  const t = placePrompt({ place: 'Living Room', time: 'NIGHT', description: 'a worn grey sofa under a moonlit window', look: 'muted earthy colours' })
  assert.match(t, /^Cinematic film still, wide establishing shot of Living Room, night\. a worn grey sofa under a moonlit window\. Nobody in it/)
  assert.match(t, /Look: muted earthy colours\./)
})
ok('a shot with a room opens on <Picture 1> and stays in <Picture 2>', () => {
  const r = withRoom(asFirstFrame(P), { place: 'Pottery Studio', description: 'shelves of bowls, a skylight.' })
  assert.match(r, /^subject_definitions:\n<Picture 1> is the first frame of \[Shot 1\], the storyboard sketch of this shot\.\n<Subject 1> is the place in <Picture 2>: Pottery Studio, shelves of bowls, a skylight\.\n/)
  assert.match(r, /\n\nsummary:\n\[keyframe completion \+ reference generation\] /)
  assert.match(r, /\n<Picture 1> \(\[Shot 1\] first frame\): fully_preserved - /)
  assert.match(r, /\n<Subject 1> \(appears in \[Shot 1\]\): fully_preserved - /)
  assert.ok(!r.includes('is fully referenced') && !r.includes('integrated_multimodal_description'))
  assert.match(r, /\n\ndetailed_description:\nThe shot begins from <Picture 1>[^\n]*\n\[Shot 1\] Medium static shot: \{char\} lifts a bowl\. She smiles\.\n\noverall_soundscape:\nRain taps\.\n\nnon_diegetic_music:\nN\/A$/)
  // the writer's one-line layout: two shots on one line each get their own line
  const inline = withRoom('integrated_multimodal_description: [Shot 1] A. [Shot 2] At 00:03.000, B.\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A', { place: 'Bus stop', people: ['Theo'] })
  assert.match(inline, /\n\[Shot 1\] A\.\n\[Shot 2\] At 00:03\.000, B\.\n\noverall_soundscape:\nWind\./)
  assert.match(inline, /<Subject 2> is Theo, the person in <Picture 3>\./)
  assert.match(inline, /Theo is <Subject 2>\./)
  assert.match(inline, /<Subject 2> \(appears in \[Shot 1\], \[Shot 2\]\): partially_preserved - Theo's face and hair only/)
})
ok('an outdoor place is kept as a place, not a room', () => {
  const out = withRoom(asFirstFrame(P.replace('\n\noverall_soundscape:\nRain taps.', '')), { place: "Farmer's Field", outside: true })
  assert.ok(!/room|furniture/i.test(out), out)
  assert.match(out, /fully_preserved - the place, its ground, plants and sky, light and colours/)
  assert.ok(isOutside({ heading: 'EXT. FARMER’S FIELD - EVENING' }) && isOutside({ inside: false }) && !isOutside({ heading: 'INT. KITCHEN - NIGHT' }))
  assert.match(withRoom(asFirstFrame(P), { place: 'Pottery Studio' }), /fully_preserved - the room, its furniture/)
})
ok('a shot filmed from its sketch opens on <Picture 1>, once', () => {
  const f = asFirstFrame(P)
  assert.ok(f.startsWith('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description:'))
  assert.equal(asFirstFrame(f), f)
})
ok('a moving staged shot: its previs is <Video 1>, with or without a sketch and a room', () => {
  const stage = { people: [{ name: 'Tess', x: -1, y: 1, facing: 90 }, { name: 'Theo', x: 1, y: 1, facing: -90 }], camera: { x: 0, y: -3, facing: 0, lens: 'normal', move: 'arc-left', height: 'eye' } }
  const all = withRoom(asFirstFrame(P), { place: 'Pottery Studio', people: ['Theo'], previs: stage })
  assert.match(all, /<Subject 2> is Theo, the person in <Picture 3>\./)
  assert.match(all, /Its camera move and blocking follow <Video 1>\./)
  assert.match(all, /\n<Video 1> \(camera movement and blocking\): partially_preserved - /)
  assert.match(all, /detailed_description:\nThe shot begins from <Picture 1> and takes place in <Subject 1>, the place in <Picture 2>, throughout\.\n<Video 1> is a grey previs/)
  const bare = withRoom(P, { people: ['Theo'], sketch: false, room: false, previs: stage })
  assert.ok(!/<Picture 2>|<Subject 2>|place in/.test(bare), 'no sketch and no room: Theo is <Subject 1>, <Picture 1>')
  assert.match(bare, /<Subject 1> is Theo, the person in <Picture 1>\./)
  assert.match(bare, /^subject_definitions:\n<Subject 1> is Theo/)
  assert.match(bare, /\[reference generation\] The target video is one shot\. Theo is <Subject 1>\. Its camera move/)
  assert.match(bare, /detailed_description:\n<Video 1> is a grey previs/)
  const sketchOnly = withRoom(asFirstFrame(P), { room: false, previs: stage })
  assert.match(sketchOnly, /detailed_description:\nThe shot begins from <Picture 1>\.\n<Video 1>/)
})
ok('a new shot is named from its first shot, not its field names', () => {
  const ref = ['subject_definitions:', '<Subject 1> is {char} (S1).', '', 'retention_analysis:', '<Subject 1> (appears in [Shot 1]): fully_preserved - x', '', 'detailed_description:', '[Shot 1] Live-action, cinematic. Full shot of {char} (S1) on a rooftop at dusk with water towers.'].join('\n')
  assert.equal(shotName(ref, { name: 'Tess Marlow' }), 'Full shot of Tess on a rooftop at dusk…')
  assert.equal(shotName('integrated_multimodal_description: [Shot 1] A dog runs.', null), 'A dog runs.')
  // the house rules ("There is no writing…", "One continuous take") are skipped
  assert.equal(shotName('integrated_multimodal_description: [Shot 1] One continuous take. There is no writing anywhere in the picture. {char} sits behind the wheel in a grey hoodie.', { name: 'Theo Lindqvist' }), 'Theo sits behind the wheel in a grey…')
})
ok('a sketch drawn before the shot changed is set aside until it is redrawn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-prod-'))
  const films = new Productions({ dataDir: dir, studio: () => null })
  const p = films.create({ name: 'Stale' })
  films.patch(p.id, (q) => (q.scenes = [{ id: 's1', heading: 'EXT. BUS STOP - NIGHT', shots: [{ id: 'a', action: 'They sit.', seconds: 5, sketch: 'C:/x.png' }, { id: 'b', action: 'Rain.', seconds: 5 }] }]))
  films.editShot(p.id, 's1', 'a', { seconds: 6, line: '' })
  assert.ok(!films.find(films.get(p.id), 'a').sh.sketchStale, 'length and words leave the sketch alone')
  films.editShot(p.id, 's1', 'a', { action: 'They sit.' })
  assert.ok(!films.find(films.get(p.id), 'a').sh.sketchStale, 'the same action again changes nothing')
  films.editShot(p.id, 's1', 'a', { stage: { people: [{ name: 'Tess', x: 0, y: 1, facing: 0 }], camera: { x: 0, y: -3, facing: 0, move: 'arc-left' } } })
  assert.equal(films.find(films.get(p.id), 'a').sh.sketchStale, true, 'a new board does')
  films.editShot(p.id, 's1', 'b', { action: 'Heavy rain.' })
  assert.ok(!films.find(films.get(p.id), 'b').sh.sketchStale, 'a shot with no sketch has nothing to set aside')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---------- phase 4 ----------
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-p4-'))
const touch = (dir, name) => (fs.writeFileSync(path.join(dir, name), 'x'), path.join(dir, name))
ok('a made-up person gets a face of their own, kept apart from the cast who are played', () => {
  const dir = tmp()
  const tessFace = touch(dir, 'tess.png')
  const keeperFace = touch(dir, 'keeper.png')
  const films = new Productions({ dataDir: dir, studio: () => ({ characters: () => [{ id: 'tess', name: 'Tess Marlow', picture: tessFace }] }) })
  const p = films.create({ name: 'Faces' })
  const shots = [{ id: 'a', speaker: 'KEEPER', characters: ['KEEPER', 'Tess'], character: 'none' }, { id: 'b', speaker: '', characters: ['Tess'], character: 'tess' }]
  films.patch(p.id, (q) => (q.cast = [{ characterId: 'tess', as: 'Tess' }]))
  assert.deepEqual(films.madeUpRoles(films.get(p.id), shots), ['KEEPER'], 'Tess is played; the keeper is made up')
  assert.deepEqual(films.onScreen(films.get(p.id), shots[0]).map((x) => [x.ch.name, x.made]), [['Tess Marlow', false]], 'no face drawn yet: only Tess')
  films.update(p.id, { cast: [{ characterId: 'tess', as: 'Tess' }, { characterId: null, as: 'Keeper', description: 'a weathered man in his sixties', face: keeperFace, extra: 'dropped' }] })
  const q = films.get(p.id)
  assert.deepEqual(q.cast[1], { as: 'Keeper', characterId: null, description: 'a weathered man in his sixties', face: keeperFace }, 'update keeps a made-up entry and nothing else')
  assert.deepEqual(films.onScreen(q, shots[0]).map((x) => [x.ch.name, x.made, x.face]), [['Tess Marlow', false, tessFace], ['Keeper', true, keeperFace]], 'Tess first, then the keeper (matched by first name, any case)')
  assert.deepEqual(films.madeUpRoles(q, shots), ['KEEPER'], 'still made up, now with a face')
  assert.match(facePrompt({ role: 'Keeper', description: 'a weathered man in his sixties.', look: '35 mm film' }), /^Cinematic film still, head-and-shoulders portrait of Keeper: a weathered man in his sixties\. .*Look: 35 mm film\. One person only\./)
  fs.rmSync(dir, { recursive: true, force: true })
})
ok('the person\'s own picture becomes a made-up role\'s face, and their sketches are marked to redraw', () => {
  const dir = tmp()
  const art = touch(dir, 'Farmer concept.PNG')
  const films = new Productions({ dataDir: dir, studio: () => ({ characters: () => [] }) })
  const p = films.create({ name: 'Own faces' })
  films.patch(p.id, (q) => (q.scenes = [{ id: 's1', shots: [{ id: 'a', speaker: 'FARMER', characters: ['FARMER'], sketch: 'x.png' }, { id: 'b', speaker: '', characters: ['Bramble'], sketch: 'y.png' }] }]))
  const e = films.useFace(p.id, 'Farmer', art)
  assert.equal(e.as, 'Farmer')
  assert.ok(e.face.startsWith(path.join(dir, 'productions', 'faces')) && e.face.endsWith('.png') && fs.existsSync(e.face), 'copied into the film\'s faces folder')
  const q = films.get(p.id)
  assert.equal(films.madeUp(q, 'FARMER').face, e.face, 'kept on the cast entry, matched by first name')
  assert.deepEqual(q.scenes[0].shots.map((s) => !!s.sketchStale), [true, false], 'only the farmer\'s sketch is stale')
  // someone who never speaks can have one too, and a second picture replaces the first
  films.update(p.id, { cast: [...q.cast, { as: 'Bramble', characterId: null, description: '', face: null }] })
  films.useFace(p.id, 'Bramble', art)
  assert.equal(films.get(p.id).cast.length, 2)
  assert.ok(films.get(p.id).scenes[0].shots[1].sketchStale)
  assert.notEqual(films.useFace(p.id, 'Farmer', art).face, e.face)
  assert.equal(films.get(p.id).cast.length, 2, 'replaced, not added')
  assert.throws(() => films.useFace(p.id, 'Farmer', touch(dir, 'notes.txt')), /PNG, JPEG or WebP/)
  assert.throws(() => films.useFace(p.id, 'Farmer', path.join(dir, 'missing.png')), /Pick a picture/)
  assert.ok(films.list().every((f) => f.id), 'the faces folder is not read as a film')
  // a bird who speaks, the dog and the farmer all in one shot: all three keep their faces
  films.useFace(p.id, 'Bluebird', art)
  const three = films.onScreen(films.get(p.id), { speaker: 'BLUEBIRD', characters: ['BLUEBIRD', 'BRAMBLE', 'FARMER'], character: 'none' })
  assert.deepEqual(three.map((x) => x.ch.name), ['Bluebird', 'Bramble', 'Farmer'])
  fs.rmSync(dir, { recursive: true, force: true })
})
ok('a place keeps its angles, and a shot takes the view that suits its camera', () => {
  const dir = tmp()
  const photo = touch(dir, 'room.png')
  const side = touch(dir, 'side.png')
  const quarter = touch(dir, 'quarter.png')
  const wide = touch(dir, 'wide.png')
  const loc = { pictures: [photo], angles: [{ view: 'side', file: side, from: photo }, { view: 'quarter', file: quarter, from: photo }, { view: 'wide', file: wide, from: photo }] }
  assert.equal(placePicture(loc, { camera: 'Medium shot, static' }), photo)
  assert.equal(placePicture(loc, { camera: 'Wide shot, slow push in' }), wide)
  assert.equal(placePicture(loc, { camera: 'Reverse angle on Theo' }), side, 'no true reverse: the side view shows more of the room')
  assert.equal(placePicture(loc, { camera: 'Over the shoulder on Tess' }), quarter)
  assert.equal(placePicture(loc, { camera: 'Close-up', stage: { camera: { facing: 180 } } }), side, 'a board camera turned round')
  assert.equal(placePicture(loc, { camera: 'Close-up', stage: { camera: { facing: -40 } } }), quarter, 'a slight turn either way')
  assert.equal(placePicture(loc, { camera: 'Close-up', stage: { camera: { facing: -10 } } }), photo)
  assert.equal(placePicture({ ...loc, angles: [] }, { camera: 'Wide shot' }), photo, 'no angles drawn: the photo')
  assert.equal(placePicture({ ...loc, pictures: [touch(dir, 'new.png')] }, { camera: 'Wide shot' }), path.join(dir, 'new.png'), 'angles drawn from an older photo are left out')
  const films = new Productions({ dataDir: dir, studio: () => ({ characters: () => [] }) })
  const p = films.create({ name: 'Angles' })
  films.patch(p.id, (q) => (q.locations = [{ id: 'l1', name: 'Room', description: '', pictures: [photo], angles: loc.angles }]))
  films.update(p.id, { locations: [{ id: 'l1', name: 'Room', description: 'A small room', pictures: [photo] }] })
  assert.equal(films.get(p.id).locations[0].angles.length, 3, 'an update without angles keeps them')
  fs.rmSync(dir, { recursive: true, force: true })
})
ok('the animatic holds each shot for its length, longer for a long line, and only uses fresh sketches', () => {
  const plan = animaticPlan([
    { heading: 'INT. ROOM', shots: [{ id: 'a', seconds: 5, sketch: 'a.png', speaker: 'Tess', line: 'Hi.', voiceLine: { file: 'a.wav', duration: 6.2 } }, { id: 'b', seconds: 4, sketch: 'b.png', sketchStale: true, action: 'She sits.' }] },
    { heading: 'EXT. ROAD', shots: [{ id: 'c', seconds: 3, action: 'A car passes.' }] }
  ])
  assert.deepEqual(plan.map((s) => [s.shot, s.n, s.at, s.seconds, s.sketch, s.line, s.voice]), [
    ['a', 1, 0, 6.6, 'a.png', 'Tess: Hi.', 'a.wav'],
    ['b', 2, 6.6, 4, null, '', null],
    ['c', 1, 10.6, 3, null, '', null]
  ])
})
ok('a film shot is one take: a written cut is folded into it (a face picture was cut to whole)', () => {
  const p = ['detailed_description:', '[Shot 1] Wide static shot: Keeper stands at the glass. The camera holds.', '[Shot 2] At 00:03.000, the Keeper turns toward the camera.', '[Shot 3] At 00:04.500, close-up of his weathered hand on the lever.', '', 'overall_soundscape:', 'Wind.'].join('\n')
  const o = oneTake(p)
  assert.equal((o.match(/\[Shot \d+\]/g) || []).join(), '[Shot 1]')
  assert.match(o, /The camera holds\. Then, in the same unbroken take, the Keeper turns toward the camera\. Then, in the same unbroken take, the camera moves into a close-up of his weathered hand on the lever\.\n\noverall_soundscape:/)
  assert.equal(oneTake('[Shot 1] A dog runs.'), '[Shot 1] A dog runs.', 'one shot is left alone')
  const people = withRoom(p, { people: ['Keeper'], sketch: true, room: true })
  assert.match(people, /<Subject 2> \(appears in .*\): partially_preserved - Keeper's face and hair only; .* the picture itself never appears as a frame\./)
})
ok('a finished take stands for its shot only until the shot is filmed again', () => {
  const dir = tmp()
  const jobs = [
    { id: 'pv1', kind: 'previews', status: 'success', createdAt: '2026-10-30T10:00:00Z', outputs: [{ kind: 'preview', candidate: 1, path: 'old1.mp4' }] },
    { id: 'fin1', kind: 'finish', parent: 'pv1', status: 'success', createdAt: '2026-10-30T10:05:00Z', outputs: [{ kind: 'final', path: 'old-final.mp4' }], plan: { finish: { candidate: 1 } } }
  ]
  const films = new Productions({ dataDir: dir, studio: () => ({ characters: () => [], listJobs: () => jobs }) })
  const sh = { projectId: 'x', prompt: 'p' }
  assert.equal(films.shotState(sh).final.path, 'old-final.mp4')
  jobs.push({ id: 'pv2', kind: 'previews', status: 'success', createdAt: '2026-11-01T10:00:00Z', outputs: [{ kind: 'preview', candidate: 1, path: 'new1.mp4' }] })
  const st = films.shotState(sh)
  assert.equal(st.final, undefined, 'new takes: the old final no longer stands for the shot')
  assert.deepEqual([st.status, st.candidates[0].path], ['pick', 'new1.mp4'])
  fs.rmSync(dir, { recursive: true, force: true })
})
ok('a continuous shot needs a shot before it in its scene', () => {
  const dir = tmp()
  const films = new Productions({ dataDir: dir, studio: () => ({ characters: () => [] }) })
  const p = films.create({ name: 'One take' })
  films.patch(p.id, (q) => (q.scenes = [{ id: 's1', heading: 'INT. ROOM', shots: [{ id: 'a', action: 'In.', seconds: 5 }, { id: 'b', action: 'On.', seconds: 5 }] }]))
  films.editShot(p.id, 's1', 'a', { continues: true })
  films.editShot(p.id, 's1', 'b', { continues: true })
  const [a, b] = films.get(p.id).scenes[0].shots
  assert.equal(a.continues, false, 'the first shot of a scene has nothing to carry on from')
  assert.equal(b.continues, true)
  fs.rmSync(dir, { recursive: true, force: true })
})
ok('#27: a long scene is planned in parts between script elements; each answer is capped by its seconds', () => {
  const lines = []
  for (let i = 0; i < 32; i++) lines.push(`Tess picks up part ${i} and turns it under the lamp.\n\n${i % 2 ? 'THEO' : 'TESS'}\nLine number ${i} of the long night.`)
  const sc = parseScript(`INT. WORKSHOP - NIGHT\n\n${lines.join('\n\n')}`).scenes[0]
  assert.equal(sceneParts(sc, 50).length, 1, 'a short scene stays whole')
  assert.equal(sceneParts(sc, 75).length, 1)
  const parts = sceneParts(sc, 300)
  assert.equal(parts.length, 5)
  // every line is in exactly one part, in order, and the seconds add up to about the scene's
  const all = parts.map((x) => x.text).join('\n')
  for (let i = 0; i < 32; i++) assert.equal(all.split(`Line number ${i} of`).length - 1, 1, `line ${i}`)
  assert.ok(all.indexOf('Line number 31') > all.indexOf('Line number 0'))
  assert.ok(Math.abs(parts.reduce((t, x) => t + x.seconds, 0) - 300) <= 5)
  assert.match(parts[1].text, /^INT\. WORKSHOP - NIGHT \(continued\)/)
  assert.equal(shotSchemaFor(60).properties.shots.maxItems, 22)
  assert.equal(shotSchemaFor(5).properties.shots.maxItems, 4)
  // each part carries its own script elements, and together they are the scene's, once each, in order
  assert.deepEqual(parts.flatMap((x) => x.elements), sc.elements)
  assert.deepEqual(sceneParts(sc, 50)[0].elements, sc.elements)
})
ok('#27: every line of the script ends up in a shot; a line the writer left out gets its own shot in place', () => {
  const d = (who, text) => ({ type: 'dialogue', who, text })
  const a = (text) => ({ type: 'action', text })
  const shot = (line, extra = {}) => ({ action: `about: ${line}`, staging: 'Tess left', camera: 'Wide', characters: ['Tess'], speaker: line ? 'Tess' : '', line, seconds: 5, ends: `after ${line}`, ...extra })
  const script = [a('Tess opens the box.'), d('Tess', 'It still plays.'), a('Theo leans in.'), d('Theo', "Then don't stop now."), a('She winds the key.'), d('Tess', 'One more turn.')]
  // all there (curly apostrophe, a stray word of punctuation): nothing added
  let r = keepLines([shot('It still plays!'), shot('Then don’t stop now.'), shot('One more turn.')], script)
  assert.equal(r.added, 0)
  assert.equal(r.shots.length, 3)
  // the middle line dropped: it comes back after the shot of the line before, with the action written before it
  r = keepLines([shot('It still plays.'), shot(''), shot('One more turn.')], script)
  assert.equal(r.added, 1)
  assert.deepEqual(r.shots.map((s) => s.line), ['It still plays.', "Then don't stop now.", '', 'One more turn.'])
  assert.equal(r.shots[1].speaker, 'Theo')
  assert.equal(r.shots[1].action, 'Theo leans in.')
  assert.equal(r.shots[1].staging, 'after It still plays.')
  assert.ok(r.shots[1].seconds >= 3 && r.shots[1].seconds <= 10)
  // a speech split over two shots counts; two lines in one shot count
  const long = [d('Tess', 'She used to wind it every night before bed, and hum along until she fell asleep.')]
  assert.equal(keepLines([shot('She used to wind it every night before bed,'), shot('and hum along until she fell asleep.')], long).added, 0)
  assert.equal(keepLines([shot('It still plays. Then don’t stop now. One more turn.')], script).added, 0)
  // a line said twice needs two shots, next to each other or not
  const twice = [d('Tess', 'Again.'), d('Tess', 'Again.')]
  assert.equal(keepLines([shot('Again.')], twice).added, 1)
  const aba = [d('Tess', 'Hold the light closer.'), d('Theo', 'Slow hands.'), d('Tess', 'Hold the light closer.')]
  r = keepLines([shot('Hold the light closer.'), shot('Slow hands.')], aba)
  assert.equal(r.added, 1)
  assert.deepEqual(r.shots.map((s) => s.line), ['Hold the light closer.', 'Slow hands.', 'Hold the light closer.'])
  // the writer moved a line earlier: it's there, nothing added
  assert.equal(keepLines([shot('One more turn.'), shot('It still plays.'), shot('Then don’t stop now.')], script).added, 0)
  // one word changed in a longer line still counts; a different line doesn't
  const para = [d('Theo', 'Then we fix it together before the sun comes up.')]
  assert.equal(keepLines([shot('Then we fix it together before the sun is up.')], para).added, 0)
  assert.equal(keepLines([shot('Nothing like it.')], para).added, 1)
  // a plan with no shots at all gets one shot per line
  assert.equal(keepLines([], script).shots.length, 3)
})
console.log(`${n} checks passed`)
