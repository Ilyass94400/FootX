import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TIERS } from '../../lib/career/clubs'
import { clubColors, crestUrl } from '../../lib/career/crest'
import { fmtWage, seasonLabel, contractEnd } from '../../lib/career/rules'
import { paper, sealCrack, stamp, pen, fanfare } from '../../lib/career/sfx'
import PackFx from '../PackFx'
import '../pack.css'
import './letter.css'

// ============================================================================
// La lettre : enveloppe cachetée → le sceau craque → le rabat s'ouvre → la
// lettre glisse et se déplie → le contrat. Signer = la plume écrit ton nom,
// puis le tampon s'écrase. Un club d'élite = enveloppe dorée, fanfare, paillettes.
//   phases : closed → opening → open → signing → stamped
// ============================================================================
const KIND_TITLE = { debut: 'Ton premier contrat professionnel', renewal: 'Proposition de prolongation', transfer: 'Proposition de transfert' }

function body(o, name) {
  if (o.kind === 'debut') return `Cher ${name},\n\nAprès tes années au centre de formation, le staff est unanime : ta place est chez les pros. Le club est heureux de te proposer ton premier contrat professionnel. Le maillot t'attend dans le vestiaire. À toi d'écrire la suite.`
  if (o.kind === 'renewal') return `Cher ${name},\n\nTa saison n'est pas passée inaperçue. Le club souhaite continuer l'aventure avec toi et te propose de prolonger ton contrat dans de meilleures conditions. Nous croyons en ton projet ici.`
  if (o.tier === 1) return `Cher ${name},\n\nNous suivons tes performances depuis plusieurs mois. Notre président, notre entraîneur et toute la direction sportive souhaitent faire de toi l'une des pièces maîtresses de notre projet. Peu de joueurs reçoivent cette lettre. Nous t'attendons.`
  if (o.tier === 2) return `Cher ${name},\n\nTon talent n'a échappé à personne. Nous voulons construire notre équipe autour de joueurs comme toi et te proposons de nous rejoindre dès cet été, avec un rôle à la hauteur de ton ambition.`
  return `Cher ${name},\n\nNotre club cherche un joueur capable de faire la différence. Tu as tout ce qu'il nous faut. Rejoins-nous : ici, tu auras du temps de jeu et la confiance de tout un vestiaire.`
}

export default function ContractLetter({ offer: o, playerName, season, onAnswer, onClose, autoOpen = false }) {
  const decided = ['accepted', 'declined', 'expired'].includes(o.status)
  const [phase, setPhase] = useState(decided || autoOpen ? 'opening' : 'closed')
  const [verdict, setVerdict] = useState(decided ? o.status : null)
  const fx = useRef(null)
  const gold = o.tier === 1 && o.kind !== 'renewal'
  const { primary, secondary } = clubColors(o.clubName)
  const timers = useRef([])
  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // ouverture : sceau → rabat → lettre
  useEffect(() => {
    if (phase !== 'opening') return
    if (decided) { setPhase('open'); return }
    sealCrack()
    later(380, () => paper())
    later(900, () => paper(true))
    later(1700, () => {
      setPhase('open')
      if (gold) {
        fanfare(true)
        fx.current?.burst({ x: 0.5, y: 0.3, colors: ['#f5c542', '#fff1b8', '#ffffff'], count: 160, speed: 12, kind: 'glitter', spread: Math.PI * 2 })
      }
    })
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (accept) => {
    if (phase !== 'open' || verdict) return
    if (accept) {
      setPhase('signing')
      pen()
      later(1100, () => {
        stamp()
        setVerdict('accepted'); setPhase('stamped')
        fanfare(gold)
        fx.current?.burst({ x: 0.5, y: 0.62, colors: gold ? ['#f5c542', '#fff1b8', '#ffffff'] : [primary, secondary, '#ffffff'], count: gold ? 200 : 120, speed: 14, kind: 'confetti' })
        onAnswer?.(o, true)
      })
    } else {
      stamp()
      setVerdict('declined'); setPhase('stamped')
      onAnswer?.(o, false)
    }
  }

  const yearTo = contractEnd(o.kind === 'debut' ? season + o.years - 1 : season + o.years)
  const tier = TIERS[o.tier]
  const showLetter = phase !== 'closed'
  return createPortal(
    <div className={'lt ' + phase + (gold ? ' gold' : '') + (verdict ? ' v-' + verdict : '')} style={{ '--c1': primary, '--c2': secondary }} role="dialog" aria-label={KIND_TITLE[o.kind]}>
      <div className="lt-bg" onClick={phase === 'closed' || phase === 'open' || phase === 'stamped' ? onClose : undefined} />
      {gold && <div className="lt-rays" aria-hidden="true" />}

      {/* ---------------- enveloppe */}
      <div className="lt-env" onClick={() => phase === 'closed' && setPhase('opening')}>
        <div className="lt-env-back" />
        <div className="lt-env-front"><span>{playerName}<small>Vestiaire · {o.clubName}</small></span></div>
        <div className="lt-env-flap" />
        <button className="lt-seal" aria-label="Ouvrir la lettre" onClick={(e) => { e.stopPropagation(); phase === 'closed' && setPhase('opening') }}>
          <img src={crestUrl(o.clubName, { tier: o.tier })} alt="" />
          <i className="lt-seal-crack" />
        </button>
        {gold && phase === 'closed' && <span className="lt-ribbon">Offre d'un géant</span>}
        {phase === 'closed' && <span className="lt-hint">Clique sur le sceau pour l'ouvrir</span>}
      </div>

      {/* ---------------- la lettre / le contrat */}
      {showLetter && (
        <article className="lt-paper">
          <div className="lt-fold" aria-hidden="true" />
          <header className="lt-head">
            <img src={crestUrl(o.clubName, { tier: o.tier })} alt="" />
            <div>
              <b>{o.clubName}</b>
              <span>Direction sportive · {o.kind === 'debut' ? 'Saison' : 'Mercato'} {seasonLabel(o.kind === 'debut' ? season : season + 1)}</span>
            </div>
            <em className="lt-tier">{'★'.repeat(tier?.stars || 2)}<small>{tier?.label}</small></em>
          </header>
          <h2>{KIND_TITLE[o.kind]}</h2>
          <p className="lt-body">{body(o, playerName)}</p>
          <dl className="lt-terms">
            <div><dt>Rôle</dt><dd>{o.role}</dd></div>
            <div><dt>Durée</dt><dd>{o.years} saison{o.years > 1 ? 's' : ''} <small>(jusqu'en {yearTo})</small></dd></div>
            <div className="hl"><dt>Salaire</dt><dd>{fmtWage(o.wage)} <small>/ semaine</small></dd></div>
            {o.bonus > 0 && <div className="hl"><dt>Prime à la signature</dt><dd>{fmtWage(o.bonus)}</dd></div>}
          </dl>
          <div className="lt-sign">
            <div><span className="lt-sig club">{o.clubName.split(' ').slice(-1)[0]}</span><small>Le Président</small></div>
            <div>
              <span className={'lt-sig me' + (phase === 'signing' || verdict === 'accepted' ? ' on' : '')}>{playerName}</span>
              <small>Le joueur</small>
            </div>
          </div>
          {verdict && <div className={'lt-stamp ' + verdict}>{verdict === 'accepted' ? 'Signé' : verdict === 'declined' ? 'Refusé' : 'Expiré'}</div>}
          <footer className="lt-actions">
            {phase === 'open' && !verdict && (
              <>
                {o.kind !== 'debut' && <button className="lt-btn no" onClick={() => answer(false)}>Refuser</button>}
                <button className="lt-btn yes" onClick={() => answer(true)}>{o.kind === 'debut' ? 'Signer mon premier contrat' : 'Signer le contrat'}</button>
              </>
            )}
            {(phase === 'stamped' || (decided && phase === 'open')) && <button className="lt-btn" onClick={onClose}>{verdict === 'accepted' && o.kind !== 'renewal' && !decided ? (o.kind === 'debut' ? 'Entrer au vestiaire' : 'Rejoindre mon nouveau club') : 'Fermer'}</button>}
          </footer>
        </article>
      )}
      {phase === 'closed' && <button className="lt-x" onClick={onClose} aria-label="Fermer">×</button>}
      <div className="lt-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </div>,
    document.body,
  )
}
