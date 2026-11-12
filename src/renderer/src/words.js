// Simple words: a setting (settings.plainWords) for people new to AI video and pictures. When it's on, the
// window's own text says things in plain words (LoRA becomes "trained look", seed "variation number", DLSS 5
// "quick sharpen"...). Only the words change: every control, page and default stays the same, and the real names
// stay in tooltips. It works on the window's text as shown, so names, prompts, file paths and other people's
// text (inputs, prompt boxes, LoRA names and descriptions, code) are left exactly as they are: see EXACT.
// Where a whole help line reads better rewritten by hand, the element holding it carries the plain version in
// data-plain (written next to the original in the component), and that is shown instead.
// plainText() is pure and is tested by test/words.mjs.

// whole labels that read better rewritten as a whole (matched on the trimmed text of one text node)
export const PHRASES = {
  LoRAs: 'Looks',
  RefMods: 'Reference packs',
  'Use RefMods': 'Use reference packs',
  Steps: 'Detail passes',
  Sampler: 'Drawing method',
  Scheduler: 'Step spacing',
  Seed: 'Variation number',
  'H3 + DLSS 5': 'Redraw + quick sharpen',
  'H3 + SeedVR2': 'Redraw + detail restore',
  'H3 strength': 'Redraw strength',
  'H3 size': 'Redraw size',
  'DLSS strength': 'Sharpen strength',
  'DLSS style': 'Sharpen look',
  'Then DLSS': 'Then sharpen',
  'SeedVR2 detail': 'Extra detail',
  'SeedVR2 size': 'Restore size',
  'Added detail': 'Extra detail',
  'RTX upscale': 'Double the size',
  Enhancer: 'Sharpener',
  'Enhance afterwards': 'Sharpen it later',
  'Prompt writer': 'Description writer',
  Hunt: 'Try',
  'Hunt again': 'Try again',
  Retention: 'How much it keeps',
  'Trigger word': 'Code word',
  'Trigger words': 'Code words',
  Checkpoints: 'Saved versions',
  'Frame generation': 'Smoother motion'
}

// words inside sentences, longest first; `cap` keeps a capital at the start of a sentence
const TERMS = [
  [/\bTrain a LoRA\b/g, 'Train a look'],
  [/\bLoRA strength\b/g, 'trained look strength'],
  [/\bLoRAs\b/g, 'trained looks'],
  [/\bLoRA\b/g, 'trained look'],
  [/\bRefMods\b/g, 'reference packs'],
  [/\bRefMod\b/g, 'reference pack'],
  [/\b[Cc]heckpoints\b/g, 'saved versions'],
  [/\b[Cc]heckpoint\b/g, 'saved version'],
  [/\b[Tt]rigger words\b/g, 'code words'],
  [/\b[Tt]rigger word\b/g, 'code word'],
  [/\b[Ss]eeds\b/g, 'variation numbers'],
  [/\b[Ss]eed\b/g, 'variation number'],
  [/\b[Ss]amplers\b/g, 'drawing methods'],
  [/\b[Ss]ampler\b/g, 'drawing method'],
  [/\b[Ss]chedulers\b/g, 'step spacings'],
  [/\b[Ss]cheduler\b/g, 'step spacing'],
  [/\bDLSS 5\b/g, 'quick sharpen'],
  [/\bDLSS\b/g, 'quick sharpen'],
  [/\bSeedVR2\b/g, 'detail restore'],
  [/\bRTX upscale\b/g, 'double size'],
  [/\b[Uu]pscalers\b/g, 'sharpeners'],
  [/\b[Uu]pscaler\b/g, 'sharpener'],
  [/\b[Uu]pscaled\b/g, 'enlarged'],
  [/\b[Uu]pscaling\b/g, 'enlarging'],
  [/\b[Uu]pscales\b/g, 'enlarges'],
  [/\b[Uu]pscale\b/g, 'enlarge'],
  [/\b[Ff]rame generation\b/g, 'smoother motion'],
  [/\b[Pp]rompts\b/g, 'descriptions'],
  [/\b[Pp]rompt\b/g, 'description'],
  [/\b[Aa]spect ratios\b/g, 'shapes'],
  [/\b[Aa]spect ratio\b/g, 'shape'],
  [/\bVRAM\b/g, 'graphics memory'],
  [/\bGPUs\b/g, 'graphics cards'],
  [/\bGPU\b/g, 'graphics card'],
  [/\bRAM\b/g, 'memory'],
  // already says ComfyUI: "ComfyUI node packs" is "ComfyUI add-ons", not "ComfyUI ComfyUI add-ons"
  [/\bComfyUI [Cc]ustom nodes\b/g, 'ComfyUI add-ons'],
  [/\bComfyUI [Nn]ode packs\b/g, 'ComfyUI add-ons'],
  [/\bComfyUI [Nn]ode pack\b/g, 'ComfyUI add-on'],
  [/\b[Cc]ustom nodes\b/g, 'ComfyUI add-ons'],
  [/\b[Nn]ode packs\b/g, 'ComfyUI add-ons'],
  [/\b[Nn]ode pack\b/g, 'ComfyUI add-on'],
  [/\bany MCP agent\b/g, 'any AI agent'],
  [/\bMCP agents\b/g, 'AI agents'],
  [/\bMCP agent\b/g, 'AI agent'],
  [/\bMCP servers?\b/g, 'agent link'],
  [/\bMCP\b/g, 'agent link'],
  [/\b[Tt]ext encoders?\b/g, 'text reader'],
  [/\bVAE\b/g, 'picture decoder'],
  [/\b[Dd]iffusion models?\b/g, 'main model'],
  [/\b[Ll]atents?\b/g, 'rough draft'],
  [/\b[Dd]enoise\b/g, 'redraw strength'],
  [/\bmodes and hunt\b/g, 'modes and takes'],
  [/\bthe hunt\b/g, 'the takes'],
  [/\bThe hunt\b/g, 'The takes'],
  [/\b[Hh]unting\b/g, 'trying takes'],
  [/\b[Hh]unts\b/g, 'tries'],
  [/\b[Hh]unt\b/g, 'try']
]

// a capital where the original word had one (Seed, Prompt), or at the start of the text or a sentence; names
// that are always written with capitals (LoRA, RefMod, DLSS, GPU) take one only from where they stand
function cased(original, plain, before) {
  const start = !before.trim() || /[.!?:·—–]\s*$/.test(before)
  const named = /^[A-Z][A-Za-z0-9]*[A-Z0-9]/.test(original)
  return start || (!named && /^[A-Z]/.test(original)) ? plain[0].toUpperCase() + plain.slice(1) : plain
}

export function plainText(text) {
  if (!text || !/[A-Za-z]/.test(text)) return text
  const trimmed = text.trim()
  if (Object.hasOwn(PHRASES, trimmed)) return text.replace(trimmed, PHRASES[trimmed])
  let out = text
  for (const [re, plain] of TERMS) {
    if (!re.test(out)) continue
    re.lastIndex = 0
    out = out.replace(re, (m, ...rest) => {
      const at = rest[rest.length - 2]
      const whole = rest[rest.length - 1]
      // "the hunt" keeps its own case: it's written out in the list
      if (/^the hunt$/i.test(m)) return plain
      return cased(m, plain, whole.slice(Math.max(0, at - 3), at))
    })
  }
  return out
}

// where the words are kept exactly: things people type, prompts, names, paths, code and other people's text
export const EXACT = [
  'input', 'textarea', 'select', 'option', 'pre', 'code', 'kbd', '[contenteditable]', '[data-words="exact"]', '.words-exact',
  '.prompt', '.run-prompt', '.prompt-diff', '.compare-diff', '.set-path', '.set-code', '.system-meter',
  '.lora-name', '.lora-desc', '.lora-tags', '.lora-words', '.lora-details-title', '.lora-full-prompt', '.lora-modal-file', '.lora-group-name', '.lora-chip-name',
  '.shot-name', '.shelf-name', '.tile-name', '.viewer-name', '.viewer-words', '.portrait-name', '.cast-chip-name', '.cast-modal-name', '.train-path-name'
].join(',')

// ---------- the window side: rewrite text nodes while the setting is on ----------
let on = false
let observer = null
const original = new WeakMap() // text node -> the text React wrote
const written = new WeakMap() // text node -> what we wrote over it
const ATTRS = ['placeholder', 'title', 'aria-label']

function skip(el) {
  return !el || !!el.closest?.(EXACT)
}
function plainFor(node, text) {
  const el = node.parentElement
  const alt = el?.getAttribute?.('data-plain')
  return alt && el.childNodes.length === 1 ? alt : plainText(text)
}
function fixText(node) {
  const now = node.nodeValue
  if (written.get(node) === now) return
  if (skip(node.parentElement)) return
  const plain = plainFor(node, now)
  original.set(node, now)
  if (plain === now) return written.delete(node)
  written.set(node, plain)
  node.nodeValue = plain
}
function fixAttrs(el) {
  if (skip(el)) return
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a)
    if (!v) continue
    const key = `data-words-${a}`
    if (el.getAttribute(key + '-plain') === v) continue
    const plain = plainText(v)
    if (plain === v) continue
    el.setAttribute(key, v)
    el.setAttribute(key + '-plain', plain)
    el.setAttribute(a, plain)
  }
}
function walk(root) {
  if (root.nodeType === 3) return fixText(root)
  if (root.nodeType !== 1 || skip(root)) return
  fixAttrs(root)
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? fixText(n) : fixAttrs(n)
}
function restore() {
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      if (written.has(n) && n.nodeValue === written.get(n)) n.nodeValue = original.get(n)
      written.delete(n)
    } else {
      for (const a of ATTRS) {
        const key = `data-words-${a}`
        if (!n.hasAttribute(key)) continue
        if (n.getAttribute(a) === n.getAttribute(key + '-plain')) n.setAttribute(a, n.getAttribute(key))
        n.removeAttribute(key)
        n.removeAttribute(key + '-plain')
      }
    }
  }
}

export function simpleWords() {
  return on
}
export function setSimpleWords(next) {
  next = !!next
  if (next === on) return
  on = next
  document.documentElement.classList.toggle('simple-words', on)
  if (on) {
    walk(document.body)
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') fixText(m.target)
        else if (m.type === 'attributes' && m.attributeName === 'data-plain') {
          // the hand-written line changed (another choice): show the new one over the text React wrote
          const t = m.target.firstChild
          if (t?.nodeType === 3 && written.has(t)) (written.delete(t), (t.nodeValue = original.get(t)))
          if (t?.nodeType === 3) fixText(t)
        } else if (m.type === 'attributes') fixAttrs(m.target)
        else m.addedNodes.forEach(walk)
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'data-plain'] })
  } else {
    observer?.disconnect()
    observer = null
    restore()
  }
  window.dispatchEvent(new CustomEvent('iv:words', { detail: on }))
}
