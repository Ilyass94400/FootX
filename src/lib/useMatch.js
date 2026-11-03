import { useState, useRef, useCallback, useEffect } from 'react'
import { resolveDuel, keeperChoose, outcome, evalQte, pickScenario, TIMING } from './matchEngine'

// Hook qui pilote la machine à états d'un moment-clé et tous ses timers.
// Phases : setup -> intro -> choice -> clash -> qte -> result
//
// usage :
//   const m = useMatch({ attacker, defender })
//   m.phase, m.start(), m.choose('force'), m.hitQte(), m.marker, m.timeLeft ...
export function useMatch({ attacker, defender }) {
  const [phase, setPhase] = useState('setup')
  const [scenario, setScenario] = useState(() => pickScenario())
  const [score, setScore] = useState({ h: 0, a: 0 })
  const [momentum, setMomentum] = useState(52)

  const [choice, setChoice] = useState(null) // tactique du joueur
  const [read, setRead] = useState(null)      // lecture du gardien
  const [res, setRes] = useState(null)        // résultat de resolveDuel
  const [out, setOut] = useState(null)        // issue finale

  const [timeLeft, setTimeLeft] = useState(TIMING.CHOICE) // chrono du choix (ms)
  const [marker, setMarker] = useState(0)                 // position QTE 0..1
  const [qteT, setQteT] = useState(1)                     // temps QTE restant 0..1
  const [fx, setFx] = useState(null)                      // 'flash' | null
  const [shake, setShake] = useState('')                  // '' | 'shake' | 'shake-lite'

  const timers = useRef([])
  const interval = useRef(null)
  const raf = useRef(null)
  const qte = useRef({ pos: 0, start: 0, dur: 1000, done: false })

  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.current.push(id); return id }
  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout); timers.current = []
    if (interval.current) { clearInterval(interval.current); interval.current = null }
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null }
  }, [])

  // Lance un nouveau moment-clé
  const start = useCallback(() => {
    clearAll()
    setChoice(null); setRead(null); setRes(null); setOut(null)
    setScenario(pickScenario())
    setPhase('intro')
    after(TIMING.INTRO, () => { setPhase('choice'); setTimeLeft(TIMING.CHOICE) })
  }, [clearAll])

  // Compte à rebours du choix
  useEffect(() => {
    if (phase !== 'choice') return
    const t0 = Date.now()
    interval.current = setInterval(() => {
      const left = TIMING.CHOICE - (Date.now() - t0)
      if (left <= 0) { clearInterval(interval.current); interval.current = null; commit(randomTactic()) }
      else setTimeLeft(left)
    }, 40)
    return () => { if (interval.current) { clearInterval(interval.current); interval.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const randomTactic = () => ['force', 'finesse', 'passe'][Math.floor(Math.random() * 3)]

  // Verrouille le choix, résout le duel, joue le clash puis lance le QTE
  const commit = useCallback((tactic) => {
    if (interval.current) { clearInterval(interval.current); interval.current = null }
    const r = keeperChoose(tactic, defender)
    const resolved = resolveDuel(tactic, r, attacker, defender)
    setChoice(tactic); setRead(r); setRes(resolved)
    setPhase('clash')
    // impact à mi-animation
    after(440, () => {
      setFx('flash'); setShake(resolved.won ? 'shake' : 'shake-lite')
      after(560, () => { setFx(null); setShake('') })
    })
    after(TIMING.CLASH, () => launchQte(resolved))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attacker, defender])

  const choose = useCallback((tactic) => { if (phase === 'choice') commit(tactic) }, [phase, commit])

  // Boucle du QTE : marqueur triangulaire 0..1..0, fenêtre de temps = res.windowMs
  const launchQte = useCallback((resolved) => {
    setPhase('qte')
    const st = qte.current
    st.done = false; st.start = performance.now(); st.dur = resolved.windowMs
    const sweep = TIMING.SWEEP
    const loop = (now) => {
      const el = now - st.start
      const ph = (el % sweep) / sweep
      st.pos = ph < 0.5 ? ph * 2 : 2 - ph * 2
      setMarker(st.pos)
      setQteT(Math.max(0, 1 - el / st.dur))
      if (el >= st.dur) { cancelAnimationFrame(raf.current); raf.current = null; if (!st.done) finish(resolved, false, false); return }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Le joueur appuie pendant le QTE
  const hitQte = useCallback(() => {
    if (phase !== 'qte' || !res) return
    const st = qte.current
    st.done = true
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null }
    const { hit, perfect } = evalQte(st.pos, res.zone)
    finish(res, hit, perfect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, res])

  // Applique l'issue au score / momentum
  const finish = useCallback((resolved, hit, perfect) => {
    const o = outcome(resolved.adv, hit, perfect)
    setOut({ ...o, hit, perfect })
    if (o.kind === 'goal') {
      setFx('flash'); setShake('shake'); after(560, () => { setFx(null); setShake('') })
      setScore((s) => ({ ...s, h: s.h + 1 }))
      setMomentum((m) => Math.min(96, m + 14))
    } else if (o.kind === 'save') {
      setMomentum((m) => Math.max(6, m - 12))
    } else {
      setMomentum((m) => Math.max(10, m - 5))
    }
    setPhase('result')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toSetup = useCallback(() => { clearAll(); setPhase('setup') }, [clearAll])

  useEffect(() => () => clearAll(), [clearAll])

  return {
    phase, scenario, score, momentum,
    choice, read, res, out,
    timeLeft, marker, qteT, fx, shake,
    start, choose, hitQte, toSetup,
  }
}
