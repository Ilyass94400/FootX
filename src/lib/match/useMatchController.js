import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { initMatch, matchReducer, aiChoice, SCENARIOS, TIMING, ATTACK_IDS, DEFEND_IDS } from './engine'
import { eco } from '../economy'
import { coinSound } from '../economy/fx'
import { track } from '../quests'
import { reportMatch } from '../career'
import { cloudSave } from '../cloud'

// ============================================================================
// Contrôleur de match : orchestre les phases du moteur (pur) avec le temps réel.
//   - un seul useReducer = source de vérité (rejouable, sérialisable)
//   - les timers vivent ICI, jamais dans le moteur
//   - l'adversaire passe par un "adapter" : IA locale aujourd'hui,
//     canal Supabase Realtime demain (même interface : il finit par dispatcher LOCK).
// ============================================================================

const LEVEL_KEY = 'footx_ai_level'

const readNum = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : d } catch { return d } }
const writeNum = (k, v) => { try { localStorage.setItem(k, String(v)) } catch { /* stockage indisponible */ } }

// Difficulté adaptative : on garde le joueur dans la zone de tension (~50 % de victoires).
function nextLevel(win) {
  const lv = readNum(LEVEL_KEY, 0.55)
  const nv = Math.max(0.2, Math.min(0.95, lv + (win ? 0.08 : -0.12)))
  writeNum(LEVEL_KEY, nv)
  cloudSave('prefs', { ai_level: nv })
  return nv
}

// Adversaire IA : décide après un délai "humain" (la pression monte quand il est prêt avant toi).
const aiOpponent = {
  chooseDelay: (timeMs) => 650 + Math.random() * Math.max(400, timeMs - 2000),
  choose: (state, role) => aiChoice(state, role, Math.random),
}

export function useMatchController(makeSetup, opponent = aiOpponent) {
  const [s, dispatch] = useReducer(matchReducer, null, () => initMatch({ ...makeSetup(), level: readNum(LEVEL_KEY, 0.55) }))
  const [reward, setReward] = useState(null)
  const stRef = useRef(s)
  stRef.current = s
  const timers = useRef([])
  const rewarded = useRef(null)
  // Coup d'envoi enregistré sur le serveur (en ligne) : la récompense de fin de match en dépend.
  const reg = useRef(null)
  const register = useCallback((state) => {
    if (state.meta?.career) { reg.current = null; return }
    const squad = Object.fromEntries(Object.entries(state.teams?.me || {}).map(([k, c]) => [k, c?.id ?? null]))
    reg.current = Promise.resolve().then(() => eco.matchStart(squad)).catch(() => null)
  }, [])
  useEffect(() => { register(stRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
    const after = (ms, fn) => { timers.current.push(setTimeout(fn, ms)) }
    clear()
    const c = s.current
    switch (s.phase) {
      case 'kickoff':
        after(TIMING.kickoff, () => dispatch({ type: 'NEW_ACTION' }))
        break
      case 'shootout':
        after(TIMING.shootout, () => dispatch({ type: 'NEW_ACTION' }))
        break
      case 'intro':
        after(TIMING.intro, () => dispatch({ type: 'OPEN_CHOICE' }))
        break
      case 'choose': {
        const time = SCENARIOS[c.scenario].time
        const aiRole = c.side === 'opp' ? 'attack' : 'defend'
        after(opponent.chooseDelay(time), () => dispatch({ type: 'LOCK', who: 'opp', choice: opponent.choose(stRef.current, aiRole) }))
        // Temps écoulé : choix au hasard + pénalité d'hésitation.
        after(time, () => {
          const ids = c.side === 'me' ? ATTACK_IDS : DEFEND_IDS
          dispatch({ type: 'LOCK', who: 'me', choice: ids[Math.floor(Math.random() * ids.length)], hesitated: true })
        })
        break
      }
      case 'clash':
        // Capacité Ultime : l'action se fige le temps de la cinématique
        after(TIMING.clash + (c.ultimate ? TIMING.ultimate : 0), () => dispatch({ type: 'START_QTE' }))
        break
      case 'qte':
        after(c.qte.period * 2.5 + 250, () => dispatch({ type: 'QTE', q: 'miss', timeout: true }))
        break
      case 'outcome':
        after(c.result.kind === 'goal' ? TIMING.goal : TIMING.outcome, () => dispatch({ type: 'NEXT' }))
        break
      case 'fulltime': {
        if (rewarded.current === s.seed) break
        rewarded.current = s.seed
        const win = s.winner === 'me'
        // Mode Carrière : note du match + XP de ton joueur (pas de pièces ni de boosters : mode solo à part)
        if (s.meta?.career) {
          const k = s.meta.career
          const goals = s.history.filter((h) => h.side === 'me' && h.kind === 'goal' && h.scorer?.id === k.proId).length
          const r = reportMatch(k.fixtureId, {
            win, gf: s.score.me, ga: s.score.opp, goals, perfect: s.stats.perfect, reads: s.stats.reads, actions: s.stats.actions,
            hesitations: s.stats.hesitations, keeper: k.keeper, saves: k.keeper ? s.stats.saves : 0, conceded: s.score.opp,
          })
          setReward({ career: r || { done: true }, streak: 0 })
          break
        }
        nextLevel(win)
        // Défis (mode démo ; en ligne, le serveur les compte à partir du match enregistré)
        track('match_played', 1)
        if (win) track('match_won', 1)
        track('perfect_qte', s.stats.perfect)
        for (const h of s.history) if (h.side === 'me' && h.kind === 'goal') track('goal_scored', 1, h.scorer || {})
        // Récompenses : X-Coins (victoire 500 / défaite 100, plafonné par jour), +1 booster par victoire (5/jour), série
        setReward({ pending: true, coins: null, streak: null })
        const goals = s.history.filter((h) => h.side === 'me' && h.kind === 'goal').map((h) => ({ country: h.scorer?.country || '', club: h.scorer?.club || '' }))
        Promise.resolve(reg.current)
          .then((m) => eco.matchFinish(m?.id, { win, home: s.score.me, away: s.score.opp, perfect: s.stats.perfect, goals }))
          .then((r) => {
            setReward({ ...r, pending: false })
            if (r.coins > 0) setTimeout(() => coinSound(r.coins), 900)
          })
          .catch((e) => setReward({ pending: false, coins: 0, streak: 0, error: e?.message || 'Récompense indisponible' }))
        break
      }
      default:
        break
    }
    return clear
  }, [s.phase, s.idx]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((id) => dispatch({ type: 'LOCK', who: 'me', choice: id }), [])
  const fireUltimate = useCallback(() => dispatch({ type: 'LOCK', who: 'me', ultimate: true }), [])
  const qte = useCallback((q) => dispatch({ type: 'QTE', q }), [])
  const rematch = useCallback(() => {
    setReward(null)
    const payload = { ...makeSetup(), level: readNum(LEVEL_KEY, 0.55) }
    dispatch({ type: 'RESET', payload })
    register({ teams: { me: payload.me }, meta: payload.meta })
  }, [makeSetup])

  return { s, choose, fireUltimate, qte, rematch, reward }
}
