// ============================================================================
// FootX — taux de drop des boosters + Pity. PUR (aucun React) : le même fichier
// pourra être utilisé par l'Edge Function qui tirera les boosters côté serveur.
//
// Un booster = 10 cartes :
//   - 1 carte VEDETTE : c'est elle qui porte les taux "par booster" ci-dessous
//   - 9 cartes de complément : Commune / Atypique / Rare uniquement
// Les taux affichés sont donc exactement la chance qu'UN booster contienne la rareté.
// ============================================================================

export const PACK_SIZE = 10

// Carte vedette (somme = 1)
export const FEATURED_RATES = [
  ['iconique', 0.01], // 1 %
  ['legendaire', 0.10], // 10 %
  ['epique', 0.15], // 15 %
  ['rare', 0.74], // 74 %
]

// 9 cartes de complément (somme = 1)
export const FILLER_RATES = [
  ['commune', 0.62],
  ['atypique', 0.28],
  ['rare', 0.10],
]

// Pity : compteurs de boosters ouverts DEPUIS la dernière carte de ce niveau.
//   - 200 boosters sans Iconique → le 200e en contient une
//   - 20 boosters sans Épique ou mieux → le 20e en contient une (Épique, Légendaire ou Iconique)
export const PITY = { iconique: 200, epicPlus: 20 }

const ORDER = ['commune', 'atypique', 'rare', 'epique', 'legendaire', 'iconique']
// "Légendaire", "legendaire", " EPIQUE " → même clé (accents et majuscules ignorés)
export const normRarity = (r) => String(r || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export const rankOf = (r) => ORDER.indexOf(normRarity(r))
const EPIC = rankOf('epique')

function weighted(table, rnd) {
  let x = rnd() * table.reduce((a, [, p]) => a + p, 0)
  for (const [r, p] of table) { x -= p; if (x < 0) return r }
  return table[table.length - 1][0]
}

// Tire les raretés d'UN booster et met à jour la pity.
//   pity = { sinceIconic, sinceEpic } → { rarities: [10], featured, forced, pity: nouveau }
export function rollPack(pity, rnd = Math.random) {
  const sinceIconic = (pity?.sinceIconic || 0) + 1
  const sinceEpic = (pity?.sinceEpic || 0) + 1
  let featured = weighted(FEATURED_RATES, rnd)
  let forced = null
  if (featured !== 'iconique' && sinceIconic >= PITY.iconique) {
    featured = 'iconique'
    forced = 'iconique'
  } else if (rankOf(featured) < EPIC && sinceEpic >= PITY.epicPlus) {
    // garantie Épique+ : on retire parmi Épique / Légendaire / Iconique avec leurs poids relatifs
    featured = weighted(FEATURED_RATES.filter(([r]) => rankOf(r) >= EPIC), rnd)
    forced = 'epicPlus'
  }
  const rarities = [featured]
  for (let i = 1; i < PACK_SIZE; i++) rarities.push(weighted(FILLER_RATES, rnd))
  return {
    rarities, featured, forced,
    pity: {
      sinceIconic: featured === 'iconique' ? 0 : sinceIconic,
      sinceEpic: rankOf(featured) >= EPIC ? 0 : sinceEpic,
    },
  }
}

// Choisit une carte de la rareté demandée dans le catalogue.
// Si cette rareté manque (petit catalogue, orthographe différente…), on DESCEND d'un cran,
// jamais vers le haut : un trou dans le catalogue ne doit pas pouvoir créer des Iconiques.
export function makePicker(catalogue, rnd = Math.random) {
  const by = {}
  for (const c of catalogue) (by[normRarity(c.rarity)] ||= []).push(c)
  return (rarity) => {
    const i = Math.max(0, rankOf(rarity))
    const tries = [...ORDER.slice(0, i + 1).reverse(), ...ORDER.slice(i + 1)]
    for (const r of tries) {
      const pool = by[r]
      if (pool?.length) return pool[Math.floor(rnd() * pool.length)]
    }
    return catalogue[Math.floor(rnd() * catalogue.length)]
  }
}

// ---- Pity sauvegardée (navigateur ; côté serveur : une ligne par joueur) ----
const KEY = 'footx_pity'
export function loadPity() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    if (p && Number.isFinite(p.sinceIconic)) return p
  } catch { /* ignore */ }
  // première fois : on reprend la progression de l'ancien compteur (boosters ouverts % 200)
  const old = parseInt(localStorage.getItem('footx_booster_count') || '0', 10) || 0
  return { sinceIconic: old % PITY.iconique, sinceEpic: 0 }
}
export function savePity(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

// Taux réels sur le long terme, pity comprise (calculés, pour l'affichage).
export function effectiveRate(base, pityAt) {
  // espérance du nombre de boosters entre deux tirages = (1 - (1-p)^N) / p
  const expected = (1 - Math.pow(1 - base, pityAt)) / base
  return 1 / expected
}
