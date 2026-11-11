// IV Studio runs on Windows, Linux and a Mac, so what the person reads says "computer", never "PC" (SB-24).
// Looks at the code and text of src, not its // and /* */ comments.
//   node --test test/unit/wording-computer.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

// the lines of a source file with comment-only lines and trailing // comments taken out
export function codeLines(text) {
  let block = false
  return text.split('\n').map((line, i) => {
    const st = line.trim()
    if (block) {
      if (st.includes('*/')) block = false
      return null
    }
    if (st.startsWith('//') || st.startsWith('*') || st.startsWith('{/*')) return null
    if (st.startsWith('/*')) {
      block = !st.includes('*/')
      return null
    }
    const cut = line.search(/\s\/\/\s/)
    return { n: i + 1, text: cut >= 0 ? line.slice(0, cut) : line }
  }).filter(Boolean)
}

describe('wording: computer, not PC', () => {
  test('codeLines drops whole-line and trailing comments and keeps URLs', () => {
    const got = codeLines("// a PC\nconst a = 'PC' // a PC\nconst u = 'https://x.y/PC'\n/* PC\n PC */\nconst b = 1").map((l) => l.text)
    assert.deepEqual(got, ["const a = 'PC'", "const u = 'https://x.y/PC'", 'const b = 1'])
  })
  test('no text a person reads says PC', () => {
    const found = []
    for (const f of walk('src').filter((p) => /\.(js|jsx|mjs|json)$/.test(p))) {
      for (const { n, text } of codeLines(fs.readFileSync(f, 'utf8'))) if (/\bPC\b/.test(text)) found.push(`${f}:${n}: ${text.trim().slice(0, 100)}`)
    }
    assert.deepEqual(found, [])
  })
})
