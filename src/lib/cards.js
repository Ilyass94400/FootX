// ============================================================================
// Requêtes sur le catalogue des cartes (Wiki, Collection) : filtres + tris,
// paginés côté serveur. Les mêmes tris existent côté client (cartes possédées).
// ============================================================================
import { supabase } from '../supabase'
import { RARITIES } from './rarity'
import { suggestedPrice } from './economy/config'
import { normRarity, RARITY_RANK } from './collection'

export const PAGE = 48
// La rareté peut être écrite de plusieurs façons dans la base (accents, majuscules)
export const VARIANTS = {
  commune: ['commune', 'Commune', 'COMMUNE'],
  atypique: ['atypique', 'Atypique', 'ATYPIQUE'],
  rare: ['rare', 'Rare', 'RARE'],
  epique: ['epique', 'Epique', 'épique', 'Épique', 'EPIQUE', 'ÉPIQUE'],
  legendaire: ['legendaire', 'Legendaire', 'légendaire', 'Légendaire', 'LEGENDAIRE', 'LÉGENDAIRE'],
  iconique: ['iconique', 'Iconique', 'ICONIQUE'],
}

// Tris proposés. Rareté et prix : la base ne sait pas classer "Iconique > Légendaire",
// on lit donc les cartes rareté par rareté (une petite requête par rareté).
export const SORTS = {
  rarity_desc: 'Rareté : meilleures d\'abord',
  rarity_asc: 'Rareté : communes d\'abord',
  price_desc: 'Prix : plus chères',
  price_asc: 'Prix : moins chères',
  name_asc: 'Nom : A → Z',
  name_desc: 'Nom : Z → A',
  club: 'Club : A → Z',
  country: 'Pays : A → Z',
}
export const value = (c) => suggestedPrice(c).buyNow // valeur estimée sur le Marché

function base(filters, select = '*', opts) {
  let req = supabase.from('cards').select(select, opts)
  if (filters.dq) req = req.ilike('name', `%${filters.dq}%`)
  if (filters.club) req = req.eq('club', filters.club)
  return req
}

const countsCache = new Map()
let hasRating = false // la table cards a-t-elle une colonne `rating` ? (détecté au premier chargement)
const seen = (rows) => { if (rows?.some((c) => typeof c.rating === 'number')) hasRating = true; return rows }
export async function fetchPage(filters, sort, page) {
  const from = page * PAGE
  const to = from + PAGE - 1
  if (/^(rarity|price)_/.test(sort)) {
    const desc = sort.endsWith('desc')
    const order = (filters.rarity ? [filters.rarity] : desc ? [...RARITIES].reverse() : [...RARITIES])
    const key = JSON.stringify([filters.dq, filters.club, order])
    if (!countsCache.has(key)) {
      countsCache.set(key, Promise.all(order.map((r) => Promise.resolve(base(filters, 'id', { count: 'exact', head: true }).in('rarity', VARIANTS[r])).then((x) => x.count || 0))))
    }
    const counts = await countsCache.get(key)
    const total = counts.reduce((a, b) => a + b, 0)
    const parts = []
    let offset = 0
    for (let i = 0; i < order.length; i++) {
      const c = counts[i]
      if (to >= offset && from < offset + c) {
        const a = Math.max(0, from - offset)
        const b = Math.min(c - 1, to - offset)
        const q2 = base(filters).in('rarity', VARIANTS[order[i]])
        parts.push(Promise.resolve((hasRating ? q2.order('rating', { ascending: !desc }).order('name') : q2.order('name')).range(a, b)).then((x) => seen(x.data || [])))
      }
      offset += c
      if (offset > to) break
    }
    let data = (await Promise.all(parts)).flat()
    // à rareté égale, la valeur dépend de la note de la carte
    if (sort.startsWith('price')) data = data.map((c, i) => [c, i]).sort((x, y) => (desc ? value(y[0]) - value(x[0]) : value(x[0]) - value(y[0])) || x[1] - y[1]).map((x) => x[0])
    return { data, total }
  }
  let req = base(filters, '*', { count: 'exact' })
  if (filters.rarity) req = req.in('rarity', VARIANTS[filters.rarity])
  if (sort === 'name_desc') req = req.order('name', { ascending: false })
  else if (sort === 'club') req = req.order('club').order('name')
  else if (sort === 'country') req = req.order('country').order('name')
  else req = req.order('name')
  const { data, count } = await req.range(from, to)
  return { data: seen(data || []), total: count ?? 0 }
}


// Les mêmes filtres et tris, appliqués à une liste déjà chargée (ex. mes cartes)
export function filterLocal(list, { dq = '', rarity = '', club = '' }) {
  const q = dq.trim().toLowerCase()
  return list.filter((c) => (!q || String(c.name).toLowerCase().includes(q)) && (!rarity || normRarity(c.rarity) === rarity) && (!club || String(c.club || '').trim() === club))
}
const byName = (a, b) => String(a.name).localeCompare(String(b.name))
const rank = (c) => RARITY_RANK[normRarity(c.rarity)] ?? 0
export const LOCAL_SORT = {
  rarity_desc: (a, b) => rank(b) - rank(a) || byName(a, b),
  rarity_asc: (a, b) => rank(a) - rank(b) || byName(a, b),
  price_desc: (a, b) => value(b) - value(a) || byName(a, b),
  price_asc: (a, b) => value(a) - value(b) || byName(a, b),
  name_asc: byName,
  name_desc: (a, b) => byName(b, a),
  club: (a, b) => String(a.club || '').localeCompare(String(b.club || '')) || byName(a, b),
  country: (a, b) => String(a.country || '').localeCompare(String(b.country || '')) || byName(a, b),
}
