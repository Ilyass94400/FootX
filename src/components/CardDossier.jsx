import { useEffect, useState } from 'react'
import { go } from '../lib/useRoute'
import { RARITY_LABEL, getBorderColor } from '../lib/rarity'
import { FEATURED_RATES, FILLER_RATES } from '../lib/drops'
import { RARITY_ECO, fmtCoins, COIN } from '../lib/economy/config'
import { cardRating, roleOf } from '../lib/collectif'
import { TRAITS, getTraits } from '../lib/traits'
import { clubKey, normRarity } from '../lib/collection'
import { value } from '../lib/cards'
import { crestUrl } from '../lib/career/crest'
import { playerProfile, ageOf } from '../lib/playerBio'
import HeroCard from './HeroCard'
import './dossier.css'

// ================================================================== LA FICHE (recto : la carte · verso : le joueur)
export default function CardDossier({ c, n, onClose }) {
  const [flipped, setFlipped] = useState(false)
  const [bio, setBio] = useState({ state: 'idle' })
  const r = normRarity(c.rarity)
  const turn = () => {
    setFlipped((f) => !f)
    if (bio.state === 'idle' || bio.state === 'error') {
      setBio({ state: 'loading' })
      playerProfile(c).then((v) => setBio(v.status === 'ok' ? { state: 'ok', data: v.data } : { state: 'none' })).catch(() => setBio({ state: 'error' }))
    }
  }
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); turn() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wd" onClick={onClose} role="dialog" aria-label={c.name}>
      <button className="wd-x" onClick={onClose} aria-label="Fermer">×</button>
      <div className={'wd-flip' + (flipped ? ' flipped' : '')} onClick={(e) => e.stopPropagation()} style={{ '--rc': getBorderColor(r) }}>
        <div className="wd-inner">
          <section className="wd-face wd-front" aria-hidden={flipped}>
            <CardSide c={c} n={n} r={r} onTurn={turn} />
          </section>
          <section className="wd-face wd-back" aria-hidden={!flipped}>
            <PlayerSide c={c} r={r} bio={bio} onTurn={turn} />
          </section>
        </div>
      </div>
    </div>
  )
}

const rateOf = (r) => {
  const f = FEATURED_RATES.find(([k]) => k === r)?.[1] || 0
  const g = FILLER_RATES.find(([k]) => k === r)?.[1] || 0
  return { f, g }
}
const pct = (x) => `${Math.round(x * 1000) / 10} %`.replace('.', ',')

function CardSide({ c, n, r, onTurn }) {
  const traits = getTraits(c)
  const eco = RARITY_ECO[r] || RARITY_ECO.commune
  const { f, g } = rateOf(r)
  const key = clubKey(c.club)
  return (
    <div className="wd-card-side">
      <button className="wd-bigcard" onClick={onTurn} aria-label="Retourner la carte pour voir le joueur">
        <HeroCard card={c} />
        <span className="wd-turn"><TurnIcon />Clique pour découvrir le joueur</span>
      </button>
      <div className="wd-info">
        <span className="wd-kicker" style={{ color: getBorderColor(r) }}>{RARITY_LABEL[r] || r} · Note {cardRating(c)}</span>
        <h2>{c.name}</h2>
        <dl className="wd-facts">
          <div><dt>Poste</dt><dd>{c.position || '—'}</dd></div>
          <div><dt>Club</dt><dd>{c.club ? <button className="wd-link" onClick={() => go('collection/' + key)}><img src={crestUrl(c.club)} alt="" />{c.club}</button> : '—'}</dd></div>
          <div><dt>Nationalité</dt><dd>{c.country || '—'}</dd></div>
          <div><dt>Ta collection</dt><dd className={n ? 'ok' : ''}>{n ? `${n} exemplaire${n > 1 ? 's' : ''}` : 'Pas encore'}</dd></div>
        </dl>
        <h3>Traits en match</h3>
        {traits.length ? (
          <ul className="wd-traits">{traits.map((t) => <li key={t} className={TRAITS[t].side}><b>{TRAITS[t].name}</b>{TRAITS[t].desc}</li>)}</ul>
        ) : <p className="wd-muted">Aucun trait : les cartes Communes n'en ont pas.</p>}
        <div className="wd-cols">
          <div><h3>Valeur sur le Marché</h3><p>Estimée à <b>{fmtCoins(value(c))}</b> {COIN}<br /><small>Fourchette de la rareté : {fmtCoins(eco.min)} à {fmtCoins(eco.max)} · vente rapide : {fmtCoins(eco.quicksell)}</small></p></div>
          <div><h3>Chance en booster</h3><p>{f ? <>Carte vedette : <b>{pct(f)}</b><br /></> : null}{g ? <>Complément : <b>{pct(g)}</b></> : null}{!f && !g && 'Uniquement en carte vedette garantie'}<br /><small>(chance d'obtenir cette rareté)</small></p></div>
        </div>
        <p className="wd-muted">Collectif : se lie avec les joueurs {c.club ? <>de <b>{c.club}</b></> : null}{c.club && c.country ? ' et ' : ''}{c.country ? <>de nationalité <b>{c.country}</b></> : null}.</p>
      </div>
    </div>
  )
}

// Style de jeu DANS FootX : poste + traits de la carte
const ROLE_TXT = { GK: 'un gardien', ATT: 'un attaquant', MID: 'un joueur de champ (défense ou milieu)', '?': 'un joueur polyvalent' }
const TRAIT_TXT = {
  puissance: 'une frappe lourde, redoutable quand il tire en force',
  sangfroid: 'un sang-froid rare face au but',
  dribbleur: 'des feintes de corps qui évitent les contre-pieds',
  mur: 'une présence physique qui réduit les chances adverses',
  reflexes: 'des réflexes qui coupent le temps de réaction des tireurs',
  lecture: 'une lecture du jeu qui devine les intentions adverses',
}
function gameStyle(c) {
  const t = getTraits(c)
  const role = ROLE_TXT[roleOf(c.position)]
  if (!t.length) return `Dans FootX, ${c.name} est ${role} sans trait particulier : sa force dépendra de ton collectif.`
  const parts = t.map((x) => TRAIT_TXT[x]).filter(Boolean)
  return `Dans FootX, ${c.name} est ${role} avec ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' et ' + parts.at(-1) : parts[0]}.`
}

function PlayerSide({ c, r, bio, onTurn }) {
  const d = bio.data
  const age = ageOf(d?.birth)
  const born = d?.birth ? new Date(d.birth).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <div className="wd-player">
      <header className="wd-ph">
        <button className="wd-mini" onClick={onTurn} aria-label="Revenir à la carte"><HeroCard card={c} tilt={false} /><span><TurnIcon /></span></button>
        <div>
          <span className="wd-kicker" style={{ color: getBorderColor(r) }}>Fiche du joueur</span>
          <h2>{d?.name || c.name}</h2>
          {d?.summary && <p className="wd-sum">{d.summary}</p>}
        </div>
      </header>

      {bio.state === 'loading' && <div className="wd-load"><span className="wd-spin" />Recherche de la fiche du joueur…</div>}
      {bio.state === 'error' && <p className="wd-muted">Impossible de joindre Wikipédia pour l'instant. <button className="wd-link" onClick={onTurn}>Réessayer</button></p>}
      {bio.state === 'none' && <p className="wd-muted">Aucune fiche publique trouvée pour ce joueur.</p>}

      {d && (
        <>
          <dl className="wd-facts four">
            <div><dt>Âge</dt><dd>{age != null ? `${age} ans` : '—'}{born && <small>{born}</small>}</dd></div>
            <div><dt>Taille</dt><dd>{d.height ? `${(d.height / 100).toFixed(2).replace('.', ',')} m` : '—'}</dd></div>
            <div><dt>Poste</dt><dd>{d.positions[0] || c.position || '—'}</dd></div>
            <div><dt>Nationalité</dt><dd>{d.nationality || c.country || '—'}</dd></div>
          </dl>
          {d.bio?.text && (
            <section>
              <h3>Biographie</h3>
              <p className="wd-bio">{d.bio.text}</p>
            </section>
          )}
          {d.clubs.length > 0 && (
            <section>
              <h3>Parcours en club</h3>
              <ol className="wd-career">
                {[...d.clubs].reverse().map((s, i) => (
                  <li key={i} className={!s.to && s.from ? 'now' : ''}>
                    <img src={crestUrl(s.team)} alt="" />
                    <span className="wd-team">{s.team}</span>
                    <span className="wd-years">{s.from ?? '?'} – {s.to ?? (s.from ? 'auj.' : '?')}</span>
                    {(s.apps != null || s.goals != null) && <span className="wd-stats">{s.apps != null ? `${s.apps} m.` : ''}{s.goals != null ? ` · ${s.goals} b.` : ''}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {d.national.length > 0 && (
            <section>
              <h3>En sélection</h3>
              <ul className="wd-nat">{d.national.map((s, i) => <li key={i}><b>{s.team}</b><span>{s.from ?? ''}{s.to ? ` – ${s.to}` : s.from ? ' – auj.' : ''}{s.apps != null ? ` · ${s.apps} sél.` : ''}{s.goals != null ? ` · ${s.goals} b.` : ''}</span></li>)}</ul>
            </section>
          )}
        </>
      )}

      <section>
        <h3>Style de jeu</h3>
        {d?.foot && <p className="wd-muted">Pied fort : <b>{d.foot}</b></p>}
        <p className="wd-bio">{gameStyle(c)}</p>
      </section>

      {d && (
        <p className="wd-src">
          Sources : {d.bio?.url && <><a href={d.bio.url} target="_blank" rel="noreferrer">Wikipédia</a> (CC BY-SA) · </>}<a href={d.wikidata} target="_blank" rel="noreferrer">Wikidata</a>. Les informations peuvent être incomplètes.
        </p>
      )}
      <button className="wd-return" onClick={onTurn}><TurnIcon />Revenir à la carte</button>
    </div>
  )
}

const TurnIcon = () => <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
