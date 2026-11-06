import { useEffect, useState } from 'react'

// Stock de boosters du joueur. En ligne, c'est le SERVEUR qui fait foi (user_boosters) :
// cette copie locale sert à l'affichage et au compte à rebours, mise à jour après chaque action.
// 1 booster revient toutes les 10 min, jusqu'à 10 max. Un nouveau joueur commence avec 10.
// Au-delà de 10, rien ne s'accumule : il faut ouvrir pour refaire de la place.
export const MAX_STOCK = 10
export const START_STOCK = 10
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
  if (s.n > MAX_STOCK) s = { n: MAX_STOCK, t: now } // ancien stock (limite à 100) ramené à 10
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

// Ajoute des boosters sans dépasser la limite. Renvoie le nombre réellement ajouté.
export function addStock(k) {
  const cur = getStock()
  const added = Math.max(0, Math.min(k, MAX_STOCK - cur.n))
  save({ n: cur.n + added, t: cur.n + added >= MAX_STOCK ? Date.now() : read().t })
  return added
}

export const stockFull = () => getStock().n >= MAX_STOCK

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

// ---- Mode en ligne : copie de l'état renvoyé par le serveur (booster_state, open_boosters…)
let offset = 0 // horloge serveur − horloge du navigateur (ms)
export function applyServerBoosters(st) {
  if (!st || typeof st.stock !== 'number') return
  if (st.server_now) offset = Date.parse(st.server_now) - Date.now()
  const t = st.regen_at ? Date.parse(st.regen_at) - offset : Date.now()
  try {
    localStorage.setItem(KEY, JSON.stringify({ n: st.stock, t }))
    if (st.pity) localStorage.setItem('footx_pity', JSON.stringify(st.pity))
    localStorage.setItem('footx_booster_count', String(st.opened || 0))
    localStorage.setItem('footx_match_rewards', JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: st.win_today || 0 }))
  } catch { /* stockage indisponible */ }
  window.dispatchEvent(new Event(EVENT))
}
