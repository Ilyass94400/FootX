import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

// Stock de boosters : géré par Supabase (fonction get_my_stock / open_boosters).
// Règles côté serveur : départ à 20, +1 toutes les 10 min, 100 max.
export const MAX_STOCK = 100

const EVENT = 'footx:stock'
let cache = null // { stock, boosters_opened, next_in (s), at (ms) }

const emit = () => window.dispatchEvent(new Event(EVENT))

export function setStockFromServer(d) {
  cache = { stock: d.stock, boosters_opened: d.boosters_opened, next_in: d.next_in, at: Date.now() }
  emit()
}

let loading = null
export function refreshStock() {
  loading ??= supabase.rpc('get_my_stock').then(({ data, error }) => {
    loading = null
    if (!error && data) setStockFromServer(data)
    return cache
  })
  return loading
}

const compute = () => {
  if (!cache) return { n: 0, nextIn: null, opened: 0, ready: false }
  const nextIn = cache.next_in == null ? null : Math.max(0, cache.next_in * 1000 - (Date.now() - cache.at))
  return { n: cache.stock, nextIn, opened: cache.boosters_opened, ready: true }
}

// Hook : stock à jour (compte à rebours local, resynchro serveur quand un booster revient)
export function useStock() {
  const [stock, setStock] = useState(compute)
  useEffect(() => {
    const update = () => setStock(compute())
    window.addEventListener(EVENT, update)
    if (!cache) refreshStock()
    const t = setInterval(() => {
      const s = compute()
      if (s.ready && s.nextIn === 0) refreshStock()
      setStock(s)
    }, 1000)
    return () => { clearInterval(t); window.removeEventListener(EVENT, update) }
  }, [])
  return stock
}

export const formatTime = (ms) => {
  const s = Math.ceil((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
