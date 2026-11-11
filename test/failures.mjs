// Failed renders in plain words: real ComfyUI messages map to the right explanation, unknown ones stay as they are.
import { FAILURE_IDS, explainFailure } from '../src/service/failures.js'

let failed = 0
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed++
}
const id = (text, ctx) => explainFailure(text, ctx)?.id ?? null

const CASES = [
  ['memory', 'KSampler: Allocation on device 0 would exceed allowed memory. (out of memory)\nCurrently allocated     : 22.31 GiB'],
  ['memory', 'SamplerCustomAdvanced: torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.50 GiB.'],
  ['memory', 'VAEDecode: [enforce fail at alloc_cpu.cpp:114] data. DefaultCPUAllocator: not enough memory: you tried to allocate 8589934592 bytes.'],
  ['missing-node', 'Cannot execute because node MiniMaxH3ReferenceToVideo does not exist.'],
  ['missing-node', 'invalid prompt: {"type": "missing_node_type", "message": "Node type \'RTXVideoSuperResolution\' not found"}'],
  ['missing-model', "UNETLoader: Value not in list: unet_name: 'minimax_h3_fp8.safetensors' not in ['flux.safetensors']"],
  ['missing-model', "LoraLoaderModelOnly: [Errno 2] No such file or directory: 'D:\\\\ComfyUI\\\\models\\\\loras\\\\tess.safetensors'"],
  ['disk-full', 'SaveVideo: [Errno 28] No space left on device'],
  ['disk-full', 'OSError: There is not enough space on the disk'],
  ['credits', 'SeedanceVideo: Payment Required: insufficient credits for this request'],
  ['sign-in', 'SeedanceVideo: Unauthorized: Please login first to use this node.'],
  ['unreachable', 'fetch failed'],
  ['unreachable', 'ComfyUI did not answer /prompt within 20 s'],
  ['unreachable', 'connect ECONNREFUSED 127.0.0.1:8188'],
  ['moderation', 'SeedanceVideo: The request was rejected by the content moderation system.'],
  ['bad-input', "LoadImage: cannot identify image file 'C:\\\\ComfyUI\\\\input\\\\ref.png'"],
  ['bad-input', 'VHS_LoadVideo: moov atom not found'],
  ['validation', 'prompt_outputs_failed_validation: Required input is missing: latent_image'],
  ['shape', 'KSampler: Sizes of tensors must match except in dimension 1. Expected size 64 but got size 60'],
  ['shape', 'LoraLoader: size mismatch for diffusion_model.blocks.0.attn.weight']
]
for (const [want, text] of CASES) check(`${want}: ${text.slice(0, 60)}`, id(text) === want)

check('a message it doesn’t know is left alone', explainFailure('KSampler: something nobody has seen before') === null)
check('no message, no explanation', explainFailure('') === null && explainFailure(null) === null)

const all = CASES.map(([, text]) => explainFailure(text))
check('every explanation has a title, a reason and keeps the original message', all.every((e, k) => e.title.length > 8 && e.why.length > 30 && e.raw === CASES[k][1]))
check('every fix has an id the window knows and a label', all.every((e) => e.fixes.every((f) => ['lower-memory', 'open-setup', 'restart-comfy', 'open-cloud', 'comfy-account', 'free-space', 'try-again'].includes(f.id) && f.label.length > 3)))
check('no explanation uses an em dash', all.every((e) => !/—/.test(e.title + e.why + e.fixes.map((f) => f.label).join(''))))
check('each kind of failure is covered by a case', FAILURE_IDS.every((x) => CASES.some(([want]) => want === x)))

const oom = 'KSampler: torch.OutOfMemoryError: CUDA out of memory'
const local = explainFailure(oom, { where: 'local', kind: 'previews' })
const cloud = explainFailure(oom, { where: 'cloud', kind: 'previews' })
const finish = explainFailure(oom, { where: 'local', kind: 'finish' })
check('out of memory on this PC offers the Low memory preset', local.fixes[0].id === 'lower-memory' && /graphics card/.test(local.title))
check('out of memory in the cloud offers a bigger GPU instead', cloud.fixes.length === 1 && cloud.fixes[0].id === 'open-cloud' && /cloud GPU/.test(cloud.title))
check('out of memory on a finish talks about the finish size', /finish/i.test(finish.why) && finish.why !== local.why)
check('ComfyUI not answering in the cloud points at Cloud, not a local restart', explainFailure('fetch failed', { where: 'cloud' }).fixes[0].id === 'open-cloud' && explainFailure('fetch failed').fixes[0].id === 'restart-comfy')

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
