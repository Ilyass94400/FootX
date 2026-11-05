import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { getDiscordProfile } from '../lib/useSession'
import { useStock } from '../lib/boosterStock'
import { loadSavedTeam } from '../lib/useTeam'
import { autoFill, SLOTS, computeCollectif, cardRating, roleOf } from '../lib/collectif'
import { useLeague } from '../lib/league/useLeague'
import { splitMs } from '../lib/league/scoring'
import { warpTo } from '../lib/warp'
import { ANNOUNCEMENTS } from '../data/announcements'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './hub.css'

// ============================================================================
// Menu principal : deux portails — L'Arène (1v1, action) et Ma Ligue (fantasy du week-end).
// ============================================================================

const ARENA = '#ff4d5e'
const LEAGUE = '#f2c230'
const DUEL_MS = 4200 // durée d'un cycle du choc de cartes (doit égaler la CSS)
const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const pad = (n) => String(n).padStart(2, '0')
const readNum = (k) => { try { return parseFloat(localStorage.getItem(k)) || 0 } catch { return 0 } }
function rewardsToday() {
  try {
    const r = JSON.parse(localStorage.getItem('footx_match_rewards') || '{}')
    return r.day === new Date().toISOString().slice(0, 10) ? r.n : 0
  } catch { return 0 }
}

export default function Hub({ session }) {
  const { name } = getDiscordProfile(session)
  const stock = useStock()
  const lg = useLeague()
  const [pool, setPool] = useState([])

  useEffect(() => {
    let alive = true
    supabase.from('cards').select('*').limit(200)
      .then(({ data }) => { if (alive) setPool(data || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const saved = useMemo(loadSavedTeam, [])
  const hasTeam = !!saved && SLOTS.every((s) => saved[s.id])
  const team = useMemo(() => {
    if (hasTeam) return saved
    const auto = autoFill(pool)
    return Object.fromEntries(SLOTS.map((s) => [s.id, saved?.[s.id] || auto[s.id] || null]))
  }, [hasTeam, saved, pool])

  // la carte vedette de l'Arène : ton meilleur attaquant (rareté puis note)
  const star = useMemo(() => {
    const list = SLOTS.map((s) => team[s.id]).filter(Boolean)
    const atk = list.filter((c) => roleOf(c.position) === 'ATT')
    const pick = (atk.length ? atk : list).sort((a, b) => (RANK[String(b.rarity).toLowerCase()] || 0) - (RANK[String(a.rarity).toLowerCase()] || 0) || cardRating(b) - cardRating(a))
    return pick[0] || null
  }, [team])

  const lineup = lg.lock ? lg.lock.team : team
  const collectif = useMemo(() => computeCollectif(team), [team])
  const streak = readNum('footx_win_streak')
  const won = rewardsToday()
  const t = splitMs(lg.gw.msLeft)
  const first = String(name).split(' ')[0]

  return (
    <div className="hb">
      <header className="hb-head">
        <div>
          <span className="hb-kicker">Saison 1 · Journée {lg.gw.number}</span>
          <h1>Salut {first}<span>.</span></h1>
        </div>
        <p className="hb-lede">Choisis ton terrain.</p>
      </header>

      <div className="hb-portals">
        {/* ------------------------------ ARÈNE ------------------------------ */}
        <Portal kind="arena" color={ARENA} route="match" label="L'Arène">
          <ArenaScene star={star} />
          <div className="hb-p-content">
            <span className="hb-p-kicker"><i className="hb-live" />Mode principal · temps réel</span>
            <h2>L'Arène</h2>
            <p className="hb-p-sub">1 contre 1 · 3 minutes · 6 actions décisives</p>
            <div className="hb-chips">
              <span className={'hb-chip' + (streak >= 2 ? ' hot' : '')}>
                <b>{streak}</b> {streak > 1 ? 'victoires de suite' : 'victoire de suite'}
              </span>
              <span className="hb-chip"><b>{won}/5</b> boosters gagnés aujourd'hui</span>
            </div>
            <span className="hb-cta"><span>Entrer dans l'Arène</span><Arrow /></span>
          </div>
        </Portal>

        {/* ------------------------------ LIGUE ------------------------------ */}
        <Portal kind="league" color={LEAGUE} route="ligue" label="Ma Ligue">
          <LeagueScene lineup={lineup} locked={!!lg.lock} />
          <div className="hb-p-content">
            <span className="hb-p-kicker">Mode saison · le week-end</span>
            <h2>Ma Ligue</h2>
            <p className="hb-p-sub">Tes cartes marquent avec les vrais matchs. Une Légendaire compte double.</p>
            <div className="hb-count" aria-label="Temps restant">
              <span className="hb-count-l">{lg.gw.phase === 'open' ? (lg.lock ? 'Équipe verrouillée · coup d\'envoi dans' : 'Verrouillage dans') : 'Matchs en cours · résultats dans'}</span>
              <div className="hb-digits">
                {t.d > 0 && <Digit v={t.d} u="j" />}
                <Digit v={pad(t.h)} u="h" />
                <Digit v={pad(t.m)} u="min" />
                <Digit v={pad(t.s)} u="s" tick />
              </div>
            </div>
            <span className="hb-cta"><span>{lg.lock ? 'Voir ma ligue' : 'Composer mon équipe'}</span><Arrow /></span>
          </div>
        </Portal>
      </div>

      {/* ------------------------------ RACCOURCIS ------------------------------ */}
      <div className="hb-tiles">
        <Tile route="boosters" color="#e4ff3c" label="Boosters" kicker="Boosters prêts" value={stock.n}
          hint={stock.n > 0 ? 'Ouvrir maintenant' : 'Recharge en cours'} pack />
        <Tile route="team" color="#7ad7ff" label="Mon équipe" kicker="Collectif" value={hasTeam ? collectif.collectif : '—'}
          hint={hasTeam ? 'Ajuster la compo' : 'Composer mes 5 titulaires'} />
        <Tile route="collection" color="#c58bff" label="Collection" kicker="Ma collection" value={pool.length ? pool.length + (pool.length >= 200 ? '+' : '') : '—'}
          hint="Voir toutes mes cartes" />
      </div>

      <div className="hb-ticker" aria-label="Annonces">
        <div className="hb-ticker-track">
          {[0, 1].map((k) => (
            <span key={k} aria-hidden={k === 1}>
              {ANNOUNCEMENTS.map((a) => <em key={a.title}><b>{a.tag}</b>{a.title} — {a.text}</em>)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Portail : inclinaison + lumière qui suivent la souris, transition "warp" au clic.
function Portal({ kind, color, route, label, children }) {
  const ref = useRef(null)
  const move = (e) => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--px', (px * 100).toFixed(1) + '%')
    el.style.setProperty('--py', (py * 100).toFixed(1) + '%')
    el.style.setProperty('--tx', ((0.5 - py) * 5).toFixed(2) + 'deg')
    el.style.setProperty('--ty', ((px - 0.5) * 7).toFixed(2) + 'deg')
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tx', '0deg')
    el.style.setProperty('--ty', '0deg')
  }
  const launch = (e) => {
    ref.current?.classList.add('launch')
    const x = e.clientX || window.innerWidth / 2
    const y = e.clientY || window.innerHeight / 2
    warpTo(route, { color, x, y, label })
  }
  return (
    <div
      ref={ref}
      role="link"
      tabIndex={0}
      aria-label={label}
      className={'hb-portal ' + kind}
      style={{ '--pc': color }}
      onPointerMove={move}
      onPointerLeave={leave}
      onClick={launch}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(e) } }}
    >
      <div className="hb-portal-in">
        {children}
        <div className="hb-p-light" aria-hidden="true" />
        <div className="hb-p-rim" aria-hidden="true" />
      </div>
    </div>
  )
}

// Scène de l'Arène : ta carte vedette percute une carte adverse en boucle.
function ArenaScene({ star }) {
  const fx = useRef(null)
  const timer = useRef(0)
  const onCycle = useCallback((e) => {
    if (e.animationName !== 'hb-duel-l') return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fx.current?.burst({ x: 0.5, y: 0.4, colors: ['#ffffff', ARENA, '#ffd25c'], count: 70, speed: 10, kind: 'spark' })
      fx.current?.burst({ x: 0.5, y: 0.4, colors: ['#ffffff', '#ffd25c'], count: 24, speed: 4, kind: 'glitter' })
    }, DUEL_MS * 0.42)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="hb-scene hb-arena-scene" aria-hidden="true">
      <div className="hb-beams" />
      <div className="hb-grass"><i /></div>
      <div className="hb-duel" onAnimationStart={onCycle} onAnimationIteration={onCycle}>
        <div className="hb-duel-l"><HeroCard card={star} tilt={false} /></div>
        <div className="hb-duel-r"><HeroCard back tilt={false} /></div>
        <div className="hb-impact" />
      </div>
      <PackFx ref={fx} ambient="rgba(255,120,130,.5)" />
    </div>
  )
}

// Scène de la Ligue : l'éventail des 5 titulaires (verrouillé = sceau doré).
function LeagueScene({ lineup, locked }) {
  const cards = SLOTS.map((s) => lineup?.[s.id]).filter(Boolean)
  return (
    <div className={'hb-scene hb-league-scene' + (locked ? ' locked' : '')} aria-hidden="true">
      <div className="hb-grid" />
      <div className="hb-fan">
        {cards.map((c, i) => (
          <div key={c.id || i} className="hb-fan-card" style={{ '--i': i - (cards.length - 1) / 2 }}>
            <HeroCard card={c} tilt={false} />
          </div>
        ))}
        {cards.length === 0 && [0, 1, 2, 3, 4].map((i) => <div key={i} className="hb-fan-card ghost" style={{ '--i': i - 2 }} />)}
      </div>
      {locked && <div className="hb-seal"><Lock /></div>}
    </div>
  )
}

function Tile({ route, color, label, kicker, value, hint, pack = false }) {
  const go = (e) => warpTo(route, { color, x: e.clientX || undefined, y: e.clientY || undefined })
  return (
    <button className="hb-tile" style={{ '--tc': color }} onClick={go} aria-label={label}>
      {pack && <span className="hb-minipack" aria-hidden="true"><i /></span>}
      <span className="hb-tile-k">{kicker}</span>
      <b className="hb-tile-v">{value}</b>
      <span className="hb-tile-h">{hint} <Arrow /></span>
    </button>
  )
}

function Digit({ v, u, tick = false }) {
  return (
    <span className="hb-digit">
      <b key={tick ? v : undefined} className={tick ? 'tick' : ''}>{v}</b>
      <small>{u}</small>
    </span>
  )
}

function Arrow() {
  return <svg className="hb-arrow" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function Lock() {
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">
      <path d="M15 21v-6a9 9 0 0118 0v6" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="9" y="20" width="30" height="23" rx="5" fill="currentColor" />
      <circle cx="24" cy="30" r="3.2" fill="#1a1407" /><path d="M24 31v6" stroke="#1a1407" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
