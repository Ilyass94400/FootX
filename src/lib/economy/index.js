import { useEffect, useState } from 'react'
import { localServer } from './localServer'
import { supabaseServer } from './supabaseServer'

// Choix du "serveur" d'économie :
//   - par défaut : mode démo local (jouable sans backend)
//   - VITE_ECONOMY=supabase : vraie économie sécurisée par Postgres
export const eco = import.meta.env.VITE_ECONOMY === 'supabase' ? supabaseServer : localServer
export { EcoError } from './localServer'

let booted = null
// Démarre l'économie une fois (solde de départ, pack de bienvenue, marché démo).
export function bootEconomy(catalogue) {
  if (!booted || (catalogue?.length && !booted.withCatalogue)) {
    booted = { p: eco.init(catalogue || []), withCatalogue: !!catalogue?.length }
  }
  return booted.p
}

// S'abonner aux événements économiques (solde, ventes, enchères…).
export function useEcoEvents(cb) {
  useEffect(() => {
    const h = (e) => cb(e.detail)
    window.addEventListener('footx:eco', h)
    return () => window.removeEventListener('footx:eco', h)
  }, [cb])
}

// Solde courant (se met à jour à chaque mouvement, sur toutes les pages).
export function useWallet() {
  const [balance, setBalance] = useState(null)
  useEffect(() => {
    let alive = true
    bootEconomy().then((w) => { if (alive && w) setBalance(w.balance) }).catch(() => {})
    const h = (e) => { if (typeof e.detail?.balance === 'number') setBalance(e.detail.balance) }
    window.addEventListener('footx:eco', h)
    return () => { alive = false; window.removeEventListener('footx:eco', h) }
  }, [])
  return { balance, mode: eco.mode }
}
