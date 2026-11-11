// Reading ComfyUI node definitions (/object_info) for API-form graphs. Newer nodes use dynamic combos: picking an
// option of `model` brings that option's own inputs, named with a dot ("model.resolution"), and growing input groups
// add numbered slots ("model.reference_images.image_1"). In API form every one of these is a flat key on the node.

const isLink = (v) => Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number'
export { isLink }

const scopeOf = (o) => ({ ...(o?.required || {}), ...(o?.optional || {}) })

// The input spec for a (possibly dotted) input name, following the dynamic combo the graph picked:
// "model.resolution" is the `resolution` input of whichever `model` option the node has.
export function specFor(def, name, inputs = {}) {
  const parts = name.split('.')
  let scope = scopeOf(def?.input)
  let prefix = ''
  for (let i = 0; i < parts.length; i++) {
    const spec = scope[parts[i]]
    if (!spec) return null
    const full = prefix ? `${prefix}.${parts[i]}` : parts[i]
    if (i === parts.length - 1) return spec
    if (spec[0] === 'COMFY_DYNAMICCOMBO_V3') {
      const options = spec[1]?.options || []
      const key = inputs[full] ?? options[0]?.key
      const picked = options.find((o) => o.key === key) || options[0]
      scope = scopeOf(picked?.inputs)
    } else if (spec[0] === 'COMFY_AUTOGROW_V3') {
      scope = scopeOf(spec[1]?.template?.input)
    } else return null
    prefix = full
  }
  return null
}

// A widget's default from its spec: an explicit default, else the first option.
export function specDefault(spec) {
  if (!spec) return null
  const o = spec[1]
  if (o && typeof o === 'object' && 'default' in o) return o.default
  if (Array.isArray(o?.options) && o.options.length) return typeof o.options[0] === 'object' && o.options[0] ? o.options[0].key : o.options[0]
  if (Array.isArray(spec[0]) && spec[0].length) return spec[0][0]
  return null
}

// Types that are values typed into the node (widgets), not connections from another node.
const WIDGET = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO', 'COMFY_DYNAMICCOMBO_V3'])
const isWidget = (spec) => !!spec && (Array.isArray(spec[0]) || (WIDGET.has(spec[0]) && !spec[1]?.forceInput))

// Fills in every required widget a node's inputs leave out, with its default, following the dynamic combos the
// inputs pick (and the defaults of combos they don't). Connections and optional inputs are left alone.
export function fillDefaults(def, inputs = {}) {
  const out = { ...inputs }
  const walk = (o, prefix) => {
    for (const [name, spec] of Object.entries(o?.required || {})) {
      const full = prefix ? `${prefix}.${name}` : name
      if (!isWidget(spec)) continue
      if (out[full] === undefined) out[full] = specDefault(spec)
      if (spec[0] === 'COMFY_DYNAMICCOMBO_V3') {
        const picked = (spec[1]?.options || []).find((x) => x.key === out[full])
        if (picked) walk(picked.inputs, full)
      }
    }
    // optional dynamic combos that were given a value still need their own required inputs
    for (const [name, spec] of Object.entries(o?.optional || {})) {
      const full = prefix ? `${prefix}.${name}` : name
      if (spec[0] === 'COMFY_DYNAMICCOMBO_V3' && out[full] !== undefined) {
        const picked = (spec[1]?.options || []).find((x) => x.key === out[full])
        if (picked) walk(picked.inputs, full)
      }
    }
  }
  walk(def?.input, '')
  return out
}

// What a node still needs: required inputs (widgets or connections) that are missing, as dotted names.
export function missingInputs(def, inputs = {}) {
  const missing = []
  const walk = (o, prefix) => {
    for (const [name, spec] of Object.entries(o?.required || {})) {
      const full = prefix ? `${prefix}.${name}` : name
      if (spec[0] === 'COMFY_AUTOGROW_V3') continue
      if (inputs[full] === undefined) missing.push(full)
      else if (spec[0] === 'COMFY_DYNAMICCOMBO_V3') {
        const picked = (spec[1]?.options || []).find((x) => x.key === inputs[full])
        if (!picked) missing.push(`${full} (no option "${inputs[full]}")`)
        else walk(picked.inputs, full)
      }
    }
  }
  walk(def?.input, '')
  return missing
}
