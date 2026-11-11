// What the person has picked on the page they're on, for the chat: pages say what's selected (the version on a shot,
// the clip and playhead in the editor, the item open in the Library viewer, how Create is set up), and the chat sends
// it with each message (ChatPanel.jsx), so "this", "that clip" and "why is it so dark" mean what's in front of them.
// Plain words and paths only; it's read when a message is sent, never stored.
import { useEffect } from 'react'

const current = new Map()

let told = null
export function setSelection(area, data) {
  if (data && Object.keys(data).length) current.set(area, { ...data, at: Date.now() })
  else current.delete(area)
  // a chat in its own window hears about it (App.jsx), at most every 400 ms
  clearTimeout(told)
  told = setTimeout(() => window.dispatchEvent(new Event('iv:selection')), 400)
}

// The selection for the page that's showing (an area is a page name, or 'viewer' for the Library's pop-up over
// any page, which wins while it's open).
export function selectionFor(page) {
  const viewer = current.get('viewer')
  const own = current.get(page)
  const pick = viewer || own
  if (!pick) return null
  const { at, ...rest } = pick
  return rest
}

// A page's selection while it's mounted: set on every change, cleared when the page goes.
export function useSelection(area, data, deps) {
  useEffect(() => {
    setSelection(area, data)
  }, deps)
  useEffect(() => () => setSelection(area, null), [])
}
