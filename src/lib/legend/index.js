// ============================================================================
// Mode Carrière — ton joueur (avatar, XP, arbre de compétences).
// Joueur connecté : sauvegardé en ligne à chaque changement (save_put, migration 20261110).
// ============================================================================
import { useEffect, useState } from 'react'
import { cloudSave, onCloud } from '../cloud'
import {
  BASE_STAT, LEGEND_CLUB, LEGEND_ID, NODE, POSITIONS, SKILL_TREE, STATS, TALENTS, TIERS,
  levelFromXp, tierFor, ultimateFor,
} from './config'
import { avatarUrl } from './avatar'

const KEY = 'footx_legend'
const EVENT = 'footx:legend'

const blank = () => ({ v: 1, avatar: null, xp: 0, skills: {}, granted: {} })
let state = null
const st = () => {
  if (state) return state
  try { const s = JSON.parse(localStorage.getItem(KEY)); state = s?.v === 1 ? s : blank() } catch { state = blank() }
  return state
}
const save = (detail) => {
  try { localStorage.setItem(KEY, JSON.stringify(st())) } catch { /* stockage indisponible */ }
  cloudSave('legend', st()) // sauvegarde en ligne (connecté)
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}

// la partie chargée depuis le serveur remplace la copie en mémoire
if (typeof window !== 'undefined') onCloud((e) => { if (e?.type === 'boot') state = null })
// ---------------------------------------------------------------- calculs dérivés
export function derive(s = st()) {
  if (!s.avatar) return null
  const lv = levelFromXp(s.xp)
  const talent = TALENTS.find((t) => t.id === s.avatar.talent) || TALENTS[0]
  const pos = POSITIONS.find((p) => p.id === s.avatar.position) || POSITIONS[0]
  const stats = Object.fromEntries(STATS.map((x) => [x.id, BASE_STAT + (talent.bonus[x.id] || 0)]))
  const traits = new Set([talent.trait])
  const ultimates = []
  let spent = 0
  for (const [id, rank] of Object.entries(s.skills)) {
    const n = NODE[id]
    if (!n || !rank) continue
    spent += n.cost * rank
    if (n.stat) stats[n.stat] += n.amount * rank
    if (n.trait) traits.add(n.trait)
    if (n.ultimate) ultimates.push(ultimateFor(n.ultimate, pos.id))
  }
  for (const k of Object.keys(stats)) stats[k] = Math.min(99, stats[k])
  const w = { ATT: [0.5, 0.35, 0.15], MIL: [0.35, 0.35, 0.3], DEF: [0.15, 0.3, 0.55], GB: [0.1, 0.2, 0.7] }[pos.id]
  const rating = Math.min(99, Math.round(stats.tir * w[0] + stats.vitesse * w[1] + stats.defense * w[2] + Math.floor(lv.level / 5)))
  const tier = tierFor(lv.level)
  const nextTier = TIERS.find((t) => t.level > lv.level) || null
  return {
    ...s.avatar, xp: s.xp, ...lv, talent, pos, stats, rating, traits: [...traits], ultimates,
    points: lv.level - spent, spent, tier, nextTier, skills: s.skills,
  }
}

// La carte évolutive, utilisable partout comme une carte du catalogue.
export function legendCard(d = derive()) {
  if (!d) return null
  return {
    id: LEGEND_ID, legend: true, name: d.name, position: d.pos.short, country: d.country, club: LEGEND_CLUB,
    rarity: d.tier.rarity, rating: d.rating, image_url: avatarUrl(d.look, { number: d.number }),
    traits: d.traits, ultimates: d.ultimates, stats: d.stats, level: d.level, look: d.look, number: d.number,
  }
}

// Met à jour la Légende dans une compo sauvegardée (sa note et son look évoluent).
export function refreshLegendInTeam(team) {
  if (!team) return team
  const card = legendCard()
  const out = { ...team }
  for (const k of Object.keys(out)) if (out[k]?.id === LEGEND_ID) out[k] = card
  return out
}

// ---------------------------------------------------------------- actions
export class LegendError extends Error {}

export function createAvatar({ name, number, position, country, look, talent }) {
  const n = String(name || '').trim()
  if (n.length < 2 || n.length > 16) throw new LegendError('Le nom doit faire entre 2 et 16 caractères.')
  if (!POSITIONS.some((p) => p.id === position)) throw new LegendError('Choisis un poste.')
  if (!TALENTS.some((t) => t.id === talent)) throw new LegendError('Choisis un talent.')
  const s = st()
  if (s.avatar) throw new LegendError('Ta Légende existe déjà.')
  s.avatar = { name: n, number: Math.max(1, Math.min(99, +number || 10)), position, country, look, talent, createdAt: Date.now() }
  s.xp = 0
  s.skills = {}
  save({ type: 'created' })
  return derive()
}

export function canUnlock(id, d = derive()) {
  const n = NODE[id]
  if (!d || !n) return { ok: false, reason: 'Compétence introuvable' }
  const rank = d.skills[id] || 0
  if (rank >= n.maxRank) return { ok: false, reason: 'Déjà au maximum', maxed: true }
  if (d.level < n.level) return { ok: false, reason: `Niveau ${n.level} requis`, locked: true }
  if (n.requires.some((r) => !d.skills[r])) return { ok: false, reason: 'Débloque d\'abord la compétence précédente', locked: true }
  if (d.points < n.cost) return { ok: false, reason: `${n.cost} point${n.cost > 1 ? 's' : ''} requis` }
  return { ok: true }
}

export function unlockNode(id) {
  const before = derive()
  const c = canUnlock(id, before)
  if (!c.ok) throw new LegendError(c.reason)
  const s = st()
  s.skills[id] = (s.skills[id] || 0) + 1
  const after = derive()
  save({ type: 'unlock', id, before, after })
  return { before, after, node: NODE[id] }
}

// XP (idempotent : la même clé — un match — ne paie qu'une fois)
export function grantXp(amount, key) {
  const s = st()
  if (!s.avatar || !(amount > 0)) return null
  if (key && s.granted[key]) return null
  const before = derive()
  const gain = Math.round(amount * (1 + (before.talent.xpBonus || 0)))
  s.xp += gain
  if (key) s.granted[key] = true
  const keys = Object.keys(s.granted)
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete s.granted[k]
  const after = derive()
  const res = { gain, before, after, levelsGained: after.level - before.level, tierUp: after.tier.rarity !== before.tier.rarity }
  save({ type: 'xp', ...res })
  return res
}

export function resetLegend() {
  state = blank()
  save({ type: 'reset' })
}

// ---------------------------------------------------------------- hooks
export function useLegend() {
  const [d, setD] = useState(() => derive())
  useEffect(() => {
    const h = () => setD(derive())
    window.addEventListener(EVENT, h)
    return () => window.removeEventListener(EVENT, h)
  }, [])
  return d
}
export function onLegend(cb) {
  const h = (e) => cb(e.detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

export { SKILL_TREE, NODE }
