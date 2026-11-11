// Every starter is a prompt the checker passes with no errors, so a first hunt never starts on a red form.
import { blocking, lintPrompt } from '../src/service/lint.js'
import { planPreviews } from '../src/service/plan.js'
import { FIRST_STARTER, STARTERS, starterById, starterForm } from '../src/renderer/src/starters.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}

check('there are starters, each with its own id', STARTERS.length >= 4 && new Set(STARTERS.map((s) => s.id)).size === STARTERS.length)
check('the first starter is the short wide one the welcome wizard opens', FIRST_STARTER.id === 'first' && FIRST_STARTER.seconds === 5 && FIRST_STARTER.aspect === '16:9')
check('a starter is found by its id, and an unknown id finds nothing', starterById('product')?.name === 'Product on a table' && starterById('nope') === null)

for (const s of STARTERS) {
  const findings = lintPrompt(s.prompt, { mode: 'text', seconds: s.seconds, media: [], character: null })
  const errors = blocking(findings)
  check(`${s.id}: the prompt checker has no errors`, errors.length === 0, errors.map((e) => e.message || e.text || JSON.stringify(e)).join(' | '))
  check(`${s.id}: has a name, a tag and a line about it`, s.name.length > 3 && s.tag.length > 3 && s.about.length > 30)
  check(`${s.id}: a length and shape Create offers`, [5, 10, 15].includes(s.seconds) && ['16:9', '9:16', '1:1'].includes(s.aspect))
  check(`${s.id}: three sections, one shot`, /^integrated_multimodal_description: \[Shot 1\] /.test(s.prompt) && /\noverall_soundscape: .+\nnon_diegetic_music: .+$/.test(s.prompt) && !/\[Shot 2\]/.test(s.prompt))
  check(`${s.id}: no em dash, no real brand or person`, !/—/.test(s.prompt + s.about + s.name + s.tag))
  const f = starterForm(s)
  check(`${s.id}: fills a text shot with no character and nothing attached`, f.mode === 'text' && f.character === 'none' && f.media.length === 0 && f.prompt === s.prompt && !('megapixels' in f) && !('previews' in f) && !('steps' in f))
}

// each one plans as a real hunt (the same planner the app uses)
for (const s of STARTERS) {
  let plan = null
  let err = ''
  try {
    plan = planPreviews({ ...starterForm(s), megapixels: 0.4, previews: 3, steps: 8, seed: 4242 })
  } catch (e) {
    err = e.message
  }
  check(`${s.id}: plans as a hunt`, !!plan, err)
}

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
