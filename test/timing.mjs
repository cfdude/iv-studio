// Time estimates come from this machine's own finished renders, and say so; with none there is no estimate.
import { estimate, estimateLine, roughly, samples, shapeOf, shapeOfPlan } from '../src/service/timing.js'

let failed = 0
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

let clock = 0
const hunt = (seconds, { mp = 0.4, secs = 5, previews = 3, steps = 8, where, status = 'success', w = 864, h = 480 } = {}) => ({
  kind: 'previews',
  status,
  seconds,
  where,
  finishedAt: new Date(Date.UTC(2026, 10, 1, 0, clock++)).toISOString(),
  plan: { resolved: mp === 0.4 ? { width: w, height: h, frames: Math.round(secs * 24) + 4, fps: 24, previews } : { frames: Math.round(secs * 24) + 4, fps: 24, previews, width: Math.round(Math.sqrt((mp * 1e6 * 16) / 9)), height: Math.round(Math.sqrt((mp * 1e6 * 9) / 16)) }, request: { megapixels: mp, seconds: secs, previews, steps } }
})
const finish = (seconds, { megapixels = 1, upscale2x = false, enhancer = 'dlss', w = 768, h = 1376, frames = 124, where } = {}) => ({
  kind: 'finish',
  status: 'success',
  seconds,
  where,
  finishedAt: new Date(Date.UTC(2026, 10, 1, 0, clock++)).toISOString(),
  plan: { finish: { megapixels, upscale2x, enhancer }, resolved: { width: w, height: h, frames } }
})

// shapes
check('a hunt’s shape counts size, length, takes and steps', shapeOf(hunt(100)).kind === 'previews' && shapeOf(hunt(100)).work > 0 && shapeOf(hunt(100, { previews: 1 })).work < shapeOf(hunt(100)).work)
check('a Seedance job is not estimated (it has a price, not a time on this PC)', shapeOf({ ...hunt(50), plan: { ...hunt(50).plan, engine: 'seedance' } }) === null)
check('a job with no where counts as this PC', shapeOf(hunt(100)).where === 'local' && shapeOf(hunt(100, { where: 'cloud' })).where === 'cloud')
check('music, pictures and failed jobs are left out', samples([{ kind: 'music', status: 'success', seconds: 30 }, hunt(100, { status: 'error' }), { ...hunt(100), seconds: 0 }]).length === 0)

const plan = (o = {}) => shapeOfPlan({ kind: 'previews', megapixels: 0.4, seconds: 5, previews: 3, steps: 8, ...o })

// nothing yet
check('with no renders yet there is no estimate', estimate(plan(), []) === null && estimateLine(null) === null)
check('a plan with no size or length has no shape', shapeOfPlan({ kind: 'previews', megapixels: 0, seconds: 5 }) === null && estimate(null, samples([hunt(100)])) === null)

// same settings: the middle of those times
{
  const h = samples([hunt(370), hunt(380), hunt(900), hunt(375), hunt(378)])
  const e = estimate(plan(), h)
  check('same settings as before: the middle of those times', e.basis === 'same' && e.runs === 5 && e.seconds === 378)
  check('…and one odd slow run doesn’t drag it', e.seconds < 400)
  check('…free on this PC', e.cost === null && /on this PC, free/.test(estimateLine(e)) && /from your last 5 renders like this/.test(estimateLine(e)))
}
{
  const many = samples(Array.from({ length: 20 }, (_, i) => hunt(100 + i)))
  check('only the newest 8 are used', estimate(plan(), many).runs === 8 && estimate(plan(), many).seconds > 111)
}

// different settings: worked out, and says so
{
  // start-up 48 s, then time grows with the work
  const t = (o) => 48 + 0.0036 * shapeOfPlan({ kind: 'previews', megapixels: 0.4, seconds: 5, previews: 3, steps: 8, ...o }).work * (124 / 120)
  const h = samples([hunt(t({}), {}), hunt(t({ previews: 1 }), { previews: 1 }), hunt(t({ steps: 4 }), { steps: 4 }), hunt(t({ previews: 2 }), { previews: 2 })])
  const e = estimate(plan({ seconds: 10, previews: 2 }), h)
  const truth = t({ seconds: 10, previews: 2 })
  check('different settings: worked out from the others, and labelled that way', e.basis === 'similar' && /worked out from your other renders/.test(estimateLine(e)))
  check('…and close to what it would really take (within 15%)', Math.abs(e.seconds - truth) / truth < 0.15)
  const one = estimate(plan({ previews: 1 }), samples([hunt(300)]))
  check('one earlier render still gives a scaled answer', one.basis === 'similar' && one.runs === 1 && one.seconds > 60 && one.seconds < 300)
}

// this PC and the cloud never mix
{
  const h = samples([hunt(400), hunt(410), hunt(90, { where: 'cloud' }), hunt(95, { where: 'cloud' })])
  check('cloud times don’t change this PC’s estimate', estimate(plan(), h).seconds === 405)
  const c = estimate(plan({ where: 'cloud' }), h, { perHour: 1.8 })
  check('a cloud estimate uses cloud times and has a cost', c.seconds === 93 && c.cost === 0.05 && /in your cloud, about \$0\.05/.test(estimateLine(c, { where: 'cloud' })))
  check('a cloud estimate with no price shows no cost', estimate(plan({ where: 'cloud' }), h).cost === null && !/\$/.test(estimateLine(estimate(plan({ where: 'cloud' }), h), { where: 'cloud' })))
  check('with only cloud renders, this PC has no estimate', estimate(plan(), samples([hunt(90, { where: 'cloud' })])) === null)
}

// finishes are matched by how they finish
{
  const h = samples([finish(157), finish(125), finish(204, { megapixels: 2, enhancer: 'seedvr2', w: 1938, h: 1080 }), finish(200, { megapixels: 2, enhancer: 'seedvr2', w: 1938, h: 1080 }), finish(217, { megapixels: 2, upscale2x: true, w: 3904, h: 2176 })])
  const a = estimate(shapeOfPlan({ kind: 'finish', megapixels: 1, seconds: 5.167, enhancer: 'dlss' }), h)
  const b = estimate(shapeOfPlan({ kind: 'finish', megapixels: 2, seconds: 5.167, enhancer: 'seedvr2' }), h)
  const c = estimate(shapeOfPlan({ kind: 'finish', megapixels: 2, seconds: 5.167, upscale2x: true, enhancer: 'dlss' }), h)
  check('a 1 MP DLSS finish uses the 1 MP DLSS finishes', a.basis === 'same' && a.runs === 2 && a.seconds === 141)
  check('a 2 MP SeedVR2 finish uses its own', b.basis === 'same' && b.seconds === 202)
  check('a 2 MP + 2x finish uses its own', c.basis === 'same' && c.seconds === 217)
  check('a way of finishing never done before has no estimate', estimate(shapeOfPlan({ kind: 'finish', megapixels: 1, seconds: 5, enhancer: 'h3' }), h) === null)
}

check('times read naturally', roughly(24) === 'about 20 seconds' && roughly(75) === 'about 1 minute' && roughly(378) === 'about 6 minutes' && roughly(4200) === 'about 1 hour 10 minutes' && roughly(3) === 'about 10 seconds')
check('no line uses an em dash', !/—/.test(estimateLine({ seconds: 100, basis: 'same', runs: 1, cost: null })) && /from your last render like this/.test(estimateLine({ seconds: 100, basis: 'same', runs: 1, cost: null })))
check('a tiny cloud cost reads as under a cent', /under \$0\.01/.test(estimateLine({ seconds: 5, basis: 'same', runs: 2, cost: 0 }, { where: 'cloud' })))

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
