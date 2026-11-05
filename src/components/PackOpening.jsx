import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { getBorderColor, RARITY_LABEL } from '../lib/rarity'
import FoilCard from './FoilCard'
import PackFx from './PackFx'
import BoosterPack from './BoosterPack'
import './pack.css'

// ============================================================================
// Ouverture de booster FootX
//  1. PACK     : le joueur déchire le pack (glisser le long de la ligne, clic ou Espace)
//  2. TEAR     : la lumière "monte" de palier en palier jusqu'à la meilleure rareté
//  3. EMERGE   : les cartes sortent du pack et forment une pile
//  4. REVEAL   : carte par carte (face cachée = contour de sa rareté), flip + burst,
//                walkout Nationalité > Club > Poste pour les légendaires / iconiques
//  5. DONE     : récap + "Ouvrir un autre pack"
// Aucune vibration d'écran : seuls le pack et les cartes bougent.
// ============================================================================

const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const rk = (r) => RANK[String(r || '').toLowerCase()] || 0
const rank = (c) => rk(c?.rarity)
const EPIC = 4
const WALK = 5
const CLIMB = ['rare', 'epique', 'legendaire', 'iconique']
const RAINBOW = ['#ff6b9a', '#ffd65c', '#62ffb8', '#5cc8ff', '#b98cff', '#ffffff']
const POW = [0, 0, 0.12, 0.28, 0.55, 0.85, 1]       // intensité visuelle par rareté
const BURST = [0, 14, 20, 30, 70, 130, 200]          // particules au flip par rareté
const BRAND = '#e4ff3c'
const NEUTRAL = '#3b3e34'
const CLIMB_MS = 600
const FLY_MS = 360
const FLY_FAST_MS = 120

const lbl = (r) => RARITY_LABEL[String(r || '').toLowerCase()] || r
const colorsOf = (r) => (rk(r) === 6 ? RAINBOW : [getBorderColor(r), '#ffffff', getBorderColor(r)])


export default function PackOpening({ cards, quick = false, onAgain, onOpenAnother, stockLeft = 0, packs = 1 }) {
  const order = useMemo(() => [...cards].sort((a, b) => rank(a) - rank(b)), [cards])
  const N = order.length
  const best = order[N - 1]
  const bestRank = rank(best)
  const climb = useMemo(
    () => (bestRank >= 3 ? CLIMB.filter((t) => RANK[t] <= bestRank) : [String(best?.rarity || 'commune').toLowerCase()]),
    [bestRank, best],
  )

  const [phase, setPhase] = useState(quick ? 'done' : 'pack')
  const [prog, setProg] = useState(0)
  const [climbStep, setClimbStep] = useState(0)
  const [st, setSt] = useState({ idx: 0, flipped: false })
  const [exiting, setExiting] = useState(false)
  const [walk, setWalk] = useState(false)
  const [flipFx, setFlipFx] = useState(0)

  const fx = useRef(null)
  const stageRef = useRef(null)
  const packRef = useRef(null)
  const wrapRef = useRef(null)
  const areaRef = useRef(null)
  const timers = useRef([])
  const hold = useRef({ t: null, iv: null })
  const autoRef = useRef(false)
  const phaseRef = useRef(phase); phaseRef.current = phase
  const stRef = useRef(st); stRef.current = st
  const progRef = useRef(prog); progRef.current = prog
  const busyRef = useRef(false); busyRef.current = exiting || walk

  const later = useCallback((ms, fn) => { timers.current.push(setTimeout(fn, ms)) }, [])
  const endHold = useCallback(() => { clearTimeout(hold.current.t); clearInterval(hold.current.iv) }, [])
  useEffect(() => () => { timers.current.forEach(clearTimeout); endHold() }, [endHold])
  useEffect(() => { if (quick) setPhase('done') }, [quick])

  // Position (fractions de la scène) d'un élément, à une hauteur relative fy.
  const at = useCallback((el, fy = 0.5, fx_ = 0.5) => {
    const s = stageRef.current?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    if (!s || !r || !s.width) return { x: 0.5, y: 0.45 }
    return { x: (r.left + r.width * fx_ - s.left) / s.width, y: (r.top + r.height * fy - s.top) / s.height }
  }, [])

  // ---------- 1-2. Déchirure + montée de rareté ----------
  const tear = useCallback(() => {
    if (phaseRef.current !== 'pack') return
    setProg(1)
    setPhase('tear')
    setClimbStep(0)
    const mouth = () => at(packRef.current, 0.13)
    fx.current?.burst({ ...mouth(), colors: ['#ffffff', getBorderColor(climb[0])], count: 90, speed: 10, spread: Math.PI * 0.9 })
    climb.forEach((t, i) => {
      if (!i) return
      later(CLIMB_MS * i, () => {
        setClimbStep(i)
        fx.current?.burst({ ...mouth(), colors: colorsOf(t), count: 60 + i * 50, speed: 9 + i * 2.4, spread: Math.PI * (0.8 + i * 0.14), kind: i >= 2 ? 'mix' : 'spark' })
        wrapRef.current?.animate([
          { transform: 'none' },
          { transform: `translateY(${-8 - i * 4}px) scale(${1.03 + i * 0.015}) rotate(${i % 2 ? 1.8 : -1.8}deg)` },
          { transform: 'none' },
        ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' })
      })
    })
    const end = CLIMB_MS * (climb.length - 1) + 820
    later(end, () => setPhase('emerge'))
    later(end + 1200, () => setPhase('reveal'))
  }, [climb, at, later])

  const autoTear = useCallback(() => {
    if (phaseRef.current !== 'pack' || autoRef.current) return
    autoRef.current = true
    const t0 = performance.now()
    const from = progRef.current
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 420)
      const p = from + (1 - from) * (1 - Math.pow(1 - k, 3))
      setProg(p)
      sparkAt(p)
      if (k < 1) requestAnimationFrame(step)
      else tear()
    }
    requestAnimationFrame(step)
  }, [tear]) // eslint-disable-line react-hooks/exhaustive-deps

  const lastSpark = useRef(0)
  const sparkAt = (p) => {
    const now = performance.now()
    if (now - lastSpark.current < 30) return
    lastSpark.current = now
    const pos = at(packRef.current, 0.13, 0.06 + 0.88 * p)
    fx.current?.burst({ ...pos, colors: ['#ffffff', BRAND], count: 4, speed: 3.2, kind: 'glitter', gravity: 0.18 })
  }

  // ---------- 4. Révélation ----------
  const flipNow = useCallback((idx) => {
    setSt({ idx, flipped: true })
    setFlipFx((n) => n + 1)
    const c = order[idx]
    const r = rank(c)
    later(250, () => {
      const p = at(areaRef.current, 0.5)
      fx.current?.burst({ ...p, colors: colorsOf(c.rarity), count: BURST[r], speed: 5 + r * 1.7, kind: r >= EPIC ? 'spark' : 'glitter', gravity: 0.1 })
      // confettis tirés depuis les bords de la carte, vers l'extérieur : le visage du joueur reste dégagé
      if (r >= WALK) later(120, () => {
        const L = at(areaRef.current, 0.22, 0)
        const R = at(areaRef.current, 0.22, 1)
        const cols = colorsOf(c.rarity)
        fx.current?.burst({ ...L, colors: cols, count: 80, speed: 12, kind: 'confetti', angle: -Math.PI * 0.82, spread: Math.PI * 0.45 })
        fx.current?.burst({ ...R, colors: cols, count: 80, speed: 12, kind: 'confetti', angle: -Math.PI * 0.18, spread: Math.PI * 0.45 })
      })
    })
  }, [order, at, later])

  const advance = useCallback((fast = false) => {
    if (busyRef.current || phaseRef.current !== 'reveal') return
    const s = stRef.current
    if (!s.flipped) {
      if (rank(order[s.idx]) >= WALK) { endHold(); setWalk(true); return } // walkout d'abord
      flipNow(s.idx)
      return
    }
    if (s.idx >= N - 1) { endHold(); setPhase('done'); return }
    setExiting(true) // la carte s'envole, la suivante monte de la pile
    later(fast ? FLY_FAST_MS : FLY_MS, () => {
      setSt({ idx: stRef.current.idx + 1, flipped: false })
      setExiting(false)
    })
  }, [N, order, flipNow, later, endHold])

  const skipTo = useCallback((idx) => {
    if (busyRef.current || idx < 0) return
    endHold()
    setSt({ idx, flipped: false })
  }, [endHold])

  const startHold = useCallback(() => {
    if (busyRef.current) return
    advance(false)
    hold.current.t = setTimeout(() => { hold.current.iv = setInterval(() => advance(true), FLY_FAST_MS + 50) }, 320)
  }, [advance])

  const onWalkBeat = useCallback((i) => {
    const c = order[stRef.current.idx]
    fx.current?.burst({ x: 0.5, y: 0.5, colors: colorsOf(c?.rarity), count: 40 + i * 40, speed: 7 + i * 2.6, kind: i >= 2 ? 'mix' : 'spark' })
  }, [order])
  const onWalkDone = useCallback(() => { setWalk(false); flipNow(stRef.current.idx) }, [flipNow])

  // Clavier : Espace / Entrée
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (e.target?.closest?.('button, input, textarea')) return
      if (phaseRef.current === 'pack') { e.preventDefault(); autoTear() }
      else if (phaseRef.current === 'reveal') { e.preventDefault(); advance(e.repeat) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [autoTear, advance])

  if (!N) return null

  // ---------- Couleur de scène (transitionne en douceur via @property --cc) ----------
  const cur = order[Math.min(st.idx, N - 1)]
  const cr = rank(cur)
  let stageR = 0
  let stageColor = BRAND
  if (phase === 'tear') { stageR = RANK[climb[climbStep]]; stageColor = getBorderColor(climb[climbStep]) }
  else if (phase === 'emerge' || phase === 'done') { stageR = bestRank; stageColor = getBorderColor(best?.rarity) }
  else if (phase === 'reveal') { stageR = cr; stageColor = getBorderColor(cur?.rarity) }
  const iconicStage = stageR === 6

  // Cible du skip : 1re carte du palier suivant (au moins épique), meilleure que la courante.
  const skipStart = st.flipped ? st.idx + 1 : st.idx
  const targetRank = Math.max(EPIC, cr + 1)
  let skipIdx = -1
  for (let j = skipStart; j < N; j++) if (rank(order[j]) >= targetRank) { skipIdx = j; break }
  const skipR = skipIdx >= 0 ? order[skipIdx].rarity : null
  const remaining = N - st.idx - 1

  // Plein écran : l'ouverture est rendue directement dans <body>, par-dessus la navigation.
  return createPortal(
    <div
      ref={stageRef}
      className={'pk-stage' + (iconicStage ? ' iconic' : '') + (phase === 'done' ? ' done' : '')}
      style={{ '--cc': stageColor }}
    >
      <PackFx ref={fx} ambient={iconicStage ? '#ffffff' : stageColor} />
      <StageBar onClose={onAgain} />
      <div className="pk-floor" />

      {/* ---------- 1-3. Pack, montée de rareté, émergence ---------- */}
      {(phase === 'tear' || phase === 'emerge') && (
        <div className="stage-rays" style={{ '--lvl': 0.16 + 0.13 * (phase === 'tear' ? climbStep : climb.length - 1) }} />
      )}
      {(phase === 'tear' || phase === 'emerge') && (
        <div key={'cl' + climbStep} className={'climb-label' + (phase === 'emerge' ? ' out' : '')}>
          <span className={climb[climbStep] === 'iconique' ? 'rainbow-text' : ''}>{lbl(climb[climbStep])}</span>
        </div>
      )}
      {phase === 'tear' && <div key={'cr' + climbStep} className="climb-ring" />}

      {phase === 'emerge' && (
        <div className="em-stack">
          {[2, 1, 0].filter((k) => k < Math.min(3, N)).map((k) => (
            <div key={k} className="em-card" style={{ '--k': k }}>
              <CardBack cc={k === 0 ? getBorderColor(order[0].rarity) : NEUTRAL} iconic={k === 0 && rank(order[0]) === 6} />
            </div>
          ))}
        </div>
      )}

      {(phase === 'pack' || phase === 'tear' || phase === 'emerge') && (
        <Pack
          phase={phase} prog={prog} setProg={setProg} packs={packs}
          packRef={packRef} wrapRef={wrapRef}
          onTear={tear} onAuto={autoTear} onSpark={sparkAt}
        />
      )}

      {/* ---------- 4. Révélation ---------- */}
      {phase === 'reveal' && cur && (
        <>
          <div className="rv-counter">{st.idx + 1}<small> / {N}</small></div>

          <div ref={areaRef} className="rv-area" style={{ '--pow': POW[cr] }}>
            {cr >= EPIC && !st.flipped && !exiting && <div className="pk-aura" />}
            {cr >= WALK && !st.flipped && !exiting && <div className={'rv-rays dim' + (cr === 6 ? ' rainbow' : '')} />}
            {cr >= EPIC && st.flipped && !exiting && <div key={'r' + flipFx} className={'rv-rays' + (cr === 6 ? ' rainbow' : '')} />}

            <div className="pk-deck">
              {[2, 1].filter((k) => k <= remaining).map((k) => (
                <div key={k} className="db" style={{ '--k': k }}><CardBack cc={NEUTRAL} /></div>
              ))}
            </div>

            <div
              key={st.idx}
              className={'flip-card' + (exiting ? ' exiting' : '') + (st.idx === 0 ? ' noenter' : '') + (cr >= EPIC && !st.flipped ? ' tease' : '')}
              data-flipped={st.flipped}
              onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}
              role="button" tabIndex={0} aria-label={st.flipped ? 'Carte suivante' : 'Retourner la carte'}
            >
              <div className="flip-lift">
                <div className="flip-inner">
                  <div className="pk-face back"><CardBack cc={getBorderColor(cur.rarity)} iconic={cr === 6} /></div>
                  <div className="pk-face front"><FoilCard card={cur} best={st.idx === N - 1} plain /></div>
                </div>
              </div>
            </div>

            {st.flipped && cr >= EPIC && !exiting && <div key={'s' + flipFx} className="pk-shock" />}
            {st.flipped && cr >= EPIC && !exiting && (
              <div key={'b' + flipFx} className="rv-banner">
                <b className={cr === 6 ? 'rainbow-text' : ''}>{lbl(cur.rarity)}</b>
                {cr >= WALK && <span>{cur.name}</span>}
              </div>
            )}
          </div>
          {st.flipped && cr >= WALK && !exiting && <div key={'f' + flipFx} className="flash-full" />}

          <div className="rv-bottom">
            <div className={'pk-tally' + (N > 24 ? ' dense' : '')}>
              {order.map((c, i) => {
                const on = i < st.idx || (i === st.idx && st.flipped)
                return (
                  <span key={i}
                    className={'pk-tb' + (on ? ' on' : '') + (on && rank(c) >= EPIC ? ' hi' : '') + (i === st.idx ? ' cur' : '')}
                    style={on ? { '--tc': getBorderColor(c.rarity) } : undefined} />
                )
              })}
            </div>
            <div className="rv-ctrl">
              <button className="pk-btn primary" onClick={() => advance(false)}>
                {st.flipped ? (st.idx >= N - 1 ? 'Voir mon tirage' : 'Suivante') : 'Retourner'}
              </button>
              {skipR && (
                <button className="pk-btn skip" style={{ '--sc': getBorderColor(skipR) }} onClick={() => skipTo(skipIdx)}>
                  <span className="long">Passer jusqu'à </span>{lbl(skipR)} ⏭
                </button>
              )}
              <button className="pk-btn ghost" onClick={() => { endHold(); setPhase('done') }}>Tout révéler</button>
            </div>
            <div className="rv-hint">Touche la carte · maintiens pour accélérer · Espace</div>
          </div>

          {walk && <Walkout card={cur} onBeat={onWalkBeat} onDone={onWalkDone} />}
        </>
      )}

      {/* ---------- 5. Récap ---------- */}
      {phase === 'done' && (
        <Recap order={order} onAgain={onAgain} onOpenAnother={onOpenAnother} stockLeft={stockLeft} />
      )}
    </div>,
    document.body,
  )
}

// Barre du haut en plein écran : vrai plein écran navigateur + retour aux boosters.
// Bloque aussi le défilement de la page pendant l'ouverture.
function StageBar({ onClose }) {
  const [fs, setFs] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('pk-lock')
    const on = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => { html.classList.remove('pk-lock'); document.removeEventListener('fullscreenchange', on) }
  }, [])
  const toggle = (e) => {
    e.stopPropagation()
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.().catch(() => {})
    } catch { /* plein écran indisponible */ }
  }
  const close = (e) => {
    e.stopPropagation()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    onClose?.()
  }
  return (
    <div className="pk-topbar">
      {document.documentElement.requestFullscreen && (
        <button className="pk-topbtn" onClick={toggle} aria-label={fs ? 'Quitter le plein écran' : 'Plein écran'}>
          <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
            <path d={fs ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {onClose && (
        <button className="pk-topbtn" onClick={close} aria-label="Retour aux boosters">
          <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Le pack (design FootX original) — se déchire en glissant le long de la ligne
// ============================================================================
function Pack({ phase, prog, setProg, packs, packRef, wrapRef, onTear, onAuto, onSpark }) {
  const drag = useRef(null)
  const torn = phase !== 'pack'

  const down = (e) => {
    if (torn) return
    const r = packRef.current.getBoundingClientRect()
    drag.current = { x0: e.clientX, w: r.width, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const dx = Math.abs(e.clientX - d.x0)
    if (dx > 6) d.moved = true
    const p = Math.min(1, dx / (d.w * 0.72))
    setProg(p)
    onSpark(p)
    if (p >= 1) { drag.current = null; onTear() }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) onAuto()
    else setProg(0) // relâché trop tôt : la bande se recolle
  }

  return (
    <div ref={wrapRef} className={'pk-wrap' + (torn ? ' torn' : '') + (phase === 'emerge' ? ' sink' : '')}>
      <div className="pk-beam" />
      <div className="pk-float">
        <BoosterPack
          packRef={packRef} packs={packs} torn={torn} prog={prog}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onPointerLeave={(e, untilt) => { if (!drag.current) untilt() }}
        />
      </div>
      {!torn && (
        <p className="pk-hint">
          Glisse le long de la ligne pour déchirer
          <span>ou clique sur le pack · Espace</span>
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Walkout (légendaire / iconique) : Nationalité > Club > Poste, puis révélation
// ============================================================================
function Walkout({ card, onBeat, onDone }) {
  const steps = [
    { k: 'Nationalité', v: card.country },
    { k: 'Club', v: card.club },
    { k: 'Poste', v: card.position },
  ]
  const [i, setI] = useState(0)
  const iconic = rank(card) === 6
  useEffect(() => {
    if (i < steps.length) onBeat?.(i)
    if (i >= steps.length) {
      const t = setTimeout(onDone, 380)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setI((n) => n + 1), 1350)
    return () => clearTimeout(t)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = steps[Math.min(i, steps.length - 1)]
  return (
    <div className={'wo' + (iconic ? ' iconic' : '')} style={{ '--cc': getBorderColor(card.rarity) }} onClick={() => setI(steps.length)}>
      <div className="wo-dim" />
      <div className="wo-rays" />
      <div className="wo-spot" />
      <div className="wo-rarity"><span className={iconic ? 'rainbow-text' : ''}>{lbl(card.rarity)}</span></div>
      {i < steps.length && (
        <div key={i} className="wo-step">
          <div className="wo-ring" />
          <div className="wo-kicker">{s.k}</div>
          <div className={'wo-val' + (iconic ? ' rainbow-text' : '')}>{s.v || '—'}</div>
        </div>
      )}
      <div className="wo-dots">{steps.map((_, j) => <i key={j} className={j <= i ? 'on' : ''} />)}</div>
      <div className="wo-skip">Touche pour passer</div>
    </div>
  )
}

// ============================================================================
// Dos de carte FootX (design original)
// ============================================================================
function CardBack({ cc, iconic = false }) {
  return (
    <div className={'card-back' + (iconic ? ' iconic' : '')} style={{ '--cc': cc }}>
      <span className="cb-cnr tl" /><span className="cb-cnr tr" /><span className="cb-cnr bl" /><span className="cb-cnr br" />
      <div className="cb-badge"><span className="cb-ring" /><span className="cb-mono">FX</span></div>
      <div className="cb-word">FOOTX</div>
    </div>
  )
}

// ============================================================================
// Récap final
// ============================================================================
const ORDER_DESC = ['iconique', 'legendaire', 'epique', 'rare', 'atypique', 'commune']
function Recap({ order, onAgain, onOpenAnother, stockLeft }) {
  const grid = useMemo(() => [...order].sort((a, b) => rank(b) - rank(a)), [order])
  const best = grid[0]
  const counts = useMemo(() => {
    const m = {}
    for (const c of order) { const r = String(c.rarity || '').toLowerCase(); m[r] = (m[r] || 0) + 1 }
    return m
  }, [order])
  const iconic = rank(best) === 6
  return (
    <div className="pk-recap">
      <div className="rc-head">
        <div>
          <div className="rc-kicker">Ton tirage · {order.length} cartes</div>
          <h2>Meilleure carte <span className={iconic ? 'rainbow-text' : ''} style={{ color: getBorderColor(best?.rarity) }}>{lbl(best?.rarity)}</span></h2>
        </div>
        <div className="rc-cta">
          {onOpenAnother && stockLeft > 0 && (
            <button className="pk-btn primary big" onClick={onOpenAnother}>Ouvrir un autre <small>{stockLeft} dispo</small></button>
          )}
          <button className="pk-btn ghost" onClick={onAgain}>Retour</button>
        </div>
      </div>
      <div className="rc-counts">
        {ORDER_DESC.filter((r) => counts[r]).map((r) => (
          <span key={r} className="rc-chip" style={{ '--tc': getBorderColor(r) }}><i />{counts[r]} {lbl(r)}</span>
        ))}
      </div>
      <div className="pk-grid">
        {grid.map((c, i) => <FoilCard key={(c.id ?? i) + '-' + i} card={c} best={i === 0} delay={Math.min(i, 30) * 0.045} />)}
      </div>
    </div>
  )
}
