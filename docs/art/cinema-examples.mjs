// Example pictures for the Cinematography menu (CraftKit.jsx CinemaPicker): one fixed scene, rendered with each
// setup's own phrase from Slate's setups.json, on this PC's ComfyUI with Z-Image Turbo (free, local). The same
// woman at the same café window, so the only difference between two tiles is the setup.
//   node docs/art/cinema-examples.mjs <out folder> [setup ids...]   (no ids: every setup; existing files are kept)
import fs from 'node:fs'
import path from 'node:path'
import { imageGraph } from '../../src/service/images.js'

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188'
const out = process.argv[2]
const only = process.argv.slice(3)
fs.mkdirSync(out, { recursive: true })
// the setup's words lead; the scene stays short, so it doesn't drown the look
const SCENE = 'Subject: a woman with dark hair in a red coat at a café table by a rainy window, evening.'
// setups whose own phrase came out too literal in a picture (a ring light for rim light, a desk lamp for Rembrandt):
// what the example uses instead. The prompt phrase the app adds is unchanged.
const OVERRIDE = {
  'rim-lighting': 'Rim lighting: a strong light from behind her traces a thin bright edge along her hair and shoulders, her face mostly in soft shadow, no lamps visible in the frame.',
  'rembrandt-lighting': 'Rembrandt lighting: one soft key light from high on one side, a small triangle of light under the eye on her shadowed cheek, deep moody shadows, no lamps visible in the frame.',
  'butterfly-lighting': 'Paramount glamour lighting: one soft light high and straight in front of her face, a small symmetrical shadow under her nose, bright even cheekbones, classic Hollywood portrait.',
  'editorial-photography': 'Editorial magazine photography: confident composition with clean negative space on one side, an art-directed palette. No text or lettering anywhere.',
  'fashion-photography': 'Fashion photography: a striking pose that shows her face and the coat, polished styling, dramatic light, a high-fashion editorial look. No text anywhere.',
  'product-photography': 'Product photography: her coffee cup in sharp focus in the foreground under clean, controlled light, her figure soft behind it. No labels, logos or text anywhere.',
  'aerial-photography': 'Aerial photography: looking straight down from high above at the rainy street and the café terrace, the woman in her red coat small at an outdoor table. A real photograph, no graphics.',
  'bleach-bypass': 'Bleach bypass film look: desaturated colour, heavy contrast, silvery highlights and crushed blacks, a gritty full-frame film still with no border.',
  'luxury-watch': 'Luxury watch commercial: a close-up of her wrist wearing an elegant plain steel watch with a blank dial (no markings, no text), rich dark light, polished highlights.',
  'energy-drink-chaos': 'Energy drink commercial chaos: fast and punchy, saturated colours, drink splashing through the air, a dynamic tilted angle. Plain cans with no labels or text.',
  'overlapping-silhouette-planes': 'Overlapping silhouette planes: dark silhouettes of other customers in the near foreground overlap her lit figure in the midground, the bright window behind. One single photograph.',
  'layered-midground-action': 'Layered depth: a blurred table edge in the foreground, her at her table in the midground, a waiter passing behind her, the rainy street in the background.'
}
// camera moves and rigs: the frame the move produces, described without naming equipment (cinema-moves.json),
// because the picture model draws whatever gear the words mention; the tile's badge says it moves
const MOVES = JSON.parse(fs.readFileSync(new URL('./cinema-moves.json', import.meta.url)))
const setups = JSON.parse(fs.readFileSync(new URL('../../resources/slate/setups.json', import.meta.url))).categories.flatMap((c) => c.setups.map((s) => ({ ...s, category: c.id })))
const todo = setups.filter((s) => (!only.length || only.includes(s.id)) && !fs.existsSync(path.join(out, `${s.id}.webp`)))
console.log(`${todo.length} to render`)
const wait = async (id) => {
  for (;;) {
    const h = await (await fetch(`${COMFY}/history/${id}`)).json()
    if (h[id]?.status?.completed) return h[id]
    if (h[id]?.status?.status_str === 'error') throw new Error(JSON.stringify(h[id].status.messages).slice(0, 400))
    await new Promise((r) => setTimeout(r, 700))
  }
}
for (const s of todo) {
  const t0 = Date.now()
  const prompt = `${MOVES[s.id] || OVERRIDE[s.id] || s.snippet} ${SCENE}`
  const g = imageGraph({ family: 'zimage', unet: 'Z Image Turbo_Turbo.safetensors', te: 'qwen_3_4b.safetensors', vae: 'ae.safetensors', prompt, width: 1024, height: 576, count: 1, seed: 4242, steps: 8, cfg: 1, prefix: `iv_cinema/${s.id}` })
  const r = await (await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: g, client_id: 'iv-cinema-examples' }) })).json()
  if (!r.prompt_id) throw new Error(JSON.stringify(r).slice(0, 400))
  const h = await wait(r.prompt_id)
  const img = Object.values(h.outputs).flatMap((o) => o.images || [])[0]
  const png = Buffer.from(await (await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`)).arrayBuffer())
  fs.writeFileSync(path.join(out, `${s.id}.png`), png)
  console.log(`${s.id} ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}
