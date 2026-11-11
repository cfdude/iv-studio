// Simple words (src/renderer/src/words.js): the plain versions read right, real names and other words are left
// alone, and a second pass changes nothing (the window rewrites text as it changes).
import assert from 'node:assert/strict'
import { plainText, PHRASES } from '../src/renderer/src/words.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('labels and sentences in plain words', () => {
  assert.equal(plainText('LoRAs'), 'Looks')
  assert.equal(plainText('H3 + SeedVR2'), 'Redraw + detail restore')
  assert.equal(plainText('LoRAs add a look, a style or a move; RefMods bring a saved look, voice or place.'), 'Trained looks add a look, a style or a move; reference packs bring a saved look, voice or place.')
  assert.equal(plainText('Tess’s LoRA'), 'Tess’s trained look')
  assert.equal(plainText('Pick the seed you like.'), 'Pick the variation number you like.')
  assert.equal(plainText('Seed 4242'), 'Variation number 4242')
  assert.equal(plainText('Upscales, keeping the faces.'), 'Enlarges, keeping the faces.')
  assert.equal(plainText('then DLSS 5 cleans it up'), 'then quick sharpen cleans it up')
  assert.equal(plainText('DLSS 5 · 2×'), 'Quick sharpen · 2×')
  assert.equal(plainText('Write the prompt. Prompts work best short.'), 'Write the description. Descriptions work best short.')
  assert.equal(plainText('Hunt a few takes, then pick one.'), 'Try a few takes, then pick one.')
  assert.equal(plainText('Stop the hunt'), 'Stop the takes')
  assert.equal(plainText('Hunt'), 'Try')
  assert.equal(plainText('Connect Claude Code, Codex or any MCP agent, so it can make shots'), 'Connect Claude Code, Codex or any AI agent, so it can make shots')
  assert.equal(plainText('same modes and hunt, and you see the price'), 'same modes and takes, and you see the price')
  assert.equal(plainText('Install missing node packs'), 'Install missing ComfyUI add-ons')
  assert.equal(plainText('24 GB VRAM'), '24 GB graphics memory')
})

ok('names and other words are left alone', () => {
  for (const s of ['Seedance 2.5', 'Seedance 2.5 Draft', 'ComfyUI ready', '1080p · 24 fps', 'Take 2', 'Prompted by', 'seeding', 'Huntington', 'The Seed of it', 'RAMP'])
    assert.equal(plainText(s), s === 'The Seed of it' ? 'The Variation number of it' : s, s)
  assert.equal(plainText(''), '')
  assert.equal(plainText('  '), '  ')
  assert.equal(plainText('4242'), '4242')
})

ok('a second pass changes nothing', () => {
  const samples = [...Object.keys(PHRASES), 'LoRAs add a look; RefMods bring a voice. Seed, sampler and scheduler, DLSS 5 and SeedVR2 upscalers, GPU, RAM, VRAM, the MCP server, the VAE, latent upscale, hunt, hunting.']
  for (const s of samples) {
    const once = plainText(s)
    assert.equal(plainText(once), once, s)
  }
})

ok('spacing around a whole label is kept', () => assert.equal(plainText(' Steps '), ' Detail passes '))

console.log(`\n${n} passed`)
