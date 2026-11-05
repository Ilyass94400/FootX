import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { initMatch, matchReducer, aiChoice, SCENARIOS, TIMING, ATTACK_IDS, DEFEND_IDS } from './engine'
import { addStock } from '../boosterStock'
import { eco } from '../economy'
import { coinSound } from '../economy/fx'
import { track } from '../quests'
import { reportMatch } from '../career'

// ============================================================================
// Contrôleur de match : orchestre les phases du moteur (pur) avec le temps réel.
//   - un seul useReducer = source de vérité (rejouable, sérialisable)
//   - les timers vivent ICI, jamais dans le moteur
//   - l'adversaire passe par un "adapter" : IA locale aujourd'hui,
//     canal Supabase Realtime demain (même interface : il finit par dispatcher LOCK).
// ============================================================================

const LEVEL_KEY = 'footx_ai_level'
const STREAK_KEY = 'footx_win_streak'
const REWARD_KEY = 'footx_match_rewards'
const DAILY_BOOSTERS = 5

const readNum = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : d } catch { return d } }
const writeNum = (k, v) => { try { localStorage.setItem(k, String(v)) } catch { /* stockage indisponible */ } }

// Difficulté adaptative : on garde le joueur dans la zone de tension (~50 % de victoires).
function nextLevel(win) {
  const lv = readNum(LEVEL_KEY, 0.55)
  const nv = Math.max(0.2, Math.min(0.95, lv + (win ? 0.08 : -0.12)))
  writeNum(LEVEL_KEY, nv)
  return nv
}

// Victoire = +1 booster (max 5 par jour) : le match nourrit l'ouverture de packs.
function grantWinReward() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const r = JSON.parse(localStorage.getItem(REWARD_KEY) || '{}')
    const n = r.day === today ? r.n : 0
    if (n >= DAILY_BOOSTERS) return { booster: false, left: 0 }
    if (!addStock(1)) return { booster: false, full: true, left: DAILY_BOOSTERS - n } // stock plein : la récompense n'est pas consommée
    localStorage.setItem(REWARD_KEY, JSON.stringify({ day: today, n: n + 1 }))
    return { booster: true, left: DAILY_BOOSTERS - n - 1 }
  } catch {
    return { booster: false, left: 0 }
  }
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
        const streak = win ? readNum(STREAK_KEY, 0) + 1 : 0
        writeNum(STREAK_KEY, streak)
        nextLevel(win)
        // Défis : matchs joués / gagnés, buts (avec le pays et le club du buteur), timings parfaits
        track('match_played', 1)
        if (win) track('match_won', 1)
        track('perfect_qte', s.stats.perfect)
        for (const h of s.history) if (h.side === 'me' && h.kind === 'goal') track('goal_scored', 1, h.scorer || {})
        setReward({ ...(win ? grantWinReward() : { booster: false, left: null }), streak, coins: null })
        // X-Coins : victoire +500, défaite +100 (une seule fois par match, plafonné par jour côté serveur)
        Promise.resolve(eco.claimMatchReward(String(s.seed), win)).then((r) => {
          if (!r?.amount) { setReward((x) => x && { ...x, coins: 0, capped: !!r?.capped }); return }
          setReward((x) => x && { ...x, coins: r.amount })
          setTimeout(() => coinSound(r.amount), 900)
        }).catch(() => setReward((x) => x && { ...x, coins: 0 }))
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
    dispatch({ type: 'RESET', payload: { ...makeSetup(), level: readNum(LEVEL_KEY, 0.55) } })
  }, [makeSetup])

  return { s, choose, fireUltimate, qte, rematch, reward }
}
