import { useState } from 'react'
import { HELP } from '../lib/help'
import './pagehelp.css'

// Petite aide repliable : « ? Comment ça marche » → 3-4 conseils courts.
// L'état ouvert/fermé est retenu par page.
const KEY = 'footx_help_open'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }

const rich = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))

export default function PageHelp({ topic, className = '' }) {
  const h = HELP[topic]
  const [open, setOpen] = useState(() => !!read()[topic])
  if (!h) return null
  const toggle = () => {
    const v = !open
    setOpen(v)
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [topic]: v })) } catch { /* rien */ }
  }
  return (
    <div className={'ph' + (open ? ' open' : '') + (className ? ' ' + className : '')}>
      <button className="ph-btn" onClick={toggle} aria-expanded={open}>
        <i aria-hidden="true">?</i>{h.title}<span className="ph-chev" aria-hidden="true" />
      </button>
      {open && (
        <ul className="ph-tips">
          {h.tips.map((t, i) => <li key={i} style={{ '--i': i }}>{rich(t)}</li>)}
        </ul>
      )}
    </div>
  )
}
