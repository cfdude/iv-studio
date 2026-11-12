// Which writer "Write it for me" uses (paths.js writerFor). Since 1.1 the request carries the shot's video model as
// engine (h3 or seedance); that must never be read as a writer (GitHub #23: 'Unknown writer "h3"').
//   node test/writer-pick.mjs
import { writerFor } from '../src/service/paths.js'
import { isHarness, parseJsonAnswer } from '../src/service/harness.js'

let failed = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}`)
  if (!cond) failed++
}
const claude = { promptEngine: 'claude', claudeModel: 'opus', ollamaModel: 'qwen' }
check(writerFor(claude, { engine: 'h3', idea: 'x' }).engine === 'claude', 'an H3 shot keeps the writer from Settings')
check(writerFor(claude, { engine: 'seedance', idea: 'x' }).engine === 'claude', 'a Seedance shot keeps the writer from Settings')
check(writerFor({}, { engine: 'h3' }).engine === 'local', 'no writer set: the local writer, not "h3"')
check(writerFor(claude, { engine: 'codex' }).engine === 'codex', 'a writer named as engine still picks it')
check(writerFor(claude, { engine: 'h3', writer: 'contextir' }).engine === 'contextir', 'request.writer picks the writer')
check(writerFor({ promptEngine: 'openai', openaiModel: 'm' }, { engine: 'h3' }).provider === 'openai', 'OpenAI-compatible stays itself on an H3 shot')
check(writerFor(claude, null).engine === 'claude', 'no request: Settings')
// Hermes as a writer (harness.js hermesJson)
check(writerFor({ promptEngine: 'hermes', hermesModel: 'm1' }, { engine: 'h3' }).engine === 'hermes' && writerFor({ promptEngine: 'hermes', hermesModel: 'm1' }, null).model === 'm1', 'Hermes from Settings, with its chat model')
check(writerFor(claude, { engine: 'hermes' }).engine === 'hermes', 'a request can name Hermes')
check(isHarness('hermes') && isHarness('claude') && !isHarness('local') && !isHarness('h3'), 'Hermes counts as an agent writer; h3 does not')
check(JSON.stringify(parseJsonAnswer('{"prompt":"x"}')) === '{"prompt":"x"}', 'a plain JSON answer')
check(parseJsonAnswer('```json\n{"prompt":"y"}\n```').prompt === 'y', 'a fenced JSON answer')
check(parseJsonAnswer('Here you go {"prompt":"z","n":[1]} hope it helps').prompt === 'z', 'JSON with words around it')
let threw = false
try {
  parseJsonAnswer('no json here')
} catch {
  threw = true
}
check(threw, 'no JSON at all is an error, not a blank prompt')
if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
