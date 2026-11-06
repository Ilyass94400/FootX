// ============================================================================
// Amis — deux "serveurs" interchangeables, comme l'économie :
//   - en ligne : fonctions Postgres de la migration 20261109_collection_amis.sql
//     (codes amis, demandes, profils d'amis, présence)
//   - démo     : en invité, ou tant que la migration n'est pas appliquée
//     (quelques amis fictifs pour voir l'interface vivre)
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { hashStr } from './career/crest'

const EVENT = 'footx:friends'
const emit = (detail) => window.dispatchEvent(new CustomEvent(EVENT, { detail }))
export class FriendError extends Error {}

// ------------------------------------------------------------------ en ligne
const msg = (e) => {
  const m = e?.message || ''
  if (/introuvable|not found/i.test(m)) return 'Aucun joueur avec ce code ou ce pseudo.'
  return m.replace(/^.*?:\s*/, '') || 'Action impossible pour le moment.'
}
const live = {
  mode: 'live',
  async me() {
    const { data, error } = await supabase.rpc('friends_me')
    if (error) throw error
    return Array.isArray(data) ? data[0] : data
  },
  async list() {
    const { data, error } = await supabase.rpc('friends_list')
    if (error) throw new FriendError(msg(error))
    return (data || []).map((r) => ({ ...r, last_seen: r.last_seen ? Date.parse(r.last_seen) : null }))
  },
  async send(query) {
    const { data, error } = await supabase.rpc('friend_request', { p_query: query })
    if (error) throw new FriendError(msg(error))
    emit({ type: 'sent' }); return data
  },
  async respond(id, accept) {
    const { error } = await supabase.rpc('friend_respond', { p_id: id, p_accept: accept })
    if (error) throw new FriendError(msg(error))
    emit({ type: 'respond' })
  },
  async remove(id) {
    const { error } = await supabase.rpc('friend_remove', { p_id: id })
    if (error) throw new FriendError(msg(error))
    emit({ type: 'remove' })
  },
  async profile(userId) {
    const { data, error } = await supabase.rpc('friend_profile', { p_user: userId })
    if (error) throw new FriendError(msg(error))
    return data
  },
}

// ------------------------------------------------------------------ démo
const KEY = 'footx_friends_demo'
const NAMES = ['Zizou_10', 'LaPulga', 'Kylian7', 'ElNino', 'Titi14', 'Benz9', 'Sergio4', 'Gigi1', 'Ronnie', 'KDB17']
const code = (s) => { const h = hashStr(s).toString(36).toUpperCase().padStart(8, '0'); return `FX-${h.slice(0, 4)}-${h.slice(4, 8)}` }
const person = (name, i) => ({ user_id: 'demo-' + name, username: name, avatar_url: null, friend_code: code(name), wins: 8 + (hashStr(name) % 140), matches: 30 + (hashStr(name + 'm') % 220), cards: 60 + (hashStr(name + 'c') % 900), last_seen: Date.now() - (i % 3 === 0 ? 60e3 : (hashStr(name) % 72) * 3600e3) })
function demoState() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.v === 1) return s } catch { /* rien */ }
  const now = Date.now()
  const s = { v: 1, rows: [
    { id: 'f1', status: 'accepted', since: now - 9 * 864e5, ...person(NAMES[0], 0) },
    { id: 'f2', status: 'accepted', since: now - 4 * 864e5, ...person(NAMES[1], 1) },
    { id: 'f3', status: 'accepted', since: now - 2 * 864e5, ...person(NAMES[2], 3) },
    { id: 'f4', status: 'incoming', since: now - 3600e3, ...person(NAMES[3], 2) },
  ] }
  localStorage.setItem(KEY, JSON.stringify(s))
  return s
}
const demoSave = (s, detail) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* plein */ } emit(detail) }
let demoCards = null
const demoPool = () => (demoCards ||= Promise.resolve(supabase.from('cards').select('*').limit(400)).then(({ data }) => data || []).catch(() => []))

const demo = {
  mode: 'demo',
  async me(session) {
    const m = session?.user?.user_metadata || {}
    const name = m.custom_claims?.global_name || m.full_name || m.name || 'Invité'
    return { id: 'me', username: name, avatar_url: m.avatar_url || null, friend_code: code('moi-' + name) }
  },
  async list() { return demoState().rows },
  async send(query) {
    const q = String(query || '').trim()
    if (q.length < 3) throw new FriendError('Entre un code ami (FX-XXXX-XXXX) ou un pseudo.')
    const s = demoState()
    if (s.rows.some((r) => r.username.toLowerCase() === q.toLowerCase() || r.friend_code === q.toUpperCase())) throw new FriendError('Vous êtes déjà amis, ou une demande est en cours.')
    const name = /^FX-/i.test(q) ? NAMES[hashStr(q) % NAMES.length] + (hashStr(q) % 90) : q.slice(0, 16)
    const row = { id: 'f' + Date.now(), status: 'outgoing', since: Date.now(), ...person(name, s.rows.length) }
    s.rows.push(row)
    demoSave(s, { type: 'sent' })
    // en démo, l'ami "accepte" quelques secondes plus tard
    setTimeout(() => { const t = demoState(); const r = t.rows.find((x) => x.id === row.id); if (r) { r.status = 'accepted'; r.since = Date.now(); r.last_seen = Date.now(); demoSave(t, { type: 'accepted', name: r.username }) } }, 5000)
    return 'sent'
  },
  async respond(id, accept) {
    const s = demoState()
    const r = s.rows.find((x) => x.id === id)
    if (!r) return
    if (accept) { r.status = 'accepted'; r.since = Date.now() } else s.rows = s.rows.filter((x) => x.id !== id)
    demoSave(s, { type: 'respond' })
  },
  async remove(id) {
    const s = demoState()
    s.rows = s.rows.filter((x) => x.id !== id)
    demoSave(s, { type: 'remove' })
  },
  async profile(userId) {
    const r = demoState().rows.find((x) => x.user_id === userId)
    const pool = await demoPool()
    const h = hashStr(userId)
    const pick = [...pool].sort((a, b) => hashStr(userId + a.id) - hashStr(userId + b.id)).slice(0, 60)
    const rank = { iconique: 5, legendaire: 4, epique: 3, rare: 2, atypique: 1, commune: 0 }
    const best = [...pick].sort((a, b) => (rank[String(b.rarity).toLowerCase()] ?? 0) - (rank[String(a.rarity).toLowerCase()] ?? 0)).slice(0, 5)
    const clubs = {}
    for (const c of pick) if (c.club) clubs[c.club] = (clubs[c.club] || 0) + 1
    return {
      username: r?.username, avatar_url: null, friend_code: r?.friend_code, wins: r?.wins ?? 0, matches: r?.matches ?? 0, elo: 1000 + (h % 600),
      cards: r?.cards ?? 0, unique: Math.round((r?.cards ?? 0) * 0.7), best,
      clubs: Object.entries(clubs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([club, n]) => ({ club, n: n + (h % 7) })),
    }
  },
}

// ------------------------------------------------------------------ choix du serveur
let chosen = null
export function friendsServer(session) {
  if (!chosen) {
    chosen = (async () => {
      if (!session || session.guest) return { api: demo, reason: 'guest' }
      try { await live.me(); return { api: live, reason: null } } catch { return { api: demo, reason: 'migration' } }
    })()
  }
  return chosen
}

// Hook principal de la page Amis
export function useFriends(session) {
  const [st, setSt] = useState({ loading: true, me: null, rows: [], mode: null, reason: null })
  const load = useCallback(async () => {
    const { api, reason } = await friendsServer(session)
    try {
      const [me, rows] = await Promise.all([api.me(session), api.list()])
      setSt({ loading: false, me, rows, mode: api.mode, reason, api })
    } catch (e) {
      setSt((s) => ({ ...s, loading: false, error: e.message, api, mode: api.mode, reason }))
    }
  }, [session])
  useEffect(() => {
    load()
    const h = () => load()
    window.addEventListener(EVENT, h)
    const t = setInterval(load, 60000) // présence et nouvelles demandes
    return () => { window.removeEventListener(EVENT, h); clearInterval(t) }
  }, [load])
  return st
}

// Pastille du menu : demandes reçues
export function useIncomingCount(session) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => friendsServer(session).then(({ api }) => api.list()).then((rows) => alive && setN(rows.filter((r) => r.status === 'incoming').length)).catch(() => {})
    load()
    window.addEventListener(EVENT, load)
    const t = setInterval(load, 90000)
    return () => { alive = false; window.removeEventListener(EVENT, load); clearInterval(t) }
  }, [session])
  return n
}

// "En ligne", "vu il y a 3 h"…
export function presence(ts) {
  if (!ts) return { on: false, label: 'Jamais vu' }
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 5) return { on: true, label: 'En ligne' }
  if (m < 60) return { on: false, label: `Vu il y a ${m} min` }
  const h = Math.floor(m / 60)
  if (h < 24) return { on: false, label: `Vu il y a ${h} h` }
  const d = Math.floor(h / 24)
  return { on: false, label: `Vu il y a ${d} jour${d > 1 ? 's' : ''}` }
}
