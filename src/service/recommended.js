// A short shelf of tested MiniMax H3 LoRAs for the LoRAs page, each pinned to one Hugging Face commit and its
// SHA-256 (checked by ModelInstaller, the same downloader Setup uses), with what it does and how to use it in
// IV Studio's own words. The list is our pick; the idea of a recommended shelf, and several of these picks, came
// from keys + Sam Wasserman's Imagination Studio (Apache-2.0). Every file is the person's to download, and each
// keeps its own licence (shown on its card): Apache-2.0, or MiniMax's H3 Community Licence for most H3 LoRAs.
// works: the H3 modes it was made for (text, frames, reference); use: 'shot' (the Create tray) or 'turnaround'
// (Characters → Turnaround sheet; it breaks motion in a normal shot).
const hf = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${encodeURIComponent(file).replace(/%2F/g, '/')}`
const H3_LICENCE = 'MiniMax H3 Community Licence'

export const RECOMMENDED = [
  {
    id: 'rec-camera-motion',
    name: 'Camera Motion',
    author: 'Jojocodex',
    page: 'https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora',
    licence: 'Apache-2.0',
    match: 'camera_motion_h3_lora_v1_3000_pruned.safetensors',
    url: hf('Jojocodex/minimax-h3-Camera-Motion-lora', 'fac88d6196ca84f3cee014ec79c71dc73572ab0a', 'camera_motion_h3_lora_v1_3000_pruned.safetensors'),
    sha256: '9d7d98d7377f56efed3aa7d507f767936112d208906f49908ec9a8ae912be88b',
    size: 155109680,
    trigger: 'camera motion',
    strength: 0.9,
    works: ['text', 'frames', 'reference'],
    what: 'Camera moves H3 tends to skip: push-ins, pull-backs, orbits, tracking, crane and aerial moves.',
    how: 'Start the prompt with "camera motion", then say the move. 0.8 is gentle, 1.0 clear.',
    use: 'shot'
  },
  {
    id: 'rec-natural-face-speech',
    name: 'Natural Face Speech',
    author: 'vpakarinen',
    page: 'https://huggingface.co/vpakarinen/natural-face-speech-h3-lora',
    licence: 'Apache-2.0',
    match: 'natural_face_speech_h3_lora_v2_500.safetensors',
    url: hf('vpakarinen/natural-face-speech-h3-lora', 'bcefb764cc2167cc43c98a06259695ff54210533', 'natural_face_speech_h3_lora_v2_500.safetensors'),
    sha256: '40b1af6134ddf8597e6b9bfed1b97fc782bac6917e498f954effd34681ab881b',
    size: 310168816,
    trigger: '',
    strength: 0.7,
    works: ['text', 'frames'],
    what: 'A face that moves like a real speaker’s, and clear English speech, for people talking to camera.',
    how: 'Use 0.6 to 0.8 on shots where someone speaks. Tall 9:16 suits it best.',
    use: 'shot'
  },
  {
    id: 'rec-motion-repair',
    name: 'Motion Continuity Repair',
    author: 'JOKER141',
    page: 'https://huggingface.co/JOKER141/MiniMax-H3-General-Motion-Continuity-Repair',
    licence: H3_LICENCE,
    match: 'Motion_Repair_V2.safetensors',
    url: hf('JOKER141/MiniMax-H3-General-Motion-Continuity-Repair', '1676b352bb9f62407f76aee2ad55db2f36d04471', 'Motion_Repair_V2.safetensors'),
    sha256: 'edfa0e2858caeba7be9108883f61da8525d3c58af998c94ac7a449d9603d7574',
    size: 155110272,
    trigger: '',
    strength: 0.8,
    works: ['text', 'frames', 'reference'],
    what: 'Keeps bodies whole through fast action: running, dance, flips, spins, falls and fights.',
    how: 'Add it to any action shot; no trigger word.',
    use: 'shot'
  },
  {
    id: 'rec-spatial-physics',
    name: 'Spatial Physics',
    author: 'Jojocodex',
    page: 'https://huggingface.co/Jojocodex/minimax-h3-spatial-physics-lora',
    licence: 'Apache-2.0',
    match: 'wushu_spatial_physics_clean_3000_pruned.safetensors',
    url: hf('Jojocodex/minimax-h3-spatial-physics-lora', '476b24df28b9b7cc5481b750469698f5cc4b0558', 'wushu_spatial_physics_clean_3000_pruned.safetensors'),
    sha256: '7d14f3701560068e7004159c8b2a7278bd2dbfc9e5e3b60d0bc9aef6c049919d',
    size: 155109672,
    trigger: '',
    strength: 0.4,
    works: ['text', 'frames', 'reference'],
    what: 'Objects that collide, bounce, stack and fall believably; also helps contact in fights.',
    how: 'Keep it low, 0.3 to 0.5, and describe the collision or fall in plain words.',
    use: 'shot'
  },
  {
    id: 'rec-fpv',
    name: 'Head-mounted FPV',
    author: 'neph1',
    page: 'https://huggingface.co/neph1/minimax_h3_headmounted_fpv_cam',
    licence: H3_LICENCE,
    match: 'fpv_headbob_h3_50.safetensors',
    url: hf('neph1/minimax_h3_headmounted_fpv_cam', 'cd2619e00df748aff4ed93bab26ab40a8176d132', 'fpv_headbob_h3_50.safetensors'),
    sha256: 'eabade655732836b339e25c9bb9101967e36febff9ada6541fa54bb2593b6ac2',
    size: 77580048,
    trigger: '',
    strength: 0.9,
    works: ['text', 'frames'],
    what: 'A first-person camera on someone’s head, bobbing as they walk, hands in view.',
    how: 'Write the shot as first-person: "first-person view, walking through…".',
    use: 'shot'
  },
  {
    id: 'rec-orbit-360',
    name: '360° Orbit',
    author: 'pablodawson',
    page: 'https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA',
    licence: H3_LICENCE,
    match: 'minimax_h3_flf2v_lora_v1.safetensors',
    url: hf('pablodawson/MiniMax-H3-360-Orbit-LoRA', '5ddbc2dbbe95edbbdaf5017c3e934b1d01791697', 'minimax_h3_flf2v_lora_v1.safetensors'),
    sha256: '14f13e3effaf3e729fdc0c97680344aa63f473be0c55963f963d718b3db2a4d4',
    size: 155111424,
    trigger: '',
    strength: 1,
    works: ['frames'],
    what: 'One photo becomes a frozen moment with the camera going all the way round and landing back where it began.',
    how: 'First / last frame mode with the same picture as both frames. Say only the camera moves and everything stays frozen.',
    use: 'shot'
  },
  {
    id: 'rec-transformation',
    name: 'Transformation',
    author: 'Ashmotv',
    page: 'https://huggingface.co/Ashmotv/transformation_lora',
    licence: H3_LICENCE,
    match: 'Transformation_style_c1-st2500_comfyui.safetensors',
    url: hf('Ashmotv/transformation_lora', '8f5dda7f25bcfe8d37c429bbe6b37f31f4b2e130', 'Transformation_style_c1-st2500_comfyui.safetensors'),
    sha256: '42d7d7468db7e5a3b9946df7728eb63e6b71d122511cfa8b09f23cb06048e1b9',
    size: 37297968,
    trigger: 'Tr@nsf0rmation_style',
    strength: 1,
    works: ['frames', 'text'],
    what: 'One picture morphs into another, piece by piece: a tomato into a cartoon boy, pencil lines into a painting.',
    how: 'First / last frame mode with two pictures. Start with "Tr@nsf0rmation_style, Picture 1 Tr@nsf0rmation into Picture 2".',
    use: 'shot'
  },
  {
    id: 'rec-turnaround',
    name: 'Turnaround',
    author: 'matlod',
    page: 'https://huggingface.co/matlod/minimax-h3-turnaround',
    licence: H3_LICENCE,
    match: 'minimax_h3_five_view_512_s1500.safetensors',
    url: hf('matlod/minimax-h3-turnaround', '791cceae539e19b297c08e26ff9d8246d231b89a', 'minimax_h3_five_view_512_s1500.safetensors'),
    sha256: '9bc12ae97d2076b3449f8b1feca1fff52252576d608a84e4625497644f265d35',
    size: 63103776,
    trigger: '',
    strength: 1.3,
    works: [],
    what: 'Five views of a character, turning around, from one picture: a character sheet.',
    how: 'Used by Characters → Turnaround sheet, with the H3 Contact Sheet node pack. Not for normal shots: it breaks their motion.',
    use: 'turnaround'
  }
]
// Each downloads into ComfyUI's loras\MiniMax H3\Recommended folder.
export const recommendedManifest = () => ({ models: RECOMMENDED.map((r) => ({ id: r.id, label: r.name, match: r.match, folder: 'loras/MiniMax H3/Recommended', url: r.url, size: r.size, sha256: r.sha256 })) })
export const MODE_LABEL = { text: 'Text', frames: 'First / last frame', reference: 'References' }
// The LoRA files ComfyUI lists that are one of these (by file name, in any folder).
export function recommendedOnDisk(loraNames = []) {
  const out = {}
  for (const r of RECOMMENDED) {
    const hit = loraNames.find((n) => n.split(/[\\/]/).pop() === r.match)
    if (hit) out[r.id] = hit
  }
  return out
}
