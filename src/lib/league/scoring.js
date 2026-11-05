// ============================================================================
// Ligue FootX — barème Fantasy + calendrier des journées. PUR (aucun React).
// Le même fichier pourra être importé tel quel par l'Edge Function Supabase
// qui calcule les points du lundi : une seule source de vérité pour le barème.
// ============================================================================

import { roleOf } from '../collectif'

// Multiplicateur de rareté : il s'applique aux actions POSITIVES uniquement
// (une Légendaire qui marque rapporte le double, mais un carton ne coûte pas double).
export const RARITY_MULT = {
  commune: 1,
  atypique: 1.1,
  rare: 1.25,
  epique: 1.5,
  legendaire: 2,
  iconique: 2.5,
}
export const CAPTAIN_MULT = 1.5

// Barème par action et par rôle (GK = gardien, MID = déf/milieu, ATT = attaquant).
export const ACTIONS = [
  { key: 'played',  label: 'Titulaire (60 min +)', short: 'Titulaire', pts: { GK: 2, MID: 2, ATT: 2 } },
  { key: 'sub',     label: 'Entré en jeu',         short: 'Entrée',    pts: { GK: 1, MID: 1, ATT: 1 } },
  { key: 'goals',   label: 'But',                  short: 'But',       pts: { GK: 10, MID: 7, ATT: 6 } },
  { key: 'assists', label: 'Passe décisive',       short: 'Passe D.',  pts: { GK: 4, MID: 4, ATT: 4 } },
  { key: 'shots',   label: 'Tir cadré',            short: 'Tir cadré', pts: { GK: 1, MID: 1, ATT: 1 } },
  { key: 'clean',   label: 'Clean sheet',          short: 'Clean sheet', pts: { GK: 5, MID: 3, ATT: 0 } },
  { key: 'saves',   label: 'Arrêt',                short: 'Arrêt',     pts: { GK: 1, MID: 0, ATT: 0 } },
  { key: 'conceded2', label: '2 buts encaissés',   short: '-2 buts',   pts: { GK: -1, MID: -1, ATT: 0 } },
  { key: 'yellow',  label: 'Carton jaune',         short: 'Jaune',     pts: { GK: -2, MID: -2, ATT: -2 } },
  { key: 'red',     label: 'Carton rouge',         short: 'Rouge',     pts: { GK: -5, MID: -5, ATT: -5 } },
  { key: 'ownGoal', label: 'But contre son camp',  short: 'CSC',       pts: { GK: -3, MID: -3, ATT: -3 } },
]
const ROLE_OF_SLOT = { GK: 'GK', D1: 'MID', D2: 'MID', A1: 'ATT', A2: 'ATT' }

export const rarityKey = (card) => String(card?.rarity || 'commune').toLowerCase()
export const multOf = (card) => RARITY_MULT[rarityKey(card)] || 1

const round1 = (n) => Math.round(n * 10) / 10

// Points d'une carte pour une journée.
//   stats : { played, sub, goals, assists, shots, clean, saves, conceded, yellow, red, ownGoal }
// Retour : { lines: [{key,label,count,pts}], base, bonus, malus, mult, captain, total }
export function scoreCard(card, stats, { slot, captain = false } = {}) {
  const role = ROLE_OF_SLOT[slot] || (roleOf(card?.position) === 'GK' ? 'GK' : roleOf(card?.position) === 'ATT' ? 'ATT' : 'MID')
  const mult = multOf(card)
  const lines = []
  let plus = 0
  let minus = 0
  for (const a of ACTIONS) {
    const count = a.key === 'conceded2' ? Math.floor((stats.conceded || 0) / 2) : stats[a.key] || 0
    const unit = a.pts[role] || 0
    if (!count || !unit) continue
    const pts = unit * count
    lines.push({ key: a.key, label: a.short, count, pts })
    if (pts > 0) plus += pts
    else minus += pts
  }
  const bonus = round1(plus * mult - plus)
  let total = plus * mult + minus
  if (captain) total *= CAPTAIN_MULT
  return { role, lines, base: plus + minus, bonus, malus: minus, mult, captain, total: round1(total) }
}

export function scoreLineup(team, statsBySlot, captainSlot) {
  const cards = {}
  let total = 0
  for (const slot of Object.keys(ROLE_OF_SLOT)) {
    const card = team[slot]
    if (!card) continue
    const r = scoreCard(card, statsBySlot[slot] || {}, { slot, captain: slot === captainSlot })
    cards[slot] = r
    total += r.total
  }
  return { cards, total: round1(total) }
}

// ----------------------------------------------------------------------------
// Simulation d'un week-end (APERÇU uniquement, en attendant le flux de stats IRL).
// Déterministe pour une graine donnée : le même aperçu ne change pas au rechargement.
// ----------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 }
const poisson = (r, l) => { let k = 0; let p = Math.exp(-l); let s = p; const u = r(); while (u > s && k < 6) { k++; p *= l / k; s += p } return k }

export function simulateStats(card, slot, seedKey) {
  const r = rng(hash(`${seedKey}:${card?.id}:${slot}`))
  const role = ROLE_OF_SLOT[slot]
  const starter = r() < 0.82
  const sub = !starter && r() < 0.7
  if (!starter && !sub) return { played: 0, sub: 0 }
  const f = starter ? 1 : 0.35
  const conceded = poisson(r, 1.25)
  return {
    played: starter ? 1 : 0,
    sub: sub ? 1 : 0,
    goals: poisson(r, (role === 'ATT' ? 0.48 : role === 'MID' ? 0.14 : 0.003) * f),
    assists: poisson(r, (role === 'ATT' ? 0.22 : role === 'MID' ? 0.18 : 0.01) * f),
    shots: poisson(r, (role === 'ATT' ? 1.3 : role === 'MID' ? 0.5 : 0) * f),
    clean: conceded === 0 && starter && role !== 'ATT' ? 1 : 0,
    saves: role === 'GK' ? poisson(r, 3.1) : 0,
    conceded: role === 'ATT' ? 0 : conceded,
    yellow: r() < 0.13 ? 1 : 0,
    red: r() < 0.012 ? 1 : 0,
    ownGoal: r() < 0.01 ? 1 : 0,
  }
}

// ----------------------------------------------------------------------------
// Calendrier : composition jusqu'au vendredi 19:00, matchs le week-end,
// résultats le lundi soir. (Heure locale du navigateur ; côté serveur, la vérité
// est la colonne gameweeks.deadline en timestamptz.)
// ----------------------------------------------------------------------------
export const SEASON_START = new Date(2026, 7, 14, 19, 0, 0) // vendredi 14 août 2026, 19:00

export function nextFriday19(from = new Date()) {
  const d = new Date(from)
  d.setHours(19, 0, 0, 0)
  const diff = (5 - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  if (d <= from) d.setDate(d.getDate() + 7)
  return d
}

export function gameweekInfo(now = new Date()) {
  const deadline = nextFriday19(now)
  const lastDeadline = new Date(deadline); lastDeadline.setDate(deadline.getDate() - 7)
  const lastResults = new Date(lastDeadline); lastResults.setDate(lastDeadline.getDate() + 3); lastResults.setHours(23, 0, 0, 0)
  // entre vendredi 19:00 et lundi 23:00 : les matchs se jouent, les équipes sont figées
  const live = now >= lastDeadline && now < lastResults
  const number = Math.max(1, Math.round((deadline - SEASON_START) / (7 * 864e5)) + 1)
  const weekendStart = new Date(deadline); weekendStart.setDate(deadline.getDate() + 1)
  const weekendEnd = new Date(deadline); weekendEnd.setDate(deadline.getDate() + 3)
  return {
    phase: live ? 'live' : 'open',
    number: live ? number - 1 : number,
    deadline: live ? lastDeadline : deadline,
    resultsAt: live ? lastResults : new Date(weekendEnd.setHours(23, 0, 0, 0)),
    msLeft: live ? lastResults - now : deadline - now,
    range: live ? null : [weekendStart, new Date(deadline.getTime() + 3 * 864e5)],
  }
}

export function splitMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}
