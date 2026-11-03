// Parity test: the JS graph builder must produce exactly what the Python test builder made for all 32
// switch states that were checked against the IV Studio GUI's own export.
//   node test/graph-parity.mjs   (IV_STUDIO_WORKFLOWS = the folder holding struct_states.json and test_v3_struct_*.json)
import fs from 'node:fs'
import { buildPrompt, checkPrompt } from '../src/service/graph.js'

const W = (process.env.IV_STUDIO_WORKFLOWS || 'D:/H3Characters/_workflows').replace(/[\/]?$/, '/')
// The fixtures live outside the repo. If the variable is unset and the default folder is not there, there is
// nothing to compare: say so and pass. If it is set to a folder without them, that is a typo: fail.
if (!fs.existsSync(W + 'struct_states.json')) {
  if (process.env.IV_STUDIO_WORKFLOWS) {
    console.error(`graph-parity: IV_STUDIO_WORKFLOWS is ${W} but struct_states.json is not there.`)
    process.exit(1)
  }
  console.log(`graph-parity skipped: no fixtures in ${W} (set IV_STUDIO_WORKFLOWS to the folder holding struct_states.json). npm run test:unit covers the graph builder without them.`)
  process.exit(0)
}
const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const meta = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.groups.json', 'utf8'))
const states = JSON.parse(fs.readFileSync(W + 'struct_states.json', 'utf8'))

let ok = 0
const bad = []
for (const [name, on] of Object.entries(states)) {
  const mine = buildPrompt(template, meta, on)
  const theirs = JSON.parse(fs.readFileSync(W + `test_v3_struct_${name}.json`, 'utf8'))
  const problems = checkPrompt(mine)
  if (problems.length) bad.push([name, problems.slice(0, 3)])
  else if (JSON.stringify(mine, Object.keys(mine).sort()) === JSON.stringify(theirs, Object.keys(theirs).sort()) && sameDeep(mine, theirs)) ok++
  else bad.push([name, 'differs'])
}
function sameDeep(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
  if (ka.join() !== kb.join()) return false
  return ka.every((k) => JSON.stringify(sortObj(a[k])) === JSON.stringify(sortObj(b[k])))
}
function sortObj(v) {
  if (Array.isArray(v)) return v.map(sortObj)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortObj(v[k])]))
  return v
}
console.log(`${ok}/${Object.keys(states).length} states identical`, bad.length ? bad : '')
process.exit(bad.length ? 1 : 0)
