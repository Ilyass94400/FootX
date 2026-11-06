import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabase'
import { getBorderColor, RARITY_LABEL } from '../lib/rarity'
import { autoFill, SLOTS, fitsSlot } from '../lib/collectif'
import { useTeam } from '../lib/useTeam'
import { useOwned } from '../lib/collection'
import { bootEconomy, LIVE } from '../lib/economy'
import { pvp, pvpSetup, SEARCH_MS, QUEUE_POLL_MS } from '../lib/match/pvp'
import HeroCard from '../components/HeroCard'
import { canPlace, CHEM_EFFECT } from '../lib/chemistry'
import { go } from '../lib/useRoute'
import { warpTo } from '../lib/warp'
import {
  ATTACK, DEFEND, ATTACK_IDS, DEFEND_IDS, SCENARIOS, TIMING, TOTAL_ACTIONS, opponentTendency, matchInsight, chemOf, ultimateReady,
} from '../lib/match/engine'
import { liveMatch } from '../lib/career'
import { loadClubs, clubLineup } from '../lib/career/clubs'
import { ratingTone } from '../lib/career/rules'
import UltimateCutscene from '../components/legend/UltimateCutscene'
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

export default function Match({ session, route }) {
  const careerMode = route === 'carriere-match'
  const [pool, setPool] = useState(null)
  const [career, setCareer] = useState(undefined) // Mode Carrière : le match en cours (null = aucun)
  useEffect(() => {
    let alive = true
    if (careerMode) {
      loadClubs().then(({ cards, clubs }) => { if (!alive) return; setCareer(liveMatch(clubs)); setPool(cards) })
      return () => { alive = false }
    }
    supabase.from('cards').select('*').limit(500)
      .then(({ data }) => { if (alive) setPool(data?.length >= 10 ? data : DEMO) })
      .catch(() => { if (alive) setPool(DEMO) })
    return () => { alive = false }
  }, [careerMode])
  const first = String(session?.user?.user_metadata?.full_name || 'FootX').split(' ')[0]
  useFullPage()
  // Plein écran : l'arène est rendue directement dans <body>, par-dessus la navigation,
  // pour occuper toute la fenêtre (comme un vrai jeu) au lieu d'un cadre dans la page.
  return createPortal(
    !pool
      ? <div className="mx-stage mx-loading"><span className="mx-spin" />Préparation du terrain…</div>
      : careerMode && !career
        ? <div className="mx-stage mx-loading">Aucun match de carrière en cours.<button className="mx-btn ghost" onClick={() => go('carriere')}>Retour au vestiaire</button></div>
        : careerMode
          ? <Arena pool={pool} myName={`FC ${first}`} career={career} />
          : <ArenaGate pool={pool} myName={`FC ${first}`} />,
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
function TopBar({ home = 'jouer' }) {
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
    warpTo(home, { color: home === 'jouer' ? '#e4ff3c' : '#f5c542', x: e.clientX, y: e.clientY })
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
// AVANT-MATCH (Arène) : on joue uniquement avec SES cartes.
// L'équipe enregistrée est vérifiée (cartes possédées, plafonds de rareté) ;
// si elle est incomplète, on la complète avec ses meilleures cartes ou on va la composer.
// ============================================================================
function ArenaGate({ pool, myName }) {
  // 'pre' (avant-match) → 'search' (recherche d'un vrai joueur) → { pvp } ou { ai }
  const [stage, setStage] = useState({ step: 'pre' })
  useEffect(() => { bootEconomy(pool).catch(() => {}) }, [pool]) // démo : pack de bienvenue si pas encore reçu
  const again = useCallback(() => setStage({ step: 'pre' }), [])
  if (stage.step === 'ai') return <Arena pool={pool} myName={myName} myTeam={stage.team} oppName={stage.oppName} notice={stage.notice} />
  if (stage.step === 'pvp') return <Arena key={stage.match.id} pool={pool} myName={myName} pvpMatch={stage.match} onAgain={again} />
  if (stage.step === 'search') {
    return <Search team={stage.team} myName={myName} onCancel={again}
      onFound={(match) => setStage({ step: 'pvp', match })}
      onAi={(notice) => setStage({ step: 'ai', team: stage.team, oppName: stage.oppName, notice })} />
  }
  return <PreMatch myName={myName}
    onStart={({ team, oppName }) => setStage({ step: 'ai', team, oppName })}
    onSearch={({ team, oppName }) => setStage({ step: 'search', team, oppName })} />
}

// Recherche d'un adversaire réel (SEARCH_MS max), sinon match contre l'IA
function Search({ team, myName, onFound, onAi, onCancel }) {
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [players, setPlayers] = useState(null)
  const [err, setErr] = useState(null)
  const done = useRef(false)
  useEffect(() => {
    let alive = true
    const finish = (fn) => { if (!done.current && alive) { done.current = true; fn() } }
    const handle = (r) => {
      if (r?.id) finish(() => onFound(r))
      else if (r?.players != null) setPlayers(r.players)
    }
    const tick = setInterval(() => setNow(Date.now()), 250)
    let timer = 0
    const loop = async () => {
      while (alive && !done.current) {
        await new Promise((res) => { timer = setTimeout(res, QUEUE_POLL_MS) })
        if (!alive || done.current) return
        if (Date.now() - t0 >= SEARCH_MS) {
          // personne : on quitte la file (si quelqu'un nous a pris entre-temps, on joue quand même contre lui)
          const r = await pvp.leave().catch(() => null)
          if (r?.id) finish(() => onFound(r))
          else finish(() => onAi('Aucun adversaire disponible pour l\'instant : match contre l\'IA.'))
          return
        }
        try {
          const r = await pvp.poll()
          if (r?.idle) handle(await pvp.join(team)) // sorti de la file (double montage en dev, coupure…) : on y retourne
          else handle(r)
        } catch { /* coupure : on réessaie */ }
      }
    }
    pvp.join(team).then((r) => { handle(r); loop() }).catch((e) => setErr(e.message))
    return () => {
      alive = false
      clearInterval(tick)
      clearTimeout(timer)
      if (!done.current) pvp.leave().catch(() => {}) // page quittée pendant la recherche
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const left = Math.max(0, Math.ceil((SEARCH_MS - (now - t0)) / 1000))
  const cancel = () => { done.current = true; pvp.leave().catch(() => {}); onCancel() }
  const vsAi = () => { done.current = true; pvp.leave().then((r) => (r?.id ? onFound(r) : onAi(null))).catch(() => onAi(null)) }
  return (
    <div className="mx-stage mx-search">
      <TopBar />
      <div className="mx-search-in">
        <div className="mx-radar" aria-hidden="true"><i /><i /><i /><b /></div>
        <span className="mx-pre-k">L'Arène · joueur contre joueur</span>
        <h1>{err ? 'Recherche impossible' : 'Recherche d\'un adversaire…'}</h1>
        {err ? <p className="mx-search-err">{err}</p> : (
          <p>
            <b>{myName}</b> cherche un joueur de ton niveau.
            {players != null && <> {players > 1 ? `${players} joueurs` : '1 joueur'} en recherche.</>}
            <br />Sans adversaire dans <b>{left} s</b>, tu joues contre l'IA.
          </p>
        )}
        <div className="mx-search-bar"><i style={{ animationDuration: SEARCH_MS + 'ms' }} /></div>
        <div className="mx-search-btns">
          <button className="mx-btn" onClick={vsAi}>Jouer contre l'IA maintenant</button>
          <button className="mx-btn ghost" onClick={cancel}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

const LINE = [['A1', 'A2'], ['D1', 'D2'], ['GK']] // affichage : attaque en haut, gardien en bas

function PreMatch({ myName, onStart, onSearch }) {
  const owned = useOwned()
  const t = useTeam()
  const [oppName] = useState(() => RIVALS[Math.floor(Math.random() * RIVALS.length)])
  const mine = useMemo(() => (owned ? [...new Map(owned.items.filter((i) => i.card).map((i) => [String(i.card.id), i.card])).values()] : null), [owned])

  // une carte vendue, ou une carte du mode démo que le compte ne possède pas : retirée de l'équipe
  const ownedIds = useMemo(() => (mine ? new Set(mine.map((c) => String(c.id))) : null), [mine])
  useEffect(() => {
    if (!ownedIds) return
    for (const sl of SLOTS) { const c = t.team[sl.id]; if (c && !ownedIds.has(String(c.id))) t.removeFrom(sl.id) }
  }, [ownedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mine) return <div className="mx-stage mx-loading"><span className="mx-spin" />Chargement de ta collection…</div>

  const missing = SLOTS.filter((sl) => !t.team[sl.id] || !ownedIds.has(String(t.team[sl.id].id)))
  const ready = missing.length === 0 && t.validity.ok
  const keepers = mine.filter((c) => fitsSlot(c, 'GK')).length
  const field = mine.length - keepers
  const canAuto = keepers >= 1 && field >= 4
  const capErr = t.validity.errors?.[0]
  const launch = () => { if (ready) onStart({ team: t.team, oppName }) }
  const search = () => { if (ready) onSearch({ team: t.team, oppName }) }

  return (
    <div className="mx-stage mx-pre">
      <TopBar />
      <div className="mx-pre-in">
        <header className="mx-pre-head">
          <span className="mx-pre-k">L'Arène · avant-match</span>
          <h1><b>{myName}</b> <i>vs</i> {LIVE ? '???' : oppName}</h1>
          <p>{!ready ? 'Tu joues avec tes cartes : complète ton 5 avant le coup d\'envoi.' : LIVE ? 'Ton 5 est prêt. Trouve un adversaire : un vrai joueur, ou l\'IA si personne n\'est disponible.' : 'Ton 5 est prêt. Vérifie-le, puis lance le match.'}</p>
        </header>

        <div className="mx-pre-board">
          <div className="mx-pre-pitch" aria-label="Ton équipe">
            {LINE.map((row, r) => (
              <div key={r} className="mx-pre-row">
                {row.map((id) => {
                  const c = t.team[id]
                  const sl = SLOTS.find((x) => x.id === id)
                  return (
                    <div key={id} className={'mx-pre-slot' + (c ? '' : ' empty')}>
                      {c ? <HeroCard card={c} tilt={false} /> : <span className="mx-pre-hole"><b>+</b>{sl?.label || id}</span>}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <aside className="mx-pre-side">
            <div className="mx-pre-stat"><span>Collectif</span><b>{missing.length ? '—' : t.collectif.collectif}</b></div>
            <div className="mx-pre-stat"><span>Titulaires</span><b>{SLOTS.length - missing.length}<small>/{SLOTS.length}</small></b></div>
            <ul className="mx-pre-checks">
              <li className={missing.length ? 'ko' : 'ok'}>{missing.length ? `Il manque ${missing.length} titulaire${missing.length > 1 ? 's' : ''}` : '5 titulaires, tous à toi'}</li>
              <li className={t.validity.ok ? 'ok' : 'ko'}>{t.validity.ok ? `Plafonds de rareté respectés` : capErr?.message}</li>
            </ul>
            {!canAuto && (
              <p className="mx-pre-note">Il te faut au moins <b>1 gardien</b> et <b>4 joueurs de champ</b> dans ta collection. Tu en as {keepers} et {field} : ouvre des boosters.</p>
            )}
            <div className="mx-pre-btns">
              {LIVE ? (
                <>
                  <button className="mx-btn primary xl" disabled={!ready} onClick={search}>Trouver un adversaire</button>
                  <button className="mx-btn" disabled={!ready} onClick={launch}>Entraînement contre l'IA</button>
                </>
              ) : <button className="mx-btn primary xl" disabled={!ready} onClick={launch}>Lancer le match</button>}
              {canAuto && (
                <button className="mx-btn" onClick={() => t.fill(mine)}>{missing.length ? 'Compléter avec mes meilleures cartes' : 'Compo auto (mes meilleures cartes)'}</button>
              )}
              <button className="mx-btn ghost" onClick={(e) => warpTo('team', { color: '#7ad7ff', x: e.clientX, y: e.clientY })}>Composer mon équipe</button>
              {!canAuto && <button className="mx-btn gold" onClick={() => go('boosters')}>Ouvrir des boosters</button>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
function Arena({ pool, myName, career, myTeam, oppName, pvpMatch = null, onAgain, notice = null }) {
  const makeSetup = useCallback(() => {
    if (career) {
      // Mode Carrière : les vrais joueurs de ton club + TOI, contre les joueurs du club adverse
      const level = Math.max(0.2, Math.min(0.95, 0.5 + ((career.opp.strength || 70) - (career.me.strength || 70)) / 25))
      return {
        me: clubLineup(career.me, career.pro), opp: clubLineup(career.opp),
        names: { me: career.me.name, opp: career.opp.name }, level, focus: career.pro?.id,
        meta: { career: { fixtureId: career.fixture.id, proId: career.pro?.id, keeper: career.pro?.position === 'GB' } },
      }
    }
    // Arène contre un VRAI joueur : équipes, graine et noms viennent du serveur (identiques des deux côtés)
    if (pvpMatch) return pvpSetup(pvpMatch)
    // Arène : TON équipe validée à l'avant-match (uniquement tes cartes), contre une équipe adverse
    const me = myTeam
    const mine = new Set(SLOTS.map((sl) => me[sl.id]?.id))
    const opp = buildTeam(shuffle(pool.filter((c) => !mine.has(c.id))).slice(0, 50))
    return { me, opp, names: { me: myName, opp: oppName || RIVALS[Math.floor(Math.random() * RIVALS.length)] } }
  }, [pool, myName, career, myTeam, oppName, pvpMatch])

  const { s, choose, fireUltimate, qte, rematch, reward, myPick, netWait, netError } = useMatchController(makeSetup)
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
  const myChoice = myPick // mon choix (affiché dès l'envoi en PvP)
  const live = s.meta?.pvp || null
  const oppLocked = !!c?.choices.opp
  const myRead = c && c.read != null ? (iAttack ? c.read : -c.read) : null
  const myAdv = c ? (iAttack ? c.adv : -c.adv) : 0
  const ultReady = ultimateReady(s) // Capacité Ultime jouable sur cette action ?
  const ult = c?.ultimate || null // Capacité Ultime déclenchée sur cette action
  const legend = useMemo(() => Object.values(s.teams.me).find((x) => x?.legend) || null, [s.teams.me])

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
      after(TIMING.clash * 0.4 + (c.ultimate ? TIMING.ultimate : 0), () => {
        bang(c.ultimate ? 'shake-ult' : Math.abs(c.adv) >= 1.5 ? 'shake-hard' : 'shake', c.ultimate ? 700 : 520)
        if (c.ultimate) fx.current?.burst({ ...frac(L.clash), colors: [c.ultimate.color, c.ultimate.color2, '#ffffff'], count: 160, speed: 15, kind: 'spark' })
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
          bang(c.ultimate ? 'shake-ult' : 'shake-hard', c.ultimate ? 800 : 650)
          const cols = c.ultimate && scorerMe ? [c.ultimate.color, c.ultimate.color2, '#ffffff'] : scorerMe ? [ME, '#ffffff', getBorderColor(c.attacker.rarity)] : [OPP, '#ffffff']
          fx.current?.burst({ ...frac(shot.to), colors: cols, count: 140, speed: 13, kind: 'spark' })
          if (scorerMe) after(150, () => {
            fx.current?.burst({ x: 0.1, y: 0.55, colors: cols, count: 90, speed: 14, kind: 'confetti', angle: -Math.PI * 0.32, spread: Math.PI * 0.4 })
            fx.current?.burst({ x: 0.9, y: 0.55, colors: cols, count: 90, speed: 14, kind: 'confetti', angle: -Math.PI * 0.68, spread: Math.PI * 0.4 })
          })
        } else if (k === 'save') {
          bang(c.ultimate ? 'shake-ult' : 'shake', c.ultimate ? 700 : 380)
          if (c.ultimate) fx.current?.burst({ ...frac(shot.to), colors: [c.ultimate.color, c.ultimate.color2, '#ffffff'], count: 120, speed: 12, kind: 'spark' })
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
    const onKey = (e) => {
      if ((e.key === 'u' || e.key === 'U') && ultReady) { fireUltimate(); return }
      const i = ['1', '2', '3'].indexOf(e.key); if (i >= 0) choose(ids[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.phase, myChoice, iAttack, choose, ultReady, fireUltimate])

  // QTE d'une Ultime : impact violent au moment de la frappe / de l'arrêt
  const onQte = useCallback((q) => {
    if (c?.ultimate && q !== 'miss') {
      setShake('shake-ult')
      setTimeout(() => setShake(''), 700)
      fx.current?.burst({ x: 0.5, y: 0.82, colors: [c.ultimate.color, c.ultimate.color2, '#ffffff'], count: 90, speed: 13, kind: 'spark' })
    }
    qte(q)
  }, [c, qte])

  const zoom = s.phase === 'clash' || s.phase === 'qte'
  const ultFx = ult && (s.phase === 'clash' || s.phase === 'qte' || s.phase === 'outcome')
  const stageCls = ['mx-stage', shake, ultFx ? 'ult' : '', danger && !myChoice ? 'danger' : '', s.phase === 'outcome' && c?.result?.kind === 'goal' ? (iAttack ? 'goal-me' : 'goal-opp') : ''].filter(Boolean).join(' ')

  return (
    <div ref={stageRef} className={stageCls} style={{ '--me': ME, '--opp': OPP, '--u1': ult?.color, '--u2': ult?.color2 }}>
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
            {s.phase === 'outcome' && shot && <Ball shot={shot} start={L.ball} color={ult ? ult.color : getBorderColor(c.attacker.rarity)} fire={!!ult} />}
          </>
        )}
      </div>

      <PackFx ref={fx} ambient="rgba(255,255,240,.6)" />
      <Hud s={s} />
      <TopBar home={career ? 'carriere' : 'jouer'} />

      {s.phase === 'kickoff' && <Kickoff s={s} />}
      {s.phase === 'shootout' && <Banner title="Tirs au but" sub="Mort subite · chaque tir compte" />}
      {s.phase === 'intro' && c && <Intro c={c} iAttack={iAttack} shootout={s.shootout} focus={s.focus} />}
      {s.phase === 'outcome' && c?.result && <Callout c={c} iAttack={iAttack} />}
      {s.phase === 'fulltime' && <FullTime s={s} reward={reward} onRematch={live ? onAgain : rematch} />}
      {live && s.phase !== 'fulltime' && <LiveBadge live={live} />}
      {netWait && s.phase !== 'fulltime' && (
        <div className={'mx-netwait ' + netWait}><span className="mx-dots"><i /><i /><i /></span>{netWait === 'qte' ? `${live?.opp?.name || 'L\'adversaire'} tente sa chance…` : `En attente de ${live?.opp?.name || 'l\'adversaire'}…`}</div>
      )}
      {netError && <div className="mx-netwait err">Connexion instable : {netError}</div>}
      {notice && s.phase === 'kickoff' && <div className="mx-notice">{notice}</div>}
      {s.phase === 'clash' && ult && (
        <UltimateCutscene key={'u' + s.idx} ult={ult} look={legend?.look} number={legend?.number} name={legend?.name}
          caption={iAttack ? 'Capacité Ultime' : 'Capacité Ultime · Défense'} />
      )}

      <div className="mx-dock">
        {s.phase === 'choose' && c && (
          <ChoiceDock key={'d' + s.idx} c={c} iAttack={iAttack} myChoice={myChoice} oppLocked={oppLocked} danger={danger}
            stamina={s.stamina.me[c.attacker.id] ?? 100} onChoose={choose} ult={ultReady} onUltimate={fireUltimate} />
        )}
        {s.phase === 'clash' && c && <Verdict c={c} iAttack={iAttack} myRead={myRead} myAdv={myAdv} />}
        {s.phase === 'qte' && c && <Verdict c={c} iAttack={iAttack} myRead={myRead} myAdv={myAdv} compact />}
        {s.phase === 'qte' && c && <QteBar key={'q' + s.idx} qte={c.qte} iAttack={iAttack} onHit={onQte} ult={ult} />}
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
function Ball({ shot, start, color, fire }) {
  const dur = shot.a === 'force' ? 420 : shot.a === 'lob' ? 650 : 540
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`mx-ball ${shot.a}${i ? ' ghost' : ''}${fire ? ' fire' : ''}`}
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
function ChoiceDock({ c, iAttack, myChoice, oppLocked, danger, stamina, onChoose, ult, onUltimate }) {
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
      {(ult || c.ultimate) && (
        <button className={'mx-ult' + (c.ultimate ? ' fired' : myChoice ? ' dim' : '')} style={{ '--u1': (ult || c.ultimate).color, '--u2': (ult || c.ultimate).color2 }}
          onClick={onUltimate} disabled={!!myChoice}>
          <span className="mx-ult-k">U</span>
          <span className="mx-ult-t"><small>Capacité Ultime · 1 fois par match</small><b>{(ult || c.ultimate).name}</b></span>
          <span className="mx-ult-go">{c.ultimate ? 'Activée' : 'Déclencher'}</span>
        </button>
      )}
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
function QteBar({ qte, iAttack, onHit, ult }) {
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
    <div className={'mx-qte' + (ult ? ' epic' : '')} onPointerDown={strike}>
      <div className="mx-qte-title">{ult ? ult.name : iAttack ? 'Frappe !' : 'Réflexe !'} <small>{iAttack ? 'Tape quand le curseur est dans la zone' : 'Arrête-la au bon moment'}</small></div>
      <div className="mx-qte-track">
        <div className="mx-qte-zone" style={{ left: `${(qte.center - qte.zone / 2) * 100}%`, width: `${qte.zone * 100}%` }}><i /></div>
        <div className={'mx-qte-cursor' + (hit ? ' stop ' + hit.q : '')} style={hit ? { left: `${hit.p * 100}%` } : { animationDuration: `${qte.period}ms` }}>
          {ult && <i className="mx-qte-fire" />}
        </div>
      </div>
      <button className="mx-hit" type="button">{iAttack ? 'Frapper' : 'Arrêter'} <kbd>Espace</kbd></button>
    </div>
  )
}

// ---------- Overlays ----------
// Match contre un vrai joueur : badge "en direct" avec son nom et son niveau
function LiveBadge({ live }) {
  return (
    <div className="mx-live" title="Match contre un vrai joueur">
      <i className="mx-live-dot" />En direct
      {live.opp?.avatar ? <img src={live.opp.avatar} alt="" /> : null}
      <b>{live.opp?.name}</b>{live.opp?.elo ? <small>{live.opp.elo} elo</small> : null}
    </div>
  )
}
function Kickoff({ s }) {
  const row = (t) => SLOTS.map((sl) => t[sl.id]).filter(Boolean)
  return (
    <div className="mx-over mx-kickoff">
      <div className="mx-ko-kicker">{s.meta?.pvp ? 'Joueur contre joueur · en direct' : 'Coup d\'envoi · 6 actions clés'}</div>
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
function Intro({ c, iAttack, shootout, focus }) {
  const you = focus && (c.side === 'me' ? c.attacker.id === focus : c.keeper.id === focus)
  const sc = SCENARIOS[c.scenario]
  return (
    <div className="mx-over mx-intro">
      <div className="mx-intro-min">{shootout ? `Tir au but · série ${shootout.round}` : `${c.minute}'`}</div>
      <div className="mx-intro-title">{sc.title}</div>
      <div className={'mx-intro-who ' + c.side}>{you ? (iAttack ? 'Ton action : à toi de jouer' : 'Ton action : arrête-le') : iAttack ? 'À toi de frapper' : 'Défends ta cage'} <span>· {c.attacker.name}</span></div>
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
  if (c.ultimate) { t = c.ultimate.name; sub = iAttack ? 'Capacité Ultime : le gardien est pris de vitesse' : 'Capacité Ultime : rien ne passe' }
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
  if (s.meta?.career) return <CareerFullTime s={s} reward={reward} />
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
        {s.meta?.pvp && <small>contre {s.names.opp} · joueur réel</small>}
      </div>
      {s.forfeit === 'opp' && <div className="mx-near">{s.names.opp} a quitté le match : victoire par abandon.</div>}
      {s.forfeit === 'me' && <div className="mx-near">Tu as été absent trop longtemps : défaite par abandon.</div>}
      {reward?.disputed && <div className="mx-near">Les deux écrans n'ont pas donné le même score : match sans vainqueur.</div>}
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
            {reward?.pending && <span className="mx-chip">Enregistrement du match…</span>}
            {reward?.error && <span className="mx-chip">{reward.error}</span>}
            {win && reward && !reward.pending && !reward.error && !reward.booster && <span className="mx-chip">{reward.full ? 'Stock de boosters plein (10/10)' : 'Boosters de victoire du jour atteints'}</span>}
            {reward?.streak >= 2 && <span className="mx-chip hot">Série : {reward.streak} victoires</span>}
            {reward?.elo_delta != null && reward.elo_delta !== 0 && <span className={'mx-chip' + (reward.elo_delta > 0 ? ' hot' : '')}>{reward.elo_delta > 0 ? '+' : ''}{reward.elo_delta} elo</span>}
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
        <button className="mx-btn primary xl" onClick={onRematch} autoFocus>{s.meta?.pvp ? 'Nouveau match' : 'Rejouer'}</button>
        {reward?.booster && <button className="mx-btn gold" onClick={() => go('boosters')}>Ouvrir mon booster</button>}
        <button className="mx-btn ghost" onClick={() => go('team')}>Modifier mon équipe</button>
      </div>
    </div>
  )
}

// Fin d'un match de carrière : la note sur 10, l'XP, puis retour au vestiaire
function CareerFullTime({ s, reward }) {
  const win = s.winner === 'me'
  const r = reward?.career
  const pro = Object.values(s.teams.me).find((x) => x?.id === s.focus)
  const goals = s.history.filter((h) => h.side === 'me' && h.kind === 'goal' && h.scorer?.id === s.focus).length
  const back = (e, to = 'carriere') => warpTo(to, { color: '#f5c542', x: e.clientX, y: e.clientY })
  return (
    <div className={'mx-over mx-full ' + (win ? 'win' : 'lose')}>
      <div className="mx-full-res">{win ? 'Victoire' : 'Défaite'}</div>
      <div className="mx-full-score">
        <span>{s.score.me} <i>–</i> {s.score.opp}</span>
        {s.shootout && <small>{s.pens.me}-{s.pens.opp} aux tirs au but</small>}
        <small>{s.names.me} · {s.names.opp}</small>
      </div>
      <div className="mx-full-body">
        {pro && (
          <div className="mx-mvp">
            <div className="mx-mvp-card"><FoilCard card={pro} best plain /></div>
            <span>Ton match</span>
          </div>
        )}
        <div className="mx-full-side">
          {r?.rating != null && (
            <div className={'mx-rating ' + ratingTone(r.rating)}>
              <b>{r.rating.toFixed(1)}</b>
              <span>Note du match<small>{r.rating >= 8 ? 'Homme du match' : r.rating >= 7 ? 'Très bon match' : r.rating >= 6 ? 'Match correct' : 'Match difficile'}</small></span>
            </div>
          )}
          <div className="mx-stats">
            <div><b>{goals}</b><span>Tes buts</span></div>
            <div><b>{s.stats.reads}/{s.stats.actions}</b><span>Lectures gagnées</span></div>
            <div><b>{s.stats.perfect}</b><span>Timings parfaits</span></div>
            <div><b>{s.stats.ultimates || 0}</b><span>Capacité ultime</span></div>
          </div>
          <div className="mx-rewards">
            {r?.xp > 0 && <span className="mx-chip legend">+{r.xp} XP</span>}
            {r?.levels > 0 && <span className="mx-chip gold">Niveau {r.level} ! +{r.levels} point{r.levels > 1 ? 's' : ''} de compétence</span>}
            {r?.seasonOver && <span className="mx-chip hot">Dernier match de la saison</span>}
          </div>
        </div>
      </div>
      <div className="mx-full-cta">
        <button className="mx-btn primary xl" onClick={(e) => back(e)} autoFocus>Retour au vestiaire</button>
        {r?.levels > 0 && <button className="mx-btn gold" onClick={(e) => back(e, 'carriere-arbre')}>Dépenser mes points</button>}
      </div>
    </div>
  )
}
