// Settings → Accessibility: classes on <html> that styles.css answers (text size is the window's zoom, in main).
//   hc  higher contrast text: grey secondary text close to white, stronger lines
//   rm  reduce motion: no animations, transitions or moving stages
//   fr  clear focus outlines: a thick ring on whatever the keyboard is on
//   ul  underline links
import { applyAccent } from './accent'

const CLASSES = { highContrast: 'hc', reduceMotion: 'rm', focusRings: 'fr', underlineLinks: 'ul' }
export function applyA11y(s = {}) {
  const root = document.documentElement
  for (const [key, cls] of Object.entries(CLASSES)) root.classList.toggle(cls, !!s[key])
  applyAccent(s.accent)
}
export function setContrast(on) {
  document.documentElement.classList.toggle('hc', !!on)
}
export const highContrast = () => document.documentElement.classList.contains('hc')
// motion that the reduce-motion setting stops, as well as the system's own setting
export const reducedMotion = () => document.documentElement.classList.contains('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches
