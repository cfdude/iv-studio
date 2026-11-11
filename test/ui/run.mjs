// `npm run test:ui`: the page tier under the guard. It exists so that `npm run test:ui -- --update-traces` works: the
// node test runner reads every bare argument as a file pattern and would silently ignore the flag, so it is taken here
// and passed on as IV_UPDATE_TRACES=1 (test/ui/trace.mjs). Every other argument goes to node as it is.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const update = args.includes('--update-traces')
const rest = args.filter((a) => a !== '--update-traces')
const node = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './test/fakes/guard.mjs', '--test', '--test-concurrency=1', ...rest, 'test/ui/*.test.mjs']
const r = spawnSync(process.execPath, node, { cwd: root, stdio: 'inherit', env: { ...process.env, ...(update ? { IV_UPDATE_TRACES: '1' } : {}) } })
process.exit(r.status ?? 1)
