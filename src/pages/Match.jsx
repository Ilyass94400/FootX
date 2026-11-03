import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { getBorderColor, FALLBACK_IMG } from '../lib/rarity'
import { TACTICS, READS } from '../lib/matchEngine'
import { getTraits, TRAITS } from '../lib/traits'
import { useMatch } from '../lib/useMatch'
import { useHoloTilt } from '../lib/useHoloTilt'
import Particles from '../components/Particles'
import './match.css'

const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const rank = (c) => RANK[c?.rarity?.toLowerCase()] || 0
const pick = (a) => a[Math.floor(Math.random() * a.length)]

// Cartes de secours si Supabase est vide (dev hors-ligne)
const DEMO = {
  atk: { id: 'demo-atk', name: 'R. Mbala', club: 'FootX United', country: 'France', position: 'ATT', rarity: 'legendaire', image_url: '' },
  def: { id: 'demo-def', name: 'T. Kähn', club: 'Rival FC', country: 'Allemagne', position: 'GB', rarity: 'epique', image_url: '' },
}

export default function Match() {
  const [atk, setAtk] = useState(DEMO.atk)
  const [def, setDef] = useState(DEMO.def)

  // Tire deux cartes dans le catalogue pour la démo de duel.
  useEffect(() => {
    let alive = true
    supabase.from('cards').select('*').limit(400).then(({ data }) => {
      if (!alive || !data?.length) return
      const sorted = [...data].sort((a, b) => rank(b) - rank(a))
      const attacker = pick(sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.15))))
      const keeper = data.find((c) => /^(gb|g|gk)$/i.test(c.position || '') && c.id !== attacker.id) || pick(data.filter((c) => c.id !== attacker.id))
      setAtk(attacker); setDef(keeper || DEMO.def)
    })
    return () => { alive = false }
  }, [])

  const m = useMatch({ attacker: atk, defender: def })
  const atkColor = getBorderColor(atk.rarity)

  // Raccourcis clavier : 1/2/3 tactiques, Espace/Entrée QTE
  useEffect(() => {
    const onKey = (e) => {
      if (m.phase === 'choice') {
        if (e.key === '1') m.choose('force')
        if (e.key === '2') m.choose('finesse')
        if (e.key === '3') m.choose('passe')
      }
      if (m.phase === 'qte' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); m.hitQte() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [m])

  return (
    <div className={'match-stage ' + m.shake} style={{ '--atkc': atkColor }}>
      <Particles color={atkColor} className="match-particles" />
      <div className="match-vignette" />
      {m.fx === 'flash' && <div className="match-flash go" style={{ '--atkc': atkColor }} />}

      <Hud m={m} atk={atk} def={def} />

      <div className={'arena' + (m.phase === 'clash' ? ' clash' : '')}>
        <div className="spotlight" style={{ opacity: m.phase === 'setup' ? 0.4 : 1 }} />

        {m.phase !== 'setup' && (
          <>
            <DuelCard card={atk} side="home" active={m.phase === 'choice' || m.phase === 'intro'} tilt={-3} />
            <DuelCard card={def} side="away" active={m.phase === 'choice' || m.phase === 'intro'} tilt={3} />
          </>
        )}

        {m.phase === 'clash' && (
          <>
            <div className="impact"><div className="shock" style={{ '--atkc': atkColor }} /></div>
            <div className="trail" style={{ '--atkc': atkColor }} />
          </>
        )}

        {m.phase === 'setup' && <Setup m={m} atk={atk} def={def} />}
        {m.phase === 'intro' && <Intro scenario={m.scenario} />}
        {m.phase === 'qte' && m.res && <Verdict m={m} />}
        {m.phase === 'result' && m.out && <Result m={m} />}
      </div>

      <Dock m={m} />
      <div className="match-foot">Prototype moteur de match FootX</div>
    </div>
  )
}

// --- Carte de duel -----------------------------------------------------------
function DuelCard({ card, side, active, tilt = 0 }) {
  const holo = useHoloTilt()
  const cc = getBorderColor(card.rarity)
  const traits = getTraits(card)
  return (
    <div
      ref={holo.ref}
      {...(active ? holo.handlers : {})}
      className={'duel-card ' + side + (active ? ' idle' : '')}
      style={{ '--cc': cc, '--tilt': tilt + 'deg' }}
    >
      <div className="rar">{card.rarity}</div>
      <div className="photo">
        {card.image_url
          ? <img src={card.image_url} alt={card.name} onError={(e) => { e.target.src = FALLBACK_IMG }} />
          : <div className="silh">{/^(gb|g|gk)$/i.test(card.position || '') ? '🧤' : '⚽'}</div>}
        <div className="holo-sheen" />
      </div>
      {traits.length > 0 && (
        <div className="trait-chips">{traits.map((t) => <span key={t} className="tchip">{TRAITS[t].name}</span>)}</div>
      )}
      <div className="meta">
        <div className="nm">{card.name}</div>
        <div className="cl">{card.club} · {card.country}</div>
      </div>
    </div>
  )
}

// --- HUD ---------------------------------------------------------------------
function Hud({ m, atk, def }) {
  return (
    <div className="match-hud">
      <div className="team">
        <div className="nm">{atk.club}</div><div className="sub">Domicile</div>
      </div>
      <div className="scoreboard">
        <div className="score"><b>{m.score.h}</b><span className="sep">:</span><b>{m.score.a}</b></div>
        <div className="clock">{m.scenario.kicker.toUpperCase()}</div>
        <div className="momentum">
          <i style={{ width: m.momentum + '%', background: m.momentum > 50 ? 'var(--accent)' : 'var(--r-legendaire)' }} />
          <span className="mid" />
        </div>
      </div>
      <div className="team away">
        <div className="nm">{def.club}</div><div className="sub">Extérieur</div>
      </div>
    </div>
  )
}

// --- Overlays ----------------------------------------------------------------
function Setup({ m }) {
  return (
    <div className="overlay">
      <div className="setup-panel">
        <h1>Moteur de duel</h1>
        <p className="lead">
          Un moment-clé fige l'action. Choisis ta tactique avant la fin du chrono : elle s'entrechoque
          avec la lecture du gardien (Pierre-Feuille-Ciseaux), les Traits ajustent le rapport de force,
          puis un QTE réflexe décide du dénouement.
        </p>
        <button className="btn play" onClick={m.start}>▶ Lancer le duel</button>
      </div>
    </div>
  )
}

function Intro({ scenario }) {
  return (
    <div className="overlay scenario-title">
      <div className="kicker">{scenario.kicker} · Moment-clé</div>
      <h1>{scenario.title}</h1>
      <p>{scenario.sub}</p>
    </div>
  )
}

function Verdict({ m }) {
  const { res, choice, read } = m
  return (
    <div className="overlay verdict">
      <div className="vs-pick">
        <div className={'pickcard ' + (res.won ? 'win' : res.lost ? 'lose' : '')}>
          <div className="who">Attaquant</div>
          <div className="ic">{TACTICS[choice].ic}</div>
          <div className="lab">{TACTICS[choice].name}</div>
        </div>
        <div className={'pickcard ' + (res.lost ? 'win' : res.won ? 'lose' : '')}>
          <div className="who">Gardien</div>
          <div className="ic">{READS[read].ic}</div>
          <div className="lab">{READS[read].name}</div>
        </div>
      </div>
      <div className={'vbadge ' + res.verdict}>
        {res.won ? 'Avantage attaquant !' : res.lost ? 'Le gardien a lu le coup' : 'Duel serré'}
      </div>
    </div>
  )
}

function Result({ m }) {
  return (
    <div className="overlay result">
      <h1 className={m.out.kind}>{m.out.head}</h1>
      <p className="desc">{m.out.desc}</p>
      <div className="row">
        <button className="btn play" onClick={m.start}>↻ Action suivante</button>
        <button className="btn ghost" onClick={m.toSetup}>Quitter</button>
      </div>
    </div>
  )
}

// --- Dock (choix tactiques OU QTE) -------------------------------------------
function Dock({ m }) {
  const CHOICE = 3200
  const ringC = 2 * Math.PI * 20
  const ringOff = ringC * (1 - m.timeLeft / CHOICE)
  const sec = Math.ceil(m.timeLeft / 1000)

  if (m.phase === 'choice') return (
    <div className="dock">
      <div className="dock-inner">
        <div className="choice-head">
          <span className="lbl">Ton choix tactique</span>
          <span className="keeper-think"><i className="dot" /> Le gardien se prépare…</span>
          <span className="ring">
            <svg width="46" height="46">
              <circle cx="23" cy="23" r="20" fill="none" stroke="#26281f" strokeWidth="4" />
              <circle cx="23" cy="23" r="20" fill="none" stroke={m.timeLeft < 1000 ? 'var(--r-legendaire)' : 'var(--accent)'}
                strokeWidth="4" strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringOff} transform="rotate(-90 23 23)" />
            </svg>
            <span className="num">{sec}</span>
          </span>
        </div>
        <div className="tactics">
          {Object.values(TACTICS).map((t) => (
            <button key={t.id} className="tactic" onClick={() => m.choose(t.id)}>
              <span className="key">{t.key}</span>
              <span className="ic">{t.ic}</span>
              <span className="nm">{t.name}</span>
              <span className="beat">{t.beatLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  if (m.phase === 'qte' && m.res) {
    const zonePct = m.res.zone * 100
    const zoneLeft = 50 - zonePct / 2
    return (
      <div className="dock">
        <div className="dock-inner qte-wrap">
          <div className="qte-prompt">
            RÉFLEXE — frappe dans la zone !
            <small>{m.res.won ? 'Avantage : grande fenêtre, ne la gâche pas.' : m.res.lost ? 'Mal embarqué : fenêtre étroite, tente le geste.' : 'Duel neutre : vise juste.'}</small>
          </div>
          <div className="qte-track">
            <div className="qte-zone" style={{ left: zoneLeft + '%', width: zonePct + '%' }} />
            <div className="qte-marker" style={{ left: `calc(${m.marker * 100}% - 2.5px)` }} />
          </div>
          <div className="qte-timebar"><i style={{ width: (m.qteT * 100) + '%' }} /></div>
          <button className="btn qte" onClick={m.hitQte}>FRAPPER</button>
        </div>
      </div>
    )
  }

  if (m.phase === 'intro' || m.phase === 'clash') return (
    <div className="dock"><div className="dock-inner hint">{m.phase === 'intro' ? "L'action se fige…" : 'Impact !'}</div></div>
  )

  return <div className="dock" />
}
