// Logique de composition d'équipe FootX (5 titulaires) + score de "Collectif".
// Pur, sans React — testable et réutilisable côté serveur pour valider une compo PvP.

import { RARITIES } from './rarity'

const RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i + 1])) // commune=1 … iconique=6

// Rôle d'une carte à partir de son champ `position` (tolérant aux variantes de données).
export function roleOf(position) {
  const p = (position || '').toLowerCase()
  if (/^(gb|g|gk)$/.test(p)) return 'GK'
  if (/(def|dc|dl|dg|dd|lat|mdc|mc|mil|m)$/.test(p) || ['def', 'mil'].includes(p)) return 'MID'
  if (/(att|bu|avc|ail|aig|aid|rw|lw|st|fw)$/.test(p) || ['att', 'bu'].includes(p)) return 'ATT'
  return '?' // inconnu -> accepté sur n'importe quel poste de champ
}

// Formation 5v5 : 1 gardien, 2 déf/milieux, 2 attaquants.
export const SLOTS = [
  { id: 'GK', label: 'Gardien',     accepts: ['GK'] },
  { id: 'D1', label: 'Déf / Milieu', accepts: ['MID', '?'] },
  { id: 'D2', label: 'Déf / Milieu', accepts: ['MID', '?'] },
  { id: 'A1', label: 'Attaquant',   accepts: ['ATT', '?'] },
  { id: 'A2', label: 'Attaquant',   accepts: ['ATT', '?'] },
]

export const emptyTeam = () => ({ GK: null, D1: null, D2: null, A1: null, A2: null })

// Une carte peut-elle aller dans ce slot ?
export function fits(card, slot) {
  if (!card) return false
  const role = roleOf(card.position)
  if (slot.id === 'GK') return role === 'GK'
  // slots de champ : tout sauf un gardien
  return role !== 'GK'
}

// Rating d'une carte : champ `rating` si présent, sinon estimé depuis la rareté.
export function cardRating(card) {
  if (typeof card?.rating === 'number') return card.rating
  return { commune: 62, atypique: 70, rare: 78, epique: 84, legendaire: 89, iconique: 93 }[card?.rarity?.toLowerCase()] || 65
}

// --- Score de Collectif ------------------------------------------------------
// Renvoie un détail transparent (donc facile à équilibrer / afficher).
//   note      : moyenne des ratings (0..99)
//   alchimie  : 0..100, liens club (x2) + pays entre les 5 cartes
//   rareté    : petit bonus moyen de rareté
//   collectif : score final pondéré 0..100
export function computeCollectif(team) {
  const cards = SLOTS.map((s) => team[s.id]).filter(Boolean)
  const filled = cards.length
  if (filled === 0) return { collectif: 0, note: 0, alchimie: 0, rarete: 0, filled: 0, links: { club: 0, country: 0 }, valid: false }

  const note = Math.round(cards.reduce((s, c) => s + cardRating(c), 0) / filled)
  const rarete = Math.round((cards.reduce((s, c) => s + (RANK[c.rarity?.toLowerCase()] || 1), 0) / filled) / 6 * 100)

  // Alchimie : pour chaque paire de cartes, +2 si même club, +1 si même pays.
  let clubLinks = 0, countryLinks = 0, points = 0
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].club && cards[i].club === cards[j].club) { clubLinks++; points += 2 }
      if (cards[i].country && cards[i].country === cards[j].country) { countryLinks++; points += 1 }
    }
  }
  const maxPairs = (filled * (filled - 1)) / 2
  const maxPoints = maxPairs * 3 // toutes les paires même club ET même pays
  const alchimie = maxPoints ? Math.round((points / maxPoints) * 100) : 0

  // Pondération : la note porte le gros, l'alchimie et la rareté la relèvent.
  // Pénalité si l'équipe est incomplète (chaque slot vide coûte ~12 pts).
  const completeness = filled / SLOTS.length
  const raw = note * 0.7 + alchimie * 0.22 + rarete * 0.08
  const collectif = Math.round(raw * completeness)

  return {
    collectif, note, alchimie, rarete, filled,
    links: { club: clubLinks, country: countryLinks },
    valid: filled === SLOTS.length,
  }
}

// Remplit automatiquement une compo depuis une collection (meilleur rating d'abord).
export function autoFill(collection) {
  const team = emptyTeam()
  const used = new Set()
  const byRating = [...collection].sort((a, b) => cardRating(b) - cardRating(a))
  for (const slot of SLOTS) {
    const card = byRating.find((c) => !used.has(c.id) && fits(c, slot))
    if (card) { team[slot.id] = card; used.add(card.id) }
  }
  return team
}
