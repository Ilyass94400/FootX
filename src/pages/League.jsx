import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDiscordProfile } from '../lib/useSession'
import { getBorderColor, RARITY_LABEL, RARITIES } from '../lib/rarity'
import { SLOTS } from '../lib/collectif'
import { loadSavedTeam } from '../lib/useTeam'
import { useLeague } from '../lib/league/useLeague'
import { ACTIONS, RARITY_MULT, CAPTAIN_MULT, multOf, scoreLineup, simulateStats, splitMs } from '../lib/league/scoring'
import { warpTo } from '../lib/warp'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './league.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Ma Ligue — fantasy asynchrone du week-end.
// Composition → verrouillage (vendredi 19:00) → matchs IRL → points le lundi.
// ============================================================================

const GOLD = '#f2c230'
const ROWS = [['A1', 'A2'], ['D1', 'D2'], ['GK']]
const SLOT_LABEL = { GK: 'Gardien', D1: 'Déf / Milieu', D2: 'Déf / Milieu', A1: 'Attaquant', A2: 'Attaquant' }
const pad = (n) => String(n).padStart(2, '0')
const fmt = (v) => { const r = Math.round(v * 10) / 10; return (Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')) }
const multTxt = (m) => '×' + fmt(m)
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const HOUR = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export default function League({ session }) {
  const { name, avatar } = getDiscordProfile(session)
  const lg = useLeague()
  const saved = useMemo(loadSavedTeam, [])
  const locked = !!lg.lock
  const team = locked ? lg.lock.team : saved || {}
  const complete = SLOTS.every((s) => team[s.id])
  const missing = SLOTS.filter((s) => !team[s.id]).length
  const [captain, setCaptain] = useState(() => lg.lock?.captain || (saved?.A1 ? 'A1' : saved?.A2 ? 'A2' : 'GK'))
  const cap = locked ? lg.lock.captain : captain

  // ---- effets de verrouillage
  const fx = useRef(null)
  const boardRef = useRef(null)
  const [slam, setSlam] = useState(false)
  const doLock = () => {
    if (!lg.lockTeam(team, captain)) return
    setSlam(true)
    try { navigator.vibrate?.([30, 40, 70]) } catch { /* pas de vibreur */ }
    const board = boardRef.current?.getBoundingClientRect()
    const slots = boardRef.current?.querySelectorAll('.lg-slot .hc') || []
    slots.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const card = team[el.closest('.lg-slot')?.dataset.slot]
      setTimeout(() => fx.current?.burst({
        x: (r.left + r.width / 2 - board.left) / board.width, y: (r.top + r.height / 2 - board.top) / board.height,
        colors: [getBorderColor(card?.rarity), GOLD, '#fff'], count: 34, speed: 7, kind: 'spark',
      }), 60 + i * 70)
    })
    setTimeout(() => fx.current?.burst({ x: 0.5, y: 0.5, colors: [GOLD, '#fff2b8', '#fff'], count: 120, speed: 12, kind: 'mix' }), 380)
    setTimeout(() => setSlam(false), 1400)
  }

  const t = splitMs(lg.gw.msLeft)
  const phaseLabel = lg.gw.phase === 'live' ? 'Matchs en cours · résultats dans' : locked ? 'Coup d\'envoi de la journée dans' : 'Verrouillage dans'
  const step = lg.gw.phase === 'live' ? 1 : 0

  return (
    <div className="lg">
      <PageHelp topic="ligue" />
      {/* ------------------------------------------------------------ en-tête */}
      <section className="lg-hero">
        <div className="lg-hero-l">
          <button className="lg-back" onClick={(e) => warpTo('accueil', { color: '#e4ff3c', x: e.clientX, y: e.clientY })}>← Menu</button>
          <span className="lg-kicker">Ma Ligue · Saison 1 · Journée {lg.gw.number}</span>
          <LeagueName value={lg.league.name} onSave={lg.rename} canEdit={lg.league.owner !== false} />
          <Invite code={lg.league.code} />
          {lg.live && <JoinLeague onJoin={lg.join} />}
          {lg.error && <p className="lg-error" role="alert">{lg.error}</p>}
        </div>
        <div className="lg-clock">
          <span className="lg-clock-l">{phaseLabel}</span>
          <div className="lg-digits">
            {t.d > 0 && <Digit v={t.d} u="jours" />}
            <Digit v={pad(t.h)} u="heures" />
            <Digit v={pad(t.m)} u="min" />
            <Digit v={pad(t.s)} u="sec" tick />
          </div>
          <span className="lg-clock-d">
            {lg.gw.phase === 'open' ? <>Verrouillage <b>{DAY.format(lg.gw.deadline)} à {HOUR.format(lg.gw.deadline)}</b></> : <>Points calculés <b>{DAY.format(lg.gw.resultsAt)} soir</b></>}
          </span>
          <ol className="lg-steps">
            {['Composition', 'Matchs du week-end', 'Points'].map((s, i) => (
              <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''}><i />{s}</li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ compo + verrou */}
      <div className="lg-main">
        <section ref={boardRef} className={'lg-board' + (locked ? ' locked' : '') + (slam ? ' slam' : '')}>
          <div className="lg-pitch" aria-hidden="true"><i className="c" /><i className="b" /></div>
          <div className="lg-rows">
            {ROWS.map((row) => (
              <div key={row.join()} className="lg-row">
                {row.map((id) => (
                  <Slot key={id} id={id} card={team[id]} captain={cap === id} locked={locked}
                    onCaptain={() => !locked && setCaptain(id)} />
                ))}
              </div>
            ))}
          </div>
          {locked && <div className={'lg-stamp' + (slam ? ' fresh' : '')}><LockIcon /> Verrouillée</div>}
          <div className="lg-flash" aria-hidden="true" />
          <PackFx ref={fx} ambient="rgba(242,194,48,.45)" />
        </section>

        <aside className="lg-side">
          <div className={'lg-lockcard' + (locked ? ' done' : '')}>
            {!complete && !locked ? (
              <>
                <h3>Il te manque {missing} titulaire{missing > 1 ? 's' : ''}</h3>
                <p>Ta compo de Ligue est la même que dans « Mon équipe » : 1 gardien, 2 déf/milieux, 2 attaquants.</p>
                <button className="lg-btn" onClick={(e) => warpTo('team', { color: '#7ad7ff', x: e.clientX, y: e.clientY })}>Composer mon équipe</button>
              </>
            ) : lg.gw.phase === 'live' && !locked ? (
              <>
                <h3>Les matchs ont commencé</h3>
                <p>Trop tard pour cette journée : prépare ta compo pour la suivante, elle ouvre lundi soir.</p>
              </>
            ) : !locked ? (
              <>
                <h3>Verrouille ton équipe</h3>
                <p>Ton capitaine <b>{team[cap]?.name}</b> marque <b>×{fmt(CAPTAIN_MULT)}</b>. Tu peux encore changer jusqu'au verrouillage.</p>
                <HoldButton onDone={doLock}>Maintiens pour verrouiller</HoldButton>
                <button className="lg-link" onClick={(e) => warpTo('team', { color: '#7ad7ff', x: e.clientX, y: e.clientY })}>Changer de joueurs</button>
              </>
            ) : (
              <>
                <h3><span className="lg-ok"><CheckIcon /></span>Équipe verrouillée</h3>
                <p>Le {DAY.format(new Date(lg.lock.lockedAt))} à {HOUR.format(new Date(lg.lock.lockedAt))}. Capitaine : <b>{team[cap]?.name}</b>.</p>
                <Potential team={team} cap={cap} />
                {lg.gw.phase === 'open' && <button className="lg-link" onClick={lg.unlock}>Déverrouiller pour modifier</button>}
              </>
            )}
          </div>
          <Rules />
        </aside>
      </div>

      {complete && <Simulation team={team} cap={cap} gw={lg.gw.number} />}

      <Standings name={name} avatar={avatar} code={lg.league.code} gw={lg.gw.number} locked={locked} members={lg.league.members} />
    </div>
  )
}

// ---------------------------------------------------------------- sous-composants

function Slot({ id, card, captain, locked, onCaptain }) {
  const m = card ? multOf(card) : 1
  return (
    <div className={'lg-slot' + (card ? '' : ' empty') + (captain ? ' cap' : '')} data-slot={id} style={{ '--cc': card ? getBorderColor(card.rarity) : 'rgba(255,255,255,.2)' }}>
      {card ? (
        <HeroCard card={card}>
          {m > 1 && <span className="lg-mult">{multTxt(m)}</span>}
          {captain && <span className="lg-cap">C</span>}
        </HeroCard>
      ) : (
        <div className="lg-empty"><span>+</span><small>{SLOT_LABEL[id]}</small></div>
      )}
      {card && !locked && (
        <button className={'lg-capbtn' + (captain ? ' on' : '')} onClick={onCaptain} aria-pressed={captain}>
          {captain ? 'Capitaine' : 'Nommer capitaine'}
        </button>
      )}
    </div>
  )
}

function LeagueName({ value, onSave, canEdit = true }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const save = () => { onSave(v.trim()); setEdit(false) }
  return edit ? (
    <form className="lg-name-edit" onSubmit={(e) => { e.preventDefault(); save() }}>
      <input autoFocus value={v} maxLength={32} onChange={(e) => setV(e.target.value)} onBlur={save} aria-label="Nom de la ligue" />
    </form>
  ) : (
    <h1 className="lg-name">
      {value}
      {canEdit && (
        <button className="lg-pen" onClick={() => setEdit(true)} aria-label="Renommer la ligue">
          <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        </button>
      )}
    </h1>
  )
}

function Invite({ code }) {
  const [ok, setOk] = useState(false)
  const ref = useRef(null)
  const copy = () => {
    const done = () => { setOk(true); setTimeout(() => setOk(false), 1600) }
    navigator.clipboard?.writeText(code).then(done).catch(() => {
      const r = document.createRange(); r.selectNodeContents(ref.current)
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
    })
  }
  return (
    <div className="lg-invite">
      <span>Code d'invitation</span>
      <b ref={ref}>{code}</b>
      <button onClick={copy} className={ok ? 'ok' : ''}>{ok ? 'Copié !' : 'Copier'}</button>
    </div>
  )
}

// Rejoindre la ligue d'un ami (son code d'invitation)
function JoinLeague({ onJoin }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [state, setState] = useState({ busy: false, msg: null, ok: false })
  const submit = async (e) => {
    e.preventDefault()
    if (code.trim().length < 4 || state.busy) return
    setState({ busy: true, msg: null, ok: false })
    try {
      const l = await onJoin(code)
      setState({ busy: false, msg: `Bienvenue dans « ${l?.name || 'la ligue'} » !`, ok: true })
      setCode('')
      setTimeout(() => setOpen(false), 1800)
    } catch (err) { setState({ busy: false, msg: err.message, ok: false }) }
  }
  if (!open) return <button className="lg-join-open" onClick={() => setOpen(true)}>Rejoindre la ligue d'un ami</button>
  return (
    <form className="lg-join" onSubmit={submit}>
      <input autoFocus value={code} maxLength={8} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Code de la ligue" />
      <button disabled={state.busy || code.trim().length < 4}>{state.busy ? '…' : 'Rejoindre'}</button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>Annuler</button>
      {state.msg && <span className={state.ok ? 'ok' : 'ko'}>{state.msg}</span>}
    </form>
  )
}

function Digit({ v, u, tick = false }) {
  return (
    <span className="lg-digit">
      <b key={tick ? v : undefined} className={tick ? 'tick' : ''}>{v}</b>
      <small>{u}</small>
    </span>
  )
}

// Bouton "maintenir pour verrouiller" : l'engagement physique rend le verrou précieux.
function HoldButton({ onDone, ms = 900, children }) {
  const [p, setP] = useState(0)
  const raf = useRef(0)
  const t0 = useRef(0)
  const holding = useRef(false)
  const stop = useCallback(() => {
    holding.current = false
    cancelAnimationFrame(raf.current)
    setP((v) => (v >= 1 ? v : 0))
  }, [])
  const start = () => {
    if (holding.current) return
    holding.current = true
    t0.current = performance.now()
    const loop = (now) => {
      if (!holding.current) return
      const v = Math.min(1, (now - t0.current) / ms)
      setP(v)
      if (v >= 1) { holding.current = false; onDone(); return }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return (
    <button
      className={'lg-hold' + (p > 0 ? ' charging' : '') + (p > 0.6 ? ' hot' : '')}
      style={{ '--p': p }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); start() }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start() } }}
      onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') stop() }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="lg-hold-fill" />
      <span className="lg-hold-txt"><LockIcon />{children}</span>
    </button>
  )
}

function Potential({ team, cap }) {
  const top = SLOTS.map((s) => ({ s: s.id, m: multOf(team[s.id]) * (s.id === cap ? CAPTAIN_MULT : 1) })).sort((a, b) => b.m - a.m)[0]
  return (
    <div className="lg-pot">
      <span>Meilleur levier</span>
      <b style={{ color: getBorderColor(team[top.s]?.rarity) }}>{team[top.s]?.name}</b>
      <em>chaque point compte {multTxt(top.m)}</em>
    </div>
  )
}

function Rules() {
  const rows = ACTIONS.filter((a) => a.key !== 'sub')
  return (
    <div className="lg-rules">
      <h3>Barème</h3>
      <div className="lg-mults">
        {RARITIES.map((r) => (
          <span key={r} style={{ '--cc': getBorderColor(r) }}><i>{RARITY_LABEL[r]}</i><b>{multTxt(RARITY_MULT[r])}</b></span>
        ))}
      </div>
      <p className="lg-rules-note">Le multiplicateur de rareté s'applique aux actions positives. Les cartons et les buts encaissés ne sont jamais multipliés.</p>
      <table className="lg-table-pts">
        <thead><tr><th>Action</th><th>GB</th><th>DÉF/MIL</th><th>ATT</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.key}>
              <td>{a.label}</td>
              {['GK', 'MID', 'ATT'].map((r) => <td key={r} className={a.pts[r] > 0 ? 'p' : a.pts[r] < 0 ? 'n' : ''}>{a.pts[r] > 0 ? '+' + a.pts[r] : a.pts[r] || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Aperçu : simule un week-end et révèle les points carte par carte (même barème que le vrai calcul).
function Simulation({ team, cap, gw }) {
  const [seed, setSeed] = useState(0)
  const [shown, setShown] = useState(-1)
  const timers = useRef([])
  const fx = useRef(null)
  const ref = useRef(null)
  const res = useMemo(() => {
    if (!seed) return null
    const stats = Object.fromEntries(SLOTS.map((s) => [s.id, simulateStats(team[s.id], s.id, `${gw}-${seed}`)]))
    return { stats, ...scoreLineup(team, stats, cap) }
  }, [seed, team, cap, gw])

  const run = () => {
    timers.current.forEach(clearTimeout)
    setSeed((s) => s + 1)
    setShown(-1)
    const order = SLOTS.map((s) => s.id)
    order.forEach((_, i) => timers.current.push(setTimeout(() => setShown(i), 350 + i * 620)))
    timers.current.push(setTimeout(() => setShown(order.length), 350 + order.length * 620 + 250))
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // éclats sur les grosses cartes au moment où leur multiplicateur tombe
  useEffect(() => {
    if (!res || shown < 0 || shown >= SLOTS.length) return
    const id = SLOTS[shown].id
    const card = team[id]
    if (multOf(card) < 1.5 && id !== cap) return
    const t = setTimeout(() => {
      const box = ref.current?.getBoundingClientRect()
      const el = ref.current?.querySelector(`[data-sim="${id}"]`)?.getBoundingClientRect()
      if (!box || !el) return
      fx.current?.burst({ x: (el.left + el.width / 2 - box.left) / box.width, y: (el.top + el.height * 0.3 - box.top) / box.height, colors: [getBorderColor(card.rarity), '#fff', GOLD], count: 50, speed: 8, kind: 'spark' })
    }, 720)
    return () => clearTimeout(t)
  }, [shown, res, team, cap])

  const busy = shown >= 0 && shown < SLOTS.length
  return (
    <section className="lg-sim" ref={ref}>
      <div className="lg-sim-head">
        <div>
          <h2>Aperçu des points <em>Simulation</em></h2>
          <p>Un week-end simulé à partir de probabilités moyennes, avec le vrai barème. Les points officiels viendront des stats réelles des matchs.</p>
        </div>
        <button className="lg-btn ghost" onClick={run} disabled={busy}>{seed ? 'Simuler un autre week-end' : 'Simuler un week-end'}</button>
      </div>
      <div className="lg-sim-grid">
        {SLOTS.map((s, i) => {
          const card = team[s.id]
          const r = res?.cards[s.id]
          const on = res && shown >= i
          return (
            <div key={s.id} data-sim={s.id} className={'lg-sim-card' + (on ? ' on' : '') + (s.id === cap ? ' cap' : '')} style={{ '--cc': getBorderColor(card?.rarity) }}>
              <div className="lg-sim-top">
                <div className="lg-sim-hc"><HeroCard card={card} tilt={false} /></div>
                <div className="lg-sim-pts">
                  <b>{on ? <CountUp to={r.total} /> : '—'}</b>
                  <small>pts</small>
                </div>
              </div>
              <div className="lg-sim-lines">
                {on && (r.lines.length ? r.lines.map((l, k) => (
                  <span key={l.key} className={l.pts < 0 ? 'n' : ''} style={{ animationDelay: k * 60 + 'ms' }}>{l.count > 1 ? l.count + '× ' : ''}{l.label} <b>{l.pts > 0 ? '+' : ''}{l.pts}</b></span>
                )) : <span className="none">N'a pas joué</span>)}
              </div>
              {on && (r.mult > 1 || r.captain) && (
                <div className="lg-sim-stamps">
                  {r.mult > 1 && <span className="stamp">{RARITY_LABEL[String(card.rarity).toLowerCase()]} {multTxt(r.mult)}</span>}
                  {r.captain && <span className="stamp cap">Capitaine ×{fmt(CAPTAIN_MULT)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className={'lg-sim-total' + (res && shown >= SLOTS.length ? ' on' : '')}>
        <span>Total de la journée</span>
        <b>{res && shown >= SLOTS.length ? <CountUp to={res.total} ms={1100} /> : '—'}</b>
        <small>points</small>
      </div>
      <PackFx ref={fx} ambient="rgba(242,194,48,.25)" />
    </section>
  )
}

function CountUp({ to, ms = 700 }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf
    const t0 = performance.now()
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms)
      setV(to * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return fmt(v)
}

function Standings({ name, avatar, code, gw, locked, members }) {
  // En ligne : les vrais membres de la ligue. Démo : toi seul.
  const rows = members?.length
    ? [...members].sort((x, y) => (y.points || 0) - (x.points || 0) || (y.me ? 1 : 0) - (x.me ? 1 : 0))
    : [{ id: 'me', name, avatar, me: true, points: 0, locked }]
  const free = Math.max(0, 5 - rows.length)
  return (
    <section className="lg-standings">
      <div className="lg-sim-head">
        <div>
          <h2>Classement de la ligue</h2>
          <p>Le classement cumule les points de chaque journée. Invite tes amis avec le code <b>{code}</b>.</p>
        </div>
      </div>
      <ol className="lg-rank">
        {rows.map((m, i) => (
          <li key={m.id || i} className={m.me ? 'me' : ''}>
            <span className="pos">{i + 1}</span>
            {m.avatar ? <img src={m.avatar} alt="" /> : <span className="av">{String(m.name || '?')[0]}</span>}
            <strong>{m.name}{m.me ? ' (toi)' : ''}</strong>
            <span className="st">{(m.me ? locked : m.locked) ? `Équipe verrouillée · J${gw}` : 'Équipe à verrouiller'}</span>
            <b className="pts">{Math.round((m.points || 0) * 10) / 10} <small>pts</small></b>
          </li>
        ))}
        {Array.from({ length: free }, (_, n) => (
          <li key={'free' + n} className="free">
            <span className="pos">{rows.length + n + 1}</span>
            <span className="av">+</span>
            <strong>Place libre</strong>
            <span className="st">Partage le code {code}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">
      <path d="M15 21v-6a9 9 0 0118 0v6" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="9" y="20" width="30" height="23" rx="5" fill="currentColor" />
    </svg>
  )
}
function CheckIcon() {
  return <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true"><path d="M10 25l9 9 19-20" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
