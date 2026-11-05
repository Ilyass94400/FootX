// ============================================================================
// Mode Carrière Solo « L'Ascension » — sauvegarde locale (mode démo).
// En production, les mêmes règles sont appliquées par Postgres (migration
// 20261108_carriere.sql : career_save, career_stats, career_skills…).
//
// Le joueur (avatar, XP, arbre, Ultimes) est géré par lib/legend ; ici on gère
// sa vie de footballeur : club, contrat, calendrier, notes, courrier, mercato.
// ============================================================================
import { useEffect, useState } from 'react'
import { createAvatar, derive, grantXp, legendCard, resetLegend } from '../legend'
import { hashStr } from './crest'
import { findClub } from './clubs'
import { SEASON_LENGTH, buildOffers, matchRating, matchXp, rng, seasonStats } from './rules'

const DEBUT_WAGE = { 1: 22500, 2: 11000, 3: 4500, 4: 1500 } // € / semaine (fictif) — = SQL
const KEY = 'footx_career'
const EVENT = 'footx:career'
const blank = () => ({ v: 1, active: false })
let state = null
const st = () => {
  if (state) return state
  try { const s = JSON.parse(localStorage.getItem(KEY)); state = s?.v === 1 ? s : blank() } catch { state = blank() }
  return state
}
const save = (detail) => {
  try { localStorage.setItem(KEY, JSON.stringify(st())) } catch { /* stockage indisponible */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}
export class CareerError extends Error {}

// ---------------------------------------------------------------- calendrier
function makeFixtures(clubs, myKey, season, seed) {
  const r = rng(seed)
  const others = clubs.filter((c) => c.key !== myKey)
  const me = findClub(clubs, myKey)
  const order = [...others].sort(() => r() - 0.5)
  const list = []
  for (let i = 0; i < SEASON_LENGTH && order.length; i++) {
    const o = order[i % order.length]
    list.push({ id: `s${season}-r${i + 1}`, round: i + 1, oppKey: o.key, oppName: o.name, home: i % 2 === 0, big: o.tier === 1 || (o.tier <= 2 && (me?.tier ?? 4) <= 2), result: null })
  }
  // le choc de la saison (le club le plus fort) tombe sur la dernière journée
  const best = list.reduce((b, f, i) => ((findClub(clubs, f.oppKey)?.strength ?? 0) > (findClub(clubs, list[b].oppKey)?.strength ?? 0) ? i : b), 0)
  if (list.length > 1) { const k = list.length - 1; [list[best].oppKey, list[k].oppKey] = [list[k].oppKey, list[best].oppKey]; [list[best].oppName, list[k].oppName] = [list[k].oppName, list[best].oppName]; [list[best].big, list[k].big] = [list[k].big, list[best].big] }
  return list
}

// ---------------------------------------------------------------- lecture
export function getCareer() {
  const s = st()
  if (!s.active) return null
  const player = derive()
  if (!player) return null
  const stats = seasonStats(s.fixtures)
  const next = s.fixtures.find((f) => !f.result) || null
  const unread = s.inbox.filter((m) => m.status === 'new').length
  const pendingOffers = s.inbox.filter((m) => m.season === s.season && (m.kind === 'transfer' || m.kind === 'renewal') && m.status !== 'accepted' && m.status !== 'declined' && m.status !== 'expired').length
  return { ...s, player, stats, next, unread, pendingOffers, seasonOver: !next }
}

export function useCareer() {
  const [c, setC] = useState(() => getCareer())
  useEffect(() => {
    const h = () => setC(getCareer())
    window.addEventListener(EVENT, h)
    window.addEventListener('footx:legend', h)
    return () => { window.removeEventListener(EVENT, h); window.removeEventListener('footx:legend', h) }
  }, [])
  return c
}
export function onCareer(cb) {
  const h = (e) => cb(e.detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

// ---------------------------------------------------------------- début de carrière
// form = données de l'Académie (si on crée un nouveau joueur), club = club choisi
export function startCareer({ form, club, clubs }) {
  if (!club) throw new CareerError('Choisis ton club de départ.')
  if (form) { resetLegend(); createAvatar(form) }
  const p = derive()
  if (!p) throw new CareerError('Crée d\'abord ton joueur.')
  const seed = hashStr(p.name + club.key + Date.now())
  state = {
    v: 1, active: true, seed, season: 1, phase: 'season',
    clubKey: club.key, clubName: club.name,
    contract: { until: 3, wage: DEBUT_WAGE[club.tier] || 1500, role: 'Jeune espoir' },
    fixtures: makeFixtures(clubs, club.key, 1, seed),
    inbox: [], history: [], live: null,
  }
  const first = {
    id: 's1-debut', kind: 'debut', season: 1, clubKey: club.key, clubName: club.name, tier: club.tier,
    wage: state.contract.wage, years: 3, role: 'Jeune espoir', bonus: 0, status: 'new', at: Date.now(),
  }
  state.inbox.push(first)
  save({ type: 'start' })
  return first
}

export function resetCareer() {
  state = blank()
  resetLegend()
  save({ type: 'reset' })
}

// ---------------------------------------------------------------- matchs
export function playFixture(id) {
  const s = st()
  const f = s.fixtures?.find((x) => x.id === id)
  if (!f || f.result) throw new CareerError('Ce match est déjà joué.')
  s.live = id
  save({ type: 'live', id })
}

// Match en cours (pour l'Arène) : ton club, l'adversaire et ta carte de joueur
export function liveMatch(clubs) {
  const s = st()
  if (!s.active || !s.live) return null
  const f = s.fixtures.find((x) => x.id === s.live)
  if (!f || f.result) return null
  const me = findClub(clubs, s.clubKey)
  const opp = findClub(clubs, f.oppKey)
  if (!me || !opp) return null
  const card = legendCard()
  return { fixture: f, me, opp, pro: card && { ...card, club: me.name }, season: s.season }
}

// Fin d'un match joué : note, XP (une seule fois par match)
export function reportMatch(id, m) {
  const s = st()
  const f = s.fixtures?.find((x) => x.id === id)
  if (!f || f.result) return null
  const rating = matchRating(m)
  const xp = matchXp({ rating, goals: m.goals, win: m.win })
  const g = grantXp(xp, 'career-' + id)
  f.result = { win: !!m.win, gf: m.gf, ga: m.ga, goals: m.goals || 0, perfect: m.perfect || 0, rating, xp: g?.gain ?? 0, sim: false }
  if (s.live === id) s.live = null
  save({ type: 'result', id })
  return { rating, xp: g?.gain ?? 0, levels: g?.levelsGained ?? 0, level: g?.after.level, tierUp: g?.tierUp ? g.after.tier.rarity : null, seasonOver: !s.fixtures.some((x) => !x.result) }
}

// Simuler un match (moitié moins d'XP) : utile quand on veut avancer vite dans la saison
export function simulateFixture(id, clubs) {
  const s = st()
  const f = s.fixtures?.find((x) => x.id === id)
  if (!f || f.result) return null
  const r = rng(hashStr(id + s.seed))
  const p = derive()
  const me = findClub(clubs, s.clubKey)
  const opp = findClub(clubs, f.oppKey)
  const pWin = Math.max(0.15, Math.min(0.85, 0.5 + ((me?.strength ?? 70) - (opp?.strength ?? 70)) / 40 + (p.rating - 70) / 100 + (f.home ? 0.05 : 0)))
  const win = r() < pWin
  const gExp = { ATT: 0.75, MIL: 0.35, DEF: 0.12, GB: 0 }[p.position] ?? 0.3
  let goals = 0
  for (let i = 0; i < 3; i++) if (r() < gExp / 3 + (p.stats.tir - 60) / 400) goals++
  const gf = Math.max(goals, win ? 1 + Math.floor(r() * 3) : Math.floor(r() * 2))
  const ga = win ? Math.floor(r() * gf) : gf + 1 + Math.floor(r() * 2)
  const rating = Math.round(Math.max(4, Math.min(9.5, 6.1 + (win ? 0.4 : -0.4) + goals * 0.9 + (r() - 0.5) * 1.2)) * 10) / 10
  const xp = matchXp({ rating, goals, win, sim: true })
  const g = grantXp(xp, 'career-' + id)
  f.result = { win, gf, ga, goals, perfect: 0, rating, xp: g?.gain ?? 0, sim: true }
  save({ type: 'result', id, sim: true })
  return f.result
}

// ---------------------------------------------------------------- fin de saison / mercato
export function closeSeason(clubs) {
  const s = st()
  if (!s.active || s.phase !== 'season' || s.fixtures.some((f) => !f.result)) return null
  const p = derive()
  const stats = seasonStats(s.fixtures)
  const current = findClub(clubs, s.clubKey) || { key: s.clubKey, name: s.clubName, tier: 4 }
  const { score, offers } = buildOffers({ clubs, current, stats, level: p.level, season: s.season, seed: s.seed + s.season })
  s.history.push({ season: s.season, clubKey: s.clubKey, clubName: s.clubName, ...stats, score, level: p.level })
  s.phase = 'mercato'
  const now = Date.now()
  for (const o of offers) s.inbox.push({ ...o, status: 'new', at: now })
  save({ type: 'mercato', offers: offers.length })
  return offers
}

export function openMessage(id) {
  const m = st().inbox?.find((x) => x.id === id)
  if (m && m.status === 'new') { m.status = 'read'; save({ type: 'read', id }) }
}

// Accepter / refuser une offre (signer une offre fait expirer les autres)
export function answerOffer(id, accept) {
  const s = st()
  const m = s.inbox?.find((x) => x.id === id)
  if (!m || ['accepted', 'declined', 'expired'].includes(m.status)) throw new CareerError('Cette offre n\'est plus valable.')
  if (m.kind === 'debut') { m.status = 'accepted'; save({ type: 'signed', id }); return m }
  if (!accept) { m.status = 'declined'; save({ type: 'declined', id }); return m }
  m.status = 'accepted'
  for (const o of s.inbox) if (o !== m && o.season === m.season && (o.kind === 'transfer' || o.kind === 'renewal') && !['accepted', 'declined'].includes(o.status)) o.status = 'expired'
  const moved = m.clubKey !== s.clubKey
  s.clubKey = m.clubKey
  s.clubName = m.clubName
  s.contract = { until: s.season + m.years, wage: m.wage, role: m.role }
  s.signed = { season: s.season, clubKey: m.clubKey, moved }
  save({ type: 'signed', id, moved })
  return m
}

export function newSeason(clubs) {
  const s = st()
  if (!s.active || s.phase !== 'mercato') return
  for (const o of s.inbox) if (o.season === s.season && ['new', 'read'].includes(o.status) && o.kind !== 'debut') o.status = 'expired'
  s.season += 1
  s.phase = 'season'
  s.signed = null
  s.fixtures = makeFixtures(clubs, s.clubKey, s.season, s.seed + s.season * 7919)
  save({ type: 'season', season: s.season })
}
