// ============================================================================
// Économie FootX — paramètres. MIROIR des tables `economy_settings` et
// `economy_rarity` (supabase/migrations/20261105_economie.sql).
// Côté serveur, ce sont les tables qui font foi ; ici, c'est pour l'affichage
// et le mode démo local.
// ============================================================================

export const COIN = 'X-Coins'

export const ECONOMY = {
  startBalance: 5000,
  matchWin: 500,
  matchLoss: 100,
  matchDailyCap: 30,
  winBoostersPerDay: 5, // victoire en Arène = +1 booster, 5 par jour
  boosterPrice: 1500,
  marketTaxPct: 5,
  bidStepPct: 5,
  antiSnipeSec: 30,
  maxListings: 30,
  durations: [1, 6, 24], // heures
}

// quicksell < plancher du marché : vendre à un joueur rapporte toujours plus.
// plafond : empêche de "transférer" des coins entre deux comptes via une annonce absurde.
export const RARITY_ECO = {
  commune: { quicksell: 40, min: 150, max: 5000 },
  atypique: { quicksell: 80, min: 250, max: 10000 },
  rare: { quicksell: 200, min: 500, max: 25000 },
  epique: { quicksell: 600, min: 1500, max: 100000 },
  legendaire: { quicksell: 2000, min: 5000, max: 500000 },
  iconique: { quicksell: 6000, min: 15000, max: 2000000 },
}

export const ecoOf = (card) => RARITY_ECO[String(card?.rarity || 'commune').toLowerCase()] || RARITY_ECO.commune

// Enchère minimale suivante (même formule que place_bid côté SQL).
export function minNextBid(listing) {
  if (listing.currentBid == null) return listing.startPrice
  return Math.max(listing.currentBid + 50, Math.ceil((listing.currentBid * (100 + ECONOMY.bidStepPct)) / 100 / 50) * 50)
}

export const afterTax = (price) => price - Math.floor((price * ECONOMY.marketTaxPct) / 100)

// Prix "conseillé" d'une carte : base de rareté modulée par sa note (pour pré-remplir la mise en vente).
export function suggestedPrice(card) {
  const e = ecoOf(card)
  const rating = typeof card?.rating === 'number' ? card.rating : null
  const k = rating ? Math.max(0.8, Math.min(3, 1 + (rating - 75) / 12)) : 1.4
  const start = Math.round((e.min * k) / 50) * 50
  return { start: Math.max(e.min, start), buyNow: Math.min(e.max, Math.round((start * 1.8) / 50) * 50) }
}

export const fmtCoins = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
