import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOwned } from '../lib/collection'
import { getBorderColor, RARITIES, RARITY_LABEL } from '../lib/rarity'
import { roleOf, cardRating, fitsSlot, SLOTS } from '../lib/collectif'
import { useTeam } from '../lib/useTeam'
import { CHEM_EFFECT, RARITY_CAP, canPlace, previewPlacement, rarityCount, MAX_TEAM_CHEM } from '../lib/chemistry'
import { warpTo } from '../lib/warp'
import { track } from '../lib/quests'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './team.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Team Builder de l'Arène — demi-terrain 5v5, liens de Collectif, plafonds de rareté.
// Collection : uniquement les cartes que le joueur POSSÈDE (une par joueur, doublons regroupés).
// En ligne, le serveur refuse aussi toute carte non possédée (squad_save).
// ============================================================================

// Positions sur le demi-terrain (en % ; on attaque vers le haut).
const POS = { A1: { x: 27, y: 18 }, A2: { x: 73, y: 18 }, D1: { x: 21, y: 50 }, D2: { x: 79, y: 50 }, GK: { x: 50, y: 81 } }
const SLOT_LABEL = { GK: 'Gardien', D1: 'Déf / Milieu', D2: 'Déf / Milieu', A1: 'Attaquant', A2: 'Attaquant' }
const PICK_TITLE = { GK: 'Choisis ton gardien', D1: 'Choisis un défenseur ou milieu', D2: 'Choisis un défenseur ou milieu', A1: 'Choisis un attaquant', A2: 'Choisis un attaquant' }
const LINK_TXT = (l) => (l.club && l.country ? 'Club + Pays' : l.club ? 'Club' : l.country ? 'Pays' : 'Aucun lien')
const TONE = (v) => (v >= 2 ? 'green' : v === 1 ? 'yellow' : 'red')
const RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]))
const PAGE = 48

export default function Team() {
  const owned = useOwned()
  const pool = useMemo(() => {
    if (!owned) return null
    const m = new Map()
    for (const it of owned.items) if (it.card && !m.has(String(it.card.id))) m.set(String(it.card.id), it.card)
    return [...m.values()]
  }, [owned])
  const t = useTeam()
  const [active, setActive] = useState(null) // poste sélectionné
  const [hover, setHover] = useState(null) // carte survolée (aperçu des liens)
  const [q, setQ] = useState('')
  const [rar, setRar] = useState('all')
  const [sort, setSort] = useState('fit')
  const [limit, setLimit] = useState(PAGE)
  const [toast, setToast] = useState(null)
  const [blocked, setBlocked] = useState([]) // postes en cause (pulsent en rouge)
  const [shakeId, setShakeId] = useState(null)
  const [pop, setPop] = useState(null) // { slot, tone, delta, key }
  const fx = useRef(null)
  const lastPlaced = useRef(null)
  const toastTimer = useRef(0)

  const showError = useCallback((res, card) => {
    clearTimeout(toastTimer.current)
    setToast({ ...res, key: Date.now(), rarity: res.rarity })
    setBlocked(res.blockers || [])
    setShakeId(card?.id ?? null)
    try { navigator.vibrate?.(60) } catch { /* pas de vibreur */ }
    toastTimer.current = setTimeout(() => { setToast(null); setBlocked([]) }, 3200)
    setTimeout(() => setShakeId(null), 450)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const tryPlace = useCallback((slotId, card) => {
    if (!slotId || !card) return
    const res = t.assign(slotId, card)
    if (!res.ok) { showError(res, card); return }
    if (res.same) return
    const from = SLOTS.find((s) => t.team[s.id]?.id === card.id)?.id
    lastPlaced.current = { slots: [slotId, from].filter(Boolean), before: t.chemistry.total }
    setToast(null); setBlocked([]); setHover(null)
    // passe au poste vide suivant : zéro clic inutile
    const nextEmpty = SLOTS.find((s) => s.id !== slotId && !t.team[s.id] && s.id !== from)
    setActive(nextEmpty ? nextEmpty.id : null)
  }, [t, showError])

  // Effets de validation : étincelles sur les nouveaux liens, flash du poste, "+N collectif".
  useEffect(() => {
    const lp = lastPlaced.current
    if (!lp) return
    lastPlaced.current = null
    const ch = t.chemistry
    const delta = ch.total - lp.before
    const touched = ch.links.filter((l) => l.active && (lp.slots.includes(l.a) || lp.slots.includes(l.b)))
    touched.forEach((l, i) => {
      const x = (POS[l.a].x + POS[l.b].x) / 200
      const y = (POS[l.a].y + POS[l.b].y) / 200
      setTimeout(() => {
        if (l.value === 2) fx.current?.burst({ x, y, colors: ['#2ed573', '#b8ffcf', '#ffffff'], count: 46, speed: 8, kind: 'spark' })
        else if (l.value === 1) fx.current?.burst({ x, y, colors: ['#f7c948', '#fff3c4'], count: 18, speed: 5, kind: 'spark' })
        else fx.current?.burst({ x, y, colors: ['#ff4d5e'], count: 8, speed: 3, kind: 'glitter' })
      }, 180 + i * 90)
    })
    const s = lp.slots[0]
    const chem = ch.cards[s]?.chem ?? 0
    if (chem === 3) {
      const p = POS[s]
      setTimeout(() => fx.current?.burst({ x: p.x / 100, y: p.y / 100, colors: ['#2ed573', '#e4ff3c', '#ffffff'], count: 70, speed: 10, kind: 'mix' }), 420)
    }
    setPop({ slot: s, tone: TONE(chem >= 2 ? 2 : chem), delta, chem, key: Date.now() })
  }, [t.chemistry])

  // Défis "collectif" : meilleur collectif individuel et collectif d'équipe atteints
  useEffect(() => {
    const best = Math.max(0, ...SLOTS.map((s) => t.chemistry.cards[s.id]?.chem ?? 0))
    track('team_chem', best)
    if (SLOTS.every((s) => t.team[s.id])) track('team_chem_total', t.chemistry.total)
  }, [t.chemistry, t.team])

  // ---- collection filtrée / triée
  const view = useMemo(() => {
    if (!pool) return []
    const s = q.trim().toLowerCase()
    let list = pool.filter((c) => (!s || c.name?.toLowerCase().includes(s) || c.club?.toLowerCase().includes(s) || c.country?.toLowerCase().includes(s))
      && (rar === 'all' || String(c.rarity).toLowerCase() === rar)
      && (!active || fitsSlot(c, active)))
    const fitScore = (c) => (active ? previewPlacement(t.team, active, c).delta : 0)
    if (sort === 'fit' && active) {
      const sc = new Map(list.map((c) => [c.id, fitScore(c)]))
      list = [...list].sort((a, b) => sc.get(b.id) - sc.get(a.id) || cardRating(b) - cardRating(a))
    } else if (sort === 'rarity') list = [...list].sort((a, b) => (RANK[String(b.rarity).toLowerCase()] ?? 0) - (RANK[String(a.rarity).toLowerCase()] ?? 0) || cardRating(b) - cardRating(a))
    else list = [...list].sort((a, b) => cardRating(b) - cardRating(a))
    return list
  }, [pool, q, rar, active, sort, t.team])

  useEffect(() => setLimit(PAGE), [q, rar, active, sort])

  // aperçu des liens quand on survole une carte avec un poste sélectionné
  const preview = useMemo(() => (active && hover ? previewPlacement(t.team, active, hover).after : null), [active, hover, t.team])
  const shownChem = preview || t.chemistry
  const counts = rarityCount(t.team)
  const complete = SLOTS.every((s) => t.team[s.id])
  const ready = complete && t.validity.ok
  const ch = t.chemistry

  const onDropSlot = (slotId, e) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    const card = pool?.find((c) => String(c.id) === id) || SLOTS.map((s) => t.team[s.id]).find((c) => String(c?.id) === id)
    tryPlace(slotId, card)
  }

  return (
    <div className="tb">
      {/* ------------------------------------------------------------ en-tête */}
      <header className="tb-head">
        <div>
          <span className="tb-kicker">Arène · Format 5 contre 5</span>
          <h1>Mon équipe</h1>
          <p className="tb-sub">1 gardien · 2 déf/milieux · 2 attaquants. Lie tes joueurs par club et par pays.</p>
        </div>
        <div className="tb-actions">
          <button className="tb-btn ghost" onClick={() => pool && t.fill(pool)} disabled={!pool}>
            <Sparkle /> Compo auto
          </button>
          <button className="tb-btn ghost" onClick={() => { t.clear(); setActive('GK') }}>Vider</button>
          <button className={'tb-btn primary' + (ready ? ' ready' : '')} disabled={!ready}
            onClick={(e) => warpTo('match', { color: '#ff4d5e', x: e.clientX, y: e.clientY, label: "L'Arène" })}
            title={ready ? '' : !complete ? 'Complète tes 5 postes' : 'Respecte les limites de rareté'}>
            Jouer dans l'Arène <Arrow />
          </button>
        </div>
      </header>
      <PageHelp topic="equipe" />

      <div className="tb-layout">
        {/* ------------------------------------------------------------ terrain */}
        <section className="tb-pitch-wrap">
          <div className={'tb-pitch' + (active ? ' picking' : '')} onClick={(e) => { if (e.target === e.currentTarget) setActive(null) }}>
            <PitchLines />
            <svg className="tb-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {shownChem.links.map((l) => {
                const a = POS[l.a]
                const b = POS[l.b]
                const cls = 'tb-link ' + (l.active ? TONE(l.value) : 'off') + (preview ? ' preview' : '')
                return (
                  <g key={l.a + l.b} className={cls}>
                    <line className="glow" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
                    <line className="core" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
                    {l.active && l.value === 2 && <line className="flow" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />}
                  </g>
                )
              })}
            </svg>
            {shownChem.links.filter((l) => l.active).map((l) => (
              <span key={'t' + l.a + l.b} className={'tb-link-tag ' + TONE(l.value) + (preview ? ' preview' : '')}
                style={{ left: (POS[l.a].x + POS[l.b].x) / 2 + '%', top: (POS[l.a].y + POS[l.b].y) / 2 + '%' }}>
                {LINK_TXT(l)}
              </span>
            ))}

            {SLOTS.map((s) => (
              <Slot key={s.id} id={s.id} card={t.team[s.id]} info={shownChem.cards[s.id]} active={active === s.id}
                blocked={blocked.includes(s.id)} pop={pop?.slot === s.id ? pop : null} preview={!!preview && active === s.id ? hover : null}
                onSelect={() => setActive(active === s.id ? null : s.id)}
                onRemove={() => { t.removeFrom(s.id); setActive(s.id) }}
                onDrop={(e) => onDropSlot(s.id, e)} />
            ))}
            <PackFx ref={fx} ambient="rgba(228,255,60,.22)" />
          </div>
          <p className="tb-hint">{active ? 'Choisis une carte dans ta collection — ou glisse-la sur le poste.' : 'Clique sur un poste pour y placer une carte.'}</p>
        </section>

        {/* ------------------------------------------------------------ colonne */}
        <aside className="tb-side">
          <div className="tb-summary">
            <ChemRing total={ch.total} />
            <div className="tb-summary-r">
              <div className="tb-caps">
                <CapMeter label="Iconique" rarity="iconique" n={counts.iconique || 0} max={RARITY_CAP.iconique} flash={toast?.rarity === 'iconique'} />
                <CapMeter label="Légendaires" rarity="legendaire" n={counts.legendaire || 0} max={RARITY_CAP.legendaire} flash={toast?.rarity === 'legendaire'} />
              </div>
              <div className="tb-note"><span>Note moyenne</span><b>{t.collectif.note || '—'}</b></div>
              {!t.validity.ok && <div className="tb-invalid">{t.validity.errors.map((e) => e.message).join(' · ')}</div>}
            </div>
          </div>

          <Effects />

          <div className={'tb-coll' + (active ? ' open' : '')}>
            <div className="tb-coll-head">
              <div>
                <h2>{active ? PICK_TITLE[active] : 'Ma collection'}</h2>
                <span>{active ? 'Triées par meilleur lien avec tes joueurs' : 'Clique une carte pour la placer au premier poste libre'}</span>
              </div>
              {active && <button className="tb-close" onClick={() => setActive(null)} aria-label="Fermer">×</button>}
            </div>
            <div className="tb-filters">
              <input className="tb-search" placeholder="Joueur, club ou pays…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="tb-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
                <option value="fit">Meilleur lien</option>
                <option value="rating">Note</option>
                <option value="rarity">Rareté</option>
              </select>
            </div>
            <div className="tb-chips">
              <button className={'tb-chip' + (rar === 'all' ? ' on' : '')} onClick={() => setRar('all')}>Toutes</button>
              {RARITIES.map((r) => (
                <button key={r} className={'tb-chip' + (rar === r ? ' on' : '')} style={{ '--cc': getBorderColor(r) }} onClick={() => setRar(r)}>{RARITY_LABEL[r]}</button>
              ))}
            </div>
            <div className="tb-grid" onMouseLeave={() => setHover(null)}>
              {!pool && Array.from({ length: 8 }, (_, i) => <div key={i} className="tb-skel" />)}
              {view.slice(0, limit).map((card) => {
                const inTeam = SLOTS.some((s) => t.team[s.id]?.id === card.id)
                const target = active || SLOTS.find((s) => !t.team[s.id] && fitsSlot(card, s.id))?.id
                const can = target ? canPlace(t.team, target, card, fitsSlot) : { ok: true }
                const pv = active && !inTeam ? previewPlacement(t.team, active, card) : null
                return (
                  <CollCard key={card.id} card={card} inTeam={inTeam} locked={!can.ok && can.reason?.startsWith('cap')} pv={pv}
                    shake={shakeId === card.id}
                    onPick={() => (active ? tryPlace(active, card) : (target ? tryPlace(target, card) : showError({ title: roleOf(card.position) === 'GK' ? 'Ton gardien est déjà en place' : 'Plus de poste libre ici', message: 'Clique d\'abord sur le poste à remplacer.' }, card)))}
                    onHover={() => setHover(card)} />
                )
              })}
              {pool && view.length === 0 && <p className="tb-empty">Aucune carte pour ce filtre. Ouvre des boosters pour agrandir ta collection.</p>}
            </div>
            {view.length > limit && <button className="tb-more" onClick={() => setLimit((l) => l + PAGE)}>Voir plus ({view.length - limit})</button>}
          </div>
        </aside>
      </div>
      {active && <div className="tb-backdrop" onClick={() => setActive(null)} />}

      {toast && (
        <div className="tb-toast" key={toast.key} role="alert">
          <span className="tb-toast-ic"><LockIcon /></span>
          <div><b>{toast.title}</b>{toast.message && <span>{toast.message}</span>}</div>
          <i className="tb-toast-bar" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- sous-composants

function Slot({ id, card, info, active, blocked, pop, preview, onSelect, onRemove, onDrop }) {
  const [over, setOver] = useState(false)
  const chem = info?.chem ?? 0
  const eff = CHEM_EFFECT[chem]
  const base = card ? cardRating(card) : 0
  return (
    <div
      className={'tb-slot' + (card ? ' filled' : '') + (active ? ' active' : '') + (blocked ? ' blocked' : '') + (over ? ' over' : '')}
      style={{ left: POS[id].x + '%', top: POS[id].y + '%', '--cc': card ? getBorderColor(card.rarity) : 'rgba(255,255,255,.3)' }}
      onClick={onSelect}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e) }}
      data-slot={id}
    >
      {card ? (
        <div className="tb-slot-card" key={card.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(card.id))}>
          <HeroCard card={card} />
        </div>
      ) : (
        <div className="tb-slot-empty">
          {preview ? <div className="tb-ghost"><HeroCard card={preview} tilt={false} /></div> : (
            <>
              <span className="plus">+</span>
              <small>{SLOT_LABEL[id]}</small>
            </>
          )}
        </div>
      )}
      {card && (
        <div className={'tb-chem ' + TONE(chem >= 2 ? 2 : chem)}>
          <span className="pips">{[0, 1, 2].map((i) => <i key={i} className={i < chem ? 'on' : ''} />)}</span>
          <b>{base + eff.stat}</b>
          <em>{eff.stat > 0 ? '+' + eff.stat : eff.stat}</em>
        </div>
      )}
      {card && <button className="tb-remove" onClick={(e) => { e.stopPropagation(); onRemove() }} aria-label={'Retirer ' + card.name}>×</button>}
      {pop && <i key={'f' + pop.key} className={'tb-flash ' + pop.tone} />}
      {pop && (
        <span key={pop.key} className={'tb-pop ' + pop.tone}>
          {pop.chem === 3 ? 'Collectif parfait !' : pop.delta > 0 ? `+${pop.delta} collectif` : pop.delta < 0 ? `${pop.delta} collectif` : eff.label}
        </span>
      )}
      <span className="tb-slot-label">{SLOT_LABEL[id]}</span>
    </div>
  )
}

function CollCard({ card, inTeam, locked, pv, shake, onPick, onHover }) {
  const role = roleOf(card.position)
  return (
    <button
      className={'tb-card' + (inTeam ? ' in' : '') + (locked ? ' locked' : '') + (shake ? ' shake' : '')}
      onClick={onPick} onMouseEnter={onHover} onFocus={onHover}
      draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(card.id))}
      aria-label={`${card.name}, ${RARITY_LABEL[String(card.rarity).toLowerCase()] || card.rarity}`}
    >
      <HeroCard card={card} />
      <span className={'tb-role r-' + role}>{role === 'GK' ? 'GB' : role === 'MID' ? 'DÉF/MIL' : role === 'ATT' ? 'ATT' : '—'}</span>
      {inTeam && <span className="tb-in">Titulaire</span>}
      {locked && <span className="tb-lock"><LockIcon /><b>Limite atteinte</b></span>}
      {pv && !locked && (
        <span className={'tb-pv ' + TONE(pv.chem >= 2 ? 2 : pv.chem)}>
          <span className="pips">{[0, 1, 2].map((i) => <i key={i} className={i < pv.chem ? 'on' : ''} />)}</span>
          {pv.delta !== 0 && <b>{pv.delta > 0 ? '+' : ''}{pv.delta}</b>}
        </span>
      )}
    </button>
  )
}

function ChemRing({ total }) {
  const r = 42
  const len = 2 * Math.PI * r
  const k = total / MAX_TEAM_CHEM
  const tone = k >= 0.8 ? 'green' : k >= 0.45 ? 'yellow' : 'red'
  const label = total === MAX_TEAM_CHEM ? 'Parfait' : k >= 0.8 ? 'Excellent' : k >= 0.45 ? 'Correct' : total > 0 ? 'Fragile' : 'Aucun lien'
  return (
    <div className={'tb-ring ' + tone}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="track" />
        <circle cx="50" cy="50" r={r} className="val" strokeDasharray={len} strokeDashoffset={len * (1 - k)} />
      </svg>
      <div className="tb-ring-c">
        <b key={total}>{total}</b>
        <small>/ {MAX_TEAM_CHEM}</small>
      </div>
      <span className="tb-ring-l">Collectif · {label}</span>
    </div>
  )
}

function CapMeter({ label, rarity, n, max, flash }) {
  return (
    <div className={'tb-cap' + (n >= max ? ' full' : '') + (n > max ? ' over' : '') + (flash ? ' flash' : '')} style={{ '--cc': getBorderColor(rarity) }}>
      <span>{label}</span>
      <div className="tb-cap-dots">{Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</div>
      <b>{n}/{max}</b>
    </div>
  )
}

function Effects() {
  return (
    <details className="tb-effects">
      <summary>Impact du collectif en match</summary>
      <div className="tb-eff-rows">
        {[3, 2, 1, 0].map((k) => {
          const e = CHEM_EFFECT[k]
          return (
            <div key={k} className={'tb-eff ' + TONE(k >= 2 ? 2 : k)}>
              <span className="pips">{[0, 1, 2].map((i) => <i key={i} className={i < k ? 'on' : ''} />)}</span>
              <b>{e.label}</b>
              <span>Note {e.stat > 0 ? '+' : ''}{e.stat}</span>
              <span>Zone QTE {e.zone >= 1 ? '+' : ''}{Math.round((e.zone - 1) * 100)} %</span>
            </div>
          )
        })}
      </div>
      <p>Lien vert = même club <em>et</em> même pays (2 pts). Jaune = club <em>ou</em> pays (1 pt). Rouge = aucun point commun. Le collectif d'un joueur est la somme de ses liens, plafonnée à 3.</p>
    </details>
  )
}

function PitchLines() {
  return (
    <svg className="tb-lines" viewBox="0 0 100 108" preserveAspectRatio="none" aria-hidden="true">
      <rect x="3" y="3" width="94" height="102" rx="1.5" />
      <line x1="3" y1="3" x2="97" y2="3" />
      <path d="M38 3 A 12 12 0 0 0 62 3" />
      <rect x="22" y="80" width="56" height="25" />
      <rect x="36" y="96" width="28" height="9" />
      <path d="M41 80 A 10 10 0 0 1 59 80" />
      <circle cx="50" cy="89" r=".7" className="spot" />
    </svg>
  )
}

function Arrow() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function Sparkle() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 2l2.2 6.3L20 10l-5.8 1.9L12 18l-2.2-6.1L4 10l5.8-1.7zM19 15l.9 2.3L22 18l-2.1.8L19 21l-.9-2.2L16 18l2.1-.7z" fill="currentColor" /></svg>
}
function LockIcon() {
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">
      <path d="M15 21v-6a9 9 0 0118 0v6" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="9" y="20" width="30" height="23" rx="5" fill="currentColor" />
    </svg>
  )
}
