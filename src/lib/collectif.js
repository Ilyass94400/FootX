// Logique de composition d'équipe FootX (5 titulaires) + score de "Collectif".
// Pur, sans React — testable et réutilisable côté serveur pour valider une compo PvP.

import { RARITIES } from './rarity'
import { computeChemistry, canPlace } from './chemistry'

const RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i + 1])) // commune=1 … iconique=6

// Rôle d'une carte à partir de son champ `position` (tolérant aux variantes de données).
export function roleOf(position) {
  const p = String(position || '').trim().toLowerCase()
  if (/^(gb|g|gk|gar|gardien|goal)/.test(p)) return 'GK'
  // attaquants : ST, CF, LW, RW, SS, BU, AVC, AIG/AID, ATT…
  if (/^(att|bu|avc|ail|aig|aid|st|cf|lw(?!b)|rw(?!b)|ss|fw|lf|rf|ap)/.test(p)) return 'ATT'
  // défenseurs et milieux : CB, LB, RB, LWB, RWB, CDM, CM, CAM, LM, RM, DC, DG, DD, MDC, MC, MOC, DEF, MIL…
  if (/^(def|dc|dg|dd|dl|lat|cb|lb|rb|lwb|rwb|sw|mil|mdc|mc|moc|mg|md|cdm|cm|cam|lm|rm|dm|am|m$)/.test(p)) return 'MID'
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
  if (!card || !slot) return false
  return slot.accepts.includes(roleOf(card.position))
}

export const fitsSlot = (card, slotId) => fits(card, SLOTS.find((s) => s.id === slotId))

// Rating d'une carte : champ `rating` si présent, sinon estimé depuis la rareté.
export function cardRating(card) {
  if (typeof card?.rating === 'number') return card.rating
  return { commune: 62, atypique: 70, rare: 78, epique: 84, legendaire: 89, iconique: 93 }[card?.rarity?.toLowerCase()] || 65
}

// --- Score de Collectif d'équipe -----------------------------------------------
// Détail transparent (facile à équilibrer / afficher) :
//   note      : moyenne des ratings (0..99)
//   alchimie  : 0..100 = collectif des liens entre joueurs ADJACENTS (voir chemistry.js)
//   rareté    : petit bonus moyen de rareté
//   collectif : score final pondéré 0..100
export function computeCollectif(team) {
  const cards = SLOTS.map((s) => team[s.id]).filter(Boolean)
  const filled = cards.length
  if (filled === 0) return { collectif: 0, note: 0, alchimie: 0, rarete: 0, filled: 0, chem: 0, links: { club: 0, country: 0 }, valid: false }

  const note = Math.round(cards.reduce((s, c) => s + cardRating(c), 0) / filled)
  const rarete = Math.round((cards.reduce((s, c) => s + (RANK[c.rarity?.toLowerCase()] || 1), 0) / filled) / 6 * 100)
  const ch = computeChemistry(team)
  const alchimie = ch.percent
  const active = ch.links.filter((l) => l.active)

  // La note porte le gros, l'alchimie et la rareté la relèvent. Équipe incomplète = pénalité.
  const completeness = filled / SLOTS.length
  const raw = note * 0.7 + alchimie * 0.22 + rarete * 0.08
  const collectif = Math.round(raw * completeness)

  return {
    collectif, note, alchimie, rarete, filled, chem: ch.total,
    links: { club: active.filter((l) => l.club).length, country: active.filter((l) => l.country).length },
    valid: filled === SLOTS.length,
  }
}

// Compo automatique : meilleure note d'abord, en respectant les plafonds de rareté,
// puis quelques passes d'amélioration qui échangent des cartes si le collectif y gagne.
export function autoFill(collection) {
  const sorted = [...collection].sort((a, b) => cardRating(b) - cardRating(a))
  const keepers = sorted.filter((c) => roleOf(c.position) === 'GK').slice(0, 40)
  const field = sorted.filter((c) => roleOf(c.position) !== 'GK').slice(0, 70)
  const listFor = (id) => (id === 'GK' ? keepers : field)
  const inTeam = (t, c) => SLOTS.some((s) => t[s.id]?.id === c.id)
  let team = emptyTeam()
  for (const slot of SLOTS) {
    const c = listFor(slot.id).find((x) => !inTeam(team, x) && canPlace(team, slot.id, x, fitsSlot).ok)
    if (c) team[slot.id] = c
  }
  const score = (t) => {
    const ch = computeChemistry(t)
    return SLOTS.reduce((s, sl) => s + (t[sl.id] ? cardRating(t[sl.id]) + ch.cards[sl.id].effect.stat * 1.6 : -200), 0)
  }
  for (let pass = 0; pass < 3; pass++) {
    let improved = false
    for (const slot of SLOTS) {
      let best = score(team)
      for (const c of listFor(slot.id)) {
        if (inTeam(team, c) || !canPlace(team, slot.id, c, fitsSlot).ok) continue
        const t = { ...team, [slot.id]: c }
        const sc = score(t)
        if (sc > best + 0.01) { best = sc; team = t; improved = true }
      }
    }
    if (!improved) break
  }
  return team
}
