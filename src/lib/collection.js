// ============================================================================
// Collection par club : catalogue (tous les clubs du jeu) + ce que JE possède.
//
//  - le catalogue vient de la vue SQL `club_catalogue` (migration 20261109) ;
//    tant qu'elle n'existe pas, on le reconstruit en lisant la table `cards`
//    par pages de 1000 (mis en cache pour la session).
//  - les cartes possédées viennent de l'économie (eco.inventory()) : mode démo
//    local ou table user_cards en ligne.
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { eco, bootEconomy, useEcoEvents } from './economy'
import { RARITIES } from './rarity'

export const clubKey = (name) => String(name || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const normRarity = (r) => String(r || 'commune').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]))

const CACHE = 'footx_catalogue_v1'
const TTL = 60 * 60 * 1000
let catalogue = null

const mode = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || ''

function fromRows(rows) {
  const by = new Map()
  for (const r of rows) {
    if (!r.club || !String(r.club).trim()) continue
    const k = clubKey(r.club)
    if (!by.has(k)) by.set(k, { key: k, name: String(r.club).trim(), total: 0, rarities: {}, countries: {} })
    const c = by.get(k)
    c.total++
    const ra = normRarity(r.rarity)
    c.rarities[ra] = (c.rarities[ra] || 0) + 1
    if (r.country) c.countries[r.country] = (c.countries[r.country] || 0) + 1
  }
  return [...by.values()].map(({ countries, ...c }) => ({ ...c, country: mode(countries) }))
}

async function fetchCatalogue() {
  // 1) la vue SQL (rapide, une seule requête)
  try {
    const { data, error } = await supabase.from('club_catalogue').select('*').limit(5000)
    if (!error && data?.length && data[0].club_key != null && typeof data[0].total === 'number') {
      return data.map((r) => ({ key: r.club_key, name: r.club, country: r.country || '', total: r.total, rarities: r.rarities || {} }))
    }
  } catch { /* vue absente : on passe au plan B */ }
  // 2) plan B : on lit les cartes par pages (colonnes minimales)
  const rows = []
  for (let page = 0; page < 60; page++) {
    const { data, error } = await supabase.from('cards').select('id, club, country, rarity').range(page * 1000, page * 1000 + 999)
    if (error || !data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return fromRows(rows)
}

export function loadCatalogue() {
  if (!catalogue) {
    catalogue = (async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem(CACHE))
        if (c && Date.now() - c.at < TTL && c.clubs?.length) return c.clubs
      } catch { /* pas de cache */ }
      const clubs = await fetchCatalogue()
      try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), clubs })) } catch { /* plein */ }
      return clubs
    })().catch(() => [])
  }
  return catalogue
}

// Tous les joueurs d'un club (triés : rareté décroissante puis nom)
const clubCache = new Map()
export function loadClubCards(name) {
  if (!clubCache.has(name)) {
    clubCache.set(name, Promise.resolve(supabase.from('cards').select('*').eq('club', name).limit(1000))
      .then(({ data }) => (data || []).sort((a, b) => (RARITY_RANK[normRarity(b.rarity)] ?? 0) - (RARITY_RANK[normRarity(a.rarity)] ?? 0) || String(a.name).localeCompare(String(b.name))))
      .catch(() => { clubCache.delete(name); return [] }))
  }
  return clubCache.get(name)
}

// Mes cartes : { byCard: Map(id → nb d'exemplaires), byClub: Map(clé → Set d'ids), items }
export function summarize(items = []) {
  const byCard = new Map()
  const byClub = new Map()
  for (const it of items) {
    const c = it.card
    if (!c || c.id == null) continue
    byCard.set(String(c.id), (byCard.get(String(c.id)) || 0) + 1)
    const k = clubKey(c.club)
    if (!k) continue
    if (!byClub.has(k)) byClub.set(k, new Set())
    byClub.get(k).add(String(c.id))
  }
  return { byCard, byClub, items, unique: byCard.size }
}

export function useOwned() {
  const [owned, setOwned] = useState(null)
  const refresh = useCallback(() => {
    Promise.resolve(bootEconomy()).catch(() => {}).then(() => eco.inventory())
      .then((items) => setOwned(summarize(items || [])))
      .catch(() => setOwned(summarize([])))
  }, [])
  useEffect(refresh, [refresh])
  useEcoEvents(useCallback((e) => { if (!e || e.type !== 'sync') refresh() }, [refresh]))
  return owned
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
