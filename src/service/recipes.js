// Recipes: something that worked in IV Studio's chat, saved as a one-click button on the Dashboard ("save this as a
// recipe"). A recipe is the request, written once by the agent so it stands on its own ("a 15 second vertical teaser
// from my latest finished shot", never ids from one day), and pressing the button sends it to the chat again.
// recipes.json in the data folder.
import fs from 'node:fs'
import path from 'node:path'

export const MAX_RECIPES = 24
const FILE = 'recipes.json'
const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max)

export function listRecipes(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8'))
    return Array.isArray(j.recipes) ? j.recipes : []
  } catch {
    return []
  }
}
function write(dataDir, recipes) {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, FILE)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ recipes }, null, 1))
  fs.renameSync(`${file}.tmp`, file)
  return recipes
}

// Saves a recipe: name (the button's words) and instruction (what the agent is asked). The same name replaces the old
// one. Returns the recipe.
export function saveRecipe(dataDir, { name, instruction, note = '' }, now = new Date()) {
  const n = clean(name, 60)
  const ins = String(instruction || '').trim().slice(0, 2000)
  if (!n) throw new Error('A recipe needs a short name for its button.')
  if (ins.length < 10) throw new Error('A recipe needs the request itself, written so it works on its own another day.')
  const all = listRecipes(dataDir)
  const old = all.find((r) => r.name.toLowerCase() === n.toLowerCase())
  if (!old && all.length >= MAX_RECIPES) throw new Error(`There are already ${MAX_RECIPES} recipes. Ask the person which one to remove first.`)
  const recipe = { id: old?.id || `r${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: n, instruction: ins, note: clean(note, 200), createdAt: old?.createdAt || now.toISOString(), updatedAt: now.toISOString() }
  write(dataDir, old ? all.map((r) => (r.id === old.id ? recipe : r)) : [...all, recipe])
  return recipe
}

export function removeRecipe(dataDir, id) {
  const all = listRecipes(dataDir)
  if (!all.some((r) => r.id === id)) throw new Error('No such recipe.')
  write(dataDir, all.filter((r) => r.id !== id))
  return { removed: id }
}
