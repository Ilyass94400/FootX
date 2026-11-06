// ============================================================================
// Prix conseillé à la mise en vente : RARETÉ + POPULARITÉ de la carte.
//
// Popularité (0 → 1), quatre signaux :
//   demande  35 % : ventes des 30 derniers jours + enchères des 7 derniers jours
//   club     25 % : grands clubs (Barça, Real, PSG, Bayern, Man City)
//   rareté   20 % : peu d'exemplaires en jeu = plus recherchée
//   note     20 % : note du joueur
// La rareté fixe la fourchette (min → max) ; la popularité place le prix dedans.
// S'il y a des ventes récentes, le prix se rapproche de ce que les joueurs ont vraiment payé,
// et il reste sous l'annonce la moins chère pour vendre vite.
// ============================================================================
import { ecoOf, rarityKey } from './config'
import { cardRating } from '../collectif'

const BIG = ['fc-barcelone', 'fc-barcelona', 'barcelona', 'barcelone', 'barca', 'real-madrid', 'paris-saint-germain', 'paris-sg', 'psg',
  'bayern-munich', 'fc-bayern-munchen', 'bayern-munchen', 'fc-bayern', 'bayern', 'manchester-city', 'man-city']
const key = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const isBigClub = (club) => { const k = key(club); return !!k && BIG.some((b) => k === b || k.includes(b)) }

const r50 = (v) => Math.round(v / 50) * 50
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export function popularity(card, st = {}) {
  const demandN = (st.sales || 0) + (st.bids || 0) / 3
  const parts = {
    demand: 1 - Math.exp(-demandN / 4),
    club: isBigClub(card?.club) ? 1 : 0,
    scarcity: st.copies ? 1 / (1 + (st.copies - 1) / 3) : 0.5,
    rating: clamp((cardRating({ ...card, rarity: rarityKey(card?.rarity) }) - 60) / 35, 0, 1),
  }
  const score = 0.35 * parts.demand + 0.25 * parts.club + 0.2 * parts.scarcity + 0.2 * parts.rating
  return { score, stars: clamp(Math.round(score * 5 + 0.4), 1, 5), parts }
}

// → { start, buyNow, value, pop, reasons[] }
export function priceAdvice(card, st = {}) {
  const e = ecoOf(card)
  const pop = popularity(card, st)
  let value = e.min * Math.pow(e.max / e.min, 0.08 + 0.32 * pop.score)
  const reasons = []
  if (st.sales > 0 && st.median) {
    const w = Math.min(0.7, 0.35 * st.sales)
    value = value * (1 - w) + st.median * w
    reasons.push({ tone: 'good', text: `${st.sales} vente${st.sales > 1 ? 's' : ''} ce mois · prix médian ${fmt(st.median)}` })
  } else reasons.push({ tone: 'info', text: 'Pas encore de vente récente : prix estimé' })
  if (pop.parts.club) reasons.push({ tone: 'good', text: 'Grand club : très demandé' })
  if (st.bids > 0) reasons.push({ tone: 'good', text: `${st.bids} enchère${st.bids > 1 ? 's' : ''} sur cette carte cette semaine` })
  if (st.copies) reasons.push({ tone: st.copies <= 2 ? 'good' : 'info', text: st.copies <= 1 ? 'Exemplaire unique en jeu' : `${st.copies} exemplaires en jeu` })

  let start = r50(value * 0.85)
  if (st.active > 0 && st.lowestBid) {
    // concurrence : on se place juste sous l'annonce la moins chère
    start = Math.min(start, r50(st.lowestBid * 0.95))
    reasons.push({ tone: 'warn', text: `${st.active} déjà en vente dès ${fmt(st.lowestBid)}` })
  }
  start = clamp(start, e.min, e.max - 50)
  let buyNow = r50(Math.max(value * 1.6, start * 1.5))
  if (st.lowestBn) buyNow = Math.min(buyNow, r50(st.lowestBn * 0.97))
  buyNow = clamp(buyNow, start + 50, e.max)
  return { start, buyNow, value: Math.round(value), pop, reasons, quick: e.quicksell, min: e.min, max: e.max }
}

const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
