import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { initMatch, matchReducer, aiChoice, SCENARIOS, TIMING, ATTACK_IDS, DEFEND_IDS } from './engine'
import { eco } from '../economy'
import { coinSound } from '../economy/fx'
import { track } from '../quests'
import { reportMatch } from '../career'
import { cloudSave } from '../cloud'
import { pvp, exchange, sleep } from './pvp'
import { applyServerBoosters } from '../boosterStock'

// ============================================================================
// Contrôleur de match : orchestre les phases du moteur (pur) avec le temps réel.
//   - un seul useReducer = source de vérité (rejouable, sérialisable)
//   - les timers vivent ICI, jamais dans le moteur
//   - l'adversaire : IA locale, OU un vrai joueur (s.meta.pvp) : chaque coup passe alors par
//     le serveur, qui ne révèle le coup adverse qu'une fois les deux joués (voir ./pvp.js).
//     Le moteur ne reçoit QUE des coups confirmés par le serveur : les deux écrans restent identiques.
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
    if (state.meta?.career || state.meta?.pvp) { reg.current = null; return }
    const squad = Object.fromEntries(Object.entries(state.teams?.me || {}).map(([k, c]) => [k, c?.id ?? null]))
    reg.current = Promise.resolve().then(() => eco.matchStart(squad)).catch(() => null)
  }, [])
  useEffect(() => { register(stRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Joueur contre joueur ----------
  const pvpId = s.meta?.pvp?.id || null
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const sent = useRef({})
  const [pending, setPending] = useState(null) // mon coup envoyé, pas encore confirmé : { idx, choice | q }
  const [netWait, setNetWait] = useState(null) // 'choice' | 'qte' : j'attends l'adversaire
  const [netError, setNetError] = useState(null)
  const onNetEnd = useCallback((r) => {
    setNetWait(null)
    dispatch({ type: 'FORFEIT', winner: r.win ? 'me' : 'opp' })
  }, [])
  const submitChoice = useCallback((choice, hesitated) => {
    const st = stRef.current
    const idx = st.idx
    if (!pvpId || st.phase !== 'choose' || sent.current[idx + ':c']) return
    sent.current[idx + ':c'] = true
    setPending({ idx, choice })
    setNetWait('choice')
    exchange(() => pvp.move(pvpId, idx, choice, hesitated), () => pvp.wait(pvpId, idx, 'choice'), () => alive.current)
      .then((r) => {
        if (!r || !alive.current) return
        if (r.finished) { onNetEnd(r); return }
        setNetWait(null)
        dispatch({ type: 'LOCK', who: 'me', choice: r.me.choice, hesitated: r.me.hesitated })
        dispatch({ type: 'LOCK', who: 'opp', choice: r.opp.choice, hesitated: r.opp.hesitated })
      })
      .catch((e) => setNetError(e.message))
  }, [pvpId, onNetEnd])
  const submitQ = useCallback((q, timeout) => {
    const st = stRef.current
    const idx = st.idx
    if (!pvpId || st.phase !== 'qte' || sent.current[idx + ':q']) return
    sent.current[idx + ':q'] = true
    setPending({ idx, q })
    setNetWait('qte')
    exchange(() => pvp.qte(pvpId, idx, q), () => pvp.wait(pvpId, idx, 'qte'), () => alive.current)
      .then((r) => {
        if (!r || !alive.current) return
        if (r.finished) { onNetEnd(r); return }
        setNetWait(null)
        dispatch({ type: 'QTE', q: r.me.qte, oppQ: r.opp.qte, timeout: !!timeout && r.me.qte === 'miss' })
      })
      .catch((e) => setNetError(e.message))
  }, [pvpId, onNetEnd])

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
        const ids = c.side === 'me' ? ATTACK_IDS : DEFEND_IDS
        const randomPick = () => ids[Math.floor(Math.random() * ids.length)]
        if (pvpId) {
          // vrai adversaire : son coup arrivera par le serveur
          after(time, () => submitChoice(randomPick(), true))
          break
        }
        const aiRole = c.side === 'opp' ? 'attack' : 'defend'
        after(opponent.chooseDelay(time), () => dispatch({ type: 'LOCK', who: 'opp', choice: opponent.choose(stRef.current, aiRole) }))
        // Temps écoulé : choix au hasard + pénalité d'hésitation.
        after(time, () => dispatch({ type: 'LOCK', who: 'me', choice: randomPick(), hesitated: true }))
        break
      }
      case 'clash':
        // Capacité Ultime : l'action se fige le temps de la cinématique
        after(TIMING.clash + (c.ultimate ? TIMING.ultimate : 0), () => dispatch({ type: 'START_QTE' }))
        break
      case 'qte':
        after(c.qte.period * 2.5 + 250, () => (pvpId ? submitQ('miss', true) : dispatch({ type: 'QTE', q: 'miss', timeout: true })))
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
        if (pvpId) {
          // vrai adversaire : les deux navigateurs annoncent le score, le serveur valide et récompense
          setReward({ pending: true, coins: null, streak: null })
          const goals = s.history.filter((h) => h.side === 'me' && h.kind === 'goal').map((h) => ({ country: h.scorer?.country || '', club: h.scorer?.club || '' }))
          ;(async () => {
            for (let i = 0; i < 30 && alive.current; i++) {
              try {
                const r = await pvp.finish(pvpId, { my: s.score.me, opp: s.score.opp, win, perfect: s.stats.perfect, goals })
                if (!r?.pending) {
                  if (r.state) applyServerBoosters(r.state)
                  try { localStorage.setItem('footx_win_streak', String(r.streak || 0)) } catch { /* rien */ }
                  eco.wallet?.().catch?.(() => {})
                  setReward({ ...r, pending: false })
                  if (r.coins > 0) setTimeout(() => coinSound(r.coins), 900)
                  return
                }
              } catch (e) {
                if (e?.hint === 'not_found' || e?.hint === 'closed') { setReward({ pending: false, coins: 0, error: e.message }); return }
              }
              await sleep(1500)
            }
            if (alive.current) setReward({ pending: false, coins: 0, error: 'Résultat pas encore validé : il apparaîtra dans ton solde.' })
          })()
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

  const choose = useCallback((id) => (pvpId ? submitChoice(id, false) : dispatch({ type: 'LOCK', who: 'me', choice: id })), [pvpId, submitChoice])
  const fireUltimate = useCallback(() => { if (!pvpId) dispatch({ type: 'LOCK', who: 'me', ultimate: true }) }, [pvpId])
  const qte = useCallback((q) => (pvpId ? submitQ(q, false) : dispatch({ type: 'QTE', q })), [pvpId, submitQ])
  const rematch = useCallback(() => {
    setReward(null)
    const payload = { ...makeSetup(), level: readNum(LEVEL_KEY, 0.55) }
    dispatch({ type: 'RESET', payload })
    register({ teams: { me: payload.me }, meta: payload.meta })
  }, [makeSetup])

  // mon coup affiché tout de suite (même avant la confirmation du serveur)
  const myPick = s.current?.choices.me || (pending && pending.idx === s.idx && pending.choice) || null
  return { s, choose, fireUltimate, qte, rematch, reward, myPick, netWait, netError }
}
