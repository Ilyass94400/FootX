import { useState } from 'react'
import { go } from '../lib/useRoute'
import { getDiscordProfile, signOut } from '../lib/useSession'
import { useStock } from '../lib/boosterStock'
import CoinCounter from './CoinCounter'
import QuestToaster from './QuestToaster'
import { usePendingQuests } from '../lib/quests'
import { useCareer } from '../lib/career'

export const NAV = [
  { id: 'accueil', label: 'Accueil' },
  { id: 'match', label: 'Arène' },
  { id: 'ligue', label: 'Ligue' },
  { id: 'carriere', label: 'Carrière' },
  { id: 'boosters', label: 'Boosters' },
  { id: 'team', label: 'Équipe' },
  { id: 'marche', label: 'Marché' },
  { id: 'defis', label: 'Défis' },
]

// Pages existantes mais secondaires : seulement dans le menu
const EXTRA = [
  { id: 'collection', label: 'Collection' },
  { id: 'classement', label: 'Classement' },
]

// Pages pas encore faites, seulement dans le menu
const MORE = [
  { id: 'amis', label: 'Amis' },
  { id: 'wiki', label: 'Wiki' },
]

export default function Navbar({ session, route }) {
  const [open, setOpen] = useState(false)
  const { name, avatar } = getDiscordProfile(session)
  const stock = useStock()
  const pending = usePendingQuests() // récompenses de défis à récupérer → point rouge
  const career = useCareer()
  const mail = career?.unread || 0 // lettres non lues (Mode Carrière)

  const nav = (id) => { setOpen(false); go(id) }

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="logo" href="#/accueil">Foot<b>X</b></a>

        <nav className="nav-links">
          {NAV.map((n) => (
            <a key={n.id} href={'#/' + n.id} className={(route === n.id || (n.id === 'carriere' && route.startsWith('carriere')) ? 'active' : '') + ((n.id === 'defis' && pending) || (n.id === 'carriere' && mail) ? ' has-badge' : '')}>
              {n.label}
              {n.id === 'defis' && pending > 0 && <i className="nav-badge" aria-label={`${pending} récompense${pending > 1 ? 's' : ''} à récupérer`}>{pending}</i>}
              {n.id === 'carriere' && mail > 0 && <i className="nav-badge" aria-label={`${mail} lettre${mail > 1 ? 's' : ''} non lue${mail > 1 ? 's' : ''}`}>{mail}</i>}
            </a>
          ))}
        </nav>

        <div className="nav-right">
          <CoinCounter onClick={() => go('marche')} />
          <a className="nav-count" href="#/boosters" title="Boosters disponibles">{stock.n} <small>boosters</small></a>
          <button className="nav-user" onClick={() => setOpen(!open)} aria-label="Menu">
            {avatar ? <img src={avatar} alt="" /> : <span className="avatar">{name[0]}</span>}
            <span className="nav-user-name">{name}</span>
            <span className="burger">{open ? '×' : '≡'}</span>
            {pending > 0 && <i className="nav-badge burger-badge">{pending}</i>}
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
            <div className="menu-list">
              {[...NAV, ...EXTRA, ...MORE].map((n) => (
                <button key={n.id} onClick={() => nav(n.id)} className={route === n.id ? 'active' : ''}>
                  {n.label}
                  {n.id === 'defis' && pending > 0 && <i className="nav-badge inline">{pending}</i>}
                  {MORE.includes(n) && <em>bientôt</em>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <QuestToaster />
    </header>
  )
}
