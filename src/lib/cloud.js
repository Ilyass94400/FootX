// ============================================================================
// SAUVEGARDE EN LIGNE
// Au démarrage (joueur connecté) : on charge TOUT depuis le serveur en un appel
// (me_bootstrap) et on remplit la copie locale que les pages lisent.
// Ensuite :
//   - argent, cartes, boosters, matchs, Ligue → chaque action passe par une fonction SQL
//   - équipe → envoyée au serveur à chaque modification (squad_save)
//   - Mode Carrière (solo) → sa sauvegarde est envoyée à chaque changement (save_put)
// Le navigateur n'est plus qu'un cache : vider le cache ou changer d'appareil ne perd rien.
// ============================================================================
import { supabase } from '../supabase'
import { LIVE } from './economy'
import { applyServerBoosters } from './boosterStock'

const OWNER = 'footx_owner'
// tout ce qui appartient à UN joueur (vidé si un autre compte se connecte sur ce navigateur)
const PER_USER = ['footx_eco', 'footx_stock', 'footx_pity', 'footx_team', 'footx_career', 'footx_legend', 'footx_league', 'footx_lineup',
  'footx_quests', 'footx_booster_count', 'footx_match_rewards', 'footx_win_streak', 'footx_ai_level', 'footx_friends_demo']
// à la 1re connexion, la partie Carrière jouée en démo est gardée (mode solo, sans argent ni cartes) ;
// tout le reste repart du serveur (pas d'import de pièces ou de cartes du mode démo)
const KEEP_ON_FIRST_LOGIN = ['footx_career', 'footx_legend', 'footx_ai_level']
const SLOTS = { career: 'footx_career', legend: 'footx_legend' }
const TEAM_SLOTS = ['GK', 'D1', 'D2', 'A1', 'A2']
export const CLOUD_EVENT = 'footx:cloud'

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* stockage indisponible */ } }
const remove = (k) => { try { localStorage.removeItem(k) } catch { /* rien */ } }
const parse = (v) => { try { return JSON.parse(v) } catch { return null } }
const emit = (detail) => window.dispatchEvent(new CustomEvent(CLOUD_EVENT, { detail }))

export class CloudError extends Error {
  constructor(message, { setup = false, code = null } = {}) { super(message); this.setup = setup; this.code = code }
}
// fonction SQL introuvable = migration pas encore exécutée dans Supabase
const toCloudError = (e) => {
  const missing = e?.code === 'PGRST202' || e?.code === '42883' || /could not find the function|does not exist/i.test(e?.message || '')
  return new CloudError(missing
    ? 'La sauvegarde en ligne n\'est pas encore installée sur le serveur.'
    : (e?.message || 'Impossible de joindre le serveur.'), { setup: missing, code: e?.code })
}

let current = null // { uid, promise }
let bootedUid = null
export const cloudActive = () => LIVE && !!bootedUid

// Équipe renvoyée par le serveur → forme utilisée par le Team Builder
export const squadToTeam = (sq) => Object.fromEntries(TEAM_SLOTS.map((s) => [s, sq?.[s] || null]))

export function cloudBoot(session) {
  if (!LIVE || !session?.user?.id || session.guest) return Promise.resolve(null)
  const uid = session.user.id
  if (current?.uid === uid) return current.promise
  bootedUid = null
  const promise = (async () => {
    const prev = read(OWNER)
    if (prev !== uid) {
      // 1re connexion sur ce navigateur : la progression du mode démo est MISE DE CÔTÉ (pas effacée),
      // pour pouvoir la récupérer plus tard
      if (!prev) { const demo = read('footx_eco'); if (demo && !read('footx_demo_backup')) write('footx_demo_backup', demo) }
      for (const k of PER_USER) if (prev || !KEEP_ON_FIRST_LOGIN.includes(k)) remove(k)
      write(OWNER, uid)
    }
    const { data, error } = await supabase.rpc('me_bootstrap')
    if (error) throw toCloudError(error)
    applyServerBoosters(data.boosters)
    write('footx_win_streak', String(data.profile?.streak || 0))
    write('footx_team', JSON.stringify(squadToTeam(data.squad)))
    const prefs = data.saves?.prefs
    if (prefs && Number.isFinite(prefs.ai_level)) write('footx_ai_level', String(prefs.ai_level))
    bootedUid = uid
    for (const [slot, key] of Object.entries(SLOTS)) {
      const remote = data.saves?.[slot]
      if (remote) write(key, JSON.stringify(remote))
      else {
        // rien sur le serveur : on y envoie la partie de ce navigateur (s'il y en a une)
        const local = parse(read(key))
        if (local && (local.active || local.avatar)) pushNow(slot, local)
      }
    }
    emit({ type: 'boot' }) // Carrière / joueur rechargent leur copie
    return data
  })()
  current = { uid, promise }
  promise.catch(() => { if (current?.promise === promise) current = null })
  return promise
}

// ---------------------------------------------------------------- envois
const timers = {}
const pending = {}
let lastError = null
export const cloudStatus = () => ({ error: lastError })

function report(error) {
  const msg = error ? (error.message || 'Sauvegarde impossible') : null
  if (msg === lastError) return
  lastError = msg
  emit({ type: 'status', error: msg })
}

function pushNow(slot, data) {
  return supabase.rpc('save_put', { p_slot: slot, p_data: data })
    .then(({ error }) => report(error))
    .catch((e) => report(e))
}

// Sauvegarde d'un mode solo (envoi groupé : 1 appel au plus toutes les 1,2 s par emplacement)
export function cloudSave(slot, data) {
  if (!cloudActive()) return
  pending[slot] = data
  clearTimeout(timers[slot])
  timers[slot] = setTimeout(() => flush(slot), 1200)
}
function flush(slot) {
  clearTimeout(timers[slot])
  const d = pending[slot]
  if (!d) return
  delete pending[slot]
  if (slot === 'squad') sendSquad(d)
  else pushNow(slot, d)
}
function flushAll() { for (const k of Object.keys(pending)) flush(k) }
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll() })
}

// Équipe : identifiants des cartes + collectif (pour les défis "collectif")
function sendSquad({ team, chem, chemTotal }) {
  const ids = Object.fromEntries(TEAM_SLOTS.filter((s) => team?.[s]?.id != null).map((s) => [s, team[s].id]))
  return supabase.rpc('squad_save', { p_team: ids, p_chem: chem || 0, p_chem_total: chemTotal || 0 })
    .then(({ error }) => report(error && error.hint !== 'not_owner' ? error : null))
    .catch((e) => report(e))
}
export function cloudSquad(team, chem = 0, chemTotal = 0) {
  if (!cloudActive()) return
  pending.squad = { team, chem, chemTotal }
  clearTimeout(timers.squad)
  timers.squad = setTimeout(() => flush('squad'), 800)
}

export function onCloud(cb) {
  const h = (e) => cb(e.detail)
  window.addEventListener(CLOUD_EVENT, h)
  return () => window.removeEventListener(CLOUD_EVENT, h)
}
