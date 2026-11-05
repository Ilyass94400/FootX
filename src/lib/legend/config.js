// ============================================================================
// Mode Carrière "Légende" — règles. MIROIR de la table `avatar_skill_nodes`
// et des fonctions de supabase/migrations/20261107_legende.sql.
// ============================================================================

export const LEGEND_ID = 'legend' // id de la carte évolutive dans les équipes
export const LEGEND_CLUB = 'FootX Académie'

export const POSITIONS = [
  { id: 'ATT', label: 'Attaquant', short: 'ATT', role: 'ATT', desc: 'Finisseur. Brille quand il attaque.' },
  { id: 'MIL', label: 'Milieu', short: 'MIL', role: 'MID', desc: 'Polyvalent. Relie toute l\'équipe.' },
  { id: 'DEF', label: 'Défenseur', short: 'DEF', role: 'MID', desc: 'Rocher. Coupe les attaques adverses.' },
  { id: 'GB', label: 'Gardien', short: 'GB', role: 'GK', desc: 'Dernier rempart. Arrête l\'impossible.' },
]

export const COUNTRIES = ['France', 'Belgique', 'Suisse', 'Maroc', 'Algérie', 'Tunisie', 'Sénégal', 'Côte d\'Ivoire', 'Cameroun', 'Espagne', 'Portugal', 'Italie', 'Allemagne', 'Angleterre', 'Pays-Bas', 'Brésil', 'Argentine', 'Japon']

// Apparence (portrait SVG maison, aucun visuel externe)
export const LOOKS = {
  skin: ['#f6d7c3', '#e8b896', '#c98e66', '#9a6440', '#6b4229'],
  hair: [
    { id: 'pics', label: 'Pics' },
    { id: 'crete', label: 'Crête' },
    { id: 'meche', label: 'Mèche' },
    { id: 'long', label: 'Longs' },
    { id: 'bandeau', label: 'Bandeau' },
  ],
  hairColor: ['#151515', '#5a3a22', '#e8c45a', '#f2f2f2', '#ff5a3c', '#3fa9ff', '#9b6bff', '#2ed573'],
  eyes: ['#3b2a1a', '#2f7fd8', '#2bbf7a', '#ffb000', '#ff4d5e', '#c56bff'],
  aura: ['#ff6a2b', '#3fa9ff', '#e4ff3c', '#c56bff', '#ff3d7f', '#2ed573'],
}

// Talents de base : bonus de départ + passif en match (via les traits de carte existants)
export const TALENTS = [
  { id: 'buteur', label: 'Instinct du buteur', desc: '+6 Tir. Ta frappe en force pèse plus lourd.', bonus: { tir: 6 }, trait: 'puissance', color: '#ff6a2b' },
  { id: 'foudre', label: 'Foudre', desc: '+6 Vitesse. Impossible à prendre totalement à contre-pied.', bonus: { vitesse: 6 }, trait: 'dribbleur', color: '#3fa9ff' },
  { id: 'rempart', label: 'Rempart', desc: '+6 Défense. Réduit la zone de réussite adverse.', bonus: { defense: 6 }, trait: 'mur', color: '#2ed573' },
  { id: 'maestro', label: 'Maestro', desc: '+2 partout et +10 % d\'XP gagnée.', bonus: { tir: 2, vitesse: 2, defense: 2 }, xpBonus: 0.1, trait: 'lecture', color: '#e4ff3c' },
]

export const STATS = [
  { id: 'tir', label: 'Tir', color: '#ff6a2b' },
  { id: 'vitesse', label: 'Vitesse', color: '#3fa9ff' },
  { id: 'defense', label: 'Défense', color: '#2ed573' },
]
export const BASE_STAT = 58

// Capacités Ultimes (une par branche ; Défense change de nom pour un gardien)
export const ULTIMATES = {
  meteore: { id: 'meteore', name: 'Frappe Météore', side: 'atk', move: 'force', color: '#ff6a2b', color2: '#ffd25c', line: 'Le ciel s\'embrase.' },
  eclair: { id: 'eclair', name: 'Dribble Éclair', side: 'atk', move: 'feinte', color: '#3fa9ff', color2: '#e8fbff', line: 'Trop rapide pour être vu.' },
  fantome: { id: 'fantome', name: 'Tacle Fantôme', side: 'def', move: 'sortir', color: '#9b6bff', color2: '#e6dbff', line: 'Il surgit de nulle part.' },
  acier: { id: 'acier', name: 'Mur d\'Acier', side: 'def', move: 'plonger', color: '#2ed573', color2: '#d6ffe4', line: 'Rien ne passe.' },
  // aperçu uniquement (prototype de cinématique) — pas dans l'arbre
  tigre: { id: 'tigre', name: 'Tir du Tigre', side: 'atk', move: 'force', color: '#ffb000', color2: '#fff1b8', line: 'Le fauve sort ses griffes.' },
}
export const ultimateFor = (nodeUltimate, position) => (nodeUltimate === 'fantome' && position === 'GB' ? ULTIMATES.acier : ULTIMATES[nodeUltimate])

// Arbre de compétences : 3 branches × 6 nœuds (de bas en haut).
//   kind : stat | trait | mastery (répétable) | ultimate
const branch = (b, color, trait, ult) => [
  { id: `${b}1`, branch: b, tier: 1, kind: 'stat', stat: b, amount: 3, cost: 1, level: 1, requires: [] },
  { id: `${b}2`, branch: b, tier: 2, kind: 'stat', stat: b, amount: 4, cost: 1, level: 4, requires: [`${b}1`] },
  { id: `${b}3`, branch: b, tier: 3, kind: 'trait', trait, cost: 2, level: 8, requires: [`${b}2`] },
  { id: `${b}4`, branch: b, tier: 4, kind: 'stat', stat: b, amount: 5, cost: 2, level: 14, requires: [`${b}3`] },
  { id: `${b}5`, branch: b, tier: 5, kind: 'mastery', stat: b, amount: 2, cost: 2, level: 20, requires: [`${b}4`], maxRank: 5 },
  { id: `${b}U`, branch: b, tier: 6, kind: 'ultimate', ultimate: ult, cost: 3, level: 25, requires: [`${b}4`] },
].map((n) => ({ maxRank: 1, color, ...n }))

export const SKILL_TREE = [
  ...branch('tir', '#ff6a2b', 'sangfroid', 'meteore'),
  ...branch('vitesse', '#3fa9ff', 'dribbleur', 'eclair'),
  ...branch('defense', '#2ed573', 'reflexes', 'fantome'),
]
export const NODE = Object.fromEntries(SKILL_TREE.map((n) => [n.id, n]))

export const TRAIT_LABEL = {
  puissance: 'Puissance', sangfroid: 'Sang-froid', dribbleur: 'Feinte de corps', mur: 'Mur', reflexes: 'Réflexes félins', lecture: 'Lecture du jeu',
}

// XP : niveau max 50, 1 point de compétence par niveau (1 au départ).
export const MAX_LEVEL = 50
export const xpToNext = (level) => 80 + 25 * (level - 1)
export function levelFromXp(xp) {
  let level = 1
  let rest = Math.max(0, xp)
  while (level < MAX_LEVEL && rest >= xpToNext(level)) { rest -= xpToNext(level); level++ }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) }
}

// Paliers de rareté (la carte change de look)
export const TIERS = [
  { level: 1, rarity: 'commune' },
  { level: 5, rarity: 'atypique' },
  { level: 10, rarity: 'rare' },
  { level: 20, rarity: 'epique' },
  { level: 35, rarity: 'legendaire' },
  { level: 50, rarity: 'iconique' },
]
export const tierFor = (level) => [...TIERS].reverse().find((t) => level >= t.level)

// XP gagnée en Arène (si la Légende est dans l'équipe)
export const MATCH_XP = { win: 300, loss: 120, goal: 60, perfect: 25 }
