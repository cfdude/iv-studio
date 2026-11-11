// The prompt checker (src/service/lint.js): each rule on a prompt that breaks it, and a clean prompt that passes.
//   node test/lint.mjs
import assert from 'node:assert/strict'
import { blocking, firstLastLine, FIRST_FRAME_LINE, lintPrompt, negativePhrases, sections } from '../src/service/lint.js'
import { backdropInShots, keepIdeaLine, keepIdeaMedium } from '../src/service/prompter.js'

let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log(`ok  ${name}`)
}
const codes = (p, ctx) => lintPrompt(p, ctx).map((f) => f.code)
const CLEAN = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium shot of {char} in a green raincoat at a bus stop at night. The camera pushes in with small amplitude at slow speed. {char} (S1) looks up and says: <d>[English] Bus is late again.</d> [Shot 2] At 00:04.000, the camera cuts to a wide shot as the bus arrives.

overall_soundscape: Rain on the shelter roof and distant traffic.

non_diegetic_music: N/A`
const tess = { name: 'Tess Marlow', trigger: 't3ss4' }

ok('a clean prompt has no warnings or errors', () => {
  const f = lintPrompt(CLEAN, { mode: 'text', seconds: 8, character: tess })
  assert.deepEqual(f.filter((x) => x.level !== 'info'), [], JSON.stringify(f))
})
ok('sections are read whether they sit on one line or the next', () => {
  const s = sections('subject_definitions:\n<Subject 1> is a cat.\n\ndetailed_description: [Shot 1] A cat.')
  assert.equal(s.subject_definitions, '<Subject 1> is a cat.')
  assert.equal(s.detailed_description, '[Shot 1] A cat.')
})
ok('length: the real length on the frame grid, and under the trained floor', () => {
  assert.match(lintPrompt(CLEAN, { seconds: 10 }).find((f) => f.code === 'real-length').message, /10\.13 s \(243 frames/)
  assert.ok(codes(CLEAN, { seconds: 4 }).includes('too-short'))
})
ok('fields: missing description, missing soundscape, template blanks', () => {
  assert.ok(codes('[Shot 1] A cat.', { mode: 'text' }).includes('missing-field'))
  assert.ok(codes(CLEAN.replace(/overall_soundscape:[^\n]*\n\n/, ''), {}).includes('no-soundscape'))
  assert.ok(blocking(lintPrompt(CLEAN.replace('green raincoat', '___'), {})).some((f) => f.code === 'placeholder'))
})
ok('frames: a last frame needs the first-and-last line, and the fix adds it', () => {
  const pics = [{ kind: 'picture' }, { kind: 'picture' }]
  const f = lintPrompt(`${FIRST_FRAME_LINE}\n\n${CLEAN}`, { mode: 'frames', seconds: 5, media: pics }).find((x) => x.code === 'frames-line')
  assert.equal(f.level, 'error')
  assert.ok(f.fix.startsWith(firstLastLine(5, 2)) && !f.fix.includes(FIRST_FRAME_LINE))
  assert.ok(!codes(`${FIRST_FRAME_LINE}\n\n${CLEAN}`, { mode: 'frames', seconds: 8, media: pics.slice(0, 1) }).includes('frames-line'))
  assert.ok(codes(`${firstLastLine(8, 2)}\n\n${CLEAN}`, { mode: 'frames', seconds: 8, media: pics }).includes('frames-cut'))
})
ok('cuts: out of order, past the end, too short', () => {
  assert.ok(codes(CLEAN.replace('00:04.000', '00:09.800'), { seconds: 8 }).includes('cut-late'))
  const two = CLEAN.replace('as the bus arrives.', 'as the bus arrives. [Shot 3] At 00:03.000, the doors open.')
  assert.ok(codes(two, { seconds: 8 }).includes('cut-order'))
  assert.ok(codes(CLEAN.replace('00:04.000', '00:00.800'), { seconds: 8 }).includes('cut-short'))
})
ok('speech: too many words for the time, quotes and names inside <d>, a missing speaker ID', () => {
  const long = CLEAN.replace('Bus is late again.', 'Bus is late again and I have been standing here in the rain for twenty minutes waiting for it to come round the corner.')
  assert.ok(codes(long, { seconds: 5 }).includes('speech-too-long'))
  const quoted = CLEAN.replace('<d>[English] Bus is late again.</d>', '<d>[English] "Bus is late again."</d>')
  const q = lintPrompt(quoted, { seconds: 8 }).find((f) => f.code === 'quoted-line')
  assert.ok(q && q.fix.includes('<d>[English] Bus is late again.</d>'))
  assert.ok(codes(CLEAN.replace('<d>[English] Bus', '<d>[English] Tess: Bus'), { seconds: 8 }).includes('name-in-line'))
  assert.ok(codes(CLEAN.replace(' (S1)', ''), { seconds: 8 }).includes('no-speaker'))
  // with a character picked and nobody else speaking, Fix names the picked character (the local writer left it out)
  const unnamed = CLEAN.replace('{char} (S1) looks up and says:', 'She sighs softly, then says:')
  const s = lintPrompt(unnamed, { seconds: 8, character: tess }).find((f) => f.code === 'no-speaker')
  assert.ok(s?.fix?.includes('She sighs softly, then {char} (S1) says: <d>'), s?.fix)
  assert.ok(!codes(s.fix, { seconds: 8, character: tess }).includes('no-speaker'))
  assert.equal(lintPrompt(CLEAN.replace('{char} (S1) looks up and says:', 'She says:'), { seconds: 8, character: tess }).find((f) => f.code === 'no-speaker').fix.includes('{char} (S1) says: <d>'), true)
  assert.equal(lintPrompt(CLEAN.replace(' (S1) looks up and says:', ' looks up. <Subject 2> (S2) nods.'), { seconds: 8, character: tess }).find((f) => f.code === 'no-speaker')?.fix, undefined)
  assert.equal(lintPrompt(CLEAN.replace(' (S1)', ''), { seconds: 8 }).find((f) => f.code === 'no-speaker').fix, undefined)
  assert.ok(codes(CLEAN.replace('<d>[English] Bus is late again.</d>', '"Bus is late again."'), { seconds: 8 }).includes('untagged-speech'))
  assert.ok(codes(CLEAN.replace(/<d>[\s\S]*?<\/d>/, 'nothing.'), { seconds: 8, voiceLine: 'x.wav' }).includes('voice-no-words'))
})
ok('references: named but not attached, attached but not named, subjects', () => {
  const ref = `subject_definitions:\n<Subject 1> is the woman in <Picture 1>.\n<Subject 2> is the kitchen in <Picture 3>.\n\ndetailed_description:\n[Shot 1] <Subject 1> (S1) bakes and says: <d>[English] Salt.</d>\n\noverall_soundscape:\nKitchen hum.\n\nnon_diegetic_music:\nN/A`
  const c = codes(ref, { mode: 'reference', seconds: 8, media: [{ kind: 'picture' }, { kind: 'picture' }] })
  assert.ok(c.includes('reference-missing') && c.includes('reference-unused') && c.includes('subject-unused'))
  assert.ok(codes(ref.replace('<Subject 1> (S1)', '<Subject 4> (S1)'), { mode: 'reference', seconds: 8 }).includes('subject-undefined'))
})
ok('the character: missing {char}, and describing the face the LoRA carries', () => {
  assert.ok(codes(CLEAN.replaceAll('{char}', 'a woman'), { seconds: 8, character: tess }).includes('char-missing'))
  assert.ok(codes(CLEAN.replace('{char} in a green raincoat', '{char} with long red hair in a green raincoat'), { seconds: 8, character: tess }).includes('char-face'))
  assert.ok(!codes(CLEAN, { seconds: 8 }).includes('char-missing'), 'no character, no check')
  assert.ok(!codes(CLEAN.replace('{char} in a green raincoat', 'A close-up of {char}\'s face as her eyes widen, {char} in a green raincoat'), { seconds: 8, character: tess }).includes('char-face'), 'framing and actions are not descriptions')
})
ok('wording: filler words (with a fix), too many camera moves', () => {
  const f = lintPrompt(CLEAN.replace('Live-action, cinematic,', 'Live-action, masterpiece, 8k, cinematic,'), { seconds: 8 }).find((x) => x.code === 'filler')
  assert.ok(f && !/masterpiece|8k/.test(f.fix))
  // three in a row leave no doubled commas behind
  const g = lintPrompt(CLEAN.replace('Live-action, cinematic,', 'Live-action, cinematic, masterpiece, 8k, highly detailed,'), { seconds: 8 }).find((x) => x.code === 'filler')
  assert.ok(g && g.fix.includes('Live-action, cinematic, ') && !/,\s*,/.test(g.fix))
  assert.ok(codes(CLEAN.replace('The camera pushes in', 'The camera pans left, tilts up, zooms in and pushes in'), { seconds: 8 }).includes('camera-load'))
})
ok('mentions: an unknown @name is an error', () => {
  assert.ok(codes(CLEAN.replace('{char} in a green', '@Mara in a green'), { seconds: 8, mentions: ['Tess', 'BusStop'] }).includes('mention-unknown'))
  assert.ok(!codes(CLEAN.replace('{char} in a green', '@tess in a green'), { seconds: 8, mentions: ['Tess'] }).includes('mention-unknown'))
})
ok('a line quoted in the idea is kept when the writer drops it', () => {
  const dropped = CLEAN.replace(/ \{char\} \(S1\) looks up and says: <d>[^<]*<\/d>/, '')
  assert.ok(!dropped.includes('<d>'))
  const kept = keepIdeaLine(dropped, 'Tess waits at a bus stop. She sighs, "Of course it\'s late."', tess)
  assert.match(kept, /\{char\} \(S1\) says: <d>\[English\] Of course it's late\.<\/d>\n\noverall_soundscape/)
  assert.ok(!codes(kept, { seconds: 8, character: tess }).includes('no-speaker'))
  assert.equal(keepIdeaLine(CLEAN, 'Tess says "Bus is late again."', tess), CLEAN)
  assert.equal(keepIdeaLine(dropped, 'Tess says "Hi." and Theo says "Bye."', tess), dropped)
})
ok('the medium the idea asks for replaces a written Live-action', () => {
  assert.match(keepIdeaMedium(CLEAN, 'An animated short: the old farmer from <Picture 1> and his dog'), /\[Shot 1\] Animated film, cinematic,/)
  assert.match(keepIdeaMedium(CLEAN, 'a 3D animated scene in a kitchen'), /3D animated film, cinematic/)
  assert.match(keepIdeaMedium(CLEAN, 'claymation: a fox steals a pie'), /Stop-motion clay animation/)
  assert.equal(keepIdeaMedium(CLEAN, 'Tess waits at a bus stop in the rain'), CLEAN)
})
ok('references: keeping a person-picture’s setting is caught; a new scene is not', () => {
  // the prompt behind Matt's 2026-11-03 "it's just doing first frame": the queen photographed at Giza
  const ref = (summary, kept) => `subject_definitions:\n<Subject 1> is the young woman in <Picture 1>, with dark bobbed hair and a tan dress with a turquoise collar.\n\nsummary:\n[reference generation] ${summary}\n\nretention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - ${kept}\n\ndetailed_description:\nLive-action, cinematic.\n[Shot 1] <Subject 1> dances.\n\noverall_soundscape:\nWind.`
  const opts = { mode: 'reference', seconds: 5, media: [{ kind: 'picture', file: 'queen.png' }] }
  const kept = lintPrompt(ref('The queen from <Picture 1> dances. Her appearance, costume, and setting are fully preserved as she spins.', 'dark bobbed hair, tan dress, turquoise collar'), opts).find((x) => x.code === 'reference-keeps-place')
  assert.ok(kept && /appearance and costume are fully preserved/.test(kept.fix))
  const inRetention = lintPrompt(ref('The queen from <Picture 1> walks at night.', 'dark bobbed hair, tan dress, desert setting, golden sunlight'), opts).find((x) => x.code === 'reference-keeps-place')
  assert.ok(inRetention && /fully_preserved - dark bobbed hair, tan dress\n/.test(inRetention.fix))
  assert.ok(!codes(ref('The queen walks through a neon street at night. The setting is new.', 'face, hair, wardrobe; she moves through the new scene'), opts).includes('reference-keeps-place'))
  // the 0.2.7 writer's own summary: kept and new in one sentence, split by a semicolon
  assert.ok(!codes(ref('The queen walks through a neon street. Her identity, wardrobe, and accessories are fully preserved as defined by the picture; the scene’s setting, lighting, and camera motion are new per idea.', 'identity, dark hair, linen dress'), opts).includes('reference-keeps-place'))
})
ok('references: shots set in the picture’s own backdrop are sent back, unless the idea asks for it', () => {
  // the 8B writer's draft on Matt's queen picture: "No place is preserved", then [Shot 1] between two pyramids
  const draft = (shot1) => ({ subjects: [{ definition: 'the queen in <Picture 1>', backdrop: 'Pyramids, the Sphinx, desert sand, tourists, clear blue sky' }], style: 'Live-action, cinematic.', shots: [{ start_seconds: 0, description: shot1 }, { start_seconds: 3, description: 'She walks under neon signs in the rain.' }] })
  assert.deepEqual(backdropInShots(draft('The queen stands between two pyramids under a clear sky.'), 'The queen walks through a rainy neon-lit city street at night.'), ['pyramid'])
  assert.deepEqual(backdropInShots(draft('The queen steps out of a taxi into the rain.'), 'The queen walks through a rainy neon-lit city street at night.'), [])
  assert.deepEqual(backdropInShots(draft('The queen dances on the top of a pyramid above the desert.'), 'The queen dances on top of a pyramid.'), [])
  assert.deepEqual(backdropInShots({ subjects: [{ definition: 'the throne room in <Picture 2>', backdrop: '' }], shots: [{ description: 'A throne room.' }] }, 'She sits on the throne.'), [])
})
ok('"no X": negatives are listed with positive wording; house sentences and spoken lines are left alone', () => {
  const p = CLEAN.replace('at a bus stop at night.', 'at a bus stop at night. No photographs appear anywhere, and {char} never looks at the camera. A street without people.')
  const f = lintPrompt(p, { mode: 'text', seconds: 8, character: tess }).find((x) => x.code === 'negative-wording')
  assert.ok(f, 'found')
  assert.equal(f.level, 'warning')
  assert.match(f.message, /"No photographs appear anywhere" \(try: bare, plain walls\)/)
  assert.match(f.message, /"never looks at the camera" \(try: eyes on something/)
  assert.match(f.message, /"without people" \(try: an empty street/)
  assert.equal(f.fix, undefined, 'no automatic rewrite')
  const house = CLEAN.replace('at a bus stop at night.', 'at a bus stop at night. There is no writing anywhere in the picture. One continuous shot, no cuts. No one speaks. Nobody speaks in this shot: no dialogue, only the sounds of the place. This carries straight on from the previous shot as one unbroken take: no cut, the same camera.')
  assert.deepEqual(negativePhrases(house), [], JSON.stringify(negativePhrases(house)))
  assert.deepEqual(negativePhrases('[Shot 1] She says: <d>[English] No, I never said that.</d> She no longer waits.'), [], 'spoken words and grammar are not things to show')
  assert.deepEqual(negativePhrases('retention_analysis: identity - not changed\n\nnon_diegetic_music: No music'), [], 'meta sections are skipped')
  assert.deepEqual(negativePhrases("[Shot 1] She doesn't smile.").map((x) => x.instead), ['a calm, neutral expression'])
})
console.log(`${n} checks passed`)
