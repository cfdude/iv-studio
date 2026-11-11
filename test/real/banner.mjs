// Imported by every real test file. With the opt-in set, it says before the first test that real tests cost something.
import { before } from 'node:test'

export const BANNER = 'Real tests spend Comfy Cloud credits or local GPU time.'

before(() => {
  if (process.env.IV_REAL === '1') console.log(BANNER)
})
