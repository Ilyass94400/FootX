// ============================================================================
// FootX · Collectif (chimie entre joueurs) + plafonds de rareté — PUR, sans React.
// Le même fichier sert au Team Builder (affichage), au moteur de match (bonus/malus)
// et pourra servir côté serveur pour valider une compo PvP.
// ============================================================================

// Formation 5v5 (demi-terrain, on attaque vers le haut) :
//          A1 ─── A2
//          │       │
//          D1 ─── D2
//            \   /
//             GK
// Deux joueurs ADJACENTS partagent un lien. 6 liens au total.
export const LINKS = [
  ['A1', 'A2'],
  ['A1', 'D1'],
  ['A2', 'D2'],
  ['D1', 'D2'],
  ['D1', 'GK'],
  ['D2', 'GK'],
]
export const NEIGHBORS = LINKS.reduce((acc, [a, b]) => {
  ;(acc[a] ||= []).push(b)
  ;(acc[b] ||= []).push(a)
  return acc
}, {})
export const SLOT_IDS = ['GK', 'D1', 'D2', 'A1', 'A2']
export const MAX_CHEM = 3
export const MAX_TEAM_CHEM = SLOT_IDS.length * MAX_CHEM // 15

const norm = (v) => String(v || '').trim().toLowerCase()
const rarityOf = (card) => norm(card?.rarity) || 'commune'

// ---- Qualité d'un lien entre deux cartes ----------------------------------
//   0 = aucun point commun (rouge), 1 = même pays OU même club (jaune),
//   2 = même pays ET même club (vert).
export function linkBetween(a, b) {
  if (!a || !b) return { value: 0, club: false, country: false, active: false }
  const club = !!norm(a.club) && norm(a.club) === norm(b.club)
  const country = !!norm(a.country) && norm(a.country) === norm(b.country)
  return { value: (club ? 1 : 0) + (country ? 1 : 0), club, country, active: true }
}

// ---- Effet du collectif individuel sur le match ---------------------------
//   adv   : avantage ajouté au duel (échelle -3..+3 du moteur)
//   zone  : multiplicateur de la zone verte du QTE
//   stat  : bonus/malus affiché sur la note de la carte
export const CHEM_EFFECT = {
  0: { label: 'Isolé', tone: 'red', adv: -0.45, zone: 0.8, stat: -4 },
  1: { label: 'Faible', tone: 'yellow', adv: -0.1, zone: 0.94, stat: -1 },
  2: { label: 'Bon', tone: 'green', adv: 0.15, zone: 1.06, stat: 1 },
  3: { label: 'Parfait', tone: 'green', adv: 0.35, zone: 1.18, stat: 3 },
}

// ---- Calcul complet -------------------------------------------------------
// Collectif d'une carte = somme des points de ses liens avec ses voisins présents,
// plafonnée à 3. Un attaquant (2 voisins) atteint 3/3 avec 1 lien vert + 1 jaune ;
// un milieu (3 voisins) peut y arriver avec 3 liens jaunes.
export function computeChemistry(team) {
  const links = LINKS.map(([a, b]) => ({ a, b, ...linkBetween(team[a], team[b]) }))
  const cards = {}
  let total = 0
  for (const id of SLOT_IDS) {
    const card = team[id]
    if (!card) { cards[id] = null; continue }
    const mine = links.filter((l) => l.active && (l.a === id || l.b === id))
    const raw = mine.reduce((s, l) => s + l.value, 0)
    const chem = Math.min(MAX_CHEM, raw)
    cards[id] = { chem, raw, effect: CHEM_EFFECT[chem], links: mine.length }
    total += chem
  }
  return { links, cards, total, max: MAX_TEAM_CHEM, percent: Math.round((total / MAX_TEAM_CHEM) * 100) }
}

// Collectif par id de carte (pour le moteur de match).
export function chemByCardId(team) {
  const { cards } = computeChemistry(team)
  const out = {}
  for (const id of SLOT_IDS) if (team[id] && cards[id]) out[team[id].id] = cards[id].chem
  return out
}

// ---- Plafonds de rareté (anti pay-to-win) -------------------------------------
export const RARITY_CAP = { iconique: 1, legendaire: 2 }
const CAP_LABEL = { iconique: 'Iconique', legendaire: 'Légendaire' }

export function rarityCount(team, exceptSlots = []) {
  const n = {}
  for (const id of SLOT_IDS) {
    if (exceptSlots.includes(id) || !team[id]) continue
    const r = rarityOf(team[id])
    n[r] = (n[r] || 0) + 1
  }
  return n
}

// Peut-on poser `card` sur `slotId` ? La carte remplacée (et la carte elle-même si elle
// est déjà ailleurs dans l'équipe, c'est alors un déplacement) ne comptent pas.
//   → { ok: true } ou { ok: false, reason, title, message, blockers: [slotIds] }
export function canPlace(team, slotId, card, fitsSlot) {
  if (!card) return { ok: false, reason: 'empty' }
  if (fitsSlot && !fitsSlot(card, slotId)) {
    return { ok: false, reason: 'role', title: 'Mauvais poste', message: slotId === 'GK' ? 'Seul un gardien peut garder les cages.' : 'Un gardien ne peut pas jouer dans le champ.', blockers: [] }
  }
  const already = SLOT_IDS.filter((id) => team[id]?.id === card.id && id !== slotId)
  const r = rarityOf(card)
  const cap = RARITY_CAP[r]
  if (cap != null) {
    const count = rarityCount(team, [slotId, ...already])[r] || 0
    if (count >= cap) {
      const blockers = SLOT_IDS.filter((id) => id !== slotId && !already.includes(id) && rarityOf(team[id]) === r)
      return {
        ok: false, reason: 'cap-' + r, rarity: r, blockers,
        title: cap === 1 ? `Une seule ${CAP_LABEL[r]} par équipe` : `${cap} ${CAP_LABEL[r]}s maximum`,
        message: `Retire ${blockers.map((id) => team[id]?.name).filter(Boolean).join(' ou ')} pour aligner ${card.name}.`,
      }
    }
  }
  return { ok: true }
}

// Vérifie une équipe entière (ex. une compo sauvegardée avant l'arrivée des plafonds).
export function validateTeam(team) {
  const n = rarityCount(team)
  const errors = Object.entries(RARITY_CAP)
    .filter(([r, cap]) => (n[r] || 0) > cap)
    .map(([r, cap]) => ({ rarity: r, count: n[r], cap, message: `${n[r]} ${CAP_LABEL[r]}s alignées (max ${cap})` }))
  return { ok: errors.length === 0, errors, count: n }
}

// Aperçu : collectif que gagnerait l'équipe si on posait `card` sur `slotId`.
export function previewPlacement(team, slotId, card) {
  const before = computeChemistry(team)
  const next = { ...team }
  for (const id of SLOT_IDS) if (next[id]?.id === card.id) next[id] = null
  next[slotId] = card
  const after = computeChemistry(next)
  return { chem: after.cards[slotId]?.chem ?? 0, delta: after.total - before.total, after }
}
