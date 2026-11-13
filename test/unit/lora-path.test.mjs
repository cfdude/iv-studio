// A character's saved LoRA name uses backslashes (characters.js); a Mac's file path needs the OS separator.
//   node --test test/unit/lora-path.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { loraFilePath } from '../../src/shared/lora.js'

describe('loraFilePath', () => {
  test('a Windows-spelled name joins under the folder with the OS separator', () => {
    assert.equal(loraFilePath('/m/loras', 'MiniMax H3\\tess\\a.safetensors'), path.join('/m/loras', 'MiniMax H3', 'tess', 'a.safetensors'))
  })
  test('a forward-slash name gives the same path', () => {
    assert.equal(loraFilePath('/m/loras', 'MiniMax H3/tess/a.safetensors'), path.join('/m/loras', 'MiniMax H3', 'tess', 'a.safetensors'))
  })
  test('a plain file name stays one segment', () => {
    assert.equal(loraFilePath('/m/loras', 'a.safetensors'), path.join('/m/loras', 'a.safetensors'))
  })
})
