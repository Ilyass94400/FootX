import { supabase } from '../supabase'

// Catalogue complet des cartes, gardé en cache 24h dans le navigateur
// -> une seule grosse requête par jour et par joueur au lieu d'une à chaque page.
const KEY = 'footx_catalogue_v1'
const TTL = 24 * 60 * 60 * 1000
const COLUMNS = 'id,name,club,country,position,rarity,image_url'

let memory = null
let pending = null

async function fetchAll() {
  const { count } = await supabase.from('cards').select('id', { count: 'exact', head: true })
  const pages = Math.ceil((count || 0) / 1000)
  const res = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase.from('cards').select(COLUMNS).order('id').range(i * 1000, i * 1000 + 999))
  )
  return res.flatMap((r) => r.data || [])
}

export async function getCatalogue() {
  if (memory) return memory
  try {
    const c = JSON.parse(localStorage.getItem(KEY))
    if (c && Date.now() - c.t < TTL && c.cards?.length) return (memory = c.cards)
  } catch { /* cache illisible : on recharge */ }

  pending ??= fetchAll().then((cards) => {
    try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), cards })) } catch { /* trop gros : tant pis */ }
    memory = cards
    pending = null
    return cards
  })
  return pending
}
