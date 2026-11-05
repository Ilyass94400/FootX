import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  legendCard, unlockNode, canUnlock, grantXp, onLegend, SKILL_TREE,
} from '../lib/legend'
import {
  POSITIONS, COUNTRIES, LOOKS, TALENTS, STATS, TIERS, ULTIMATES, TRAIT_LABEL, ultimateFor,
} from '../lib/legend/config'
import { avatarUrl } from '../lib/legend/avatar'
import { powerUp, levelUp } from '../lib/legend/sfx'
import { getBorderColor, RARITY_LABEL } from '../lib/rarity'
import LegendCard from '../components/legend/LegendCard'
import UltimateCutscene from '../components/legend/UltimateCutscene'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './vestiaire.css'

// ============================================================================
// Composants du joueur de carrière (mode solo « L'Ascension ») :
//   <Academy>      création du joueur (identité, apparence, talent + étape en plus, ex. le club)
//   <SkillLocker>  le vestiaire : stats, carte, arbre de compétences
// ============================================================================

// ================================================================== ACADÉMIE
const BASE_STEPS = ['Identité', 'Apparence', 'Talent']
export function Academy({ onDone, extra, finalLabel = 'Valider' }) {
  const STEPS = extra ? [...BASE_STEPS, extra.label] : BASE_STEPS
  const [step, setStep] = useState(0)
  const [f, setF] = useState({
    name: '', number: 10, position: 'ATT', country: 'France', talent: 'buteur',
    look: { skin: LOOKS.skin[1], hair: 'pics', hairColor: LOOKS.hairColor[0], eyes: LOOKS.eyes[0], aura: LOOKS.aura[0] },
  })
  const [err, setErr] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const setLook = (p) => setF((x) => ({ ...x, look: { ...x.look, ...p } }))
  const talent = TALENTS.find((t) => t.id === f.talent)
  const preview = useMemo(() => ({
    id: 'preview', name: f.name.trim() || 'Ton nom', position: POSITIONS.find((p) => p.id === f.position).short,
    country: f.country, club: f.club?.name || 'Centre de formation', rarity: 'commune', rating: 61, image_url: avatarUrl(f.look, { number: f.number }),
  }), [f])
  const canNext = step === 0 ? f.name.trim().length >= 2 : step === 3 && extra ? extra.canNext(f) : true
  const sign = () => {
    if (f.name.trim().length < 2) { setErr('Le nom doit faire au moins 2 caractères.'); setStep(0); return }
    try { onDone({ ...f, name: f.name.trim() }) } catch (e) { setErr(e.message) }
  }

  return (
    <div className="ac" style={{ '--au': f.look.aura }}>
      <header className="ac-head">
        <span className="vs-kicker">Mode Carrière · Le centre de formation</span>
        <h1>Crée ton joueur</h1>
        <ol className="ac-steps">
          {STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}><i>{i + 1}</i>{s}</li>)}
        </ol>
      </header>

      <div className="ac-layout">
        <section className="ac-form" key={step}>
          {step === 0 && (
            <>
              <label className="ac-field">
                <span>Nom sur le maillot</span>
                <input className="ac-name" maxLength={16} placeholder="Ex. Ilyass" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
              </label>
              <div className="ac-row">
                <label className="ac-field ac-num">
                  <span>Numéro</span>
                  <input type="number" min="1" max="99" value={f.number} onChange={(e) => set({ number: Math.max(1, Math.min(99, +e.target.value || 1)) })} />
                </label>
                <label className="ac-field">
                  <span>Nationalité</span>
                  <select value={f.country} onChange={(e) => set({ country: e.target.value })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select>
                </label>
              </div>
              <div className="ac-field">
                <span>Poste</span>
                <div className="ac-pos">
                  {POSITIONS.map((p) => (
                    <button key={p.id} className={f.position === p.id ? 'on' : ''} onClick={() => set({ position: p.id })}>
                      <b>{p.short}</b><strong>{p.label}</strong><small>{p.desc}</small>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <Swatches label="Peau" list={LOOKS.skin} value={f.look.skin} onPick={(v) => setLook({ skin: v })} />
              <div className="ac-field">
                <span>Coiffure</span>
                <div className="ac-hair">
                  {LOOKS.hair.map((h) => (
                    <button key={h.id} className={f.look.hair === h.id ? 'on' : ''} onClick={() => setLook({ hair: h.id })}>
                      <img src={avatarUrl({ ...f.look, hair: h.id }, { number: f.number })} alt="" /><small>{h.label}</small>
                    </button>
                  ))}
                </div>
              </div>
              <Swatches label="Cheveux" list={LOOKS.hairColor} value={f.look.hairColor} onPick={(v) => setLook({ hairColor: v })} />
              <Swatches label="Yeux" list={LOOKS.eyes} value={f.look.eyes} onPick={(v) => setLook({ eyes: v })} />
              <Swatches label="Aura" list={LOOKS.aura} value={f.look.aura} onPick={(v) => setLook({ aura: v })} big />
            </>
          )}
          {step === 2 && (
            <div className="ac-talents">
              {TALENTS.map((t) => (
                <button key={t.id} className={f.talent === t.id ? 'on' : ''} style={{ '--tc': t.color }} onClick={() => set({ talent: t.id })}>
                  <b>{t.label}</b>
                  <small>{t.desc}</small>
                  <em>Trait : {TRAIT_LABEL[t.trait]}</em>
                </button>
              ))}
            </div>
          )}
          {step === 3 && extra && extra.render(f, set)}
          {err && <p className="ac-err">{err}</p>}
          <div className="ac-nav">
            {step > 0 && <button className="vs-btn ghost" onClick={() => setStep(step - 1)}>Retour</button>}
            {step < STEPS.length - 1
              ? <button className="vs-btn" disabled={!canNext} onClick={() => setStep(step + 1)}>Continuer</button>
              : <button className="vs-btn big" disabled={!canNext} onClick={sign}>{finalLabel}</button>}
          </div>
        </section>

        <aside className="ac-preview">
          <div className="ac-card"><LegendCard card={preview} aura={f.look.aura} level={1} /></div>
          {step === 2 && <p className="ac-talent-tag" style={{ '--tc': talent.color }}>{talent.label}</p>}
        </aside>
      </div>
    </div>
  )
}

function Swatches({ label, list, value, onPick, big }) {
  return (
    <div className="ac-field">
      <span>{label}</span>
      <div className={'ac-sw' + (big ? ' big' : '')}>
        {list.map((c) => <button key={c} className={value === c ? 'on' : ''} style={{ '--c': c }} onClick={() => onPick(c)} aria-label={c} />)}
      </div>
    </div>
  )
}

// ================================================================== VESTIAIRE
export function SkillLocker({ d, onBack, kicker = 'Mode Carrière', club }) {
  const fx = useRef(null)
  const rootRef = useRef(null)
  const [pulse, setPulse] = useState(0)
  const [flashStat, setFlashStat] = useState(null)
  const [hover, setHover] = useState(null)
  const [bloom, setBloom] = useState(null) // { id, key }
  const [cut, setCut] = useState(null) // cinématique d'ultime
  const [banner, setBanner] = useState(null) // niveau / évolution
  const [msg, setMsg] = useState(null)
  const card = useMemo(() => ({ ...legendCard(d), ...(club ? { club } : {}) }), [d, club])
  const aura = d.look?.aura || '#ff6a2b'

  // montée de niveau / évolution (après un match ou le bouton de test)
  const bannerT = useRef(0)
  useEffect(() => onLegend((e) => {
    if (e?.type !== 'xp' || !e.levelsGained) return
    levelUp()
    setPulse((p) => p + 1)
    // une évolution de rareté reste prioritaire sur un simple niveau
    setBanner((b) => (b?.tier && !e.tierUp ? { ...b, level: e.after.level, gained: b.gained + e.levelsGained }
      : { key: Date.now(), level: e.after.level, gained: e.levelsGained + (b && !e.tierUp ? b.gained : 0), tier: e.tierUp ? e.after.tier.rarity : null }))
    if (e.tierUp) fx.current?.burst({ x: 0.5, y: 0.4, colors: [getBorderColor(e.after.tier.rarity), '#ffffff', aura], count: 180, speed: 15, kind: 'mix' })
    clearTimeout(bannerT.current)
    bannerT.current = setTimeout(() => setBanner(null), e.tierUp ? 3600 : 2400)
  }), [aura])
  useEffect(() => () => clearTimeout(bannerT.current), [])

  const buy = useCallback((node, el) => {
    const c = canUnlock(node.id, d)
    if (!c.ok) { setMsg({ key: Date.now(), text: c.reason }); return }
    const { before, after } = unlockNode(node.id)
    // effets : son, éclosion du nœud, rayon d'énergie, secousse légère, carte qui pulse, stat qui flashe
    powerUp(node.kind === 'ultimate')
    setBloom({ id: node.id, key: Date.now() })
    setPulse((p) => p + 1)
    if (node.stat) setFlashStat({ id: node.stat, key: Date.now(), from: before.stats[node.stat], to: after.stats[node.stat] })
    const root = rootRef.current
    root?.classList.remove('shake'); void root?.offsetWidth; root?.classList.add('shake')
    const r = el?.getBoundingClientRect()
    if (r) fx.current?.burst({ x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight, colors: [node.color, '#ffffff', aura], count: node.kind === 'ultimate' ? 120 : 50, speed: node.kind === 'ultimate' ? 13 : 9, kind: 'spark' })
    if (node.kind === 'ultimate') setTimeout(() => setCut({ ult: ultimateFor(node.ultimate, d.position), caption: 'Capacité Ultime débloquée' }), 450)
  }, [d, aura])

  const next = d.nextTier
  const xpPct = d.need ? Math.round((d.into / d.need) * 100) : 100
  return (
    <div className="vs" style={{ '--au': aura }}>
      <header className="vs-head">
        <div>
          <span className="vs-kicker">{kicker}</span>
          <h1>Ton joueur</h1>
        </div>
        <div className="vs-head-r">
          <div className={'vs-points' + (d.points > 0 ? ' has' : '')}><b key={d.points}>{d.points}</b><span>point{d.points > 1 ? 's' : ''} de<br />compétence</span></div>
          {onBack && <button className="vs-btn ghost" onClick={onBack}>Retour au vestiaire</button>}
          {import.meta.env.DEV && <button className="vs-link" onClick={() => grantXp(400, 'dev-' + Date.now())} title="Visible seulement en dev">+400 XP (test)</button>}
        </div>
      </header>

      <div className="vs-grid" ref={rootRef}>
        {/* ---------------------------------------------- statistiques */}
        <aside className="vs-panel vs-stats">
          <div className="vs-id">
            <b>{d.name}</b>
            <span>#{d.number} · {d.pos.label} · {d.country}</span>
          </div>
          <div className="vs-ovr"><span>Note</span><b key={d.rating}>{d.rating}</b></div>
          {STATS.map((s) => (
            <StatBar key={s.id} s={s} value={d.stats[s.id]} flash={flashStat?.id === s.id ? flashStat : null} />
          ))}
          <div className="vs-sub">
            <h3>Talent</h3>
            <span className="vs-tag" style={{ '--tc': d.talent.color }}>{d.talent.label}</span>
          </div>
          <div className="vs-sub">
            <h3>Traits en match</h3>
            <div className="vs-tags">{d.traits.map((t) => <span key={t} className="vs-tag">{TRAIT_LABEL[t]}</span>)}</div>
          </div>
          <div className="vs-sub">
            <h3>Capacités Ultimes</h3>
            {d.ultimates.length ? d.ultimates.map((u) => (
              <button key={u.id} className="vs-ult" style={{ '--u1': u.color }} onClick={() => setCut({ ult: u })}>
                <b>{u.name}</b><small>{u.side === 'atk' ? 'En attaque' : 'En défense'} · 1 fois par match</small><i>Voir</i>
              </button>
            )) : (
              <button className="vs-ult demo" style={{ '--u1': ULTIMATES.tigre.color }} onClick={() => setCut({ ult: ULTIMATES.tigre, caption: 'Aperçu' })}>
                <b>Aucune pour l'instant</b><small>Débloquées au niveau 25 · aperçu : {ULTIMATES.tigre.name}</small><i>Voir</i>
              </button>
            )}
          </div>
        </aside>

        {/* ---------------------------------------------- la carte */}
        <section className="vs-center">
          <div className="vs-card"><LegendCard card={card} aura={aura} level={d.level} pulse={pulse} /></div>
          <div className="vs-xp">
            <div className="vs-xp-top"><b>Niveau {d.level}</b><span>{d.need ? `${d.into} / ${d.need} XP` : 'Niveau maximum'}</span></div>
            <div className="vs-xp-bar"><i style={{ width: xpPct + '%' }} /></div>
            <p>L'XP dépend de ta note de match : plus elle est haute, plus tu progresses.</p>
          </div>
          <ol className="vs-tiers">
            {TIERS.map((t) => (
              <li key={t.rarity} className={(d.level >= t.level ? 'on' : '') + (t.rarity === d.tier.rarity ? ' cur' : '')} style={{ '--cc': getBorderColor(t.rarity) }} title={RARITY_LABEL[t.rarity]}>
                <i /><small>niv {t.level}</small>
              </li>
            ))}
          </ol>
          {next && <p className="vs-next">Évolution <b style={{ color: getBorderColor(next.rarity) }}>{RARITY_LABEL[next.rarity]}</b> au niveau {next.level}</p>}
        </section>

        {/* ---------------------------------------------- arbre */}
        <section className="vs-panel vs-tree">
          <div className="vs-tree-head"><h2>Arbre de compétences</h2>
            <div className="vs-branches">{STATS.map((s) => <span key={s.id} style={{ color: s.color }}>{s.label}</span>)}</div>
          </div>
          <SkillTree d={d} bloom={bloom} onBuy={buy} onHover={setHover} />
          <NodeInfo d={d} node={hover} />
        </section>
      </div>

      {msg && <div key={msg.key} className="vs-toast" onAnimationEnd={() => setMsg(null)}>{msg.text}</div>}
      {banner && (
        <div key={banner.key} className={'vs-banner' + (banner.tier ? ' tier' : '')} style={{ '--cc': banner.tier ? getBorderColor(banner.tier) : aura }}>
          <span>{banner.tier ? 'Évolution !' : 'Niveau supérieur'}</span>
          <b>{banner.tier ? RARITY_LABEL[banner.tier] : `Niveau ${banner.level}`}</b>
          <small>+{banner.gained} point{banner.gained > 1 ? 's' : ''} de compétence</small>
        </div>
      )}
      {cut && <UltimateCutscene ult={cut.ult} look={d.look} number={d.number} name={d.name} caption={cut.caption} onDone={() => setCut(null)} />}
      <div className="vs-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </div>
  )
}

function StatBar({ s, value, flash }) {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (shown === value) return
    const from = shown
    const t0 = performance.now()
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700)
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div key={flash?.key} className={'vs-stat' + (flash ? ' flash' : '')} style={{ '--sc': s.color }}>
      <span>{s.label}</span>
      <div className="vs-stat-bar"><i style={{ width: shown + '%' }} /></div>
      <b>{shown}</b>
      {flash && <em>+{flash.to - flash.from}</em>}
    </div>
  )
}

// ------------------------------------------------------------------ arbre
// Placement : 3 colonnes (branches), lignes du bas (palier 1) vers le haut (Ultime).
const COLS = { tir: 1 / 6, vitesse: 3 / 6, defense: 5 / 6 }
const ROW = { 1: 0.9, 2: 0.74, 3: 0.58, 4: 0.42, 5: 0.27, 6: 0.09 }
const posOf = (n) => ({ x: COLS[n.branch] + (n.kind === 'mastery' ? -0.095 : 0), y: n.kind === 'mastery' ? ROW[5] + 0.04 : ROW[n.tier] })

function SkillTree({ d, bloom, onBuy, onHover }) {
  const edges = SKILL_TREE.flatMap((n) => n.requires.map((r) => [r, n.id]))
  const P = Object.fromEntries(SKILL_TREE.map((n) => [n.id, posOf(n)]))
  return (
    <div className="st">
      <svg className="st-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {edges.map(([a, b]) => {
          const lit = !!d.skills[b]
          const ready = !!d.skills[a] && !lit
          const node = SKILL_TREE.find((x) => x.id === b)
          return (
            <g key={a + b} className={'st-edge' + (lit ? ' lit' : ready ? ' ready' : '')} style={{ '--nc': node.color }}>
              <line x1={P[a].x * 100} y1={P[a].y * 100} x2={P[b].x * 100} y2={P[b].y * 100} vectorEffect="non-scaling-stroke" />
              {bloom?.id === b && <line key={bloom.key} className="beam" x1={P[a].x * 100} y1={P[a].y * 100} x2={P[b].x * 100} y2={P[b].y * 100} vectorEffect="non-scaling-stroke" pathLength="1" />}
            </g>
          )
        })}
      </svg>
      {SKILL_TREE.map((n) => {
        const rank = d.skills[n.id] || 0
        const c = canUnlock(n.id, d)
        const state = rank >= n.maxRank ? 'max' : rank > 0 ? 'owned' : c.ok ? 'ready' : c.locked ? 'locked' : 'poor'
        const p = P[n.id]
        const u = n.ultimate ? ultimateFor(n.ultimate, d.position) : null
        return (
          <button
            key={n.id}
            className={`st-node k-${n.kind} ${state}` + (rank > 0 && rank < n.maxRank && c.ok ? ' ready' : '')}
            style={{ left: p.x * 100 + '%', top: p.y * 100 + '%', '--nc': n.color }}
            onClick={(e) => onBuy(n, e.currentTarget)}
            onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onMouseLeave={() => onHover(null)}
            aria-label={nodeTitle(n, u)}
          >
            <span className="st-in"><NodeGlyph n={n} /></span>
            {n.maxRank > 1 && <span className="st-rank">{rank}/{n.maxRank}</span>}
            {state === 'locked' && <span className="st-lv">{n.level}</span>}
            {bloom?.id === n.id && <span key={bloom.key} className="st-bloom" />}
            {n.kind === 'ultimate' && <span className="st-ult-name">{u.name}</span>}
          </button>
        )
      })}
    </div>
  )
}

const nodeTitle = (n, u) => (n.kind === 'ultimate' ? u.name : n.kind === 'trait' ? `Trait : ${TRAIT_LABEL[n.trait]}` : n.kind === 'mastery' ? `Maîtrise ${STATS.find((s) => s.id === n.stat).label}` : `${STATS.find((s) => s.id === n.stat).label} +${n.amount}`)

function NodeInfo({ d, node }) {
  if (!node) return <div className="st-info idle">Survole une compétence pour voir son effet. Clique pour la débloquer.</div>
  const c = canUnlock(node.id, d)
  const u = node.ultimate ? ultimateFor(node.ultimate, d.position) : null
  const rank = d.skills[node.id] || 0
  const effect = node.kind === 'ultimate'
    ? `${u.side === 'atk' ? 'En attaque' : 'En défense'}, une fois par match : ta Légende lit forcément l'adversaire et sa zone de réussite s'élargit fortement.`
    : node.kind === 'trait' ? `Ta carte gagne le trait « ${TRAIT_LABEL[node.trait]} » en Arène.`
      : `+${node.amount} ${STATS.find((s) => s.id === node.stat).label}${node.maxRank > 1 ? ` par rang (${rank}/${node.maxRank})` : ''}.`
  return (
    <div className="st-info" style={{ '--nc': node.color }}>
      <b>{nodeTitle(node, u)}</b>
      <p>{effect}</p>
      <span className={c.ok || c.maxed ? 'ok' : 'no'}>{c.ok ? `Coût : ${node.cost} point${node.cost > 1 ? 's' : ''} · clique pour débloquer` : c.maxed ? 'Débloquée ✓' : c.reason}</span>
    </div>
  )
}

function NodeGlyph({ n }) {
  if (n.kind === 'ultimate') return <svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M13 2L4 14h7l-2 8 11-13h-7z" fill="currentColor" /></svg>
  if (n.kind === 'trait') return <svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z" fill="currentColor" /></svg>
  if (n.kind === 'mastery') return <svg viewBox="0 0 24 24" width="1em" height="1em"><path d="M5 19h14M7 15l5-9 5 9z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" /></svg>
  return <b>+{n.amount}</b>
}
