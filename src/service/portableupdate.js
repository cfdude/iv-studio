// IV Studio's own updater for the portable Windows copy (the zip with a "data" folder beside IV Studio.exe). The
// installer can't update it (it would put a second copy in Program Files), so the portable copy reads
// latest-portable.yml from the newest release, downloads IV-Studio-Portable-win-x64.zip into data\updates, checks it
// against the feed's SHA-512 and size, unpacks it with Windows' own tar, checks the new IV Studio.exe and its
// version, and after IV Studio quits a small PowerShell script swaps the program files in place (never the data
// folder) and opens IV Studio again. The old files are kept aside until the new ones are in, and put back if not.
// Nothing here needs Electron, so it's tested on any OS (test/portable-update.mjs); the unpacking and the version
// read take stand-ins there.
import fs from 'node:fs'
import path from 'node:path'
import { PORTABLE_FOLDER } from './paths.js'
export { checkFile, download, newer, parseFeed } from './macupdate.js'

export const RELEASES = 'https://github.com/hollisorg/iv-studio/releases'
export const PORTABLE_ZIP = 'IV-Studio-Portable-win-x64.zip'
export const PORTABLE_FEED = 'latest-portable.yml'
export const UPDATES_FOLDER = 'updates'

// where the feed and its zip are: GitHub's newest release, or a test feed (a folder URL)
export function feedUrls(testFeed) {
  if (testFeed) {
    const base = testFeed.replace(/\/+$/, '')
    return { feed: `${base}/${PORTABLE_FEED}`, file: (name) => `${base}/${encodeURIComponent(name)}` }
  }
  return { feed: `${RELEASES}/latest/download/${PORTABLE_FEED}`, file: (name, version) => `${RELEASES}/download/v${version}/${encodeURIComponent(name)}` }
}

// the portable zip in the feed
export const pickFile = (files) => files.find((f) => /portable.*\.zip$/i.test(f.url)) || null

// latest-portable.yml for a built zip (scripts/portable-feed.mjs, at release time): the same shape as latest.yml
export function feedText({ version, sha512, size, releaseDate = new Date().toISOString() }) {
  return [`version: ${version}`, 'files:', `  - url: ${PORTABLE_ZIP}`, `    sha512: ${sha512}`, `    size: ${size}`, `path: ${PORTABLE_ZIP}`, `sha512: ${sha512}`, `releaseDate: '${releaseDate}'`, ''].join('\n')
}

// Why this copy can't replace itself, or null when it can: the folder IV Studio.exe is in has to be writable.
export function cannotReplace(appDir, { access = fs.accessSync } = {}) {
  if (!appDir) return 'IV Studio isn’t running from a folder.'
  try {
    access(appDir, fs.constants.W_OK)
    access(path.join(appDir, 'IV Studio.exe'), fs.constants.W_OK)
  } catch {
    return `IV Studio can’t change ${appDir}. Download the new portable zip and unzip it over this folder, or move the folder somewhere you can write to.`
  }
  return null
}

// The package.json inside resources\app.asar. Electron's own fs reads into an asar, so this works in the app;
// the test passes a stand-in.
export const asarVersion = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'app.asar', 'package.json'), 'utf8')).version

// Unpack the zip into dir and check it: IV Studio.exe and resources\app.asar are there, and the version is the
// feed's. unzip(zip, dir) -> { code, stderr } is Windows' tar (stood in by the test).
export async function stage(zip, dir, { version, unzip, readVersion = asarVersion }) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const r = await unzip(zip, dir)
  if (r.code !== 0) throw new Error(`Couldn’t unpack the update: ${String(r.stderr || '').trim().split('\n')[0]}`)
  if (!fs.existsSync(path.join(dir, 'IV Studio.exe'))) throw new Error('The update has no IV Studio.exe.')
  if (!fs.existsSync(path.join(dir, 'resources', 'app.asar'))) throw new Error('The update has no app.asar.')
  let got = null
  try {
    got = readVersion(dir)
  } catch {
    /* reported below */
  }
  if (got !== version) throw new Error(`The update says it is ${got || 'no version'}, not ${version}.`)
  // the zip's own empty data folder is never copied over the person's
  fs.rmSync(path.join(dir, PORTABLE_FOLDER), { recursive: true, force: true })
  return dir
}

// Old program files set aside by an earlier update and still there (one was in use when it finished): removed
// when IV Studio next opens. The data folder's updates\ folder only.
export function cleanUpOld(appDir) {
  const dir = path.join(appDir, PORTABLE_FOLDER, UPDATES_FOLDER)
  let left = 0
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!/^old-/.test(name)) continue
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    } catch {
      left++
    }
  }
  return left
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`

// The PowerShell script that swaps the program files once IV Studio (pid) has quit. Every item in the app folder
// except data moves into data\updates\old-<stamp> (a rename on the same drive, which Windows allows even for an
// .exe another process still has open, such as an agent's MCP server), the new items move in, and the old ones are
// deleted (or left for cleanUpOld when something still holds them). If anything fails, the moved items go back.
// Then IV Studio opens again.
// Windows paths whatever OS builds it (the test runs on Linux and macOS too).
export function installScript({ pid, appDir, staged, log, relaunch = true, stamp = Date.now() }) {
  const old = path.win32.join(appDir, PORTABLE_FOLDER, UPDATES_FOLDER, `old-${stamp}`)
  const exe = path.win32.join(appDir, 'IV Studio.exe')
  return [
    '# IV Studio portable update',
    `$app = ${ps(appDir)}`,
    `$new = ${ps(staged)}`,
    `$old = ${ps(old)}`,
    `$log = ${ps(log)}`,
    `$keep = ${ps(PORTABLE_FOLDER)}`,
    'function Say($m) { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format o), $m) }',
    `Say "waiting for IV Studio (pid ${pid}) to quit"`,
    '$n = 0',
    `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { $n++; if ($n -gt 600) { Say "it didn't quit"; exit 1 }; Start-Sleep -Milliseconds 200 }`,
    'Start-Sleep -Milliseconds 500',
    'New-Item -ItemType Directory -Force -Path $old | Out-Null',
    // move a list of items from one folder to another, retrying while Windows still holds a file
    'function MoveAll($from, $to, $names) {',
    '  $done = @()',
    '  foreach ($name in $names) {',
    '    $ok = $false',
    '    for ($i = 0; $i -lt 25 -and -not $ok; $i++) {',
    '      try { Move-Item -LiteralPath (Join-Path $from $name) -Destination (Join-Path $to $name) -Force -ErrorAction Stop; $ok = $true }',
    '      catch { Start-Sleep -Milliseconds 400 }',
    '    }',
    '    if (-not $ok) { Say "couldn\'t move $name"; return @{ ok = $false; done = $done } }',
    '    $done += $name',
    '  }',
    '  return @{ ok = $true; done = $done }',
    '}',
    '$oldNames = @(Get-ChildItem -LiteralPath $app -Force | Where-Object { $_.Name -ne $keep } | ForEach-Object { $_.Name })',
    '$newNames = @(Get-ChildItem -LiteralPath $new -Force | Where-Object { $_.Name -ne $keep } | ForEach-Object { $_.Name })',
    '$out = MoveAll $app $old $oldNames',
    'if (-not $out.ok) {',
    '  Say "putting the old files back"',
    '  MoveAll $old $app $out.done | Out-Null',
    '} else {',
    '  $in = MoveAll $new $app $newNames',
    '  if ($in.ok) {',
    '    Say "installed"',
    '    try { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction Stop } catch { Say "old files still in use; removed next time" }',
    '    try { Remove-Item -LiteralPath $new -Recurse -Force -ErrorAction Stop } catch {}',
    '  } else {',
    '    Say "couldn\'t put the new files in place; putting the old ones back"',
    '    foreach ($name in $in.done) { Remove-Item -LiteralPath (Join-Path $app $name) -Recurse -Force -ErrorAction SilentlyContinue }',
    '    MoveAll $old $app $oldNames | Out-Null',
    '  }',
    '}',
    relaunch ? `Start-Process -FilePath ${ps(exe)} -WorkingDirectory $app; Say "opened"` : 'Say "not reopening"',
    ''
  ].join('\r\n')
}
