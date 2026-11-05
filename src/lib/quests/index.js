// ============================================================================
// Défis — état + API côté client.
//   mode démo  : progression calculée dans le navigateur (localStorage)
//   mode live  : la progression vient du SERVEUR (triggers SQL) ; le client lit
//                get_my_quests() et réclame via claim_quest(). track() ne fait rien.
// ============================================================================
import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { eco } from '../economy'
import { addStock, getStock, MAX_STOCK } from '../boosterStock'
import { applyEvent, canClaim, currentQuests, prune, rowKey } from './engine'
import { BY_ID } from './templates'

const KEY = 'footx_quests'
const EVENT = 'footx:quests'
const live = () => eco.mode === 'live'

const load = () => {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.rows) return s } catch { /* ignore */ }
  return { seed: Math.random().toString(36).slice(2), rows: {} }
}
let state = null
const st = () => (state ||= load())
const save = (detail) => {
  prune(st())
  try { localStorage.setItem(KEY, JSON.stringify(st())) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}

export class QuestError extends Error { constructor(code, msg) { super(msg); this.code = code } }

// ---------------------------------------------------------------- suivi des événements
// Appelé par le jeu : fin de match, booster ouvert, achat… (en live : ignoré, le serveur s'en charge)
export function track(type, amount = 1, payload = {}) {
  if (live()) return
  const done = applyEvent(st(), type, amount, payload)
  save({ type: 'progress', event: type })
  for (const q of done) window.dispatchEvent(new CustomEvent(EVENT, { detail: { type: 'completed', quest: q } }))
}

// ---------------------------------------------------------------- lecture
export async function listQuests() {
  if (live()) {
    const { data, error } = await supabase.rpc('get_my_quests')
    if (error) throw new QuestError('server', error.message)
    return (data || []).map((r) => ({
      ...(BY_ID[r.template_id] || {}), id: r.template_id, category: r.category, title: r.title, desc: r.description, icon: r.icon,
      target: r.target, progress: r.progress, coins: Number(r.reward_coins), boosters: r.reward_boosters, period: r.period_key,
      completedAt: r.completed_at && Date.parse(r.completed_at), claimedAt: r.claimed_at && Date.parse(r.claimed_at),
      resetsAt: r.resets_at && Date.parse(r.resets_at),
    }))
  }
  const list = currentQuests(st())
  return list
}

export const pendingOf = (list) => list.filter((q) => q.completedAt && !q.claimedAt).length

// ---------------------------------------------------------------- récupérer une récompense
export async function claimQuest(id, period) {
  const q = BY_ID[id]
  if (q?.boosters && getStock().n + q.boosters > MAX_STOCK) {
    throw new QuestError('stock_full', `Stock de boosters plein (${MAX_STOCK} max) : ouvre-en avant de récupérer.`)
  }
  if (live()) {
    const { error } = await supabase.rpc('claim_quest', { p_template: id, p_period: period })
    if (error) throw new QuestError(error.hint || 'server', error.message)
    await eco.wallet()
    save({ type: 'claimed', id })
    return { coins: q?.coins || 0, boosters: q?.boosters || 0 }
  }
  const c = canClaim(st(), id, period)
  if (!c.ok) throw new QuestError('refused', c.message)
  c.row.claimedAt = Date.now() // d'abord marqué réclamé : un double clic ne paie pas deux fois
  save({ type: 'claimed', id })
  if (c.quest.coins) await eco.grantQuestReward(rowKey(id, period), c.quest.coins)
  if (c.quest.boosters) addStock(c.quest.boosters)
  return { coins: c.quest.coins, boosters: c.quest.boosters || 0 }
}

// ---------------------------------------------------------------- hooks
export function useQuests() {
  const [list, setList] = useState(null)
  useEffect(() => {
    let alive = true
    const refresh = () => listQuests().then((l) => { if (alive) setList(l) }).catch(() => { if (alive) setList([]) })
    refresh()
    window.addEventListener(EVENT, refresh)
    const t = setInterval(refresh, 30000) // passage de minuit / du lundi
    let ch = null
    if (live()) {
      ch = supabase.channel('quests').on('postgres_changes', { event: '*', schema: 'public', table: 'user_quests' }, refresh).subscribe()
    }
    return () => { alive = false; window.removeEventListener(EVENT, refresh); clearInterval(t); if (ch) supabase.removeChannel(ch) }
  }, [])
  return list
}

export function usePendingQuests() {
  const list = useQuests()
  return list ? pendingOf(list) : 0
}

export function onQuestEvent(cb) {
  const h = (e) => cb(e.detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

// ---------------------------------------------------------------- pont avec l'économie
// Les actions du Marché passent déjà par des événements 'footx:eco' : on les écoute ici,
// sans toucher au code du marché. Recompte aussi la collection (Iconiques / Légendaires).
let bridged = false
export function startQuestTracking() {
  if (bridged || live()) return
  bridged = true
  const recount = async () => {
    try {
      const inv = await eco.inventory()
      const n = (r) => inv.filter((i) => String(i.card?.rarity).toLowerCase() === r).length
      track('collection_iconique', n('iconique'))
      track('collection_legendaire', n('legendaire'))
    } catch { /* inventaire indisponible */ }
  }
  window.addEventListener('footx:eco', (e) => {
    const d = e.detail || {}
    if (d.type === 'bought' || d.type === 'won') track('market_buy', 1, { country: d.card?.country, club: d.card?.club, rarity: d.card?.rarity })
    if (d.type === 'sold') track('market_sale', 1, { rarity: d.card?.rarity })
    if (d.type === 'listed') track('market_list', 1)
    if (d.type === 'quicksell') track('quicksell', d.n || 1)
    if (['inventory', 'bought', 'won'].includes(d.type)) recount()
  })
  recount()
}
