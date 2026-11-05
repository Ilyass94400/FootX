import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabase'
import { getBorderColor, RARITY_LABEL } from '../lib/rarity'
import { autoFill, SLOTS, fitsSlot } from '../lib/collectif'
import { loadPlayableTeam } from '../lib/useTeam'
import { canPlace, CHEM_EFFECT } from '../lib/chemistry'
import { go } from '../lib/useRoute'
import { warpTo } from '../lib/warp'
import {
  ATTACK, DEFEND, ATTACK_IDS, DEFEND_IDS, SCENARIOS, TIMING, TOTAL_ACTIONS, opponentTendency, matchInsight, chemOf,
} from '../lib/match/engine'
import { useMatchController } from '../lib/match/useMatchController'
import { stageLayout } from '../lib/match/pitchGeometry'
import Pitch from '../components/match/Pitch'
import { ChoiceIcon, IconBall, IconBolt, IconCheck } from '../components/match/MatchIcons'
import FoilCard from '../components/FoilCard'
import PackFx from '../components/PackFx'
import './match.css'

// ============================================================================
// Match PvP (adversaire IA pour l'instant) — 6 actions clés, ~2 minutes.
// ============================================================================

const ME = '#e4ff3c'
const OPP = '#ff4d5e'
const RIVALS = ['Olympique Nocturne', 'Atlético Éclair', 'Red Lions FC', 'Sporting Minuit', 'Real Tempête', 'AS Vauban']
const shuffle = (a) => {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] }
  return b
}
function buildTeam(pool) {
  const t = autoFill(pool)
  const used = new Set(Object.values(t).filter(Boolean).map((c) => c.id))
  for (const sl of SLOTS) {
    if (t[sl.id]) continue
    // complète les trous en respectant les plafonds de rareté (1 Iconique, 2 Légendaires)
    const c = pool.find((x) => !used.has(x.id) && canPlace(t, sl.id, x, fitsSlot).ok) || pool.find((x) => !used.has(x.id) && canPlace(t, sl.id, x).ok)
    if (c) { t[sl.id] = c; used.add(c.id) }
  }
  return t
}
const DEMO = Array.from({ length: 30 }, (_, i) => ({
  id: 'demo-' + i, name: 'Joueur ' + (i + 1), club: 'FootX', country: 'France',
  position: ['GB', 'DEF', 'MIL', 'ATT', 'ATT'][i % 5],
  rarity: ['commune', 'atypique', 'rare', 'epique', 'legendaire', 'iconique'][i % 6], image_url: '',
}))
const KEEPER_VERB = { plonger: 'a plongé', sortir: 'est sorti', rester: 'est resté sur sa ligne' }
const COUNTER_TXT = { force: 'La frappe en force', feinte: 'La feinte', lob: 'Le lob' }
const label = (r) => RARITY_LABEL[String(r || '').toLowerCase()] || r

export default function Match({ session }) {
  const [pool, setPool] = useState(null)
  useEffect(() => {
    let alive = true
    supabase.from('cards').select('*').limit(500)
      .then(({ data }) => { if (alive) setPool(data?.length >= 10 ? data : DEMO) })
      .catch(() => { if (alive) setPool(DEMO) })
    return () => { alive = false }
  }, [])
  const first = String(session?.user?.user_metadata?.full_name || 'FootX').split(' ')[0]
  useFullPage()
  // Plein écran : l'arène est rendue directement dans <body>, par-dessus la navigation,
  // pour occuper toute la fenêtre (comme un vrai jeu) au lieu d'un cadre dans la page.
  return createPortal(
    !pool
      ? <div className="mx-stage mx-loading"><span className="mx-spin" />Préparation du terrain…</div>
      : <Arena pool={pool} myName={`FC ${first}`} />,
    document.body,
  )
}

// Bloque le défilement de la page tant que l'arène est ouverte.
function useFullPage() {
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('mx-lock')
    return () => html.classList.remove('mx-lock')
  }, [])
}

// Boutons de la barre du haut : retour au menu + vrai plein écran (navigateur).
function TopBar() {
  const [fs, setFs] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggle = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.().catch(() => {})
    } catch { /* plein écran indisponible */ }
  }
  const quit = (e) => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    warpTo('accueil', { color: '#e4ff3c', x: e.clientX, y: e.clientY })
  }
  const canFs = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen
  return (
    <div className="mx-top">
      <button className="mx-topbtn" onClick={quit} aria-label="Quitter le match">
        <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>Menu</span>
      </button>
      {canFs && (
        <button className="mx-topbtn icon" onClick={toggle} aria-label={fs ? 'Quitter le plein écran' : 'Plein écran'}>
          <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
            {fs
              ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </button>
      )}
    </div>
  )
}

// ============================================================================
function Arena({ pool, myName }) {
  const makeSetup = useCallback(() => {
    const me = loadPlayableTeam() || buildTeam(shuffle(pool).slice(0, 60))
    const mine = new Set(SLOTS.map((sl) => me[sl.id]?.id))
    const opp = buildTeam(shuffle(pool.filter((c) => !mine.has(c.id))).slice(0, 50))
    return { me, opp, names: { me: myName, opp: RIVALS[Math.floor(Math.random() * RIVALS.length)] } }
  }, [pool, myName])

  const { s, choose, qte, rematch, reward } = useMatchController(makeSetup)
  const stageRef = useRef(null)
  const fx = useRef(null)
  const [box, setBox] = useState({ w: 1000, h: 680 })
  const [shake, setShake] = useState('')
  const [danger, setDanger] = useState(false)
  const [netHit, setNetHit] = useState(0)

  useLayoutEffect(() => {
    const el = stageRef.current
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const L = useMemo(() => stageLayout(box.w, box.h), [box])
  const frac = useCallback((p) => ({ x: p.x / box.w, y: p.y / box.h }), [box])

  const c = s.current
  const iAttack = c?.side === 'me'
  const myChoice = c?.choices.me
  const oppLocked = !!c?.choices.opp
  const myRead = c && c.read != null ? (iAttack ? c.read : -c.read) : null
  const myAdv = c ? (iAttack ? c.adv : -c.adv) : 0

  // Trajectoire du ballon selon le choix et l'issue
  const shot = useMemo(() => {
    if (!c?.result) return null
    const a = c.choices[c.side]
    const k = c.result.kind
    const T = L.targets
    const left = s.idx % 2 === 0
    let to
    if (k === 'goal') to = a === 'lob' ? T.top : a === 'feinte' ? (left ? T.bl : T.br) : (left ? T.tl : T.tr)
    else if (k === 'save') to = { x: T.keeper.x + (left ? -1 : 1) * L.keeper.w * 0.28, y: T.keeper.y }
    else to = a === 'feinte' ? (left ? T.wideL : T.wideR) : T.over
    return { a, k, to, left, dx: to.x - L.ball.x, dy: to.y - L.ball.y }
  }, [c, L, s.idx])

  // ---------- Effets (secousses, étincelles, filet) synchronisés avec les phases ----------
  useEffect(() => {
    const ts = []
    const after = (ms, fn) => ts.push(setTimeout(fn, ms))
    const bang = (kind, ms) => { setShake(kind); after(ms, () => setShake('')) }
    setDanger(false)
    if (s.phase === 'choose' && c) {
      after(SCENARIOS[c.scenario].time - 1700, () => setDanger(true))
    }
    if (s.phase === 'clash' && c) {
      after(TIMING.clash * 0.4, () => {
        bang(Math.abs(c.adv) >= 1.5 ? 'shake-hard' : 'shake', 520)
        fx.current?.burst({ ...frac(L.clash), colors: [getBorderColor(c.attacker.rarity), getBorderColor(c.keeper.rarity), '#ffffff'], count: 90, speed: 11, kind: 'spark' })
      })
    }
    if (s.phase === 'outcome' && c?.result && shot) {
      const k = c.result.kind
      const scorerMe = k === 'goal' && iAttack
      after(80, () => fx.current?.burst({ ...frac(L.ball), colors: [getBorderColor(c.attacker.rarity), '#ffffff'], count: 26, speed: 6, kind: 'spark', spread: Math.PI * 0.8 }))
      after(560, () => {
        if (k === 'goal') {
          setNetHit((n) => n + 1)
          bang('shake-hard', 650)
          const cols = scorerMe ? [ME, '#ffffff', getBorderColor(c.attacker.rarity)] : [OPP, '#ffffff']
          fx.current?.burst({ ...frac(shot.to), colors: cols, count: 140, speed: 13, kind: 'spark' })
          if (scorerMe) after(150, () => {
            fx.current?.burst({ x: 0.1, y: 0.55, colors: cols, count: 90, speed: 14, kind: 'confetti', angle: -Math.PI * 0.32, spread: Math.PI * 0.4 })
            fx.current?.burst({ x: 0.9, y: 0.55, colors: cols, count: 90, speed: 14, kind: 'confetti', angle: -Math.PI * 0.68, spread: Math.PI * 0.4 })
          })
        } else if (k === 'save') {
          bang('shake', 380)
          fx.current?.burst({ ...frac(shot.to), colors: [getBorderColor(c.keeper.rarity), '#ffffff'], count: 60, speed: 8, kind: 'spark' })
        }
      })
    }
    return () => ts.forEach(clearTimeout)
  }, [s.phase, s.idx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clavier : 1/2/3 pour choisir
  useEffect(() => {
    if (s.phase !== 'choose' || myChoice) return
    const ids = iAttack ? ATTACK_IDS : DEFEND_IDS
    const onKey = (e) => { const i = ['1', '2', '3'].indexOf(e.key); if (i >= 0) choose(ids[i]) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.phase, myChoice, iAttack, choose])

  const zoom = s.phase === 'clash' || s.phase === 'qte'
  const stageCls = ['mx-stage', shake, danger && !myChoice ? 'danger' : '', s.phase === 'outcome' && c?.result?.kind === 'goal' ? (iAttack ? 'goal-me' : 'goal-opp') : ''].filter(Boolean).join(' ')

  return (
    <div ref={stageRef} className={stageCls} style={{ '--me': ME, '--opp': OPP }}>
      <div className="mx-world" style={{ transformOrigin: `${L.clash.x}px ${L.clash.y}px`, transform: zoom ? 'scale(1.07)' : 'none' }}>
        <div className="mx-sky"><div className="mx-crowd" /><div className="mx-flashes" /></div>
        <Pitch hit={netHit} />
        <div className="mx-lights" />

        {c && s.phase !== 'kickoff' && s.phase !== 'fulltime' && s.phase !== 'shootout' && (
          <>
            <DuelCard key={'k' + s.idx} role="keeper" card={c.keeper} side={c.side === 'me' ? 'opp' : 'me'} pos={L.keeper}
              phase={s.phase} toClash={L.clash.y - L.keeper.y} choice={s.phase !== 'choose' && s.phase !== 'intro' ? c.choices[c.side === 'me' ? 'opp' : 'me'] : null}
              won={myRead == null ? null : (iAttack ? myRead < 0 : myRead > 0)} result={c.result} shot={shot}
              chem={chemOf(s, c.side === 'me' ? 'opp' : 'me', c.keeper)} />
            <DuelCard key={'a' + s.idx} role="attacker" card={c.attacker} side={c.side} pos={L.attacker}
              phase={s.phase} toClash={L.clash.y - L.attacker.y} choice={s.phase !== 'choose' && s.phase !== 'intro' ? c.choices[c.side] : null}
              won={myRead == null ? null : (iAttack ? myRead > 0 : myRead < 0)} result={c.result}
              stamina={s.stamina[c.side][c.attacker.id] ?? 100} tired={c.tired} chem={chemOf(s, c.side, c.attacker)} />
            {s.phase === 'choose' && <Tendency s={s} pos={iAttack ? L.keeper : L.attacker} />}
            {s.phase === 'outcome' && shot && <Ball shot={shot} start={L.ball} color={getBorderColor(c.attacker.rarity)} />}
          </>
        )}
      </div>

      <PackFx ref={fx} ambient="rgba(255,255,240,.6)" />
      <Hud s={s} />
      <TopBar />

      {s.phase === 'kickoff' && <Kickoff s={s} />}
      {s.phase === 'shootout' && <Banner title="Tirs au but" sub="Mort subite · chaque tir compte" />}
      {s.phase === 'intro' && c && <Intro c={c} iAttack={iAttack} shootout={s.shootout} />}
      {s.phase === 'outcome' && c?.result && <Callout c={c} iAttack={iAttack} />}
      {s.phase === 'fulltime' && <FullTime s={s} reward={reward} onRematch={rematch} />}

      <div className="mx-dock">
        {s.phase === 'choose' && c && (
          <ChoiceDock key={'d' + s.idx} c={c} iAttack={iAttack} myChoice={myChoice} oppLocked={oppLocked} danger={danger}
            stamina={s.stamina.me[c.attacker.id] ?? 100} onChoose={choose} />
        )}
        {s.phase === 'clash' && c && <Verdict c={c} iAttack={iAttack} myRead={myRead} myAdv={myAdv} />}
        {s.phase === 'qte' && c && <Verdict c={c} iAttack={iAttack} myRead={myRead} myAdv={myAdv} compact />}
        {s.phase === 'qte' && c && <QteBar key={'q' + s.idx} qte={c.qte} iAttack={iAttack} onHit={qte} />}
        {s.phase === 'intro' && c && <div className="mx-dock-wait">Prépare-toi…</div>}
      </div>
    </div>
  )
}

// ---------- Carte en duel ----------
function DuelCard({ role, card, side, pos, phase, toClash, choice, won, result, shot, stamina, tired, chem = 1 }) {
  const cc = getBorderColor(card.rarity)
  let anim = 'enter'
  if (phase === 'choose') anim = 'idle'
  if (phase === 'clash') anim = 'clash'
  if (phase === 'qte') anim = 'hold'
  if (phase === 'outcome' && result) {
    if (role === 'attacker') anim = 'strike'
    else anim = result.kind === 'save' ? (shot?.left ? 'dive-l' : 'dive-r') : result.kind === 'goal' ? (shot?.left ? 'beaten-r' : 'beaten-l') : 'idle'
  }
  const ChoiceDef = choice ? (ATTACK[choice] || DEFEND[choice]) : null
  return (
    <div className={`mx-card ${role} ${anim}`} style={{ left: pos.x, top: pos.y, width: pos.w, '--to-clash': `${toClash}px`, '--cc': cc }}>
      <div className="mx-card-in">
        <FoilCard card={card} plain />
        <span className={'mx-side-tag ' + side}>{side === 'me' ? 'TOI' : 'ADV'}</span>
        <span className={'mx-chem t' + chem} title={`Collectif ${chem}/3 · ${CHEM_EFFECT[chem].label}`}>
          {[0, 1, 2].map((i) => <i key={i} className={i < chem ? 'on' : ''} />)}
        </span>
      </div>
      {role === 'attacker' && stamina != null && (
        <div className={'mx-stam' + (stamina < 35 ? ' low' : '')} title="Endurance">
          <IconBolt /><span><i style={{ width: `${stamina}%` }} /></span>
        </div>
      )}
      {ChoiceDef && (
        <div className={`mx-pick ${role} ${won == null ? '' : won ? 'win' : 'lose'}`}>
          <ChoiceIcon id={choice} /><b>{ChoiceDef.short}</b>{tired && role === 'attacker' && <em>épuisé</em>}
        </div>
      )}
    </div>
  )
}

// ---------- Habitudes de l'adversaire (aide à la lecture) ----------
function Tendency({ s, pos }) {
  const t = opponentTendency(s)
  if (!t.length) return null
  return (
    <div className="mx-tend" style={{ left: pos.x + pos.w / 2 + 14, top: pos.y - pos.h * 0.2 }}>
      <span>Ses derniers choix</span>
      <div>{t.map((id, i) => <i key={i} title={(ATTACK[id] || DEFEND[id]).label}><ChoiceIcon id={id} /></i>)}</div>
    </div>
  )
}

// ---------- Ballon (+ traînée de la couleur de rareté) ----------
function Ball({ shot, start, color }) {
  const dur = shot.a === 'force' ? 420 : shot.a === 'lob' ? 650 : 540
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`mx-ball ${shot.a}${i ? ' ghost' : ''}`}
          style={{ left: start.x, top: start.y, '--dx': `${shot.dx}px`, '--dy': `${shot.dy}px`, '--bt': `${dur}ms`, '--trail': color, '--go': i ? 0.55 - i * 0.14 : 1, animationDelay: `${120 + i * 28}ms` }}>
          <div className="mx-ball-i" style={{ animationDelay: `${120 + i * 28}ms` }}><IconBall /></div>
        </div>
      ))}
    </>
  )
}

// ---------- HUD : score, minute, actions, momentum ----------
function Hud({ s }) {
  const m = s.momentum
  const minute = s.current?.minute
  return (
    <div className="mx-hud">
      <div className="mx-sb">
        <div className="mx-sb-team me"><b>{s.names.me}</b><small>Collectif {s.collectif.me}</small></div>
        <div className="mx-sb-score">
          <b key={'m' + s.score.me} className="pop">{s.score.me}</b><i>:</i><b key={'o' + s.score.opp} className="pop">{s.score.opp}</b>
          {s.shootout && <small className="mx-pens">t.a.b. {s.pens.me}-{s.pens.opp}</small>}
        </div>
        <div className="mx-sb-team opp"><b>{s.names.opp}</b><small>Collectif {s.collectif.opp}</small></div>
      </div>
      <div className="mx-sb-meta">
        <span className="mx-clock">{s.shootout ? 'T.A.B.' : minute ? `${minute}'` : "0'"}</span>
        <div className="mx-pips">
          {Array.from({ length: TOTAL_ACTIONS }, (_, i) => {
            const h = s.history[i]
            const cls = h ? (h.kind === 'goal' ? (h.side === 'me' ? 'g-me' : 'g-opp') : 'done') : i === s.idx && !s.shootout ? 'cur' : ''
            return <i key={i} className={cls} />
          })}
        </div>
      </div>
      <div className="mx-mom" title="Momentum : la pression du match">
        <span>TOI</span>
        <div className="mx-mom-bar">
          <i className={m >= 0 ? 'me' : 'opp'} style={{ width: `${Math.abs(m) / 2}%`, [m >= 0 ? 'right' : 'left']: '50%' }} />
          <b />
        </div>
        <span>ADV</span>
        {Math.abs(m) >= 60 && <em className={m > 0 ? 'me' : 'opp'}>Temps fort</em>}
      </div>
    </div>
  )
}

// ---------- Dock de choix (timer en jauge) ----------
function ChoiceDock({ c, iAttack, myChoice, oppLocked, danger, stamina, onChoose }) {
  const sc = SCENARIOS[c.scenario]
  const ids = iAttack ? ATTACK_IDS : DEFEND_IDS
  const defs = iAttack ? ATTACK : DEFEND
  return (
    <div className="mx-choose">
      <div className="mx-choose-head">
        <span className={'mx-role ' + (iAttack ? 'atk' : 'def')}>{iAttack ? 'Choisis ta frappe' : 'Lis sa frappe'}</span>
        <span className={'mx-opp-state' + (oppLocked ? ' ready' : '')}>
          {oppLocked ? <><IconCheck /> Adversaire prêt</> : <><span className="mx-dots"><i /><i /><i /></span> L'adversaire réfléchit</>}
        </span>
      </div>
      <div className={'mx-gauge' + (danger && !myChoice ? ' danger' : '') + (myChoice ? ' locked' : '')}>
        <i style={{ animationDuration: `${sc.time}ms` }} />
      </div>
      <div className="mx-choices">
        {ids.map((id) => {
          const d = defs[id]
          const isTired = iAttack && !sc.free && stamina < d.cost
          const cls = ['mx-choice', myChoice === id ? 'picked' : myChoice ? 'dim' : '', isTired ? 'tired' : ''].filter(Boolean).join(' ')
          return (
            <button key={id} className={cls} onClick={() => onChoose(id)} disabled={!!myChoice}>
              <span className="mx-key">{d.key}</span>
              <span className="mx-ic"><ChoiceIcon id={id} /></span>
              <b>{d.label}</b>
              <small>{d.hint}</small>
              {iAttack && !sc.free && <em><IconBolt />{isTired ? 'Épuisé' : `-${d.cost}`}</em>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- QTE : timing de frappe / réflexe ----------
function QteBar({ qte, iAttack, onHit }) {
  const start = useRef(0)
  const [hit, setHit] = useState(null)
  useLayoutEffect(() => { start.current = performance.now() }, [])
  const strike = useCallback(() => {
    if (hit) return
    const k = (performance.now() - start.current) / qte.period
    const cyc = Math.floor(k)
    const f = k - cyc
    const p = cyc % 2 === 0 ? f : 1 - f
    const d = Math.abs(p - qte.center)
    const q = d <= qte.zone * 0.18 ? 'perfect' : d <= qte.zone / 2 ? 'good' : 'miss'
    setHit({ p, q })
    onHit(q)
  }, [hit, qte, onHit])
  useEffect(() => {
    const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); strike() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [strike])
  return (
    <div className="mx-qte" onPointerDown={strike}>
      <div className="mx-qte-title">{iAttack ? 'Frappe !' : 'Réflexe !'} <small>{iAttack ? 'Tape quand le curseur est dans la zone' : 'Arrête-la au bon moment'}</small></div>
      <div className="mx-qte-track">
        <div className="mx-qte-zone" style={{ left: `${(qte.center - qte.zone / 2) * 100}%`, width: `${qte.zone * 100}%` }}><i /></div>
        <div className={'mx-qte-cursor' + (hit ? ' stop ' + hit.q : '')} style={hit ? { left: `${hit.p * 100}%` } : { animationDuration: `${qte.period}ms` }} />
      </div>
      <button className="mx-hit" type="button">{iAttack ? 'Frapper' : 'Arrêter'} <kbd>Espace</kbd></button>
    </div>
  )
}

// ---------- Overlays ----------
function Kickoff({ s }) {
  const row = (t) => SLOTS.map((sl) => t[sl.id]).filter(Boolean)
  return (
    <div className="mx-over mx-kickoff">
      <div className="mx-ko-kicker">Coup d'envoi · 6 actions clés</div>
      <div className="mx-ko-vs">
        <TeamRow name={s.names.me} cards={row(s.teams.me)} col={s.collectif.me} side="me" />
        <span className="mx-ko-x">VS</span>
        <TeamRow name={s.names.opp} cards={row(s.teams.opp)} col={s.collectif.opp} side="opp" />
      </div>
      <div className="mx-ko-tip">Lis ton adversaire, choisis ta tactique, frappe au bon moment.</div>
    </div>
  )
}
function TeamRow({ name, cards, col, side }) {
  return (
    <div className={'mx-ko-team ' + side}>
      <b>{name}</b>
      <div className="mx-ko-avs">
        {cards.map((c) => (
          <span key={c.id} style={{ '--cc': getBorderColor(c.rarity) }} title={`${c.name} · ${label(c.rarity)}`}>
            {c.image_url ? <img src={c.image_url} alt="" /> : <em>{String(c.name || '?')[0]}</em>}
          </span>
        ))}
      </div>
      <small>Collectif {col}</small>
    </div>
  )
}
function Banner({ title, sub }) {
  return <div className="mx-over mx-banner"><b>{title}</b><span>{sub}</span></div>
}
function Intro({ c, iAttack, shootout }) {
  const sc = SCENARIOS[c.scenario]
  return (
    <div className="mx-over mx-intro">
      <div className="mx-intro-min">{shootout ? `Tir au but · série ${shootout.round}` : `${c.minute}'`}</div>
      <div className="mx-intro-title">{sc.title}</div>
      <div className={'mx-intro-who ' + c.side}>{iAttack ? 'À toi de frapper' : 'Défends ta cage'} <span>· {c.attacker.name}</span></div>
      {c.pressing && <div className="mx-press">Temps fort : tu gardes le ballon</div>}
    </div>
  )
}
function Verdict({ c, iAttack, myRead, myAdv, compact = false }) {
  let t
  let sub
  if (myRead > 0) { t = 'Tu l\'as lu !'; sub = iAttack ? 'Gardien pris à contre-pied' : 'Tu as anticipé sa frappe' }
  else if (myRead < 0) { t = iAttack ? 'Le gardien t\'a lu' : 'Pris à contre-pied'; sub = iAttack ? 'Il faudra une frappe parfaite' : 'Il faudra un réflexe parfait' }
  else { t = 'Duel indécis'; sub = 'Tout se joue sur le timing' }
  const tone = myRead > 0 ? 'good' : myRead < 0 ? 'bad' : 'even'
  const pct = Math.max(4, Math.min(96, 50 + (myAdv / 3) * 46))
  return (
    <div className={'mx-verdict ' + tone + (compact ? ' compact' : '')}>
      <b>{t}</b>
      <span>{sub}{c.hesitated.me ? ' · hésitation -1' : ''}{c.tired && iAttack ? ' · joueur épuisé' : ''}</span>
      <div className="mx-adv">
        <em>Avantage</em>
        <div className="mx-adv-bar"><i style={{ left: `${pct}%` }} /></div>
        <em className={myAdv >= 0 ? 'me' : 'opp'}>{myAdv >= 0.3 ? 'Toi' : myAdv <= -0.3 ? 'Adversaire' : 'Égal'}</em>
      </div>
    </div>
  )
}
function Callout({ c, iAttack }) {
  const r = c.result
  const k = r.kind
  let t
  let sub
  let tone
  const q = r.myQ === 'perfect' ? 'parfait' : r.myQ === 'good' ? 'bon' : 'raté'
  if (iAttack) {
    tone = k === 'goal' ? 'me' : 'opp'
    t = k === 'goal' ? 'But !' : k === 'save' ? 'Arrêté' : 'À côté'
    sub = k === 'goal' ? (r.myQ === 'perfect' ? 'Frappe parfaite, en pleine lucarne' : c.read === 1 ? 'Gardien pris à contre-pied' : 'Ça fait mouche')
      : r.timeout ? 'Trop tard : tu as hésité'
      : k === 'save' ? (c.read === -1 ? 'Le gardien avait lu ta frappe' : 'Superbe parade adverse')
      : 'La frappe fuit le cadre'
  } else {
    tone = k === 'goal' ? 'opp' : 'me'
    t = k === 'goal' ? 'But adverse' : k === 'save' ? 'Arrêt !' : 'À côté !'
    sub = k === 'goal' ? (r.timeout ? 'Trop tard : tu as hésité' : c.read === 1 ? 'Il t\'a pris à contre-pied' : 'Frappe imparable')
      : k === 'save' ? (r.myQ === 'perfect' ? 'Réflexe parfait' : 'Tu as lu sa frappe') : 'Ta pression l\'a fait déjouer'
  }
  return (
    <div className={`mx-over mx-callout ${tone} ${k}`}>
      <b>{t}</b>
      <span>{sub}</span>
      {!r.timeout && <em className={r.myQ}>{iAttack ? 'Frappe' : 'Réflexe'} : {q}</em>}
    </div>
  )
}

function FullTime({ s, reward, onRematch }) {
  const win = s.winner === 'me'
  const pens = s.shootout
  const insight = matchInsight(s)
  const mvpId = Object.keys(s.mvp).sort((a, b) => s.mvp[b] - s.mvp[a])[0]
  const mvp = Object.values(s.teams.me).find((c) => c && String(c.id) === mvpId) || s.teams.me.A1 || s.teams.me.GK
  const close = !win && (Math.abs(s.score.me - s.score.opp) <= 1)
  return (
    <div className={'mx-over mx-full ' + (win ? 'win' : 'lose')}>
      <div className="mx-full-res">{win ? 'Victoire' : 'Défaite'}</div>
      <div className="mx-full-score">
        <span>{s.score.me} <i>–</i> {s.score.opp}</span>
        {pens && <small>{s.pens.me}-{s.pens.opp} aux tirs au but</small>}
      </div>
      {close && <div className="mx-near">Si près. Il t'a manqué un seul but.</div>}
      <div className="mx-full-body">
        {mvp && (
          <div className="mx-mvp">
            <div className="mx-mvp-card"><FoilCard card={mvp} best plain /></div>
            <span>Homme du match</span>
          </div>
        )}
        <div className="mx-full-side">
          <div className="mx-stats">
            <div><b>{s.stats.reads}/{s.stats.actions}</b><span>Lectures gagnées</span></div>
            <div><b>{s.stats.perfect}</b><span>Timings parfaits</span></div>
            <div><b>{s.stats.goals}</b><span>Buts</span></div>
            <div><b>{s.stats.saves}</b><span>Arrêts</span></div>
          </div>
          <div className="mx-rewards">
            {reward?.coins > 0 && <span className="mx-chip coins">+{reward.coins} X-Coins</span>}
            {reward?.capped && <span className="mx-chip">Gains du jour plafonnés</span>}
            {reward?.booster && <span className="mx-chip gold">+1 booster gagné</span>}
            {win && reward && !reward.booster && <span className="mx-chip">{reward.full ? 'Stock de boosters plein (10/10)' : 'Récompenses du jour atteintes'}</span>}
            {reward?.streak >= 2 && <span className="mx-chip hot">Série : {reward.streak} victoires</span>}
          </div>
          {insight && (
            <p className="mx-insight">
              Le gardien adverse {KEEPER_VERB[insight.fav]} {insight.n} fois sur {insight.total}.
              {' '}{win ? 'Bien exploité.' : <><b>{COUNTER_TXT[insight.counter]}</b> était la clé.</>}
            </p>
          )}
        </div>
      </div>
      <div className="mx-full-cta">
        <button className="mx-btn primary xl" onClick={onRematch} autoFocus>Rejouer</button>
        {reward?.booster && <button className="mx-btn gold" onClick={() => go('boosters')}>Ouvrir mon booster</button>}
        <button className="mx-btn ghost" onClick={() => go('team')}>Modifier mon équipe</button>
      </div>
    </div>
  )
}
