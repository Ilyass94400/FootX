// ============================================================================
// FootX — moteur de match (logique PURE, sans React)
//
// Un match = 6 "actions clés" (+ tirs au but en mort subite si égalité).
// Chaque action : intro -> choix simultanés (timer) -> clash -> QTE -> issue.
//
// Déterministe : même graine + mêmes choix = même match. En PvP, les deux navigateurs font
// tourner ce moteur côte à côte ; le serveur ne fait qu'arbitrer les choix (révélation simultanée).
// ============================================================================
import { getTraits } from '../traits'
import { cardRating, computeCollectif } from '../collectif'
import { chemByCardId, CHEM_EFFECT } from '../chemistry'

// ---------- Tactiques ----------
// Cycle pierre-feuille-ciseaux, cohérent avec le foot :
//   Frappe en force > gardien qui RESTE  (trop puissant pour un gardien statique)
//   Feinte          > gardien qui PLONGE (il est déjà au sol)
//   Lob             > gardien qui SORT   (il est loin de sa ligne)
// et inversement : Plonger arrête la force, Sortir étouffe la feinte, Rester capte le lob.
export const ATTACK = {
  force: { id: 'force', label: 'Frappe en force', short: 'Force', hint: 'Bat le gardien qui reste', beats: 'rester', cost: 34, key: '1' },
  feinte: { id: 'feinte', label: 'Feinte', short: 'Feinte', hint: 'Bat le gardien qui plonge', beats: 'plonger', cost: 22, key: '2' },
  lob: { id: 'lob', label: 'Lob', short: 'Lob', hint: 'Bat le gardien qui sort', beats: 'sortir', cost: 26, key: '3' },
}
export const DEFEND = {
  plonger: { id: 'plonger', label: 'Plonger', short: 'Plonger', hint: 'Arrête la frappe en force', beats: 'force', key: '1' },
  sortir: { id: 'sortir', label: 'Sortir', short: 'Sortir', hint: 'Étouffe la feinte', beats: 'feinte', key: '2' },
  rester: { id: 'rester', label: 'Rester', short: 'Rester', hint: 'Capte le lob', beats: 'lob', key: '3' },
}
export const ATTACK_IDS = ['force', 'feinte', 'lob']
export const DEFEND_IDS = ['plonger', 'sortir', 'rester']

// +1 : l'attaquant a lu le gardien · -1 : le gardien a lu l'attaquant · 0 : indécis
export const readOf = (a, d) => (ATTACK[a].beats === d ? 1 : DEFEND[d].beats === a ? -1 : 0)

export const SCENARIOS = {
  face: { id: 'face', title: 'Face-à-face', sub: 'Seul devant le gardien', time: 5000, adv: 0 },
  contre: { id: 'contre', title: 'Contre éclair', sub: 'Tout va très vite', time: 4000, adv: 0.3 },
  lointaine: { id: 'lointaine', title: 'Frappe de loin', sub: 'Aux vingt mètres', time: 5000, adv: 0, mod: { force: 0.5, feinte: -0.4 } },
  penalty: { id: 'penalty', title: 'Tir au but', sub: 'Mort subite', time: 5000, adv: 0, free: true },
}
export const MINUTES = [9, 24, 38, 53, 69, 86]
export const TOTAL_ACTIONS = MINUTES.length
export const TIMING = { kickoff: 2600, intro: 1400, clash: 1900, outcome: 2300, goal: 3000, shootout: 2400, ultimate: 2600 }
const QV = { perfect: 2, good: 1, miss: -1.2 }

const other = (side) => (side === 'me' ? 'opp' : 'me')
// Égalité parfaite de momentum : départage identique sur les deux écrans en PvP (l'équipe "home" gagne)
const meLeads = (s) => (s.pvp?.flip ? s.momentum > 0 : s.momentum >= 0)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// RNG déterministe (mulberry32). L'état de la graine vit dans s.rng.
function rand(s) {
  let a = (s.rng + 0x6d2b79f5) | 0
  s.rng = a
  a = Math.imul(a ^ (a >>> 15), 1 | a)
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296
}

// ---------- Création ----------
// focus : id de la carte que le joueur incarne (Mode Carrière) → elle prend la plupart des actions clés
// meta  : données libres renvoyées telles quelles (ex. le match de carrière en cours)
// pvp   : { flip } match contre un VRAI joueur. Les deux navigateurs font tourner le même moteur avec la
//         même graine ; flip = true pour le joueur "extérieur" (son "me" est l'équipe away du serveur).
//         Pas d'avantage d'IA, et les QTE adverses sont réels (pas simulés).
export function initMatch({ me, opp, names = { me: 'Mon équipe', opp: 'Rival FC' }, seed, level = 0.55, focus = null, meta = null, pvp = null } = {}) {
  if (pvp) level = 0
  const sd = (seed ?? (Date.now() ^ Math.floor(Math.random() * 1e9))) | 0
  const s = {
    phase: 'kickoff', idx: 0, seed: sd, rng: sd,
    teams: { me, opp }, names, focus, meta,
    collectif: { me: computeCollectif(me).collectif, opp: computeCollectif(opp).collectif },
    chem: { me: chemByCardId(me), opp: chemByCardId(opp) }, // collectif individuel 0..3 par carte
    score: { me: 0, opp: 0 }, pens: { me: 0, opp: 0 }, shootout: null,
    momentum: 0, // -100 (adversaire) … +100 (toi)
    stamina: { me: {}, opp: {} },
    history: [], current: null, winner: null,
    stats: { reads: 0, actions: 0, perfect: 0, goals: 0, saves: 0, hesitations: 0, ultimates: 0 },
    ultUsed: {}, // Capacités Ultimes de la Légende déjà utilisées (1 fois par match chacune)
    mvp: {},
    ai: null,
    pvp: pvp ? { flip: !!pvp.flip } : null,
  }
  // Personnalité de l'IA, tirée de la graine : elle a des HABITUDES que le joueur peut repérer et exploiter.
  // Chaque IA a UNE habitude dominante par rôle (≈ 55 % de ses choix) : lisible via ses tendances.
  const persona = (ids) => {
    const fav = ids[Math.floor(rand(s) * ids.length)]
    return Object.fromEntries(ids.map((k) => [k, k === fav ? 2.4 + rand(s) * 0.6 : 0.7 + rand(s) * 0.6]))
  }
  s.ai = {
    read: 0.22 + rand(s) * 0.14, // probabilité de contrer TON habitude si tu te répètes
    level, // difficulté : avantage de base de l'IA (adaptée par le contrôleur selon tes résultats)
    bias: { attack: persona(ATTACK_IDS), defend: persona(DEFEND_IDS) },
  }
  return s
}

// ---------- Choix de l'IA ----------
export function aiChoice(s, role, rnd = Math.random) {
  const ids = role === 'attack' ? ATTACK_IDS : DEFEND_IDS
  // 1) Elle exploite TES habitudes (tes 5 derniers choix dans le rôle opposé).
  const humanPicks = s.history
    .filter((h) => (role === 'defend' ? h.side === 'me' : h.side === 'opp'))
    .map((h) => (role === 'defend' ? h.attack : h.defend))
    .slice(-5)
  if (humanPicks.length >= 2 && rnd() < s.ai.read) {
    const cnt = {}
    humanPicks.forEach((p) => { cnt[p] = (cnt[p] || 0) + 1 })
    const fav = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]
    return role === 'defend' ? DEFEND_IDS.find((d) => DEFEND[d].beats === fav) : ATTACK_IDS.find((a) => ATTACK[a].beats === fav)
  }
  // 2) Sinon, ses propres biais (sa "personnalité"), en évitant ce qui l'épuiserait.
  const w = { ...s.ai.bias[role] }
  if (role === 'attack' && s.current) {
    const st = s.stamina.opp[s.current.attacker.id] ?? 100
    ATTACK_IDS.forEach((a) => { if (st < ATTACK[a].cost) w[a] *= 0.35 })
  }
  let r = rnd() * ids.reduce((t, k) => t + w[k], 0)
  for (const k of ids) { r -= w[k]; if (r <= 0) return k }
  return ids[0]
}

// Ce que l'adversaire a choisi ses dernières fois dans le rôle qu'il tient MAINTENANT (aide à la lecture).
export function opponentTendency(s, n = 3) {
  if (!s.current) return []
  const aiDefends = s.current.side === 'me'
  return s.history
    .filter((h) => (aiDefends ? h.side === 'me' : h.side === 'opp'))
    .map((h) => (aiDefends ? h.defend : h.attack))
    .slice(-n)
}

// Conseil de fin de match : quelle habitude adverse il fallait exploiter.
export function matchInsight(s) {
  const keeperPicks = s.history.filter((h) => h.side === 'me').map((h) => h.defend)
  if (keeperPicks.length < 2) return null
  const cnt = {}
  keeperPicks.forEach((p) => { cnt[p] = (cnt[p] || 0) + 1 })
  const fav = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]
  const counter = ATTACK_IDS.find((a) => ATTACK[a].beats === fav)
  return { fav, n: cnt[fav], total: keeperPicks.length, counter }
}

// ---------- Déroulé ----------
function pickAttacker(s, side) {
  const t = s.teams[side]
  if (s.shootout) {
    // tirs au but : on fait tourner les tireurs
    const order = ['A1', 'A2', 'D1', 'D2', 'GK'].map((k) => t[k]).filter(Boolean)
    return order[(s.shootout.round - 1) % order.length]
  }
  const cand = ['A1', 'A2', 'D1', 'D2'].map((k) => t[k]).filter(Boolean)
  if (!cand.length) return t.GK
  // Mode Carrière : ton joueur prend la majorité des actions clés de ton équipe
  if (side === 'me' && s.focus) {
    const f = cand.find((c) => c.id === s.focus)
    if (f && rand(s) < 0.65) return f
  }
  const weights = cand.map((c, i) => (i < 2 ? 3 : 1) * (0.35 + (s.stamina[side][c.id] ?? 100) / 100))
  let r = rand(s) * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < cand.length; i++) { r -= weights[i]; if (r <= 0) return cand[i] }
  return cand[0]
}

function newAction(s) {
  let side
  let pressing = false
  let scenario = 'penalty'
  if (s.shootout) side = s.shootout.next
  else {
    if (!s.current) side = (rand(s) < 0.5) !== !!s.pvp?.flip ? 'me' : 'opp' // PvP : même tirage vu des deux côtés
    else {
      const last = s.current.side
      const m = last === 'me' ? s.momentum : -s.momentum
      // Temps fort : avec 60+ de momentum, tu gardes le ballon (une fois de suite max).
      if (m >= 60 && !s.current.pressing) { side = last; pressing = true } else side = other(last)
    }
    const r = rand(s)
    scenario = r < 0.5 ? 'face' : r < 0.75 ? 'contre' : 'lointaine'
  }
  const defTeam = s.teams[other(side)]
  s.current = {
    side, scenario, pressing,
    attacker: pickAttacker(s, side),
    keeper: defTeam.GK || Object.values(defTeam).find(Boolean),
    minute: s.shootout ? null : MINUTES[s.idx],
    choices: { me: null, opp: null }, hesitated: { me: false, opp: false },
    read: null, adv: 0, tired: false, qte: null, result: null,
  }
  s.phase = 'intro'
}

// Capacité Ultime disponible pour MOI sur l'action en cours (ou null).
//   attaque : ma Légende doit être le tireur ; défense : ma Légende doit être sur le terrain.
export function ultimateReady(s) {
  const c = s?.current
  if (!c || s.phase !== 'choose' || c.choices.me) return null
  const used = s.ultUsed || {}
  const legend = c.side === 'me' ? (c.attacker?.legend ? c.attacker : null) : Object.values(s.teams.me).find((x) => x?.legend)
  if (!legend) return null
  const side = c.side === 'me' ? 'atk' : 'def'
  return (legend.ultimates || []).find((u) => u.side === side && !used[u.id]) || null
}

// Collectif 0..3 d'une carte (1 par défaut si inconnu, ex. ancienne sauvegarde).
export const chemOf = (s, side, card) => s.chem?.[side]?.[card?.id] ?? 1

// Les deux choix sont verrouillés : on calcule la lecture et l'avantage, et on prépare le QTE.
function resolveClash(s) {
  const c = s.current
  const atk = c.side
  const def = other(atk)
  const a = c.choices[atk]
  const d = c.choices[def]
  const sc = SCENARIOS[c.scenario]
  const atkT = getTraits(c.attacker)
  const gkT = getTraits(c.keeper)
  const ult = c.ultimate // Capacité Ultime : la lecture est forcément gagnée par ma Légende
  const read = ult ? (atk === 'me' ? 1 : -1) : readOf(a, d)

  let adv = read * 1.6 // la LECTURE pèse le plus lourd
  adv += clamp((cardRating(c.attacker) - cardRating(c.keeper)) / 12, -1, 1) * 0.8 // stats des cartes
  adv += sc.adv + (sc.mod?.[a] || 0)
  const mom = atk === 'me' ? s.momentum : -s.momentum
  if (mom >= 40) adv += 0.5 // temps fort
  if (mom <= -40) adv -= 0.3
  if (atkT.includes('puissance') && a === 'force') adv += 0.5
  if (atkT.includes('dribbleur') && a === 'feinte') adv += 0.5
  if (gkT.includes('lecture') && read === -1) adv -= 0.3
  adv += (atk === 'opp' ? 1 : -1) * s.ai.level
  adv += (s.collectif[atk] - s.collectif[def]) / 100 // synergie du deck
  // Collectif INDIVIDUEL : un joueur bien lié joue au-dessus de sa note, un isolé en dessous.
  const chemA = chemOf(s, atk, c.attacker)
  const chemK = chemOf(s, def, c.keeper)
  adv += CHEM_EFFECT[chemA].adv - CHEM_EFFECT[chemK].adv
  const stamina = s.stamina[atk][c.attacker.id] ?? 100
  const tired = !sc.free && stamina < ATTACK[a].cost
  if (tired) adv -= 0.75
  if (c.hesitated[atk]) adv -= 1
  if (c.hesitated[def]) adv += 1
  if (ult) adv += atk === 'me' ? 1.2 : -1.2
  adv = clamp(adv, -3, 3)

  // QTE du joueur humain : en attaque c'est sa frappe, en défense son réflexe.
  const myAdv = atk === 'me' ? adv : -adv
  const myCard = atk === 'me' ? c.attacker : c.keeper
  const myT = getTraits(myCard)
  const theirT = getTraits(atk === 'me' ? c.keeper : c.attacker)
  let zone = 0.24 + myAdv * 0.055
  if (atk === 'me' && myT.includes('sangfroid')) zone += 0.05
  if (atk === 'me' && tired) zone -= 0.05
  if (atk === 'opp' && myT.includes('reflexes')) zone += 0.05
  if (theirT.includes('mur') || theirT.includes('sangfroid')) zone -= 0.03
  zone *= CHEM_EFFECT[atk === 'me' ? chemA : chemK].zone // collectif parfait = zone verte plus large
  if (ult) zone *= 1.35 // zone de réussite élargie
  zone = clamp(zone, 0.09, ult ? 0.55 : 0.45)
  const period = clamp(1100 - myAdv * 90, 720, 1400) + (ult ? 120 : 0) // mauvais avantage = curseur plus rapide
  const center = 0.28 + rand(s) * 0.44

  if (!sc.free) s.stamina[atk][c.attacker.id] = Math.max(0, stamina - ATTACK[a].cost)
  s.momentum = clamp(s.momentum + (read === 1 ? 10 : read === -1 ? -10 : 0) * (atk === 'me' ? 1 : -1), -100, 100)

  c.read = read
  c.adv = adv
  c.tired = tired
  c.qte = { zone, center, period }
  c.chem = { attacker: chemA, keeper: chemK }
  s.phase = 'clash'
}

// Réussite simulée de l'IA, meilleure quand elle a l'avantage.
function simulateQ(s, aiAdv) {
  const r = rand(s)
  const pPerfect = clamp(0.16 + aiAdv * 0.05, 0.05, 0.34)
  const pMiss = clamp(0.24 - aiAdv * 0.06, 0.08, 0.45)
  return r < pPerfect ? 'perfect' : r < pPerfect + pMiss ? 'miss' : 'good'
}

function finish(s, myQ, timeout, oppQ = null) {
  const c = s.current
  const atk = c.side
  const def = other(atk)
  // PvP : la réussite adverse est celle du vrai joueur (aucun tirage) ; sinon l'IA est simulée
  const aiQ = s.pvp ? (oppQ || 'miss') : simulateQ(s, atk === 'opp' ? c.adv : -c.adv)
  const shooterQ = atk === 'me' ? myQ : aiQ
  const keeperQ = atk === 'me' ? aiQ : myQ

  // Illusion de contrôle maîtrisée : une frappe PARFAITE rentre (sauf parade parfaite sur une mauvaise lecture),
  // un réflexe PARFAIT arrête tout sauf une frappe parfaite bien lue.
  let kind
  if (shooterQ === 'perfect' && !(keeperQ === 'perfect' && c.read === -1)) kind = 'goal'
  else if (keeperQ === 'perfect' && c.read !== 1 && shooterQ !== 'perfect') kind = 'save'
  else {
    const v = c.adv * 0.9 + QV[shooterQ] - QV[keeperQ] * 0.85 + (rand(s) - 0.5) * 0.8
    kind = v > 0.75 ? 'goal' : shooterQ === 'miss' && rand(s) < 0.55 ? 'miss' : 'save'
  }

  if (kind === 'goal') {
    if (s.shootout) s.pens[atk]++
    else s.score[atk]++
    // +14 net pour le buteur : assez pour un temps fort, pas assez pour tuer le match (remontada possible)
    s.momentum = clamp(s.momentum + (atk === 'me' ? 14 : -14), -100, 100)
  } else {
    s.momentum = clamp(s.momentum + (def === 'me' ? 1 : -1) * (kind === 'save' ? 12 : 6), -100, 100)
  }

  // Récupération : tout le monde sauf le tireur reprend du souffle.
  for (const side of ['me', 'opp']) {
    for (const card of Object.values(s.teams[side])) {
      if (!card || card.id === c.attacker.id) continue
      s.stamina[side][card.id] = Math.min(100, (s.stamina[side][card.id] ?? 100) + 12)
    }
  }

  // Stats (point de vue du joueur) + MVP
  const myRead = (atk === 'me' && c.read === 1) || (atk === 'opp' && c.read === -1)
  s.stats.actions++
  if (myRead) s.stats.reads++
  if (myQ === 'perfect') s.stats.perfect++
  if (timeout || c.hesitated.me) s.stats.hesitations++
  const bump = (card, n) => { if (card) s.mvp[card.id] = (s.mvp[card.id] || 0) + n }
  if (atk === 'me') {
    if (kind === 'goal') { s.stats.goals++; bump(c.attacker, 3) }
    if (myQ === 'perfect') bump(c.attacker, 1)
  } else if (kind !== 'goal') {
    s.stats.saves++
    bump(c.keeper, kind === 'save' ? 2 : 1)
  }

  if (c.ultimate) s.stats.ultimates++
  s.history = [...s.history, { side: atk, attack: c.choices[atk], defend: c.choices[def], read: c.read, kind, myQ, ultimate: c.ultimate?.id || null,
    scorer: kind === 'goal' ? { id: c.attacker.id, name: c.attacker.name, country: c.attacker.country, club: c.attacker.club } : null }]
  c.result = { kind, myQ, aiQ, shooterQ, keeperQ, timeout: !!timeout }
  s.phase = 'outcome'
}

function end(s) {
  const diff = s.score.me - s.score.opp || s.pens.me - s.pens.opp
  s.winner = diff > 0 ? 'me' : diff < 0 ? 'opp' : meLeads(s) ? 'me' : 'opp'
  s.phase = 'fulltime'
}

function next(s) {
  if (s.shootout) {
    const so = { ...s.shootout, taken: s.shootout.taken + 1, next: other(s.shootout.next) }
    if (so.taken % 2 === 0) {
      if (s.pens.me !== s.pens.opp || so.round >= 5) { s.shootout = so; end(s); return }
      so.round++
    }
    s.shootout = so
    s.idx++
    newAction(s)
    return
  }
  s.idx++
  if (s.idx >= TOTAL_ACTIONS) {
    if (s.score.me === s.score.opp) {
      s.shootout = { round: 1, taken: 0, next: meLeads(s) ? 'me' : 'opp' }
      s.phase = 'shootout'
      return
    }
    end(s)
    return
  }
  newAction(s)
}

// ---------- Reducer ----------
function draft(st) {
  return {
    ...st,
    score: { ...st.score }, pens: { ...st.pens },
    stamina: { me: { ...st.stamina.me }, opp: { ...st.stamina.opp } },
    stats: { ...st.stats }, mvp: { ...st.mvp },
    current: st.current && { ...st.current, choices: { ...st.current.choices }, hesitated: { ...st.current.hesitated } },
  }
}

export function matchReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initMatch(action.payload)
    case 'NEW_ACTION': {
      if (state.phase !== 'kickoff' && state.phase !== 'shootout') return state
      const s = draft(state); newAction(s); return s
    }
    case 'OPEN_CHOICE': {
      if (state.phase !== 'intro') return state
      return { ...state, phase: 'choose' }
    }
    case 'LOCK': {
      if (state.phase !== 'choose' || state.current.choices[action.who]) return state
      const s = draft(state)
      const ult = action.who === 'me' && action.ultimate ? ultimateReady(state) : null
      if (action.ultimate && !ult) return state
      if (ult) {
        s.current.ultimate = ult
        s.ultUsed = { ...state.ultUsed, [ult.id]: true }
      }
      s.current.choices[action.who] = ult ? ult.move : action.choice
      s.current.hesitated[action.who] = !!action.hesitated
      if (s.current.choices.me && s.current.choices.opp) resolveClash(s)
      return s
    }
    case 'START_QTE': {
      if (state.phase !== 'clash') return state
      return { ...state, phase: 'qte' }
    }
    case 'QTE': {
      if (state.phase !== 'qte') return state
      const s = draft(state); finish(s, action.q, action.timeout, action.oppQ); return s
    }
    case 'FORFEIT': {
      // PvP : un joueur a quitté le match (forfeit = qui est parti)
      if (state.phase === 'fulltime') return state
      return { ...state, winner: action.winner || 'me', forfeit: action.winner === 'opp' ? 'me' : 'opp', phase: 'fulltime', current: state.current && { ...state.current } }
    }
    case 'NEXT': {
      if (state.phase !== 'outcome') return state
      const s = draft(state); next(s); return s
    }
    default:
      return state
  }
}
