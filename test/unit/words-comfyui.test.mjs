// Simple words: a phrase that already says ComfyUI doesn't get a second one.
//   node --test test/unit/words-comfyui.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { plainText } from '../../src/renderer/src/words.js'

describe('ComfyUI add-ons', () => {
  test('"ComfyUI node packs" and "ComfyUI custom nodes" become "ComfyUI add-ons" once', () => {
    assert.equal(plainText('ComfyUI node packs'), 'ComfyUI add-ons')
    assert.equal(plainText('Install the ComfyUI node pack first'), 'Install the ComfyUI add-on first')
    assert.equal(plainText('Missing ComfyUI custom nodes'), 'Missing ComfyUI add-ons')
  })
  test('without ComfyUI in front they still get it, and a second pass changes nothing', () => {
    assert.equal(plainText('Install missing node packs'), 'Install missing ComfyUI add-ons')
    assert.equal(plainText('Custom nodes'), 'ComfyUI add-ons')
    for (const s of ['ComfyUI node packs', 'node packs', 'ComfyUI custom nodes']) assert.equal(plainText(plainText(s)), plainText(s))
  })
})
