// ============================================================================
// Règles du Mode Carrière (pures — reproduites à l'identique dans la migration SQL).
// ============================================================================
export const SEASON_LENGTH = 10 // matchs par saison
export const FIRST_YEAR = 2026
// fin de contrat : année où se termine la dernière saison couverte (until = n° de cette saison)
export const contractEnd = (until) => FIRST_YEAR + until
export const seasonLabel = (n) => `${FIRST_YEAR + n - 1}-${String((FIRST_YEAR + n) % 100).padStart(2, '0')}`

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// Note du match sur 10 (comme L'Équipe / FIFA), à partir de ce que TON joueur a fait.
export function matchRating({ win, goals = 0, perfect = 0, reads = 0, actions = 0, hesitations = 0, keeper = false, saves = 0, conceded = 0 }) {
  let r = 6 + (win ? 0.5 : -0.4) + goals * 1.0 + perfect * 0.3 - hesitations * 0.25
  if (actions > 0) r += (reads / actions - 0.5) * 2
  if (keeper) r += saves * 0.35 - conceded * 0.3
  return Math.round(clamp(r, 3, 10) * 10) / 10
}

// XP gagnée (un match simulé rapporte moitié moins)
export const matchXp = ({ rating, goals = 0, win, sim = false }) => Math.round((40 + rating * 20 + goals * 40 + (win ? 60 : 0)) * (sim ? 0.5 : 1))

export const ratingTone = (r) => (r >= 8 ? 'top' : r >= 7 ? 'good' : r >= 6 ? 'avg' : 'low')

// ---------------------------------------------------------------- bilan de saison
export function seasonStats(fixtures = []) {
  const played = fixtures.filter((f) => f.result)
  const sum = (k) => played.reduce((a, f) => a + (f.result[k] || 0), 0)
  const wins = played.filter((f) => f.result.win).length
  const ratings = played.map((f) => f.result.rating)
  return {
    played: played.length, total: fixtures.length, wins, losses: played.length - wins, points: wins * 3,
    goals: sum('goals'), perfect: sum('perfect'), xp: sum('xp'),
    avg: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : 0,
    best: ratings.length ? Math.max(...ratings) : 0,
    motm: played.filter((f) => f.result.rating >= 8).length, // hommes du match
    form: played.slice(-5).map((f) => (f.result.win ? 'V' : 'D')),
  }
}

// Côte du joueur sur le marché : note moyenne, buts, victoires, niveau
export const marketScore = (st, level) => Math.round(st.avg * 10 + st.goals * 3 + st.wins * 2 + level)
export const reachTier = (score) => (score >= 125 ? 1 : score >= 105 ? 2 : score >= 85 ? 3 : 4)
export const offerCount = (score) => (score >= 100 ? 3 : score >= 80 ? 2 : 1)

const BASE_WAGE = { 1: 90000, 2: 45000, 3: 18000, 4: 7000 } // € / semaine (fictif)
export const wageFor = (tier, score) => Math.round((BASE_WAGE[tier] * (0.8 + score / 250)) / 500) * 500
export const ROLE = { 1: 'Joueur important de l\'effectif', 2: 'Titulaire indiscutable', 3: 'Leader du vestiaire', 4: 'Star du club' }
export const fmtWage = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' €'

// Petit générateur aléatoire déterministe (une saison donne toujours les mêmes offres)
export function rng(seed) {
  let s = seed >>> 0 || 1
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Offres de fin de saison : prolongation du club actuel + 1 à 3 clubs intéressés.
export function buildOffers({ clubs, current, stats, level, season, seed }) {
  const r = rng(seed)
  const score = marketScore(stats, level)
  const reach = reachTier(score)
  const n = offerCount(score)
  const pool = clubs.filter((c) => c.key !== current.key && c.tier >= reach && c.tier <= reach + 1)
  const fallback = clubs.filter((c) => c.key !== current.key)
  const picks = []
  const src = [...(pool.length ? pool : fallback)]
  // les meilleurs clubs accessibles d'abord, avec un peu de hasard
  src.sort((a, b) => a.tier - b.tier + (r() - 0.5) * 1.2)
  for (const c of src) { if (picks.length >= n) break; picks.push(c) }
  const offers = picks.map((c, i) => ({
    id: `s${season}-o${i}-${c.key}`, kind: 'transfer', season, clubKey: c.key, clubName: c.name, tier: c.tier,
    wage: wageFor(c.tier, score), years: c.tier <= 2 ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 3),
    role: ROLE[Math.min(4, Math.max(1, 1 + c.tier - reach + (c.tier >= 3 ? 1 : 0)))],
    bonus: Math.round((wageFor(c.tier, score) * (4 + r() * 8)) / 1000) * 1000,
  }))
  offers.unshift({
    id: `s${season}-renew`, kind: 'renewal', season, clubKey: current.key, clubName: current.name, tier: current.tier,
    wage: Math.round((wageFor(current.tier, score) * 0.9) / 500) * 500, years: 2, role: 'Prolongation de contrat', bonus: 0,
  })
  return { score, reach, offers }
}
