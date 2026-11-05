// ============================================================================
// Clubs du Mode Carrière : dérivés de la table `cards` (colonne `club`).
//   - le prestige d'un club vient de ses cartes (moyenne des 5 meilleures)
//   - en match, ce sont SES joueurs qui composent l'équipe
// ============================================================================
import { supabase } from '../../supabase'
import { SLOTS, cardRating, fitsSlot, roleOf } from '../collectif'
import { crestUrl } from './crest'

export const TIERS = {
  1: { label: 'Élite européenne', short: 'Élite', stars: 5 },
  2: { label: 'Grand club', short: 'Grand club', stars: 4 },
  3: { label: 'Club ambitieux', short: 'Ambitieux', stars: 3 },
  4: { label: 'Club formateur', short: 'Formateur', stars: 2 },
}
export const tierOf = (strength) => (strength >= 86 ? 1 : strength >= 80 ? 2 : strength >= 72 ? 3 : 4)

export const clubKey = (name) => String(name || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const mode = (arr) => {
  const n = {}
  let best = null
  for (const x of arr) { if (!x) continue; n[x] = (n[x] || 0) + 1; if (!best || n[x] > n[best]) best = x }
  return best
}

// Regroupe les cartes par club. Les clubs avec trop peu de joueurs (< 3) sont écartés.
export function buildClubs(cards = []) {
  const by = new Map()
  for (const c of cards) {
    if (!c?.club || c.legend) continue
    const k = clubKey(c.club)
    if (!k) continue
    if (!by.has(k)) by.set(k, { key: k, name: String(c.club).trim(), cards: [] })
    by.get(k).cards.push(c)
  }
  const out = []
  for (const club of by.values()) {
    if (club.cards.length < 3) continue
    const top = club.cards.map(cardRating).sort((a, b) => b - a).slice(0, 5)
    while (top.length < 5) top.push(60)
    const strength = Math.round(top.reduce((a, b) => a + b, 0) / 5)
    const tier = tierOf(strength)
    out.push({ ...club, country: mode(club.cards.map((c) => c.country)) || '', strength, tier, crest: crestUrl(club.name, { tier }) })
  }
  return out.sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name))
}

// Chargement unique (mis en cache pour la session)
let loading = null
export function loadClubs() {
  if (!loading) {
    loading = Promise.resolve(supabase.from('cards').select('*').limit(1000))
      .then(({ data }) => ({ cards: data || [], clubs: buildClubs(data || []) }))
      .catch(() => ({ cards: [], clubs: [] }))
  }
  return loading
}
export const findClub = (clubs, key) => clubs.find((c) => c.key === key) || null

// Réserviste générique quand un club manque de joueurs à un poste
const reserve = (club, slotId, i) => ({
  id: `res-${club.key}-${slotId}-${i}`, name: 'Réserviste', club: club.name, country: club.country,
  position: slotId === 'GK' ? 'GB' : slotId.startsWith('A') ? 'ATT' : 'MIL', rarity: 'commune', image_url: '',
})

// Équipe de 5 d'un club (meilleurs joueurs à chaque poste). `pro` = ton joueur, placé en priorité.
export function clubLineup(club, pro = null) {
  const team = { GK: null, D1: null, D2: null, A1: null, A2: null }
  const used = new Set()
  if (pro) {
    const role = roleOf(pro.position)
    const slot = role === 'GK' ? 'GK' : role === 'ATT' ? 'A1' : 'D1'
    team[slot] = { ...pro, club: club.name }
    used.add(pro.id)
  }
  const pool = [...(club?.cards || [])].sort((a, b) => cardRating(b) - cardRating(a))
  for (const sl of SLOTS) {
    if (team[sl.id]) continue
    const c = pool.find((x) => !used.has(x.id) && fitsSlot(x, sl.id)) || (sl.id !== 'GK' && pool.find((x) => !used.has(x.id) && roleOf(x.position) !== 'GK'))
    if (c) { team[sl.id] = c; used.add(c.id) }
  }
  SLOTS.forEach((sl, i) => { if (!team[sl.id]) team[sl.id] = reserve(club || { key: 'x', name: '', country: '' }, sl.id, i) })
  return team
}
