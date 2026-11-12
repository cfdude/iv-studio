// The accent colour (Settings → Accessibility → Colour, and the welcome wizard's first page): red, blue, purple, orange
// or Dark (greys only). Red is the house colour
// and the default. Each choice sets data-accent on <html>: styles.css swaps the accent variables every red in the
// interface reads, and shifts the artwork's hue to match, so no picture is redrawn. The canvas stages read RED and
// PINK from MotionCanvas, which are changed in place here.
import { PINK, RED } from './components/MotionCanvas'

export const ACCENTS = [
  { id: 'red', label: 'Red', hex: '#f44859', rgb: [244, 72, 89], pink: [241, 157, 172] },
  { id: 'blue', label: 'Blue', hex: '#3d8bff', rgb: [61, 139, 255], pink: [156, 196, 255] },
  { id: 'purple', label: 'Purple', hex: '#a06bff', rgb: [160, 107, 255], pink: [205, 182, 255] },
  { id: 'orange', label: 'Orange', hex: '#ff7a2f', rgb: [255, 122, 47], pink: [255, 189, 143] },
  // no colour: greys and white, the artwork in black and white
  { id: 'mono', label: 'Dark', hex: '#77747e', rgb: [150, 147, 158], pink: [207, 204, 214] }
]
export const accentOf = (id) => ACCENTS.find((a) => a.id === id) || ACCENTS[0]

export function applyAccent(id) {
  const a = accentOf(id)
  const root = document.documentElement
  if (a.id === 'red') delete root.dataset.accent
  else root.dataset.accent = a.id
  RED.splice(0, 3, ...a.rgb)
  PINK.splice(0, 3, ...a.pink)
}
