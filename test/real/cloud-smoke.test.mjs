// Placeholder real test. Skips unless IV_REAL=1. See test/real/README.md.
// When it runs it SPENDS Comfy Cloud credits, so run it deliberately.
//   IV_REAL=1 npm run test:real
// r2 (the Comfy Cloud backend) fills this in with one cheap job; its mocked twin lives in test/unit/.
import { test } from 'node:test'

const skip = process.env.IV_REAL ? false : 'set IV_REAL=1 to run real tests (they spend Comfy Cloud credits)'

test('Comfy Cloud answers /system_stats', { skip }, () => {
  throw new Error('not written yet: r2 adds the real call here')
})
