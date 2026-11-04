// Fails the Mac build before packaging if the FFmpeg that ships in the app is missing or isn't arm64.
// `npm ci --ignore-scripts` skips the download, which leaves the package with no binaries.
//   node scripts/check-mac-ffmpeg.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MH_MAGIC_64 = 0xfeedfacf // 64-bit Mach-O, little endian on disk as cf fa ed fe
const CPU_ARM64 = 0x0100000c
const CPU_X86_64 = 0x01000007

// Pure: `head` is the first bytes of the file, or null when the file isn't there.
export const checkMachOHeader = (head) => {
  if (!head) return { ok: false, reason: 'the file is missing' }
  if (head.length < 8 || head.readUInt32LE(0) !== MH_MAGIC_64) {
    return { ok: false, reason: 'it is not a 64-bit Mac program (a universal or non-Mac file does not count)' }
  }
  const cpu = head.readUInt32LE(4)
  if (cpu === CPU_ARM64) return { ok: true }
  if (cpu === CPU_X86_64) return { ok: false, reason: 'it is an Intel (x86_64) build, not Apple Silicon (arm64)' }
  return { ok: false, reason: `its processor type (0x${cpu.toString(16)}) is not arm64` }
}

const readHead = (file) => {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(8)
      const n = fs.readSync(fd, buf, 0, 8, 0)
      return buf.subarray(0, n)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

// Where the ffmpeg-ffprobe-static package keeps its binaries (beside its package.json).
export const defaultPaths = () => {
  const dir = path.dirname(createRequire(import.meta.url).resolve('ffmpeg-ffprobe-static/package.json'))
  return { ffmpeg: path.join(dir, 'ffmpeg'), ffprobe: path.join(dir, 'ffprobe') }
}

// Returns one plain sentence per problem; an empty list means both are fine.
export const checkBinaries = (paths = defaultPaths()) =>
  Object.entries(paths).flatMap(([name, file]) => {
    const r = checkMachOHeader(readHead(file))
    return r.ok ? [] : [`${name} (${file}): ${r.reason}`]
  })

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkBinaries()
  if (problems.length) {
    console.error('The Mac build needs arm64 ffmpeg and ffprobe, and found a problem:')
    for (const p of problems) console.error(`  - ${p}`)
    console.error('Run `npm ci` (without --ignore-scripts) on an Apple Silicon Mac so the FFmpeg download runs.')
    process.exit(1)
  }
  console.log('ffmpeg and ffprobe are arm64 Mach-O executables.')
}
