// ============================================================================
// Arène en joueur contre joueur : appels au serveur (migration 20261113).
// Le match tourne dans les deux navigateurs avec la même graine ; le serveur arbitre :
// chacun envoie son coup, et reçoit celui de l'adversaire seulement quand les deux ont joué.
// ============================================================================
import { supabase } from '../../supabase'
import { SLOTS } from '../collectif'

export const SEARCH_MS = 20000 // au-delà : match contre l'IA
export const POLL_MS = 450 // rythme des vérifications pendant un match
export const QUEUE_POLL_MS = 1500 // rythme pendant la recherche

export class PvpError extends Error {
  constructor(message, hint) { super(message); this.hint = hint }
}

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new PvpError(error.message || 'Erreur serveur', error.hint || error.code)
  return data
}

const ids = (team) => Object.fromEntries(SLOTS.map((s) => [s.id, team?.[s.id]?.id ?? null]))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const pvp = {
  join: (team) => rpc('arena_queue_join', { p_team: ids(team) }),
  poll: () => rpc('arena_queue_poll'),
  leave: () => rpc('arena_queue_leave'),
  move: (id, idx, choice, hesitated) => rpc('arena_pvp_move', { p_match: id, p_idx: idx, p_choice: choice, p_hesitated: !!hesitated }),
  qte: (id, idx, q) => rpc('arena_pvp_qte', { p_match: id, p_idx: idx, p_q: q }),
  wait: (id, idx, step) => rpc('arena_pvp_wait', { p_match: id, p_idx: idx, p_step: step }),
  finish: (id, r) => rpc('arena_pvp_finish', { p_match: id, p_my: r.my, p_opp: r.opp, p_win: !!r.win, p_perfect: r.perfect || 0, p_goals: r.goals || [] }),
}

// Envoie un coup puis attend celui de l'adversaire (ou la fin du match s'il est parti).
// Réseau coupé : on réessaie sans fin tant que le match est affiché (alive()).
export async function exchange(first, again, alive) {
  let r = null
  let delay = POLL_MS
  for (let tries = 0; alive(); tries++) {
    try {
      r = tries === 0 ? await first() : await again()
      delay = POLL_MS
      if (r?.finished || (r?.me && r?.opp)) return r
    } catch (e) {
      if (e?.hint === 'not_found' || e?.hint === 'invalid') throw e
      delay = Math.min(4000, delay * 1.6) // coupure : on espace les essais
    }
    await sleep(delay)
  }
  return null
}

// Un match trouvé par le serveur → tout ce qu'il faut pour lancer le moteur des deux côtés
export function pvpSetup(m) {
  return {
    me: m.me.squad, opp: m.opp.squad,
    names: { me: m.me.name || 'Moi', opp: m.opp.name || 'Adversaire' },
    seed: Number(m.seed) | 0,
    pvp: { flip: m.role === 'away' },
    meta: { pvp: { id: m.id, role: m.role, opp: { name: m.opp.name, avatar: m.opp.avatar, elo: m.opp.elo }, elo: m.me.elo } },
  }
}
