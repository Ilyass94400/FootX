import { useCallback, useEffect, useState } from 'react'
import { SLOTS } from '../collectif'
import { gameweekInfo } from './scoring'
import { track } from '../quests'
import { supabase } from '../../supabase'
import { cloudActive } from '../cloud'

// État de la Ligue.
//   connecté : le SERVEUR fait foi (leagues, league_members, lineups — migration 20261110) ;
//              la copie locale ci-dessous sert d'affichage immédiat, rafraîchie à chaque action.
//   démo     : tout reste dans le navigateur.
//   footx_league  → { id, name, code, owner, members:[{ id, name, avatar, me, points, locked }] }
//   footx_lineup  → { gw, team:{GK..A2}, captain, lockedAt }
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
    l = cloudActive()
      ? { name: 'Ma ligue', code: '······', owner: true, members: [], loading: true }
      : { name: 'Ligue des potes', code: makeCode(), createdAt: Date.now(), owner: true }
    if (!cloudActive()) write(LEAGUE_KEY, l)
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

// ---- serveur
const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message || 'Erreur serveur')
  return data
}
function applyServer(d) {
  if (!d) return
  if (d.league) write(LEAGUE_KEY, d.league)
  write(LINEUP_KEY, d.lock || null)
}
export function refreshLeague() {
  if (!cloudActive()) return Promise.resolve(null)
  return rpc('league_get', { p_gw: gameweekInfo().number }).then((d) => { applyServer(d); return d })
}

export function useLeague() {
  const [league, setLeague] = useState(loadLeague)
  const [lock, setLock] = useState(() => loadLock())
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const live = cloudActive()

  useEffect(() => {
    const sync = () => { setLeague(loadLeague()); setLock(loadLock()) }
    const t = setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener(EVENT, sync)
    if (live) refreshLeague().catch((e) => setError(e.message))
    return () => { clearInterval(t); window.removeEventListener(EVENT, sync) }
  }, [live])

  const gw = gameweekInfo(new Date(now))
  const fail = (e, undo) => { undo?.(); setError(e?.message || 'Action impossible'); setTimeout(() => setError(null), 6000) }

  const lockTeam = useCallback((team, captain) => {
    const g = gameweekInfo()
    if (g.phase !== 'open') return false
    if (SLOTS.some((s) => !team[s.id])) return false
    const prev = read(LINEUP_KEY)
    const v = { gw: g.number, team: Object.fromEntries(SLOTS.map((s) => [s.id, snap(team[s.id])])), captain, lockedAt: Date.now() }
    write(LINEUP_KEY, v) // affichage immédiat…
    setLock(v)
    track('league_lock', 1, { gameweek: g.number })
    if (live) {
      // …puis le serveur valide (cartes possédées, avant vendredi 19:00) ; sinon on annule
      setBusy(true)
      rpc('league_lock', { p_team: Object.fromEntries(SLOTS.map((s) => [s.id, team[s.id].id])), p_captain: captain })
        .then((lk) => { write(LINEUP_KEY, lk); return refreshLeague() })
        .catch((e) => fail(e, () => { write(LINEUP_KEY, prev); setLock(loadLock()) }))
        .finally(() => setBusy(false))
    }
    return true
  }, [live])

  const unlock = useCallback(() => {
    if (gameweekInfo().phase !== 'open') return false
    const prev = read(LINEUP_KEY)
    write(LINEUP_KEY, null)
    setLock(null)
    if (live) {
      setBusy(true)
      rpc('league_unlock', {}).then(() => refreshLeague())
        .catch((e) => fail(e, () => { write(LINEUP_KEY, prev); setLock(loadLock()) }))
        .finally(() => setBusy(false))
    }
    return true
  }, [live])

  const rename = useCallback((name) => {
    const prev = loadLeague()
    const v = { ...prev, name: name.slice(0, 32) || 'Ma ligue' }
    write(LEAGUE_KEY, v)
    setLeague(v)
    if (live) rpc('league_rename', { p_name: v.name }).then(() => refreshLeague()).catch((e) => fail(e, () => write(LEAGUE_KEY, prev)))
  }, [live])

  // Rejoindre la ligue d'un ami avec son code (en ligne seulement)
  const join = useCallback(async (code) => {
    if (!live) throw new Error('Connecte-toi avec Discord pour rejoindre une ligue.')
    const d = await rpc('league_join', { p_code: String(code || '').trim().toUpperCase() })
    applyServer(d)
    return d.league
  }, [live])

  return { league, lock, gw, now, lockTeam, unlock, rename, join, live, error, busy }
}
