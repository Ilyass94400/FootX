import { useState } from 'react'
import { go } from '../lib/useRoute'
import { getDiscordProfile, signOut } from '../lib/useSession'
import { useStock } from '../lib/boosterStock'
import CoinCounter from './CoinCounter'
import QuestToaster from './QuestToaster'
import { usePendingQuests } from '../lib/quests'
import { useCareer } from '../lib/career'
import { useIncomingCount } from '../lib/friends'

export const NAV = [
  { id: 'accueil', label: 'Accueil' },
  { id: 'jouer', label: 'Jouer' }, // Arène, Ligue et Carrière réunies sur une page de choix
  { id: 'boosters', label: 'Boosters' },
  { id: 'team', label: 'Équipe' },
  { id: 'collection', label: 'Collection' },
  { id: 'marche', label: 'Marché' },
  { id: 'defis', label: 'Défis' },
]

// Modes de jeu regroupés sous « Jouer » (raccourcis dans le menu)
const MODES = [
  { id: 'match', label: 'Arène' },
  { id: 'ligue', label: 'Ligue' },
  { id: 'carriere', label: 'Carrière' },
]
const isPlay = (route) => route === 'jouer' || route === 'match' || route === 'ligue' || route.startsWith('ligue/') || route.startsWith('carriere')

// Pages existantes mais secondaires : seulement dans le menu
const EXTRA = [
  { id: 'amis', label: 'Amis' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'classement', label: 'Classement' },
]

// Pages pas encore faites, seulement dans le menu (aucune pour l'instant)
const MORE = []

export default function Navbar({ session, route }) {
  const [open, setOpen] = useState(false)
  const { name, avatar } = getDiscordProfile(session)
  const stock = useStock()
  const pending = usePendingQuests() // récompenses de défis à récupérer → point rouge
  const career = useCareer()
  const mail = career?.unread || 0 // lettres non lues (Mode Carrière)
  const invites = useIncomingCount(session) // demandes d'amis reçues

  const nav = (id) => { setOpen(false); go(id) }

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="logo" href="#/accueil">Foot<b>X</b></a>

        <nav className="nav-links">
          {NAV.map((n) => {
            const active = n.id === 'jouer' ? isPlay(route) : route === n.id || route.startsWith(n.id + '/')
            const badge = (n.id === 'defis' && pending) || (n.id === 'jouer' && mail)
            return (
              <a key={n.id} href={'#/' + n.id} className={(active ? 'active' : '') + (badge ? ' has-badge' : '') + (n.id === 'jouer' ? ' nav-play' : '')}>
                {n.id === 'jouer' && <PlayIcon />}
                {n.label}
                {n.id === 'defis' && pending > 0 && <i className="nav-badge" aria-label={`${pending} récompense${pending > 1 ? 's' : ''} à récupérer`}>{pending}</i>}
                {n.id === 'jouer' && mail > 0 && <i className="nav-badge" aria-label={`${mail} lettre${mail > 1 ? 's' : ''} non lue${mail > 1 ? 's' : ''} (Carrière)`}>{mail}</i>}
              </a>
            )
          })}
        </nav>

        <div className="nav-right">
          <CoinCounter onClick={() => go('marche')} />
          <a className="nav-count" href="#/boosters" title="Boosters disponibles">{stock.n} <small>boosters</small></a>
          <button className="nav-user" onClick={() => setOpen(!open)} aria-label="Menu">
            {avatar ? <img src={avatar} alt="" /> : <span className="avatar">{name[0]}</span>}
            <span className="nav-user-name">{name}</span>
            <span className="burger">{open ? '×' : '≡'}</span>
            {pending + invites > 0 && <i className="nav-badge burger-badge">{pending + invites}</i>}
          </button>
        </div>
      </div>

      {open && (
        <div className="menu">
          <div className="menu-inner">
            <div className="menu-profile">
              {avatar ? <img src={avatar} alt="" /> : <span className="avatar big">{name[0]}</span>}
              <div>
                <strong>{name}</strong>
                <small>{session.guest ? 'mode invité' : 'connecté via Discord'}</small>
              </div>
              {!session.guest && <button className="link" onClick={signOut}>déconnexion</button>}
            </div>
            <div className="menu-main">
              <div className="menu-modes" aria-label="Modes de jeu">
                <span>Jouer</span>
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => nav(m.id)} className={route === m.id || route.startsWith(m.id) ? 'active' : ''}>
                    {m.label}
                    {m.id === 'carriere' && mail > 0 && <i className="nav-badge inline">{mail}</i>}
                  </button>
                ))}
              </div>
              <div className="menu-list">
                {[...NAV, ...EXTRA, ...MORE].map((n) => (
                  <button key={n.id} onClick={() => nav(n.id)} className={(n.id === 'jouer' ? isPlay(route) : route === n.id) ? 'active' : ''}>
                    {n.label}
                    {n.id === 'defis' && pending > 0 && <i className="nav-badge inline">{pending}</i>}
                    {n.id === 'jouer' && mail > 0 && <i className="nav-badge inline">{mail}</i>}
                    {n.id === 'amis' && invites > 0 && <i className="nav-badge inline">{invites}</i>}
                    {MORE.includes(n) && <em>bientôt</em>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <QuestToaster />
    </header>
  )
}

function PlayIcon() {
  return <svg className="nav-play-ico" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" /></svg>
}
