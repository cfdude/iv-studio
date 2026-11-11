// The mocked twin of every page and journey (task 7.6, design D10). Each test below carries the same row id as the page or
// journey test in test/ui, reads that row's recorded trace from test/unit/ui-traces.json, and without opening a window
// checks, in trace order, that every channel the window called is exposed by preload, handled by main, mapped to a service
// method, and that method is covered by a default-suite test (test/unit/ui-twin.mjs). A channel in page-only-channels.json
// is checked as exposed and handled only. A render-free channel with an entry in ui-channel-fixtures.json is also called
// on the fake ComfyUI with those arguments, in trace order. Regenerate a trace with `npm run test:ui -- --update-traces`.
//   node --test test/unit/ui-twins.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Edits } from '../../src/service/edits.js'
import { Images } from '../../src/service/images.js'
import { Productions } from '../../src/service/productions.js'
import { Studio } from '../../src/service/studio.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { rowIdsIn, scanTestNames } from './test-names.mjs'
import { twinContext, twinRow } from './ui-twin.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
const traces = readJson('test/unit/ui-traces.json')
const fixtures = readJson('test/unit/ui-channel-fixtures.json')
const ctx = twinContext(root)

describe('mocked twins: every page and journey, in trace order', () => {
  let fake
  let services
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps' })
    const dir = tempDirReal('iv-twin-')
    const studio = new Studio({ dataDir: dir, resourcesDir: path.join(root, 'resources'), comfyUrl: fake.url })
    services = {
      Studio: studio,
      Images: new Images({ studio, dataDir: dir }),
      Productions: new Productions({ dataDir: dir, studio: () => studio }),
      Edits: new Edits({ dataDir: dir, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
    }
  })
  after(() => fake.close())

  // reads the row's trace (a row with none fails), checks each channel, then calls the fixtures on the fake
  const twin = (id) => twinRow(id, { traces, ctx, fixtures, services })

  test('[journey:edit_video] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:edit_video'))
  test('[journey:make_a_film] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:make_a_film'))
  test('[journey:make_a_picture] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:make_a_picture'))
  test('[journey:make_a_sequence] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:make_a_sequence'))
  test('[journey:make_a_shot] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:make_a_shot'))
  test('[journey:make_music] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:make_music'))
  test('[journey:new_character] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:new_character'))
  test('[journey:replace_someone] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:replace_someone'))
  test('[journey:show_me_around] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:show_me_around'))
  test('[journey:voice_line] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:voice_line'))
  test('[journey:website_sizzle] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('journey:website_sizzle'))
  test('[page:character] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:character'))
  test('[page:characters] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:characters'))
  test('[page:cloud] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:cloud'))
  test('[page:create] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:create'))
  test('[page:edits] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:edits'))
  test('[page:edit] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:edit'))
  test('[page:home] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:home'))
  test('[page:library] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:library'))
  test('[page:lines] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:lines'))
  test('[page:loras] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:loras'))
  test('[page:media] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:media'))
  test('[page:music] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:music'))
  test('[page:project] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:project'))
  test('[page:projects] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:projects'))
  test('[page:rebuild] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:rebuild'))
  test('[page:rebuild-project] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:rebuild-project'))
  test('[page:reel] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:reel'))
  test('[page:replace] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:replace'))
  test('[page:sequence] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:sequence'))
  test('[page:sequences] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:sequences'))
  test('[page:settings] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:settings'))
  test('[page:setup] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:setup'))
  test('[page:shinobi] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:shinobi'))
  test('[page:shinobi-film] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:shinobi-film'))
  test('[page:shot] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:shot'))
  test('[page:sizzle] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:sizzle'))
  test('[page:sizzle-project] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:sizzle-project'))
  test('[page:voices] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:voices'))
  test('[page:workflows] twin: every channel it called is exposed, handled and covered, in trace order', () => twin('page:workflows'))
})

describe('mocked twins: the set of twins is the set of page and journey tests', () => {
  const idsIn = (dir) => {
    const ids = new Set()
    for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => /\.test\.mjs$/.test(n))) {
      for (const t of scanTestNames(fs.readFileSync(path.join(root, dir, f), 'utf8'), f).tests) {
        if (t.kind === 'test' && !t.skipped) for (const id of rowIdsIn(t.name).filter((i) => /^(page|journey):/.test(i))) ids.add(id)
      }
    }
    return ids
  }
  const twinTests = () => scanTestNames(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8'), 'ui-twins.test.mjs').tests.filter((t) => t.kind === 'test' && /\] twin: /.test(t.name))

  test('every [page:...] and [journey:...] id a page-tier test names has a twin here, and every twin names one', () => {
    const ui = idsIn('test/ui')
    const here = new Set(twinTests().flatMap((t) => rowIdsIn(t.name)))
    assert.deepEqual([...ui].filter((id) => !here.has(id)).sort(), [], 'a page or journey test has no twin')
    assert.deepEqual([...here].filter((id) => !ui.has(id)).sort(), [], 'a twin names a row no page-tier test has')
    assert.ok(ui.size >= 39)
  })

  test('every twin reads its own row\'s trace, and every row in ui-traces.json has a twin', () => {
    const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const ids = twinTests().map((t) => rowIdsIn(t.name)[0])
    for (const id of ids) assert.ok(text.includes(`() => twin('${id}'))`), `the twin of ${id} does not call twin('${id}')`)
    assert.equal(new Set(ids).size, ids.length, 'a twin is named twice')
    assert.deepEqual(Object.keys(traces).sort(), [...ids].sort())
  })

  test('the fixtures name render-free channels that main maps to a service method, that some row traces, and that are not page-only', () => {
    const traced = new Set(Object.values(traces).flatMap((rows) => rows.map((c) => c.channel)))
    for (const [channel, f] of Object.entries(fixtures)) {
      assert.ok(Array.isArray(f.args), `${channel}: args is a list`)
      assert.equal(ctx.handled.get(channel)?.kind, 'mapped', `${channel} is not mapped to a service method`)
      assert.ok(traced.has(channel), `${channel} is in no trace`)
      assert.ok(!ctx.pageOnly.has(channel), `${channel} is page-only`)
      assert.ok(['Studio', 'Images', 'Productions', 'Edits'].includes(ctx.handled.get(channel).className), `${channel}: no ${ctx.handled.get(channel).className} is built on the fake`)
    }
  })
})
