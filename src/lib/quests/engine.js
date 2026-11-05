// ============================================================================
// Moteur des Défis — PUR (aucun React, aucun stockage). Même logique que les
// fonctions SQL de 20261106_defis.sql (_quest_period, _ensure_quests, record_event).
// ============================================================================
import { ALL, BY_ID, DAILY, DAILY_SLOTS } from './templates'

const pad = (n) => String(n).padStart(2, '0')

// Clé de période : '2026-11-05' (jour), '2026-W45' (semaine ISO, lundi), 'career'.
export function periodKey(category, d = new Date()) {
  if (category === 'daily') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (category === 'weekly') {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day) // jeudi de la semaine ISO
    const y = t.getUTCFullYear()
    const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)
    return `${y}-W${pad(week)}`
  }
  return 'career'
}

// Prochaine réinitialisation (minuit / lundi minuit, heure locale).
export function resetsAt(category, d = new Date()) {
  if (category === 'milestone') return null
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  if (category === 'weekly') r.setDate(r.getDate() + ((8 - r.getDay()) % 7))
  return r.getTime()
}

const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

// Les quotidiens du jour : tirage fixe pour un joueur et un jour (même principe que md5 côté SQL).
export function dailyPicks(seed, dayKey) {
  return [...DAILY].sort((a, b) => hash(seed + dayKey + a.id) - hash(seed + dayKey + b.id)).slice(0, DAILY_SLOTS).map((q) => q.id)
}

export const rowKey = (id, period) => id + '|' + period

// Les défis actifs maintenant (et crée leurs lignes si besoin). Mute `state.rows`.
export function currentQuests(state, now = new Date()) {
  const day = periodKey('daily', now)
  const ids = new Set(dailyPicks(state.seed, day))
  const out = []
  for (const q of ALL) {
    if (q.category === 'daily' && !ids.has(q.id)) continue
    const period = periodKey(q.category, now)
    const k = rowKey(q.id, period)
    state.rows[k] ||= { progress: 0, completedAt: null, claimedAt: null }
    out.push({ ...q, period, ...state.rows[k], resetsAt: resetsAt(q.category, now) })
  }
  return out
}

const matches = (filter, payload) => !filter || Object.entries(filter).every(([k, v]) => String(payload?.[k] ?? '').toLowerCase() === String(v).toLowerCase())

// Un événement de jeu fait avancer les défis ouverts qui l'écoutent.
// Retourne les défis qui viennent d'être TERMINÉS (pour le toast "Défi terminé !").
export function applyEvent(state, type, amount = 1, payload = {}, now = new Date()) {
  if (!(amount > 0)) return []
  const done = []
  for (const q of currentQuests(state, now)) {
    if (q.event !== type || q.completedAt || !matches(q.filter, payload)) continue
    const row = state.rows[rowKey(q.id, q.period)]
    row.progress = Math.min(q.target, q.mode === 'max' ? Math.max(row.progress, amount) : row.progress + amount)
    if (row.progress >= q.target) { row.completedAt = now.getTime(); done.push({ ...q, ...row }) }
  }
  return done
}

// Vérifie qu'un défi peut être réclamé (même règles que claim_quest en SQL).
export function canClaim(state, id, period) {
  const row = state.rows[rowKey(id, period)]
  if (!BY_ID[id] || !row) return { ok: false, message: 'Défi introuvable' }
  if (!row.completedAt) return { ok: false, message: 'Défi pas encore terminé' }
  if (row.claimedAt) return { ok: false, message: 'Récompense déjà récupérée' }
  return { ok: true, row, quest: BY_ID[id] }
}

// Nettoyage : on garde la carrière et les 3 dernières semaines.
export function prune(state, now = new Date()) {
  const keepWeeks = new Set([0, 7, 14].map((d) => periodKey('weekly', new Date(now.getTime() - d * 864e5))))
  const keepDays = new Set(Array.from({ length: 7 }, (_, i) => periodKey('daily', new Date(now.getTime() - i * 864e5))))
  for (const k of Object.keys(state.rows)) {
    const p = k.split('|')[1]
    if (p !== 'career' && !keepWeeks.has(p) && !keepDays.has(p)) delete state.rows[k]
  }
}
