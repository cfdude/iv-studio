// A LoRA name is saved Windows-style ('MiniMax H3\tess\a.safetensors') and ComfyUI lists it with its own OS's
// separator, so a file path built from one has to split on both.
import path from 'node:path'

export const loraFilePath = (folder, name) => path.join(folder, ...String(name).replace(/\\/g, '/').split('/'))
