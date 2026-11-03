import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { getBorderColor } from '../lib/rarity'
import { roleOf, cardRating } from '../lib/collectif'
import { useTeam } from '../lib/useTeam'
import PlayerCard from '../components/PlayerCard'
import './team.css'

// BROUILLON du Team Builder : compo 5 titulaires + score de Collectif en direct.
// Le "pool" ici = un échantillon de la table cards. Dans le jeu, remplace la requête
// par la collection possédée du joueur (ex: table user_cards filtrée sur session.user.id).
export default function Team({ session }) {
  const [pool, setPool] = useState([])
  const [q, setQ] = useState('')
  const t = useTeam()

  useEffect(() => {
    // TODO jeu réel : .from('user_cards').select('cards(*)').eq('user_id', session.user.id)
    supabase.from('cards').select('*').limit(80).then(({ data }) => setPool(data || []))
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return pool.filter((c) => !s || c.name?.toLowerCase().includes(s) || c.club?.toLowerCase().includes(s))
  }, [pool, q])

  const c = t.collectif

  return (
    <div className="team-page">
      <header className="team-head">
        <div>
          <h1>Composition</h1>
          <p className="sub">5 titulaires · 1 gardien, 2 déf/milieux, 2 attaquants</p>
        </div>
        <div className="collectif-badge" data-valid={c.valid}>
          <span className="lbl">Collectif</span>
          <b>{c.collectif}</b>
          <small>{c.valid ? 'équipe complète' : `${c.filled}/5 placés`}</small>
        </div>
      </header>

      <div className="team-layout">
        {/* Terrain */}
        <section className="pitch-col">
          <div className="formation">
            {t.slots.map((slot) => {
              const card = t.team[slot.id]
              const color = card ? getBorderColor(card.rarity) : 'var(--border)'
              return (
                <button key={slot.id} className={'slot-card' + (card ? ' filled' : '')}
                  style={{ '--c': color }} onClick={() => card && t.removeFrom(slot.id)}
                  title={card ? 'Retirer' : slot.label}>
                  {card ? (
                    <>
                      <span className="rt">{cardRating(card)}</span>
                      <span className="nm">{card.name}</span>
                      <span className="cl">{card.club}</span>
                      <span className="x">✕</span>
                    </>
                  ) : (
                    <span className="placeholder">{slot.label}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="breakdown">
            <Stat label="Note moyenne" value={c.note} />
            <Stat label="Alchimie" value={c.alchimie} suffix="%" />
            <Stat label="Rareté" value={c.rarete} suffix="%" />
            <div className="links">
              <span>🔗 Club ×{c.links.club}</span>
              <span>🌍 Pays ×{c.links.country}</span>
            </div>
          </div>
        </section>

        {/* Collection */}
        <section className="pool-col">
          <div className="pool-head">
            <input className="search" placeholder="Chercher un joueur ou un club…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="pool-actions">
              <button className="mini" onClick={() => t.fill(pool)}>Auto</button>
              <button className="mini ghost" onClick={t.clear}>Vider</button>
            </div>
          </div>
          <div className="pool-grid">
            {filtered.map((card) => (
              <button key={card.id} className={'pool-item role-' + roleOf(card.position) + (t.isInTeam(card) ? ' used' : '')}
                onClick={() => t.place(card)} title={`${card.name} · ${card.position}`}>
                <PlayerCard card={card} small />
                <span className="role-tag">{roleOf(card.position)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="muted">Aucune carte — ouvre des boosters pour agrandir ta collection.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, suffix = '' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className="bar"><i style={{ width: Math.min(100, value) + '%' }} /></div>
      <b>{value}{suffix}</b>
    </div>
  )
}
