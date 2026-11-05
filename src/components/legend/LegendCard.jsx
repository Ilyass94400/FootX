import { useMemo } from 'react'
import HeroCard from '../HeroCard'
import { getBorderColor } from '../../lib/rarity'
import './legend.css'

// Carte évolutive : plus la Légende monte de niveau, plus la carte se charge
// (holo → particules → flammes dorées → arc-en-ciel + éclairs).
export default function LegendCard({ card, aura = '#ff6a2b', level, size, pulse = 0, tilt = true, badge = 'Carrière' }) {
  const r = String(card?.rarity || 'commune').toLowerCase()
  const parts = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    x: (i * 37) % 100, d: (i * 0.37) % 3, s: 0.6 + ((i * 13) % 10) / 10, t: 2.4 + ((i * 7) % 10) / 6,
  })), [])
  return (
    <div className={'lc lc-' + r} style={{ '--au': aura, '--cc': getBorderColor(r), width: size }}>
      <div className="lc-aura" aria-hidden="true"><i /><i /><i /></div>
      <div className="lc-flames" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--k': i }} />)}</div>
      <div key={pulse} className={'lc-card' + (pulse ? ' pulse' : '')}>
        <HeroCard card={card} tilt={tilt}>
          <span className="lc-badge">{badge}</span>
          {level != null && <span className="lc-level"><small>NIV</small>{level}</span>}
          <span className="lc-holo" aria-hidden="true" />
        </HeroCard>
      </div>
      <div className="lc-parts" aria-hidden="true">
        {parts.map((p, i) => <i key={i} style={{ left: p.x + '%', animationDelay: p.d + 's', animationDuration: p.t + 's', '--s': p.s }} />)}
      </div>
      {r === 'iconique' && <div className="lc-bolts" aria-hidden="true"><i /><i /></div>}
    </div>
  )
}
