// IV Studio's release, in one command, with every check before anything is published.
//
//   node scripts/release.mjs 1.1.6              # check everything, then publish
//   node scripts/release.mjs 1.1.6 --dry        # check everything, publish nothing
//   node scripts/release.mjs 1.1.6 --notes path # release notes (default dist/release-notes-<version>.md)
//   --tests-passed                              # skip step 3 when this same commit just passed it here
//
// Runs on Windows from a release worktree with its own node_modules (npm ci; never a junction). In order:
//   1. The tree is clean, it fast-forwards from origin/main, and there are notes and a What's new entry.
//   2. package.json gets the version (one commit, "IV Studio <version>").
//   3. Every CI test here (scripts/ci-linux.sh's list) and the cloud tests.
//   4. The exact commit goes to a candidate branch, and GitHub builds and checks it on Linux and Mac
//      (the workflows with no release tag: build and check only). Meanwhile the Windows installer and portable zip are
//      built here, opened (every page, no errors) and their MCP server started.
//   5. Only when all of that passed: main moves to the commit, v<version> is published as Latest with the Windows
//      files, and Linux and Mac build the same commit again into the release.
//   6. Every public file is downloaded and checked against its update feed.
// Anything failing stops it there; before step 5 nothing public has changed except the candidate branch.
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const REPO = 'hollisorg/iv-studio'
const args = process.argv.slice(2)
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))
const DRY = args.includes('--dry')
const notesArg = args[args.indexOf('--notes') + 1]
if (!version) die('Usage: node scripts/release.mjs <version> [--dry] [--notes file]')
const TAG = `v${version}`
const notes = path.resolve(ROOT, args.includes('--notes') ? notesArg : `dist/release-notes-${version}.md`)
const report = { version, dry: DRY, steps: [] }

function die(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}
function step(name) {
  console.log(`\n== ${name}`)
  report.steps.push({ name, at: new Date().toISOString() })
}
function run(cmd, argv, { cwd = ROOT, quiet = false, env = process.env, allowFail = false, timeout = 0 } = {}) {
  const shell = process.platform === 'win32' && /\.cmd$/i.test(cmd)
  const r = spawnSync(shell ? `"${cmd}"` : cmd, argv.map((a) => (shell ? `"${a}"` : a)), { cwd, env, encoding: 'utf8', shell, maxBuffer: 64 * 1024 * 1024, timeout: timeout || undefined })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (!quiet && out.trim()) console.log(out.trim().split('\n').slice(-8).join('\n'))
  if (r.status !== 0 && !allowFail) die(`${cmd} ${argv.join(' ')} failed (exit ${r.status}).\n${out.trim().split('\n').slice(-15).join('\n')}`)
  return { ok: r.status === 0, out: (r.stdout || '').trim() }
}
const git = (...a) => run('git', a, { quiet: true }).out
const gh = (...a) => run('gh', a, { quiet: true }).out
// npm itself, run with this Node: npm.cmd started from Node works out its own folder wrongly when quoted
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const npm = (...a) => (fs.existsSync(NPM_CLI) ? run(process.execPath, [NPM_CLI, ...a], { quiet: true }) : run('npm.cmd', a, { quiet: true }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const sha512b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64')

async function download(url, dest) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) die(`Download failed: ${url} (${r.status})`)
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
  return dest
}

// The latest run of a workflow on a ref, once it's for this commit.
async function runFor(workflow, ref, sha) {
  for (let i = 0; i < 40; i++) {
    const list = JSON.parse(gh('run', 'list', '--repo', REPO, '--workflow', workflow, '--branch', ref, '--limit', '5', '--json', 'databaseId,headSha,createdAt'))
    const hit = list.find((x) => x.headSha === sha)
    if (hit) return hit.databaseId
    await sleep(6000)
  }
  die(`${workflow} never started on ${ref}.`)
}
async function waitRun(id, label) {
  for (;;) {
    const r = JSON.parse(gh('run', 'view', String(id), '--repo', REPO, '--json', 'status,conclusion'))
    if (r.status === 'completed') {
      if (r.conclusion !== 'success') die(`${label} (run ${id}) ended: ${r.conclusion}. See https://github.com/${REPO}/actions/runs/${id}`)
      console.log(`✓ ${label} passed (run ${id})`)
      return id
    }
    await sleep(30000)
  }
}

// ---------- 1. ready to release?
step('Checks before starting')
if (process.platform !== 'win32') die('Run this on Windows: it builds the Windows installer itself.')
if (fs.existsSync(path.join(ROOT, 'node_modules')) && fs.lstatSync(path.join(ROOT, 'node_modules')).isSymbolicLink()) die('node_modules is a junction or link: run npm ci in this worktree first (a junction drops packages from the installer).')
const dirty = git('status', '--porcelain').split('\n').filter((l) => l && !l.startsWith('?? '))
if (dirty.length) die(`Commit or set aside these changes first:\n${dirty.join('\n')}`)
git('fetch', '-q', 'origin')
if (!run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { quiet: true, allowFail: true }).ok) die('This branch does not fast-forward from origin/main: merge origin/main first.')
if (run('gh', ['release', 'view', TAG, '--repo', REPO], { quiet: true, allowFail: true }).ok) die(`${TAG} is already released.`)
if (!fs.existsSync(notes)) die(`No release notes at ${notes}.`)
if (!fs.readFileSync(path.join(ROOT, 'src/renderer/src/news.js'), 'utf8').includes(`version: '${version}'`)) die(`news.js has no What's new entry for ${version}.`)

// ---------- 2. the version
step(`Version ${version}`)
const pkgFile = path.join(ROOT, 'package.json')
const pkgText = fs.readFileSync(pkgFile, 'utf8')
const current = JSON.parse(pkgText).version
if (current !== version) {
  fs.writeFileSync(pkgFile, pkgText.replace(`"version": "${current}"`, `"version": "${version}"`))
  git('add', 'package.json')
  git('commit', '-q', '-m', `IV Studio ${version}`)
}
const SHA = git('rev-parse', 'HEAD')
report.commit = SHA
console.log(`commit ${SHA}`)

// ---------- 3. tests here
step('Every CI test, and the cloud tests')
const ciList = fs.readFileSync(path.join(ROOT, 'scripts/ci-linux.sh'), 'utf8').match(/for t in ([^;]+); do/)[1].trim().split(/\s+/)
const failed = []
for (const t of args.includes('--tests-passed') ? [] : [...ciList, 'runpod', 'cloudprep', 'cloudvoice']) {
  const r = run(process.execPath, [`test/${t}.mjs`], { quiet: true, allowFail: true, timeout: 300000 })
  if (!r.ok) failed.push(t)
}
if (failed.length) die(`Tests failed: ${failed.join(', ')}`)
console.log(`✓ ${ciList.length + 3} tests passed`)
report.tests = ciList.length + 3

// ---------- 4. Linux and Mac check the exact commit, while Windows builds here
step('Linux and Mac check this commit (nothing published)')
const CANDIDATE = `release-candidate/${TAG}`
git('push', '-q', '-f', 'origin', `HEAD:refs/heads/${CANDIDATE}`)
// a check already running or passed for this commit (an earlier try of this release) is used again, not repeated
const existing = (workflow) => {
  const list = JSON.parse(gh('run', 'list', '--repo', REPO, '--workflow', workflow, '--branch', CANDIDATE, '--limit', '5', '--json', 'databaseId,headSha,status,conclusion'))
  return list.find((x) => x.headSha === SHA && (x.status !== 'completed' || x.conclusion === 'success'))?.databaseId || null
}
const checkOn = async (workflow) => {
  const had = existing(workflow)
  if (had) return had
  gh('workflow', 'run', workflow, '--repo', REPO, '--ref', CANDIDATE)
  await sleep(4000)
  return runFor(workflow, CANDIDATE, SHA)
}
const linuxCheck = await checkOn('linux.yml')
const macCheck = await checkOn('mac.yml')
console.log(`Linux run ${linuxCheck}, Mac run ${macCheck}`)

step('Windows installer and portable zip')
npm('run', 'dist')
npm('run', 'dist:portable')
const dist = path.join(ROOT, 'dist')
const winFiles = ['IV-Studio-Setup.exe', 'IV-Studio-Setup.exe.blockmap', 'latest.yml', 'IV-Studio-Portable-win-x64.zip', 'latest-portable.yml'].map((f) => path.join(dist, f))
for (const f of winFiles) if (!fs.existsSync(f)) die(`Missing ${f}`)
for (const y of ['latest.yml', 'latest-portable.yml']) if (!fs.readFileSync(path.join(dist, y), 'utf8').includes(`version: ${version}`)) die(`${y} isn't ${version}`)
report.windows = { installer: sha256(winFiles[0]), portable: sha256(winFiles[3]) }

step('The packaged app opens every page, and its MCP server starts')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-release-'))
const exe = path.join(dist, 'win-unpacked', 'IV Studio.exe')
const env = { ...process.env, IV_STUDIO_SMOKE: scratch, IV_STUDIO_DATA: path.join(scratch, 'data'), IV_STUDIO_USER_DATA: path.join(scratch, 'ud') }
run(exe, [], { env, quiet: true, allowFail: true, timeout: 180000 })
const smoke = JSON.parse(fs.readFileSync(path.join(scratch, 'smoke.json'), 'utf8'))
if (smoke.version !== version) die(`The packaged app says ${smoke.version}, not ${version}.`)
if (smoke.errors.length) die(`The packaged app had page errors: ${JSON.stringify(smoke.errors).slice(0, 500)}`)
const { IV_STUDIO_SMOKE: _smoke, ...mcpEnv } = env
const mcp = run(process.execPath, ['test/mcp-smoke.mjs'], { env: { ...mcpEnv, MCP_COMMAND: exe, MCP_ARGS: JSON.stringify([path.join(dist, 'win-unpacked', 'resources', 'app.asar', 'out', 'main', 'mcp.js')]) }, quiet: true, timeout: 180000 }).out
const tools = Number(/tools \((\d+)\)/.exec(mcp)?.[1] || 0)
console.log(`✓ ${smoke.pages.length} pages, 0 errors; MCP ${tools} tools`)
report.smoke = { pages: smoke.pages.length, tools }

step('Waiting for Linux and Mac')
await waitRun(linuxCheck, 'Linux check')
await waitRun(macCheck, 'Mac check')
report.checks = { linux: linuxCheck, mac: macCheck }

if (DRY) {
  fs.writeFileSync(path.join(dist, `release-${version}.json`), JSON.stringify(report, null, 2))
  console.log(`\n✓ Everything passed for ${version} (commit ${SHA}). --dry: nothing published. Run again without --dry to publish.`)
  process.exit(0)
}

// ---------- 5. publish
step(`Publishing ${TAG}`)
git('push', '-q', 'origin', 'HEAD:main')
gh('release', 'create', TAG, '--repo', REPO, '--target', SHA, '--title', `IV Studio ${version}`, '--notes-file', notes, '--latest', ...winFiles)
gh('workflow', 'run', 'linux.yml', '--repo', REPO, '--ref', 'main', '-f', `release=${TAG}`)
gh('workflow', 'run', 'mac.yml', '--repo', REPO, '--ref', 'main', '-f', `release=${TAG}`)
const linuxRel = await runFor('linux.yml', 'main', SHA)
const macRel = await runFor('mac.yml', 'main', SHA)

// ---------- 6. the public files
step('Checking the public Windows files')
const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-public-'))
const base = `https://github.com/${REPO}/releases/latest/download`
if (sha256(await download(`${base}/IV-Studio-Setup.exe`, path.join(pub, 'setup.exe'))) !== report.windows.installer) die('The public installer is not the one built here.')
if (sha256(await download(`${base}/IV-Studio-Portable-win-x64.zip`, path.join(pub, 'portable.zip'))) !== report.windows.portable) die('The public portable zip is not the one built here.')
console.log('✓ Windows installer and portable zip match')

step('Waiting for the Linux and Mac release builds')
await waitRun(linuxRel, 'Linux release')
await waitRun(macRel, 'Mac release')
const tagBase = `https://github.com/${REPO}/releases/download/${TAG}`
async function checkFeed(feed, files) {
  const y = await (await fetch(`${tagBase}/${feed}`)).text()
  if (!y.includes(`version: ${version}`)) die(`${feed} isn't ${version}`)
  for (const f of files) {
    const buf = fs.readFileSync(await download(`${tagBase}/${f}`, path.join(pub, f)))
    const m = new RegExp(`url: ${f.replace(/[.]/g, '\\.')}\\s+sha512: (\\S+)\\s+size: (\\d+)`).exec(y)
    if (!m || m[1] !== sha512b64(buf) || Number(m[2]) !== buf.length) die(`${f} doesn't match ${feed}`)
  }
  console.log(`✓ ${files.join(', ')} match ${feed}`)
}
await checkFeed('latest-linux.yml', ['IV-Studio.AppImage'])
await checkFeed('latest-mac.yml', ['IV-Studio-mac-arm64.dmg', 'IV-Studio-mac-arm64.zip', 'IV-Studio-mac-x64.dmg', 'IV-Studio-mac-x64.zip'])
run('git', ['push', '-q', 'origin', '--delete', CANDIDATE], { quiet: true, allowFail: true })
report.release = { url: `https://github.com/${REPO}/releases/tag/${TAG}`, linux: linuxRel, mac: macRel }
fs.writeFileSync(path.join(dist, `release-${version}.json`), JSON.stringify(report, null, 2))
console.log(`\n✓ IV Studio ${version} is the public Latest release: ${report.release.url}`)
