import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ABUSE_EMAIL, H3_RULES, TERMS_URL } from '../../../service/terms'

// The notice for MiniMax H3's terms (terms.js, TERMS.md). The main process asks for it before the first H3 render or
// training (terms:ask) and waits for the answer; Settings › About and Check my PC open it with openH3Terms().
// <H3TermsHost /> is mounted once in App.
let show = null
// accepted: when they already have (Settings shows the rules again, with nothing to tick).
export function openH3Terms({ accepted = false } = {}) {
  return new Promise((resolve) => (show ? show({ mode: 'read', accepted, resolve }) : resolve(false)))
}

// Accepted or not, kept current for Settings and Check my PC.
export function useH3Terms() {
  const [state, setState] = useState(null)
  useEffect(() => {
    let live = true
    window.ivstudio.terms
      .state()
      .then((s) => live && setState(s))
      .catch(() => {})
    const off = window.ivstudio.terms.onChanged?.((s) => setState(s))
    return () => ((live = false), off?.())
  }, [])
  return state
}

export const reportMisuse = () => window.ivstudio.terms.report().catch(() => {})

export function H3TermsHost() {
  const [req, setReq] = useState(null)
  const [agree, setAgree] = useState(false)
  const okRef = useRef(null)
  useEffect(() => {
    show = (r) => (setAgree(false), setReq(r))
    // a render or training is waiting on the answer
    const off = window.ivstudio.terms.onAsk?.((q) => (setAgree(false), setReq({ mode: 'ask', what: q?.what })))
    // still waiting from before a reload of the window
    window.ivstudio.terms
      .state()
      .then((s) => s.asking && setReq((r) => r || { mode: 'ask', what: s.asking }))
      .catch(() => {})
    return () => ((show = null), off?.())
  }, [])
  useEffect(() => {
    if (!req) return
    // first in line, so Esc closes only this (not Check my PC or a tour underneath)
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      answer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])
  useEffect(() => {
    if (agree) okRef.current?.focus()
  }, [agree])

  async function answer(yes) {
    const r = req
    setReq(null)
    try {
      if (r.mode === 'ask') await window.ivstudio.terms.answer(!!yes)
      else if (yes) await window.ivstudio.terms.accept()
    } catch {}
    r.resolve?.(!!yes)
  }
  if (!req) return null
  const waiting = req.mode === 'ask'
  const done = !waiting && req.accepted
  const open = (url) => window.ivstudio.links.open(url)

  return createPortal(
    <div className="modal-backdrop h3-terms-backdrop" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="modal confirm h3-terms" role="dialog" aria-modal="true" aria-labelledby="h3-terms-title">
        <p className="mono label">MiniMax H3 · Terms of use</p>
        <h2 id="h3-terms-title">{waiting ? (req.what === 'training' ? 'Before you train on H3' : 'Before your first H3 render') : 'The rules for MiniMax H3'}</h2>
        <p className="confirm-message">
          IV Studio makes video with MiniMax H3. Using it means agreeing to IV Studio’s terms, which carry MiniMax’s own use restrictions. They apply to
          everything you make with H3, wherever you share it. You’re asked once.
        </p>
        <ol className="h3-terms-rules">
          {H3_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <p className="small dim h3-terms-credit">
          IV Studio is <strong>Powered by MiniMax H3</strong> and keeps that credit and MiniMax’s licence notice. Seen something that breaks these rules? Report it to{' '}
          <button className="link-btn" onClick={reportMisuse}>
            {ABUSE_EMAIL}
          </button>
          .
        </p>
        <div className="h3-terms-links">
          <button className="link-btn mono small" onClick={() => open(TERMS_URL)}>
            Read the full terms ↗
          </button>
          <button className="link-btn mono small" onClick={() => window.ivstudio.terms.openLicense().catch(() => {})}>
            MiniMax’s licence ↗
          </button>
        </div>
        {done ? (
          <p className="small h3-terms-done">✓ You agreed to these terms. They keep applying to everything you make with H3.</p>
        ) : (
          <label className="consent small h3-terms-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I’ve read these rules and agree to IV Studio’s terms for MiniMax H3.
          </label>
        )}
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn btn-small" onClick={() => answer(false)}>
            {waiting ? 'Not now' : 'Close'}
          </button>
          {!done && (
            <button ref={okRef} className="btn btn-small btn-primary" disabled={!agree} onClick={() => answer(true)}>
              {waiting ? 'Agree and continue' : 'Agree'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
