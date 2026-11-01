import { useEffect, useState } from 'react'

// Stock de boosters du joueur (sauvegardé dans le navigateur pour l'instant).
// 1 booster revient toutes les 10 min, jusqu'à 100 max. Un nouveau joueur commence avec 20.
export const MAX_STOCK = 100
export const START_STOCK = 20
export const REGEN_MS = 10 * 60 * 1000

const KEY = 'footx_stock'
const EVENT = 'footx:stock'

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null }
}
const save = (s) => {
  localStorage.setItem(KEY, JSON.stringify(s))
  window.dispatchEvent(new Event(EVENT))
}

// Calcule le stock actuel en ajoutant les boosters regagnés depuis la dernière fois
export function getStock() {
  const now = Date.now()
  let s = read() || { n: START_STOCK, t: now }
  if (s.n >= MAX_STOCK) {
    s = { n: MAX_STOCK, t: now }
  } else {
    const gained = Math.floor((now - s.t) / REGEN_MS)
    if (gained > 0) {
      const n = Math.min(MAX_STOCK, s.n + gained)
      s = { n, t: n >= MAX_STOCK ? now : s.t + gained * REGEN_MS }
    }
  }
  localStorage.setItem(KEY, JSON.stringify(s))
  return { n: s.n, nextIn: s.n >= MAX_STOCK ? null : REGEN_MS - (now - s.t) }
}

export function spendStock(k) {
  const cur = getStock()
  if (k > cur.n) return false
  const raw = read()
  // si on était plein, le chrono de recharge démarre maintenant
  save({ n: cur.n - k, t: cur.n >= MAX_STOCK ? Date.now() : raw.t })
  return true
}

export function addStock(k) {
  const cur = getStock()
  save({ n: Math.min(MAX_STOCK, cur.n + k), t: read().t })
}

// Hook : stock à jour (se rafraîchit toutes les secondes et après chaque ouverture)
export function useStock() {
  const [stock, setStock] = useState(getStock)
  useEffect(() => {
    const update = () => setStock(getStock())
    const t = setInterval(update, 1000)
    window.addEventListener(EVENT, update)
    return () => { clearInterval(t); window.removeEventListener(EVENT, update) }
  }, [])
  return stock
}

export const formatTime = (ms) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
