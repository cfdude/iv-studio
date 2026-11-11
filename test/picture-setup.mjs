// GitHub #22: every model family in Create → Image can be set up from IV Studio. Its downloads (models.json
// pictureFamilies) hold a model the family reads, a text encoder and a VAE it accepts, and a family's own folder of
// fine-tunes counts as present (acceptPath), as Create → Image reads it.
//   node test/picture-setup.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { IMAGE_FAMILIES } from '../src/service/images.js'
import { resolveModel } from '../src/service/setup.js'

const manifest = JSON.parse(fs.readFileSync(new URL('../resources/models.json', import.meta.url), 'utf8'))
let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const names = (m) => [m.match, ...(m.alt || [])]
const forFamily = (id) => manifest.models.filter((m) => m.pictureFamilies?.includes(id))

for (const f of IMAGE_FAMILIES) {
  // an H3 still uses the H3 models every shot needs (Setup's required models)
  if (f.id === 'h3') continue
  ok(`${f.label}: its downloads make it ready`, () => {
    const files = forFamily(f.id)
    assert.ok(files.length, 'no downloads')
    for (const m of files) assert.ok(m.optional && m.url && m.size && m.loader, `${m.id} is incomplete`)
    if (f.checkpoint) return assert.ok(files.some((m) => f.checkpoint.test(m.match)), 'no checkpoint it reads')
    const unet = files.find((m) => m.loader === 'UNETLoader.unet_name')
    assert.ok(unet && f.unet.test(`${unet.folder.split('/').slice(1).join('/')}/${unet.match}`.replace(/^\//, '')), 'no model file it reads')
    assert.ok(files.some((m) => m.loader === 'CLIPLoader.clip_name' && names(m).some((x) => f.te.files.includes(x))) || f.te.type === 'minimax', 'no text encoder it accepts')
    assert.ok(files.some((m) => m.loader === 'VAELoader.vae_name' && names(m).some((x) => f.vae.includes(x))), 'no VAE it accepts')
  })
}

ok('gated downloads name their licence page', () => {
  for (const m of manifest.models.filter((x) => /black-forest-labs|Lightricks/.test(x.url || ''))) assert.match(m.gated || '', /^https:\/\/huggingface\.co\//, m.id)
})

ok('a fine-tune in the family’s folder counts; a look-alike name elsewhere does not', () => {
  const moss = manifest.models.find((m) => m.id === 'moss_unet')
  assert.equal(resolveModel(moss, ['moss\\realism_v10.safetensors'])?.how, 'version')
  assert.equal(resolveModel(moss, ['moss/realism_v10.safetensors'])?.how, 'version')
  assert.equal(resolveModel(moss, ['mossy_meadow.safetensors']), null)
  const flux2 = manifest.models.find((m) => m.id === 'flux2_unet')
  assert.equal(resolveModel(flux2, ['flux3_image_klein_sd_int8_convrot.safetensors']), null)
  assert.equal(resolveModel(flux2, ['Flux 2\\flux-2-klein-9b-fp8.safetensors'])?.how, 'exact')
})

console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
