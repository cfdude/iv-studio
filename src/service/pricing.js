// What a ComfyUI graph costs before it runs. ComfyUI's partner (API) nodes run on the person's Comfy.org credits, and
// each one declares its price in /object_info as a `price_badge`: a JSONata expression over the node's widget values,
// which inputs are linked, and how many of a growing input group are filled. IV Studio evaluates the same expression
// for an API-form graph, so the confirm before a paid run shows the price ComfyUI's own window would show.
// (Written for IV Studio from how ComfyUI behaves; none of ComfyUI's front-end code is copied. JSONata is MIT.)
import jsonata from 'jsonata'
import { isLink, specDefault, specFor } from './nodeschema.js'

export { specDefault, specFor }

// Comfy.org sells 211 credits for $1 (ComfyUI's own front end uses the same rate).
export const CREDITS_PER_USD = 211
export const usdToCredits = (usd) => Math.round(usd * CREDITS_PER_USD)


// Nodes that only hold a value; a widget linked to one of these still has a known value.
const PRIMITIVES = new Set(['PrimitiveInt', 'PrimitiveFloat', 'PrimitiveString', 'PrimitiveStringMultiline', 'PrimitiveBoolean', 'PrimitiveNode'])

// The partner nodes of an API-form graph: [{ id, node, def }].
export function partnerNodes(graph, info) {
  return Object.entries(graph || {})
    .filter(([, n]) => n && info?.[n.class_type]?.api_node)
    .map(([id, node]) => ({ id, node, def: info[node.class_type] }))
}

// Widget values as the price expressions expect them: numbers for INT/FLOAT, booleans for BOOLEAN, and everything
// else (combos, strings, dynamic combos) trimmed and lower-cased.
export function normalize(raw, type) {
  if (raw === undefined || raw === null) return null
  const t = String(type || '').toUpperCase()
  if (t === 'INT' || t === 'FLOAT') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (t === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw
    const s = String(raw).trim().toLowerCase()
    return s === 'true' ? true : s === 'false' ? false : null
  }
  if (t === 'COMBO' && (typeof raw === 'number' || typeof raw === 'boolean')) return raw
  return String(raw).trim().toLowerCase()
}

// The value a node input has: written in the graph, through a primitive node, or the spec's default.
function valueOf(graph, node, def, name) {
  const v = node.inputs?.[name]
  if (isLink(v)) {
    const src = graph[String(v[0])]
    if (src && PRIMITIVES.has(src.class_type)) return src.inputs?.value ?? null
    return null
  }
  if (v !== undefined) return v
  return specDefault(specFor(def, name, node.inputs))
}

// The data a node's price expression reads: { widgets, inputs, inputGroups }.
export function priceContext(graph, node, def) {
  const dep = def.price_badge?.depends_on || {}
  const widgets = {}
  for (const w of dep.widgets || []) widgets[w.name] = normalize(valueOf(graph, node, def, w.name), w.type)
  const inputs = {}
  for (const name of dep.inputs || []) inputs[name] = { connected: isLink(node.inputs?.[name]) }
  const inputGroups = {}
  for (const g of dep.input_groups || []) inputGroups[g] = Object.entries(node.inputs || {}).filter(([k, v]) => k.startsWith(`${g}.`) && isLink(v)).length
  return { widgets, inputs, inputGroups }
}

const compiled = new Map()
function compile(expr) {
  if (!compiled.has(expr)) {
    let c = null
    try {
      c = jsonata(expr)
    } catch {}
    compiled.set(expr, c)
  }
  return compiled.get(expr)
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

// A price expression's answer as { min, max } in dollars, or { text } when it only says something in words or gives
// a rate ("$0.10/second", "$0.014 per 1K tokens": the total depends on what the run makes, so it can't be added up),
// or null when it gave nothing. "/Run" and "/Image" are whole prices.
export function readResult(r) {
  if (!r || typeof r !== 'object') return null
  const suffix = String(r.format?.suffix || '').trim()
  if (suffix && !/^\/(run|image)( \(1k\))?$/i.test(suffix)) {
    const vals = (Array.isArray(r.usd) ? r.usd : [r.usd ?? r.min_usd, r.max_usd]).map(num).filter((x) => x != null)
    if (!vals.length) return null
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return { text: `${money(lo)}${hi > lo ? `–${money(hi)}` : ''}${suffix.startsWith('/') ? suffix : ` ${suffix}`}`, rate: true }
  }
  if (!('type' in r) && 'usd' in r) {
    const u = num(r.usd)
    return u == null ? null : { min: u, max: u }
  }
  if (r.type === 'usd') {
    const u = num(r.usd)
    return u == null ? null : { min: u, max: u, approximate: !!r.format?.approximate, note: r.format?.note || r.format?.suffix || null }
  }
  if (r.type === 'range_usd') {
    const a = num(r.min_usd)
    const b = num(r.max_usd)
    return a == null || b == null ? null : { min: Math.min(a, b), max: Math.max(a, b), approximate: !!r.format?.approximate, note: r.format?.note || r.format?.suffix || null }
  }
  if (r.type === 'list_usd' && Array.isArray(r.usd)) {
    const vals = r.usd.map(num).filter((x) => x != null)
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), approximate: !!r.format?.approximate, note: r.format?.note || r.format?.suffix || null } : null
  }
  if (r.type === 'text' && typeof r.text === 'string') return { text: r.text }
  return null
}

// One partner node's price: { min, max } in dollars, or { unknown, why } when it can't be worked out.
export async function priceNode(graph, node, def) {
  const badge = def?.price_badge
  if (!badge || badge.engine !== 'jsonata' || !badge.expr) return { unknown: true, why: 'This node does not say what it costs.' }
  const expr = compile(badge.expr)
  if (!expr) return { unknown: true, why: 'Its price could not be read.' }
  let r
  try {
    r = await expr.evaluate(priceContext(graph, node, def))
  } catch {
    return { unknown: true, why: 'Its price could not be worked out.' }
  }
  const read = readResult(r)
  if (!read) return { unknown: true, why: 'Its price depends on settings that are not filled in.' }
  if (read.text) return { unknown: true, why: read.rate ? `Charged by use: ${read.text}` : read.text, text: read.text, rate: !!read.rate }
  return read
}

function money(usd) {
  return usd >= 0.1 || usd === 0 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4).replace(/0+$/, '')}`
}

// "about $1.67 · 352 credits" or "$3.29 to $29.40 · 694 to 6,203 credits"
export function priceLabel({ min, max, approximate = true }) {
  const c = (u) => usdToCredits(u).toLocaleString('en-US')
  if (Math.abs(max - min) < 0.005) return `${approximate ? 'about ' : ''}${money(max)} · ${c(max)} credits`
  return `${money(min)} to ${money(max)} · ${c(min)} to ${c(max)} credits`
}

// The whole graph: { paid, nodes, min, max, unknown, label }. `info` is ComfyUI's /object_info (or the part of it
// for the graph's classes). nodes: [{ id, class, title, min, max, unknown, why }].
export async function priceGraph(graph, info) {
  const list = partnerNodes(graph, info)
  const nodes = []
  for (const { id, node, def } of list) {
    const p = await priceNode(graph, node, def)
    nodes.push({ id, class: node.class_type, title: node._meta?.title || def.display_name || node.class_type, ...p, ...(p.unknown ? {} : { min: round(p.min), max: round(p.max) }) })
  }
  const known = nodes.filter((n) => !n.unknown)
  const min = known.reduce((a, n) => a + n.min, 0)
  const max = known.reduce((a, n) => a + n.max, 0)
  const unknown = nodes.filter((n) => n.unknown)
  const paid = nodes.length > 0
  let label = paid ? priceLabel({ min, max }) : 'Free: no paid nodes'
  if (paid && unknown.length) label = known.length ? `${label}, plus ${unknown.length} node${unknown.length === 1 ? '' : 's'} with no price shown` : 'Price not shown by these nodes'
  return { paid, nodes, min: round(min), max: round(max), credits: { min: usdToCredits(min), max: usdToCredits(max) }, unknown: unknown.map((n) => n.title), label }
}

const round = (x) => Math.round(x * 10000) / 10000

// Throws unless a paid graph has the person's OK for at least its price. spend: { approvedUsd, unknownOk } from the
// confirm (or an agent's confirm_cost). The top of a range is what has to be agreed to.
export function checkSpend(price, spend) {
  if (!price?.paid) return true
  if (!spend) throw Object.assign(new Error(`This uses paid Comfy.org nodes (${price.label}). Confirm the price before running it.`), { code: 'needs_confirm', price })
  if (price.unknown.length && !spend.unknownOk) throw Object.assign(new Error(`${price.unknown.join(', ')} ${price.unknown.length === 1 ? 'does' : 'do'} not show a price. Confirm running without one first.`), { code: 'needs_confirm', price })
  const agreed = Number(spend.approvedUsd)
  if (!(agreed >= price.max - 0.005)) throw Object.assign(new Error(`This costs up to $${price.max.toFixed(2)}; only $${(Number.isFinite(agreed) ? agreed : 0).toFixed(2)} was agreed to.`), { code: 'needs_confirm', price })
  return true
}

// ComfyUI's /object_info for just the classes a graph uses (asked once each, then cached on the client).
export async function infoFor(comfy, graph) {
  comfy._info ||= {}
  const classes = [...new Set(Object.values(graph || {}).map((n) => n?.class_type).filter(Boolean))]
  await Promise.all(
    classes
      .filter((c) => !(c in comfy._info))
      .map(async (c) => {
        try {
          const r = await comfy.objectInfo(c)
          comfy._info[c] = r?.[c] || null
        } catch {
          comfy._info[c] = null
        }
      })
  )
  return Object.fromEntries(classes.map((c) => [c, comfy._info[c]]))
}
