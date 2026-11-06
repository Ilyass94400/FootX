import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getDiscordProfile } from '../lib/useSession'
import { useStock, formatTime, MAX_STOCK } from '../lib/boosterStock'
import { useOwned } from '../lib/collection'
import { crestUrl } from '../lib/career/crest'
import BoosterPack from '../components/BoosterPack'
import { loadSavedTeam } from '../lib/useTeam'
import { autoFill, SLOTS, computeCollectif } from '../lib/collectif'
import { useLeague } from '../lib/league/useLeague'
import { splitMs } from '../lib/league/scoring'
import { warpTo } from '../lib/warp'
import { useCareer } from '../lib/career'
import { seasonLabel } from '../lib/career/rules'
import { ANNOUNCEMENTS } from '../data/announcements'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './hub.css'

// ============================================================================
// Accueil : deux grands portails — Boosters et Jouer (Arène, Ligue, Carrière),
// puis des raccourcis (Ligue, Équipe, Carrière, Collection).
// Portail, scènes Arène/Ligue et chiffres sont aussi utilisés par la page Jouer.
// ============================================================================

const ARENA = '#ff4d5e'
const LEAGUE = '#f2c230'
const CAREER = '#5fd3ff'
const LIME = '#e4ff3c'
const DUEL_MS = 4200 // durée d'un cycle du choc de cartes (doit égaler la CSS)
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
  const career = useCareer()
  const owned = useOwned()
  // une carte par joueur possédé (doublons regroupés)
  const pool = useMemo(() => (owned ? [...new Map(owned.items.filter((i) => i.card).map((i) => [String(i.card.id), i.card])).values()] : []), [owned])

  const saved = useMemo(loadSavedTeam, [])
  const hasTeam = !!saved && SLOTS.every((s) => saved[s.id])
  const team = useMemo(() => {
    if (hasTeam) return saved
    const auto = autoFill(pool)
    return Object.fromEntries(SLOTS.map((s) => [s.id, saved?.[s.id] || auto[s.id] || null]))
  }, [hasTeam, saved, pool])

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
        {/* ------------------------------ BOOSTERS ------------------------------ */}
        <Portal kind="boosters" color={LIME} route="boosters" label="Boosters">
          <BoostersScene n={stock.n} />
          <div className="hb-p-content">
            <span className="hb-p-kicker"><i className="hb-live" />{stock.n > 0 ? 'Prêts à ouvrir' : 'Recharge en cours'}</span>
            <h2>Boosters</h2>
            <p className="hb-p-sub">10 cartes par booster, dont une vedette Rare ou mieux. Un booster de plus toutes les 10 minutes.</p>
            <div className="hb-chips">
              <span className={'hb-chip' + (stock.n >= MAX_STOCK ? ' hot' : '')}><b>{stock.n}/{MAX_STOCK}</b> boosters prêts</span>
              <span className="hb-chip">{stock.nextIn !== null ? <>+1 dans <b>{formatTime(stock.nextIn)}</b></> : 'Stock plein'}</span>
            </div>
            <span className="hb-cta"><span>{stock.n > 0 ? (stock.n > 1 ? 'Ouvrir mes boosters' : 'Ouvrir le booster') : 'Voir les boosters'}</span><Arrow /></span>
          </div>
        </Portal>

        {/* ------------------------------ JOUER ------------------------------ */}
        <Portal kind="play" color={ARENA} route="jouer" label="Jouer">
          <PlayScene
            arena={`${streak} victoire${streak > 1 ? 's' : ''} de suite`}
            league={lg.gw.phase !== 'open' ? 'Matchs en cours' : lg.lock ? 'Équipe verrouillée' : `Verrouillage ${t.d > 0 ? t.d + ' j ' : ''}${pad(t.h)}h${pad(t.m)}`}
            career={career ? { club: career.clubName, line: 'Niv ' + career.player.level } : null}
          />
          <div className="hb-p-content">
            <span className="hb-p-kicker">3 modes de jeu</span>
            <h2>Jouer</h2>
            <p className="hb-p-sub">L'Arène contre de vrais joueurs, Ma Ligue pour le week-end, la Carrière en solo.</p>
            <div className="hb-chips">
              <span className={'hb-chip' + (streak >= 2 ? ' hot' : '')}><b>{streak}</b> {streak > 1 ? 'victoires de suite' : 'victoire de suite'}</span>
              <span className="hb-chip"><b>{won}/5</b> boosters gagnés aujourd'hui</span>
            </div>
            <span className="hb-cta"><span>Choisir un mode</span><Arrow /></span>
          </div>
        </Portal>
      </div>

      {/* ------------------------------ RACCOURCIS ------------------------------ */}
      <div className="hb-tiles">
        <Tile route="ligue" color={LEAGUE} label="Ma Ligue" kicker={`Ma Ligue · J${lg.gw.number}`}
          value={lg.gw.phase !== 'open' ? 'Live' : lg.lock ? 'Prête' : `${t.d > 0 ? t.d + 'j ' : ''}${pad(t.h)}h${pad(t.m)}`}
          hint={lg.gw.phase !== 'open' ? 'Voir les points' : lg.lock ? 'Équipe verrouillée' : 'Avant le verrouillage'} />
        <Tile route="team" color="#7ad7ff" label="Mon équipe" kicker="Collectif" value={hasTeam ? collectif.collectif : '—'}
          hint={hasTeam ? 'Ajuster la compo' : 'Composer mes 5 titulaires'} />
        <Tile route="carriere" color="#f5c542" label="Mode Carrière" kicker={career ? `Carrière · ${career.clubName}` : 'Mode Carrière'} value={career ? 'Niv ' + career.player.level : 'Solo'}
          hint={career ? (career.unread ? `${career.unread} lettre${career.unread > 1 ? 's' : ''} non lue${career.unread > 1 ? 's' : ''}` : career.next ? `Prochain match : ${career.next.oppName}` : `Saison ${seasonLabel(career.season)}`) : 'Crée ton joueur et choisis ton club'} />
        <Tile route="collection" color="#c58bff" label="Collection" kicker="Ma collection" value={owned ? pool.length : '—'}
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
export function Portal({ kind, color, route, label, children }) {
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
export function ArenaScene({ star }) {
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
export function LeagueScene({ lineup, locked }) {
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

// Scène Boosters : la pile de sachets FootX sous un halo
function BoostersScene({ n }) {
  return (
    <div className="hb-scene hb-bst-scene" aria-hidden="true">
      <div className="hb-bst-rays" />
      <div className="hb-bst-stack">
        {n >= 3 && <div className="hb-bst-p p2"><BoosterPack idle /></div>}
        {n >= 2 && <div className="hb-bst-p p1"><BoosterPack idle /></div>}
        <div className={'hb-bst-p p0' + (n > 0 ? '' : ' empty')}><BoosterPack idle packs={1} /></div>
      </div>
    </div>
  )
}

// Scène Jouer : les trois modes en éventail
function PlayScene({ arena, league, career }) {
  const modes = [
    { k: 'arena', c: ARENA, label: "L'Arène", line: arena, icon: <b className="hb-mode-vs">VS</b> },
    { k: 'league', c: LEAGUE, label: 'Ma Ligue', line: league, icon: <TrophyIcon /> },
    { k: 'career', c: CAREER, label: 'Carrière', line: career ? career.line : 'Crée ton joueur', icon: career ? <img src={crestUrl(career.club, { tier: 2 })} alt="" /> : <b className="hb-mode-vs">?</b> },
  ]
  return (
    <div className="hb-scene hb-play-scene" aria-hidden="true">
      <div className="hb-play-glow" />
      <div className="hb-modes">
        {modes.map((m, i) => (
          <div key={m.k} className={'hb-mode ' + m.k} style={{ '--mc': m.c, '--i': i - 1 }}>
            <div className="hb-mode-ico">{m.icon}</div>
            <strong>{m.label}</strong>
            <small>{m.line}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
function TrophyIcon() {
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em">
      <path d="M14 7h20v9a10 10 0 0 1-20 0Z" fill="currentColor" />
      <path d="M14 10H8v3a7 7 0 0 0 7 7M34 10h6v3a7 7 0 0 1-7 7" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M21 26h6v7h-6Z" fill="currentColor" /><rect x="15" y="33" width="18" height="6" rx="2" fill="currentColor" />
    </svg>
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

export function Digit({ v, u, tick = false }) {
  return (
    <span className="hb-digit">
      <b key={tick ? v : undefined} className={tick ? 'tick' : ''}>{v}</b>
      <small>{u}</small>
    </span>
  )
}

export function Arrow() {
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
