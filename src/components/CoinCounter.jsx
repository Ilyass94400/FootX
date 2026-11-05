import { useEffect, useRef, useState } from 'react'
import { useWallet } from '../lib/economy'
import { fmtCoins } from '../lib/economy/config'
import './coins.css'

// Compteur de X-Coins du header : effet "odomètre" (chaque chiffre roule jusqu'à sa valeur),
// halo vert/rouge et montant qui s'envole à chaque mouvement d'argent.
export default function CoinCounter({ onClick }) {
  const { balance, mode } = useWallet()
  const prev = useRef(null)
  const [delta, setDelta] = useState(null) // { v, key }
  const [tone, setTone] = useState('')

  useEffect(() => {
    if (balance == null) return
    if (prev.current != null && balance !== prev.current) {
      const v = balance - prev.current
      setDelta({ v, key: Date.now() })
      setTone(v > 0 ? 'up' : 'down')
      const t = setTimeout(() => setTone(''), 1100)
      prev.current = balance
      return () => clearTimeout(t)
    }
    prev.current = balance
  }, [balance])

  return (
    <button className={'cc-wallet ' + tone} onClick={onClick} title={mode === 'demo' ? 'X-Coins (mode démo local)' : 'X-Coins'} aria-label={`${balance ?? 0} X-Coins`}>
      <CoinIcon className="cc-coin" spin={!!tone} />
      <Odometer value={balance ?? 0} />
      {delta && (
        <span key={delta.key} className={'cc-delta ' + (delta.v > 0 ? 'up' : 'down')}>
          {delta.v > 0 ? '+' : '−'}{fmtCoins(Math.abs(delta.v))}
        </span>
      )}
    </button>
  )
}

// Chaque chiffre est une colonne 0-9 qui glisse. Les colonnes sont indexées depuis la droite
// pour que l'apparition d'un nouveau chiffre (999 → 1 000) ne fasse pas sauter les autres.
export function Odometer({ value }) {
  const chars = fmtCoins(value).split('')
  let digitIndex = 0
  const total = chars.filter((c) => /\d/.test(c)).length
  return (
    <span className="cc-odo" aria-hidden="true">
      {chars.map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={'s' + i} className="cc-sep">{ch === ' ' || ch === ' ' ? ' ' : ch}</span>
        const pos = total - digitIndex++
        const d = +ch
        return (
          <span key={'d' + pos} className="cc-col">
            <span className="cc-strip" style={{ transform: `translateY(${-d * 10}%)` }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <span key={n}>{n}</span>)}
            </span>
          </span>
        )
      })}
    </span>
  )
}

export function CoinIcon({ className = '', spin = false }) {
  return (
    <svg className={className + (spin ? ' spin' : '')} viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true">
      <defs>
        <radialGradient id="ccg" cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff6c2" />
          <stop offset=".45" stopColor="#f5c542" />
          <stop offset="1" stopColor="#a8740f" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="#7a5208" />
      <circle cx="16" cy="15.2" r="14" fill="url(#ccg)" />
      <circle cx="16" cy="15.2" r="10.6" fill="none" stroke="#a8740f" strokeWidth="1.2" opacity=".7" />
      <path d="M11 10l10 10.4M21 10L11 20.4" stroke="#7a5208" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M11 9.4l10 10.4M21 9.4L11 19.8" stroke="#fff3b0" strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
    </svg>
  )
}
