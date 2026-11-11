// IV Studio's terms for MiniMax H3 (TERMS.md). MiniMax's H3 licence (section V.2) asks that everyone who uses a product
// built on H3 is told its use restrictions apply and agrees to terms at least as protective. So before the first H3
// render (or H3 training) the person reads and accepts the notice once; accepting is saved in settings as
// h3Terms: { version, at }. A new TERMS_VERSION asks again.
//
// The check sits in Comfy.submit (every graph that loads H3) and in character training. The app and the MCP server each
// register a gate with setH3Gate: the app asks the window and waits for the answer; the MCP server refuses until the
// person has accepted in the app. With no gate registered (tests, scripts that drive the service directly) nothing is
// checked.

export const H3_TERMS_VERSION = '2026-11-10'
export const ABUSE_EMAIL = 'abuse@infinitevariance.ai'
export const TERMS_URL = 'https://github.com/hollisorg/iv-studio/blob/main/TERMS.md'
export const SAFEGUARDS_URL = 'https://github.com/hollisorg/iv-studio/blob/main/docs/SAFEGUARDS.md'
export const H3_LICENSE_URL = 'https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE'
export const REPORT_URL = `mailto:${ABUSE_EMAIL}?subject=${encodeURIComponent('IV Studio misuse report')}`

export const H3_TERMS_NEEDED =
  'MiniMax H3 needs your OK first: open IV Studio and agree to the terms for MiniMax H3 (Settings › About › Terms of use). It takes a moment and is asked only once.'
export const H3_TERMS_DECLINED = 'Not rendered: MiniMax H3 can only be used after agreeing to its terms (Settings › About › Terms of use).'

// The plain-words rules the notice shows; TERMS.md has them in full. Kept here so the window, the MCP server and the test
// read the same list.
export const H3_RULES = [
  'Follow the law where you are, and only use MiniMax H3 where its licence (or a licence you hold) allows.',
  'No one under 18: never make anything that sexualises, exploits or harms a minor.',
  'Real people only with their consent. Don’t impersonate anyone, or put a real person in a video or voice they didn’t agree to.',
  'No harassment, defamation, threats, hate or discrimination, and nothing that encourages violence, extremism or terrorism.',
  'No deception: no false information to harm people or sway elections, no fake reviews or fake engagement, and no scams.',
  'Say it’s AI: anything you post publicly must clearly say it was made with AI.',
  'Respect other people’s rights: no copying their work, characters, music, likeness or private information without permission.',
  'No malware, no military use, and no high-risk automated decisions about people (jobs, credit, housing, health, policing and so on).',
  'Don’t switch off, work around or weaken IV Studio’s safeguards or MiniMax’s.',
  'Don’t use H3 or what it makes to train or improve other AI models (H3 LoRAs and characters are fine).'
]

// Does this ComfyUI graph load or run MiniMax H3 (or a model built on it, such as Viggle Remake or an H3 LoRA)? MiniMax
// H3 Image and MiniMax Music 3 are separate models under their own licences and don't count.
const H3_NODE = /^(MiniMaxH3|MinimaxH3)/
const H3_IMAGE_NODE = /^MiniMaxH3Image(?!ToVideo)/ // MiniMaxH3ImageConditioning; MiniMaxH3ImageToVideo is H3 video
const H3_FILE = /minimax[ _-]?h3(?![ _-]?image)|viggle[ _-]?remake|_mmh3|mmh3[-_]|(^|[\\/])MiniMax H3[\\/]/i
export function usesH3(prompt) {
  if (!prompt || typeof prompt !== 'object') return false
  for (const node of Object.values(prompt)) {
    const cls = String(node?.class_type || '')
    if (H3_NODE.test(cls) && !H3_IMAGE_NODE.test(cls)) return true
    for (const v of Object.values(node?.inputs || {})) if (typeof v === 'string' && H3_FILE.test(v)) return true
  }
  return false
}

export function termsAccepted(settings) {
  return settings?.h3Terms?.version === H3_TERMS_VERSION
}

export function acceptance() {
  return { version: H3_TERMS_VERSION, at: new Date().toISOString() }
}

let gate = null
// fn(what): resolves when the person has accepted, throws otherwise. what: 'render' or 'training'.
export function setH3Gate(fn) {
  gate = fn
}

// prompt: a ComfyUI graph (checked only if it uses H3), or null for work that always uses H3 (training).
export async function checkH3Terms(prompt, what = 'render') {
  if (!gate) return
  if (prompt && !usesH3(prompt)) return
  await gate(what)
}
