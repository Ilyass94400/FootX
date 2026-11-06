import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuests, claimQuest, pendingOf } from '../lib/quests'
import { fmtCoins } from '../lib/economy/config'
import { coinSound, flyCoins } from '../lib/economy/fx'
import { CoinIcon } from '../components/CoinCounter'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './defis.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Centre des Défis — quotidiens, hebdomadaires, carrière.
// ============================================================================

const TABS = [
  { id: 'daily', label: 'Quotidiens', short: 'Jour', color: '#e4ff3c' },
  { id: 'weekly', label: 'Hebdomadaires', short: 'Semaine', color: '#7ad7ff' },
  { id: 'milestone', label: 'Carrière', short: 'Carrière', color: '#f2c230' },
]

export default function Defis() {
  const list = useQuests()
  const [tab, setTab] = useState('daily')
  const [toast, setToast] = useState(null)
  const [now, setNow] = useState(Date.now())
  const fx = useRef(null)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const byTab = useMemo(() => {
    const g = { daily: [], weekly: [], milestone: [] }
    for (const q of list || []) g[q.category]?.push(q)
    // à récupérer d'abord, puis en cours (les plus avancés en premier), puis déjà récupérés
    // (une carte qu'on vient de récupérer reste en place le temps de son animation)
    const t = Date.now()
    const order = (q) => (q.claimedAt ? (t - q.claimedAt < 2500 ? 0 : 2) : q.completedAt ? 0 : 1)
    for (const k of Object.keys(g)) g[k].sort((a, b) => order(a) - order(b) || b.progress / b.target - a.progress / a.target)
    return g
  }, [list, Math.floor(now / 2500)]) // eslint-disable-line react-hooks/exhaustive-deps
  const pending = list ? pendingOf(list) : 0
  const pendingCoins = (list || []).filter((q) => q.completedAt && !q.claimedAt).reduce((a, q) => a + (q.coins || 0), 0)
  const current = byTab[tab]
  const resets = current?.[0]?.resetsAt

  const say = (t) => { setToast({ ...t, key: Date.now() }); setTimeout(() => setToast(null), 3200) }

  // Le moment clé : récupérer.
  const claim = async (q, el) => {
    const r = el?.getBoundingClientRect()
    const from = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
    try {
      await claimQuest(q.id, q.period)
      if (q.coins) {
        flyCoins(from, Math.min(22, 6 + Math.round(Math.log10(q.coins) * 3)))
        setTimeout(() => coinSound(q.coins), 760) // le "cling" tombe à l'arrivée des pièces
      }
      if (q.boosters) flyPack(from, q.boosters)
      if (q.category === 'milestone' || q.boosters) {
        fx.current?.burst({ x: 0.12, y: 0.8, colors: ['#f2c230', '#fff6c2', '#e4ff3c', '#ffffff'], count: 120, speed: 15, kind: 'confetti', angle: -Math.PI * 0.35, spread: Math.PI * 0.35 })
        fx.current?.burst({ x: 0.88, y: 0.8, colors: ['#f2c230', '#fff6c2', '#e4ff3c', '#ffffff'], count: 120, speed: 15, kind: 'confetti', angle: -Math.PI * 0.65, spread: Math.PI * 0.35 })
      }
      if (from) fx.current?.burst({ x: from.x / window.innerWidth, y: from.y / window.innerHeight, colors: ['#fff6c2', '#f5c542', '#ffffff'], count: 46, speed: 9, kind: 'spark' })
      return true
    } catch (e) {
      say({ tone: 'bad', title: 'Impossible', text: e.message })
      return false
    }
  }

  // "Tout récupérer" : une cascade, une récompense après l'autre.
  const claimAll = async () => {
    const todo = (list || []).filter((q) => q.completedAt && !q.claimedAt)
    for (const [i, q] of todo.entries()) {
      setTimeout(() => {
        const btn = document.querySelector(`[data-claim="${q.id}"]`)
        if (btn) btn.click()
        else claim(q, null)
      }, i * 380)
    }
  }

  return (
    <div className="qd">
      <header className="qd-head">
        <div>
          <span className="qd-kicker">Défis · gagne des X-Coins chaque jour</span>
          <h1>Centre des défis</h1>
        </div>
        {pending > 0 ? (
          <button className="qd-all" onClick={claimAll}>
            <span className="qd-all-n">{pending}</span>
            <span className="qd-all-t">Tout récupérer<small><CoinIcon className="qd-c" />{fmtCoins(pendingCoins)}</small></span>
          </button>
        ) : (
          <p className="qd-none">Aucune récompense en attente. Termine un défi pour en débloquer.</p>
        )}
      </header>
      <PageHelp topic="defis" />

      <nav className="qd-tabs" role="tablist">
        {TABS.map((t) => {
          const n = byTab[t.id].filter((q) => q.completedAt && !q.claimedAt).length
          const done = byTab[t.id].filter((q) => q.completedAt).length
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} style={{ '--tc': t.color }} onClick={() => setTab(t.id)}>
              <span className="l-long">{t.label}</span><span className="l-short">{t.short}</span>
              <small>{done}/{byTab[t.id].length}</small>
              {n > 0 && <i className="qd-dot">{n}</i>}
            </button>
          )
        })}
      </nav>

      <div className="qd-sub">
        {tab === 'milestone'
          ? <span>Objectifs de carrière : ils ne se réinitialisent jamais.</span>
          : <span>{tab === 'daily' ? 'Nouveaux défis dans' : 'Réinitialisation lundi dans'} <b>{fmtIn(resets - now)}</b></span>}
      </div>

      <div className="qd-list" key={tab}>
        {!list && Array.from({ length: 3 }, (_, i) => <div key={i} className="qd-skel" />)}
        {current?.map((q, i) => <QuestCard key={q.id + q.period} q={q} i={i} color={TABS.find((t) => t.id === q.category).color} onClaim={claim} />)}
      </div>

      {toast && <div key={toast.key} className={'qd-toast ' + toast.tone}><b>{toast.title}</b><span>{toast.text}</span></div>}
      <div className="qd-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </div>
  )
}

function QuestCard({ q, i, color, onClaim }) {
  const ready = q.completedAt && !q.claimedAt
  const [phase, setPhase] = useState(q.claimedAt ? 'claimed' : ready ? 'ready' : 'progress') // progress | ready | claiming | claimed
  const [fill, setFill] = useState(0)
  const btn = useRef(null)
  const pct = Math.round((q.progress / q.target) * 100)

  // la jauge se remplit à l'affichage (et à chaque progression)
  useEffect(() => { const t = setTimeout(() => setFill(pct), 80 + i * 70); return () => clearTimeout(t) }, [pct, i])
  useEffect(() => { if (phase !== 'claiming' && phase !== 'stamp') setPhase(q.claimedAt ? 'claimed' : ready ? 'ready' : 'progress') }, [q.claimedAt, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const click = async () => {
    if (phase !== 'ready') return
    setPhase('claiming')
    const ok = await onClaim(q, btn.current)
    if (!ok) { setPhase('ready'); return }
    setTimeout(() => setPhase('stamp'), 260)
    setTimeout(() => setPhase('claimed'), 1500)
  }

  return (
    <article className={'qc ' + phase + ' ' + q.category} style={{ '--qc': color, '--i': i }}>
      <div className="qc-ic"><QuestIcon name={q.icon} /></div>
      <div className="qc-main">
        <h3>{q.title}</h3>
        <p>{q.desc}</p>
        <div className="qc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={q.progress}>
          <i style={{ width: fill + '%' }} />
          <span>{fmtCoins(q.progress)} / {fmtCoins(q.target)}</span>
        </div>
      </div>
      <div className="qc-side">
        <div className="qc-reward">
          {q.coins > 0 && <b><CoinIcon className="qd-c" />{fmtCoins(q.coins)}</b>}
          {q.boosters > 0 && <em><PackIcon /> +{q.boosters} booster{q.boosters > 1 ? 's' : ''}</em>}
        </div>
        <button ref={btn} data-claim={phase === 'ready' ? q.id : undefined} className="qc-btn" onClick={click} disabled={phase !== 'ready'}>
          {phase === 'ready' && 'Récupérer'}
          {phase === 'progress' && `${pct} %`}
          {(phase === 'claiming' || phase === 'stamp') && <span className="qc-plus">+{fmtCoins(q.coins)}</span>}
          {phase === 'claimed' && <><CheckIcon /> Récupéré</>}
        </button>
      </div>
      {phase === 'stamp' && <span className="qc-stamp"><CheckIcon /></span>}
      {(phase === 'claiming' || phase === 'stamp') && <span className="qc-flash" />}
    </article>
  )
}

// mini booster qui vole vers le compteur de boosters du header
function flyPack(from, n) {
  const target = document.querySelector('.nav-count')
  if (!target || !from) return
  const to = target.getBoundingClientRect()
  for (let k = 0; k < Math.min(3, n); k++) {
    const el = document.createElement('i')
    el.className = 'qd-flypack'
    el.style.left = from.x + 'px'
    el.style.top = from.y + 'px'
    el.style.setProperty('--dx', to.left + to.width / 2 - from.x + 'px')
    el.style.setProperty('--dy', to.top + to.height / 2 - from.y + 'px')
    el.style.animationDelay = 200 + k * 140 + 'ms'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1600 + k * 140)
  }
}

function fmtIn(ms) {
  if (!(ms > 0)) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`
  return `${m} min ${String(s % 60).padStart(2, '0')} s`
}

// ---------------------------------------------------------------- icônes
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }
function QuestIcon({ name }) {
  const paths = {
    ball: <><circle cx="12" cy="12" r="9" {...P} /><path d="M12 7l4 3-1.5 4.5h-5L8 10z" {...P} /></>,
    trophy: <><path d="M7 4h10v5a5 5 0 01-10 0z" {...P} /><path d="M7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 14v4M8 20h8" {...P} /></>,
    boot: <><path d="M4 16v-5h4l2-4h4v6c4 .3 6 1.8 6 4v1H4z" {...P} /><path d="M3 20h18" {...P} /></>,
    target: <><circle cx="12" cy="12" r="9" {...P} /><circle cx="12" cy="12" r="5" {...P} /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></>,
    pack: <><rect x="6" y="3" width="12" height="18" rx="2" {...P} /><path d="M6 6h12M6 18h12M10 11l2-2 2 2-2 2z" {...P} /></>,
    cart: <><path d="M3 4h2l2.4 11h10.2L20 8H6.2" {...P} /><circle cx="9" cy="19" r="1.4" fill="currentColor" /><circle cx="17" cy="19" r="1.4" fill="currentColor" /></>,
    tag: <><path d="M3 12V4h8l10 10-8 8z" {...P} /><circle cx="7.5" cy="8.5" r="1.4" fill="currentColor" /></>,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" {...P} /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" {...P} /><path d="M8 11V8a4 4 0 018 0v3" {...P} /></>,
    coins: <><ellipse cx="12" cy="7" rx="7" ry="3" {...P} /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" {...P} /></>,
    link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" {...P} /></>,
    star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" {...P} />,
    crown: <><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" {...P} /></>,
  }
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">{paths[name] || paths.star}</svg>
}
function CheckIcon() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" {...P} strokeWidth="3" /></svg> }
function PackIcon() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2" fill="currentColor" opacity=".25" /><rect x="6" y="3" width="12" height="18" rx="2" {...P} /><path d="M10 11l2-2 2 2-2 2z" fill="currentColor" /></svg> }
