import { useCallback, useEffect, useState } from 'react'
import { SLOTS } from '../collectif'
import { gameweekInfo } from './scoring'
import { track } from '../quests'

// État local de la Ligue (navigateur) — même forme que les futures tables Supabase :
//   footx_league  → leagues + league_members   { name, code, createdAt }
//   footx_lineup  → lineups + lineup_cards      { gw, team:{GK..A2}, captain, lockedAt }
// Quand les tables existeront, seules load/save changent : l'UI ne bouge pas.
const LEAGUE_KEY = 'footx_league'
const LINEUP_KEY = 'footx_lineup'
const EVENT = 'footx:league'

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } }
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* stockage indisponible */ }
  window.dispatchEvent(new Event(EVENT))
}
const makeCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 31) | 0]).join('')

export function loadLeague() {
  let l = read(LEAGUE_KEY)
  if (!l?.code) {
    l = { name: 'Ligue des potes', code: makeCode(), createdAt: Date.now() }
    write(LEAGUE_KEY, l)
  }
  return l
}

// Compo verrouillée pour la journée en cours (null si rien de verrouillé cette semaine).
export function loadLock(gwNumber = gameweekInfo().number) {
  const l = read(LINEUP_KEY)
  return l && l.gw === gwNumber ? l : null
}

// Snapshot léger d'une carte (ce qui compte pour le score), pas tout l'objet.
const snap = (c) => c && { id: c.id, name: c.name, club: c.club, country: c.country, position: c.position, rarity: c.rarity, image_url: c.image_url, rating: c.rating }

export function useLeague() {
  const [league, setLeague] = useState(loadLeague)
  const [lock, setLock] = useState(() => loadLock())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const sync = () => { setLeague(loadLeague()); setLock(loadLock()) }
    const t = setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener(EVENT, sync)
    return () => { clearInterval(t); window.removeEventListener(EVENT, sync) }
  }, [])

  const gw = gameweekInfo(new Date(now))

  const lockTeam = useCallback((team, captain) => {
    const g = gameweekInfo()
    if (g.phase !== 'open') return false
    if (SLOTS.some((s) => !team[s.id])) return false
    const v = { gw: g.number, team: Object.fromEntries(SLOTS.map((s) => [s.id, snap(team[s.id])])), captain, lockedAt: Date.now() }
    write(LINEUP_KEY, v)
    setLock(v)
    track('league_lock', 1, { gameweek: g.number })
    return true
  }, [])

  const unlock = useCallback(() => {
    if (gameweekInfo().phase !== 'open') return false
    write(LINEUP_KEY, null)
    setLock(null)
    return true
  }, [])

  const rename = useCallback((name) => {
    const v = { ...loadLeague(), name: name.slice(0, 32) || 'Ma ligue' }
    write(LEAGUE_KEY, v)
    setLeague(v)
  }, [])

  return { league, lock, gw, now, lockTeam, unlock, rename }
}
