// A failed render in plain words. ComfyUI's own message ("KSampler: Allocation on device…") says what broke
// in its terms; this says what happened, why, and what to do about it, with a button for each fix the app can
// take the person to. The original message is always kept and shown under "Details".
//
// explainFailure(text, { where, kind }) -> { id, title, why, fixes: [{ id, label }], raw } or null when the
// message isn't one it knows (the page then shows the original message as before).
// where: 'local' or 'cloud'. kind: the job's kind (previews, finish, enhance…).
//
// Fix ids the window knows (components/Failure.jsx):
//   lower-memory  switch Speed to Low memory        open-setup     the Setup page
//   restart-comfy restart ComfyUI                   open-cloud     the Cloud page
//   comfy-account the Comfy account (credits)       free-space     the data folder in Settings
//   try-again     nothing to change: run it again

const RULES = [
  {
    id: 'memory',
    test: /out of memory|outofmemory|allocation on device|cuda error: out of memory|not enough (gpu )?memory|failed to allocate|mmap.*cannot allocate|DefaultCPUAllocator|paging file is too small/i,
    say: ({ where, kind }) => ({
      title: where === 'cloud' ? 'The cloud GPU ran out of memory' : 'Your graphics card ran out of memory',
      why:
        where === 'cloud'
          ? 'This render needed more memory than the GPU you picked has. A shorter shot, a smaller size or a bigger GPU will fit.'
          : kind === 'finish' || kind === 'enhance'
            ? 'Finishing at this size needs more memory than the card has free. A smaller finish (1 MP with the 2x upscale) gives nearly the same picture and fits smaller cards.'
            : 'This shot needed more memory than the card has free. Something else may be using it (a game, a browser, another AI app), or the size is too big for this card.',
      fixes: where === 'cloud' ? [{ id: 'open-cloud', label: 'Pick a bigger GPU' }] : [{ id: 'lower-memory', label: 'Use the Low memory preset' }, { id: 'restart-comfy', label: 'Restart ComfyUI to free memory' }]
    })
  },
  {
    id: 'missing-node',
    test: /node type .*(not found|does not exist)|missing_node_type|cannot execute because node|unknown node|node .* does not exist|class_type .* not found/i,
    say: () => ({
      title: 'A node pack is missing or didn’t load',
      why: 'This render uses a ComfyUI node that this ComfyUI doesn’t have. It’s either not installed yet, or it was installed and ComfyUI hasn’t been restarted since.',
      fixes: [{ id: 'open-setup', label: 'Open Setup' }, { id: 'restart-comfy', label: 'Restart ComfyUI' }]
    })
  },
  {
    id: 'missing-model',
    test: /value not in list|not in \[|no such file or directory.*\.(safetensors|gguf|ckpt|pt|pth|bin)|\.(safetensors|gguf|ckpt)\W.*(not found|missing|does not exist)|model .* not found|failed to load .*\.(safetensors|gguf)|filenotfounderror/i,
    say: () => ({
      title: 'A model file is missing',
      why: 'The render asked for a model or LoRA that isn’t in this ComfyUI’s folders. It may not be downloaded yet, or it was moved or renamed.',
      fixes: [{ id: 'open-setup', label: 'Check downloads in Setup' }]
    })
  },
  {
    id: 'disk-full',
    test: /no space left|enospc|disk (is )?full|not enough (disk )?space|there is not enough space on the disk/i,
    say: () => ({
      title: 'The drive is full',
      why: 'There was no room to save the render. Free some space on the drive ComfyUI saves to, or move IV Studio’s data to a bigger drive.',
      fixes: [{ id: 'free-space', label: 'Open storage settings' }]
    })
  },
  {
    id: 'credits',
    test: /insufficient (credits|balance|funds)|payment required|\b402\b|not enough credits|out of credits|credit balance/i,
    say: () => ({
      title: 'Not enough Comfy.org credits',
      why: 'This render runs on your Comfy.org credits and the balance didn’t cover it. Nothing was charged for the part that didn’t run.',
      fixes: [{ id: 'comfy-account', label: 'Open your Comfy account' }]
    })
  },
  {
    id: 'sign-in',
    test: /unauthori[sz]ed|\b401\b|invalid api key|api key (is )?(missing|invalid|expired)|please (log|sign) in|forbidden|\b403\b/i,
    say: ({ where }) => ({
      title: 'A sign-in or key was refused',
      why: where === 'cloud' ? 'Your cloud didn’t accept the request. Its sign-in may have expired.' : 'A service this render uses didn’t accept your key. It may be missing, mistyped or expired.',
      fixes: [where === 'cloud' ? { id: 'open-cloud', label: 'Open Cloud' } : { id: 'comfy-account', label: 'Check your Comfy account' }]
    })
  },
  {
    id: 'unreachable',
    test: /econnrefused|econnreset|enotfound|etimedout|fetch failed|socket hang up|network (error|request failed)|didn.t answer|did not answer|connection (refused|reset|closed)|bad gateway|\b50[234]\b|pod.*(asleep|stopped|not running)/i,
    say: ({ where }) => ({
      title: where === 'cloud' ? 'Your cloud GPU stopped answering' : 'ComfyUI stopped answering',
      why: where === 'cloud' ? 'The cloud machine went away while it was working. It may have shut down for being idle, or been stopped from its own website.' : 'ComfyUI closed or froze while it was rendering. Its own window usually says why.',
      fixes: where === 'cloud' ? [{ id: 'open-cloud', label: 'Open Cloud' }, { id: 'try-again', label: 'Try again' }] : [{ id: 'restart-comfy', label: 'Restart ComfyUI' }, { id: 'try-again', label: 'Try again' }]
    })
  },
  {
    id: 'moderation',
    test: /content (policy|moderation)|moderat(ed|ion)|safety (filter|system)|flagged|sensitive content|nsfw.*(blocked|detected)/i,
    say: () => ({
      title: 'The service refused this prompt',
      why: 'The model’s own content filter turned the request down. Rewording the prompt or using different pictures usually gets it through.',
      fixes: []
    })
  },
  {
    id: 'bad-input',
    test: /cannot identify image file|unidentifiedimageerror|invalid (image|video) file|moov atom not found|could not (open|read|decode)|failed to (open|read|decode)|corrupt/i,
    say: () => ({
      title: 'A picture or video couldn’t be read',
      why: 'One of the files this render uses is damaged, still downloading, or a kind ComfyUI can’t open. Pick it again, or use a PNG, JPG or MP4.',
      fixes: []
    })
  },
  {
    id: 'validation',
    test: /prompt_outputs_failed_validation|failed validation|invalid prompt|required input is missing|value .* (smaller|bigger) than (min|max)|return type mismatch/i,
    say: () => ({
      title: 'ComfyUI turned the render down before it started',
      why: 'A setting in this render isn’t one this ComfyUI accepts. That usually means ComfyUI or a node pack is older or newer than IV Studio expects.',
      fixes: [{ id: 'open-setup', label: 'Check for updates in Setup' }]
    })
  },
  {
    id: 'shape',
    test: /sizes of tensors must match|shape mismatch|mat1 and mat2 shapes cannot be multiplied|expected .* channels|size mismatch for/i,
    say: () => ({
      title: 'A model didn’t fit this render',
      why: 'A LoRA or model made for a different model family was used here, so the pieces didn’t line up. Take the last LoRA you added off and try again.',
      fixes: [{ id: 'try-again', label: 'Try again' }]
    })
  }
]

export function explainFailure(text, { where = 'local', kind = '' } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const rule = RULES.find((r) => r.test.test(raw))
  if (!rule) return null
  return { id: rule.id, ...rule.say({ where: where === 'cloud' ? 'cloud' : 'local', kind }), raw }
}

export const FAILURE_IDS = RULES.map((r) => r.id)
