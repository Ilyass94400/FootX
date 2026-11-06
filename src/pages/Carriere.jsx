import { useEffect, useMemo, useRef, useState } from 'react'
import { useLegend } from '../lib/legend'
import { avatarUrl } from '../lib/legend/avatar'
import { TALENTS, POSITIONS } from '../lib/legend/config'
import { go } from '../lib/useRoute'
import { warpTo } from '../lib/warp'
import {
  useCareer, startCareer, playFixture, simulateFixture, closeSeason, openMessage, answerOffer, newSeason, resetCareer, CareerError,
} from '../lib/career'
import { loadClubs, findClub, TIERS } from '../lib/career/clubs'
import { clubColors, crestUrl } from '../lib/career/crest'
import { seasonLabel, fmtWage, ratingTone, contractEnd } from '../lib/career/rules'
import { mailDing, whistle, fanfare } from '../lib/career/sfx'
import { Academy, SkillLocker } from './Vestiaire'
import ContractLetter from '../components/career/ContractLetter'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './carriere.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Mode Carrière Solo « L'Ascension » : un seul joueur, toute une carrière.
//   #/carriere            le hub (vestiaire) : prochain match, saison, casier
//   #/carriere-arbre      l'arbre de compétences
//   #/carriere-courrier   la boîte de réception (contrats, offres du mercato)
//   #/carriere-match      le match (moteur de l'Arène)
// ============================================================================
export default function Carriere({ route }) {
  const [db, setDb] = useState(null)
  const c = useCareer()
  const player = useLegend()
  const [letter, setLetter] = useState(null)
  const [official, setOfficial] = useState(null)
  const [toast, setToast] = useState(null)
  const pendingOfficial = useRef(null)
  useEffect(() => { let alive = true; loadClubs().then((x) => alive && setDb(x)); return () => { alive = false } }, [])

  // dernière journée jouée → clôture de la saison et arrivée des offres
  useEffect(() => {
    if (!db?.clubs.length || !c || c.phase !== 'season' || !c.seasonOver) return
    const offers = closeSeason(db.clubs)
    if (offers) {
      mailDing()
      setToast({ key: Date.now(), title: 'Fin de saison !', text: `${offers.length} lettre${offers.length > 1 ? 's' : ''} dans ta boîte de réception` })
    }
  }, [db, c])

  const openLetter = (m) => { openMessage(m.id); setLetter(m) }
  const onAnswer = (o, accept) => {
    try { answerOffer(o.id, accept) } catch (e) { if (!(e instanceof CareerError)) throw e }
    if (accept && o.kind === 'transfer') pendingOfficial.current = o
  }
  const closeLetter = () => {
    setLetter(null)
    if (pendingOfficial.current) { setOfficial(pendingOfficial.current); pendingOfficial.current = null }
  }

  if (!db) return <div className="cr-load"><span className="cr-spin" />Ouverture du vestiaire…</div>
  if (!db.clubs.length) return <div className="cr-load">Aucun club trouvé dans la base de cartes.</div>

  let view
  if (!c) view = <Creation clubs={db.clubs} player={player} onStarted={(o) => setLetter(o)} />
  else if (route === 'carriere-arbre') view = <SkillLocker d={c.player} club={c.clubName} kicker={`L'Ascension · ${c.clubName}`} onBack={() => go('carriere')} />
  else if (route === 'carriere-courrier') view = <Inbox c={c} onOpen={openLetter} />
  else view = <Hub c={c} clubs={db.clubs} />

  return (
    <>
      {view}
      {letter && c && (
        <ContractLetter key={letter.id} offer={letter} playerName={c.player.name} season={c.season}
          autoOpen={letter.kind === 'debut'} onAnswer={onAnswer} onClose={closeLetter} />
      )}
      {official && <Official o={official} c={c} onDone={() => setOfficial(null)} />}
      {toast && (
        <button key={toast.key} className="cr-toast" onClick={() => { setToast(null); go('carriere-courrier') }} onAnimationEnd={(e) => e.animationName === 'cr-toast' && setToast(null)}>
          <MailIcon /><span><b>{toast.title}</b>{toast.text}</span>
        </button>
      )}
    </>
  )
}

// ================================================================== CRÉATION
function Creation({ clubs, player, onStarted }) {
  const [keep, setKeep] = useState(false)
  const [club, setClub] = useState(null)
  const [err, setErr] = useState('')
  const start = (form, cl) => {
    try { onStarted(startCareer({ form, club: cl, clubs })) } catch (e) { setErr(e.message) }
  }
  if (player && keep) {
    return (
      <div className="ac cr-keepflow" style={{ '--au': player.look?.aura }}>
        <header className="ac-head">
          <span className="vs-kicker">Mode Carrière · L'Ascension</span>
          <h1>Choisis ton club</h1>
          <p className="cr-sub">{player.name}, {player.pos.label.toLowerCase()} de niveau {player.level}. Où commence ton histoire ?</p>
        </header>
        <ClubPicker clubs={clubs} value={club} onPick={setClub} />
        {err && <p className="ac-err">{err}</p>}
        <div className="ac-nav">
          <button className="vs-btn ghost" onClick={() => setKeep(false)}>Retour</button>
          <button className="vs-btn big" disabled={!club} onClick={() => start(null, club)}>Recevoir mon premier contrat</button>
        </div>
      </div>
    )
  }
  return (
    <>
      {player && (
        <div className="cr-keep">
          <img src={avatarUrl(player.look, { number: player.number })} alt="" />
          <span>Tu as déjà un joueur : <b>{player.name}</b> (niveau {player.level}).</span>
          <button className="vs-btn ghost" onClick={() => setKeep(true)}>Le garder</button>
        </div>
      )}
      <Academy
        finalLabel="Recevoir mon premier contrat"
        extra={{
          label: 'Club',
          canNext: (f) => !!f.club,
          render: (f, set) => <ClubPicker clubs={clubs} value={f.club} onPick={(cl) => set({ club: cl })} />,
        }}
        onDone={(f) => start(f, f.club)}
      />
      {err && <p className="ac-err">{err}</p>}
    </>
  )
}

const TIER_PITCH = {
  1: 'Pression maximale : chaque match est une finale.',
  2: 'Un grand club exigeant, des supporters qui attendent tout de toi.',
  3: 'Le tremplin idéal pour se faire un nom.',
  4: 'Le chemin le plus long, la plus belle histoire.',
}
function ClubPicker({ clubs, value, onPick }) {
  const [q, setQ] = useState('')
  const [tier, setTier] = useState(0)
  const list = clubs.filter((cl) => (!tier || cl.tier === tier) && (!q || cl.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="cp">
      <div className="cp-bar">
        <input placeholder="Chercher un club…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cp-tiers">
          {[0, 1, 2, 3, 4].map((t) => <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{t ? TIERS[t].short : 'Tous'}</button>)}
        </div>
      </div>
      <div className="cp-grid">
        {list.map((cl) => (
          <button key={cl.key} className={'cp-club t' + cl.tier + (value?.key === cl.key ? ' on' : '')} style={{ '--c1': clubColors(cl.name).primary }} onClick={() => onPick(cl)}>
            <img src={cl.crest} alt="" />
            <b>{cl.name}</b>
            <small>{cl.country}</small>
            <span className="cp-stars" aria-label={TIERS[cl.tier].label}>{'★'.repeat(TIERS[cl.tier].stars)}<i>{'★'.repeat(5 - TIERS[cl.tier].stars)}</i></span>
          </button>
        ))}
        {!list.length && <p className="cp-empty">Aucun club ne correspond.</p>}
      </div>
      {value && <p className="cp-pitch"><b>{value.name}</b> · {TIERS[value.tier].label}. {TIER_PITCH[value.tier]}</p>}
    </div>
  )
}

// ================================================================== HUB (le vestiaire)
function Hub({ c, clubs }) {
  const me = findClub(clubs, c.clubKey) || { name: c.clubName, tier: 4, strength: 70, crest: crestUrl(c.clubName) }
  const p = c.player
  const colors = clubColors(c.clubName)
  const st = c.stats
  const last = [...c.fixtures].reverse().find((f) => f.result)
  const pos = POSITIONS.find((x) => x.id === p.position)
  const talent = TALENTS.find((t) => t.id === p.talent?.id) || p.talent

  return (
    <div className="cr" style={{ '--c1': colors.primary, '--c2': colors.secondary, '--au': p.look?.aura }}>
      <div className="cr-room" aria-hidden="true"><div className="cr-lockers" /><div className="cr-bench" /><div className="cr-light" /></div>
      <div className="cr-inner">
        <header className="cr-head">
          <img className="cr-head-crest" src={me.crest} alt="" />
          <div className="cr-head-t">
            <span className="cr-kicker">L'Ascension · Saison {seasonLabel(c.season)}</span>
            <h1 className={me.name.length > 14 ? 'long' : ''}>{me.name}</h1>
            <span className="cr-head-sub">{c.phase === 'mercato' ? 'Mercato d\'été' : `Journée ${Math.min(st.played + 1, st.total)} sur ${st.total}`} · {TIERS[me.tier]?.label}</span>
          </div>
          <div className="cr-head-r">
            <button className="cr-tile" onClick={() => go('carriere-arbre')}>
              <TreeIcon /><span><b>Arbre de compétences</b><small>{p.points > 0 ? `${p.points} point${p.points > 1 ? 's' : ''} à dépenser` : 'Améliore ton joueur'}</small></span>
              {p.points > 0 && <i className="cr-badge gold">{p.points}</i>}
            </button>
            <button className="cr-tile" onClick={() => go('carriere-courrier')}>
              <MailIcon /><span><b>Boîte de réception</b><small>{c.unread ? `${c.unread} nouvelle${c.unread > 1 ? 's' : ''} lettre${c.unread > 1 ? 's' : ''}` : 'Contrats et offres'}</small></span>
              {c.unread > 0 && <i className="cr-badge">{c.unread}</i>}
            </button>
          </div>
        </header>
        <PageHelp topic="carriere" />

        <div className="cr-grid">
          {/* ------------------------------------------------ le casier */}
          <section className="cr-locker">
            <div className="cr-tape">{p.name} · #{p.number}</div>
            <div className="cr-locker-in">
              <div className="cr-polaroid"><img src={avatarUrl(p.look, { number: p.number })} alt="" /><span>{pos?.label}</span></div>
              <Jersey name={p.name} number={p.number} c1={colors.primary} c2={colors.secondary} />
            </div>
            <div className="cr-ovr">
              <div className="cr-ring" style={{ '--pct': p.need ? (p.into / p.need) * 100 : 100 }}><b>{p.level}</b><small>niv</small></div>
              <div className="cr-ovr-t">
                <span>Note générale <b>{p.rating}</b></span>
                <span>{talent?.label}</span>
                <small>{p.need ? `${p.into} / ${p.need} XP` : 'Niveau maximum'}</small>
              </div>
            </div>
            <dl className="cr-contract">
              <div><dt>Rôle</dt><dd>{c.contract.role}</dd></div>
              <div><dt>Salaire</dt><dd>{fmtWage(c.contract.wage)}<small>/sem.</small></dd></div>
              <div><dt>Contrat</dt><dd>jusqu'en {contractEnd(c.contract.until)}</dd></div>
            </dl>
          </section>

          {/* ------------------------------------------------ le tableau noir */}
          <section className="cr-board">
            <BoardDoodles />
            {c.phase === 'season' && c.next && <NextMatch f={c.next} me={me} opp={findClub(clubs, c.next.oppKey)} c={c} clubs={clubs} />}
            {c.phase === 'mercato' && <Mercato c={c} clubs={clubs} me={me} />}
          </section>

          {/* ------------------------------------------------ les stats de la saison */}
          <section className="cr-clip">
            <div className="cr-clip-top"><i /></div>
            <h2>Ta saison</h2>
            <div className={'cr-avg ' + (st.played ? ratingTone(st.avg) : '')}>
              <b>{st.played ? st.avg.toFixed(1) : '–'}</b><span>Note moyenne</span>
            </div>
            <div className="cr-kpis">
              <div><b>{st.played}<small>/{st.total}</small></b><span>Matchs</span></div>
              <div><b>{st.goals}</b><span>Buts</span></div>
              <div><b>{st.wins}<small>V</small> {st.losses}<small>D</small></b><span>Bilan</span></div>
              <div><b>{st.points}</b><span>Points</span></div>
              <div><b>{st.motm}</b><span>Notes ≥ 8</span></div>
              <div><b>{st.best ? st.best.toFixed(1) : '–'}</b><span>Meilleure note</span></div>
            </div>
            <div className="cr-form"><span>Forme</span>{st.form.length ? st.form.map((x, i) => <i key={i} className={x === 'V' ? 'w' : 'l'}>{x}</i>) : <em>Aucun match joué</em>}</div>
            {last && (
              <div className={'cr-last ' + ratingTone(last.result.rating)}>
                <span>Dernier match · {last.oppName}</span>
                <b>{last.result.rating.toFixed(1)}</b>
              </div>
            )}
          </section>
        </div>

        <Calendar c={c} clubs={clubs} />
        {c.history.length > 0 && <History c={c} />}
        <div className="cr-foot">
          <button className="cr-reset" onClick={() => { if (window.confirm?.('Effacer ta carrière et ton joueur ?')) resetCareer() }}>Recommencer une carrière</button>
        </div>
      </div>
    </div>
  )
}

function NextMatch({ f, me, opp, c, clubs }) {
  const [busy, setBusy] = useState(false)
  const play = (e) => {
    playFixture(f.id)
    whistle()
    warpTo('carriere-match', { color: '#f5c542', x: e.clientX, y: e.clientY, label: 'Jour de match' })
  }
  const sim = () => { setBusy(true); setTimeout(() => { simulateFixture(f.id, clubs); setBusy(false) }, 650) }
  const home = f.home ? me : opp
  const away = f.home ? opp : me
  const pct = Math.round(((me.strength || 70) / ((me.strength || 70) + (opp?.strength || 70))) * 100)
  return (
    <div className={'cr-next' + (f.big ? ' big' : '')} key={f.id}>
      {f.big && <span className="cr-choc">Choc de la saison</span>}
      <span className="cr-chalk-k">Prochain match · Journée {f.round}/{c.fixtures.length}</span>
      <div className="cr-vs">
        <TeamBadge club={home} mine={home === me} />
        <span className="cr-vs-x">VS</span>
        <TeamBadge club={away} mine={away === me} />
      </div>
      <p className="cr-chalk">{f.home ? 'À domicile' : 'À l\'extérieur'} · {opp ? TIERS[opp.tier].label : ''}</p>
      <div className="cr-power" title="Rapport de force">
        <span>{me.strength}</span>
        <div><i style={{ width: pct + '%' }} /></div>
        <span>{opp?.strength ?? '–'}</span>
      </div>
      <div className="cr-cta">
        <button className="cr-play" onClick={play} disabled={busy}><WhistleIcon />Entrer sur le terrain</button>
        <button className="cr-sim" onClick={sim} disabled={busy}>{busy ? 'Simulation…' : 'Simuler (½ XP)'}</button>
      </div>
    </div>
  )
}

function TeamBadge({ club, mine }) {
  if (!club) return <div className="cr-team"><span className="cr-team-q">?</span></div>
  return (
    <div className={'cr-team' + (mine ? ' mine' : '')}>
      <img src={club.crest} alt="" />
      <b>{club.name}</b>
      {mine && <small>Ton club</small>}
    </div>
  )
}

function Mercato({ c, clubs, me }) {
  const signedClub = c.signed ? findClub(clubs, c.signed.clubKey) : null
  const fx = useRef(null)
  useEffect(() => {
    if (c.signed) fx.current?.burst({ x: 0.5, y: 0.35, colors: ['#f5c542', '#ffffff'], count: 60, speed: 8, kind: 'glitter' })
  }, [c.signed])
  return (
    <div className="cr-merc">
      <span className="cr-chalk-k">Saison {seasonLabel(c.season)} terminée</span>
      {c.signed ? (
        <>
          <img className="cr-merc-crest" src={signedClub?.crest || me.crest} alt="" />
          <h2 className="cr-chalk-t">{c.signed.moved ? 'Contrat signé !' : 'Prolongation signée !'}</h2>
          <p className="cr-chalk-club">{c.clubName}</p>
          <p className="cr-chalk">Jusqu'en {contractEnd(c.contract.until)} · {fmtWage(c.contract.wage)} / semaine</p>
          <button className="cr-play" onClick={() => { newSeason(clubs); fanfare(false) }}>Commencer la saison {seasonLabel(c.season + 1)}</button>
        </>
      ) : (
        <>
          <h2 className="cr-chalk-t">Mercato ouvert</h2>
          <p className="cr-chalk">{c.pendingOffers ? `${c.pendingOffers} offre${c.pendingOffers > 1 ? 's' : ''} t'attend${c.pendingOffers > 1 ? 'ent' : ''} dans ta boîte de réception.` : 'Aucune offre en attente.'}</p>
          <div className="cr-cta">
            <button className="cr-play" onClick={() => go('carriere-courrier')}><MailIcon />Ouvrir le courrier</button>
            <button className="cr-sim" onClick={() => newSeason(clubs)}>Rester à {me.name}</button>
          </div>
        </>
      )}
      <div className="cr-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </div>
  )
}

function Calendar({ c, clubs }) {
  return (
    <section className="cr-cal">
      <h2>Calendrier <small>Saison {seasonLabel(c.season)}</small></h2>
      <ol>
        {c.fixtures.map((f, i) => {
          const opp = findClub(clubs, f.oppKey)
          const r = f.result
          const cur = c.next?.id === f.id
          return (
            <li key={f.id} style={{ '--n': i }} className={(r ? (r.win ? 'w' : 'l') : '') + (cur ? ' cur' : '') + (f.big ? ' big' : '')}>
              <span className="cr-cal-j">J{f.round} · {f.home ? 'Dom.' : 'Ext.'}</span>
              <img src={opp?.crest || crestUrl(f.oppName)} alt="" />
              <b>{f.oppName}</b>
              {r ? (
                <span className="cr-cal-r"><em>{f.home ? `${r.gf}-${r.ga}` : `${r.ga}-${r.gf}`}</em><i className={ratingTone(r.rating)}>{r.rating.toFixed(1)}</i>{r.sim && <small>sim.</small>}</span>
              ) : <span className="cr-cal-r"><em>{cur ? 'À jouer' : '–'}</em></span>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function History({ c }) {
  return (
    <section className="cr-hist">
      <h2>Ta carrière</h2>
      <div className="cr-hist-t" role="table">
        <div role="row" className="h"><span>Saison</span><span>Club</span><span>Matchs</span><span>Buts</span><span>Note moy.</span></div>
        {c.history.map((h) => (
          <div role="row" key={h.season}><span>{seasonLabel(h.season)}</span><span><img src={crestUrl(h.clubName)} alt="" />{h.clubName}</span><span>{h.played}</span><span>{h.goals}</span><span className={ratingTone(h.avg)}>{h.avg.toFixed(2)}</span></div>
        ))}
      </div>
    </section>
  )
}

// ================================================================== BOÎTE DE RÉCEPTION
const SUBJECT = { debut: 'Ton premier contrat professionnel', renewal: 'Proposition de prolongation', transfer: 'Offre de transfert' }
const STATUS = { new: 'Nouveau', read: 'Lu', accepted: 'Signé', declined: 'Refusé', expired: 'Expiré' }
function Inbox({ c, onOpen }) {
  const list = useMemo(() => [...c.inbox].sort((a, b) => b.season - a.season || (b.at || 0) - (a.at || 0) || (a.kind === 'renewal') - (b.kind === 'renewal')), [c.inbox])
  return (
    <div className="cr cr-mail-page" style={{ '--c1': clubColors(c.clubName).primary }}>
      <div className="cr-room" aria-hidden="true"><div className="cr-lockers" /><div className="cr-light" /></div>
      <div className="cr-inner">
        <header className="cr-head">
          <div className="cr-head-t">
            <span className="cr-kicker">L'Ascension · {c.clubName}</span>
            <h1>Boîte de réception</h1>
            <span className="cr-head-sub">{c.phase === 'mercato' ? 'Mercato ouvert : signer une offre fait expirer les autres.' : 'Les offres arrivent à la fin de la saison.'}</span>
          </div>
          <div className="cr-head-r"><button className="vs-btn ghost" onClick={() => go('carriere')}>Retour au vestiaire</button></div>
        </header>
        <ul className="cr-mail">
          {list.map((m, i) => {
            const gold = m.tier === 1 && m.kind === 'transfer'
            return (
              <li key={m.id} style={{ '--i': i }}>
                <button className={'cr-mail-row s-' + m.status + (gold ? ' gold' : '')} onClick={() => onOpen(m)}>
                  <span className="cr-env"><img src={crestUrl(m.clubName, { tier: m.tier })} alt="" /></span>
                  <span className="cr-mail-t">
                    <b>{m.clubName}</b>
                    <span>{SUBJECT[m.kind]}{m.kind !== 'debut' && ` · ${fmtWage(m.wage)} / semaine`}</span>
                    <small>{m.kind === 'debut' ? `Saison ${seasonLabel(m.season)}` : `Mercato ${seasonLabel(m.season + 1)}`} · {TIERS[m.tier]?.label}</small>
                  </span>
                  {gold && m.status !== 'expired' && m.status !== 'declined' && <em className="cr-giant">Géant</em>}
                  <i className={'cr-st ' + m.status}>{STATUS[m.status]}</i>
                </button>
              </li>
            )
          })}
          {!list.length && <li className="cr-mail-empty">Aucune lettre pour le moment.</li>}
        </ul>
      </div>
    </div>
  )
}

// ================================================================== OFFICIEL (transfert signé)
function Official({ o, c, onDone }) {
  const fx = useRef(null)
  const { primary, secondary } = clubColors(o.clubName)
  useEffect(() => {
    fanfare(o.tier <= 2)
    const t1 = setTimeout(() => fx.current?.burst({ x: 0.5, y: 0.4, colors: [primary, secondary, '#f5c542', '#ffffff'], count: 220, speed: 15, kind: 'confetti' }), 500)
    const t2 = setTimeout(onDone, 4200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cr-off" style={{ '--c1': primary, '--c2': secondary }} onClick={onDone}>
      <div className="cr-off-stripes" />
      <span className="cr-off-k">Officiel</span>
      <img src={crestUrl(o.clubName, { tier: o.tier })} alt="" />
      <h2>{c?.player.name} rejoint {o.clubName}</h2>
      <p>{o.years} saisons · {fmtWage(o.wage)} / semaine · {o.role}</p>
      <PackFx ref={fx} ambient="rgba(0,0,0,0)" />
    </div>
  )
}

// ================================================================== DÉCORS
function Jersey({ name, number, c1, c2 }) {
  return (
    <svg className="cr-jersey" viewBox="0 0 140 170" aria-hidden="true">
      <path d="M70 6 L60 2 Q52 0 46 12 L44 18" fill="none" stroke="#7a6a50" strokeWidth="3" />
      <path d="M44 16 L14 30 L2 66 L26 74 L32 56 L32 162 L108 162 L108 56 L114 74 L138 66 L126 30 L96 16 Q84 28 70 28 Q56 28 44 16 Z" fill={c1} stroke="#0b0c08" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M14 30 L2 66 L26 74 L30 62 Z M126 30 L138 66 L114 74 L110 62 Z" fill={c2} opacity=".9" />
      <path d="M44 16 Q56 28 70 28 Q84 28 96 16" fill="none" stroke={c2} strokeWidth="5" />
      <text x="70" y="62" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="900" fontSize="15" letterSpacing="2" fill={c2}>{String(name).toUpperCase().slice(0, 12)}</text>
      <text x="70" y="128" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="900" fontSize="62" fill={c2} stroke="#0b0c08" strokeWidth="1.5">{number}</text>
      <path d="M32 56 L32 162 L108 162 L108 56" fill="url(#crj)" opacity=".25" />
      <defs><linearGradient id="crj" x1="0" x2="1"><stop offset="0" stopColor="#000" /><stop offset=".5" stopColor="#fff" stopOpacity=".2" /><stop offset="1" stopColor="#000" /></linearGradient></defs>
    </svg>
  )
}
function BoardDoodles() {
  return (
    <svg className="cr-doodles" viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="2.2" strokeLinecap="round">
        <rect x="14" y="14" width="372" height="232" rx="6" />
        <line x1="200" y1="14" x2="200" y2="246" /><circle cx="200" cy="130" r="34" />
        <rect x="14" y="80" width="46" height="100" /><rect x="340" y="80" width="46" height="100" />
        <path d="M84 196 q40 -60 96 -40" strokeDasharray="6 6" /><path d="M176 152 l8 6 -10 2" />
        <path d="M250 70 q50 10 70 50" /><path d="M316 112 l5 10 -11 -2" />
      </g>
      <g stroke="rgba(255,255,255,.22)" strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path d="M76 190 l12 12 M88 190 l-12 12" /><circle cx="248" cy="66" r="8" /><circle cx="120" cy="60" r="8" /><path d="M300 190 l12 12 M312 190 l-12 12" />
      </g>
    </svg>
  )
}
const MailIcon = () => <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true"><path d="M3 6h18v12H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M3 7l9 7 9-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
const TreeIcon = () => <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true"><circle cx="12" cy="4.5" r="2.5" fill="currentColor" /><circle cx="5" cy="19" r="2.5" fill="currentColor" /><circle cx="19" cy="19" r="2.5" fill="currentColor" /><circle cx="12" cy="13" r="2.5" fill="currentColor" /><path d="M12 7v3.5M10.3 14.8L6.6 17.3M13.7 14.8l3.7 2.5" stroke="currentColor" strokeWidth="2" /></svg>
const WhistleIcon = () => <svg viewBox="0 0 24 24" width="1.2em" height="1.2em" aria-hidden="true"><path d="M3 10h10l7-3v4l-3 1a6 6 0 1 1-14-2z" fill="currentColor" /><circle cx="9" cy="14" r="2" fill="#0b0c08" /></svg>
