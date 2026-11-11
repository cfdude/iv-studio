// Writes dist/latest-portable.yml beside the portable zip (npm run dist:portable runs it): the version, SHA-512 and
// size the portable copy's updater checks a download against (src/service/portableupdate.js). Publish it with the
// zip on every release.  node scripts/portable-feed.mjs [dist folder]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PORTABLE_FEED, PORTABLE_ZIP, feedText } from '../src/service/portableupdate.js'

const dist = path.resolve(process.argv[2] || 'dist')
const zip = path.join(dist, PORTABLE_ZIP)
if (!fs.existsSync(zip)) throw new Error(`No ${zip}; run npm run dist:portable first.`)
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const hash = crypto.createHash('sha512')
await new Promise((resolve, reject) => fs.createReadStream(zip).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject))
const out = path.join(dist, PORTABLE_FEED)
fs.writeFileSync(out, feedText({ version, sha512: hash.digest('base64'), size: fs.statSync(zip).size }))
console.log(`wrote ${out} (${version})`)
