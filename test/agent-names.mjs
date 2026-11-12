// The names the person gives in the welcome wizard or Settings → You and your agent, as the agent is told them
// (agentchat.js namesNote), and the accent colours (accent.js) the same settings carry.
//   node test/agent-names.mjs
import { namesNote } from '../src/service/agentchat.js'

let failed = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}`)
  if (!cond) failed++
}
check(namesNote({}) === '', 'no names: nothing added')
const both = namesNote({ agentName: 'Nova', userName: 'Sam', engine: 'claude' })
check(/calls you Nova/.test(both) && /Claude Code/.test(both), 'the agent is told its name and the app it runs on')
check(/name is Sam/.test(both), 'the agent is told the person’s name')
check(!/name is/.test(namesNote({ agentName: 'Nova', engine: 'codex' })), 'no person’s name when they gave none')
check(/calls you/.test(namesNote({ agentName: 'Nova', engine: 'hermes' })) && /Hermes/.test(namesNote({ agentName: 'Nova', engine: 'hermes' })), 'Hermes too')
check(namesNote({ agentName: 'x'.repeat(200) }).includes('x'.repeat(40)) && !namesNote({ agentName: 'x'.repeat(200) }).includes('x'.repeat(41)), 'names are kept short')
check(namesNote({ agentName: '   ' }) === '', 'blank names count as none')
if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
