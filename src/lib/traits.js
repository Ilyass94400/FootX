// Traits = passifs des cartes qui influencent les duels.
//
// Aujourd'hui la table Supabase `cards` n'a pas de colonne traits : on en DÉRIVE
// donc de façon déterministe (rareté + id) pour que chaque carte ait déjà du
// caractère. Dès que tu ajoutes une colonne `traits jsonb` (tableau d'ids),
// getTraits la lira en priorité. Migration conseillée :
//   alter table cards add column traits jsonb default '[]'::jsonb;

export const TRAITS = {
  puissance: { id: 'puissance', name: 'Puissance',        side: 'atk', desc: '+1 avantage sur un Tir en force.' },
  sangfroid: { id: 'sangfroid', name: 'Sang-froid',       side: 'atk', desc: 'Fenêtre de QTE élargie face au but.' },
  dribbleur: { id: 'dribbleur', name: 'Feinte de corps',  side: 'atk', desc: 'Ne peut pas être pris à contre-pied à fond (avantage min 0).' },
  mur:       { id: 'mur',       name: 'Mur',              side: 'def', desc: 'Réduit la zone de réussite du QTE adverse.' },
  reflexes:  { id: 'reflexes',  name: 'Réflexes félins',  side: 'def', desc: 'Raccourcit le temps de réaction du QTE.' },
  lecture:   { id: 'lecture',   name: 'Lecture du jeu',   side: 'def', desc: "Devine mieux l'intention de l'attaquant." },
}

const ATK_POOL = ['puissance', 'sangfroid', 'dribbleur']
const DEF_POOL = ['mur', 'reflexes', 'lecture']

// Nombre de traits selon la rareté
const COUNT = { commune: 0, atypique: 1, rare: 1, epique: 2, legendaire: 2, iconique: 3 }

// hash stable d'une chaîne -> entier positif
const hash = (s) => {
  let h = 0
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0
  return Math.abs(h)
}

// Un gardien (poste GB/G) pioche dans les traits défensifs, sinon offensifs.
const isKeeper = (card) => /^(gb|g|gk)$/i.test(card?.position || '')

// Renvoie la liste d'ids de traits d'une carte.
export function getTraits(card) {
  if (Array.isArray(card?.traits) && card.traits.length) return card.traits.filter((t) => TRAITS[t])
  const n = COUNT[card?.rarity?.toLowerCase()] ?? 1
  if (n === 0) return []
  const pool = isKeeper(card) ? DEF_POOL : ATK_POOL
  const h = hash(card?.id ?? card?.name ?? 'x')
  const out = []
  for (let i = 0; i < n && i < pool.length; i++) out.push(pool[(h + i) % pool.length])
  return [...new Set(out)]
}

// Applique les traits offensifs sur l'avantage brut (mutation loguée).
export function applyAtkTraits(adv, tactic, atkTraits, log = []) {
  if (atkTraits.includes('puissance') && tactic === 'force') { adv += 1; log.push('Trait Puissance : +1') }
  if (atkTraits.includes('dribbleur') && adv < 0) { adv = 0; log.push('Trait Feinte : contre-pied annulé (avantage 0)') }
  return adv
}

// Applique les traits défensifs (+ sang-froid offensif) sur les paramètres du QTE.
export function applyDefTraits({ windowMs, zone }, defTraits, atkTraits, log = []) {
  if (atkTraits.includes('sangfroid')) { zone += 0.06; log.push('Trait Sang-froid : zone +6%') }
  if (defTraits.includes('mur')) { zone -= 0.05; log.push('Trait Mur : zone -5%') }
  if (defTraits.includes('reflexes')) { windowMs -= 150; log.push('Trait Réflexes : -150 ms') }
  return { windowMs, zone }
}
