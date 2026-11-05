import { useState } from 'react'
import { go } from '../lib/useRoute'
import { getDiscordProfile, signOut } from '../lib/useSession'
import { useStock } from '../lib/boosterStock'
import CoinCounter from './CoinCounter'

export const NAV = [
  { id: 'accueil', label: 'Accueil' },
  { id: 'match', label: 'Arène' },
  { id: 'ligue', label: 'Ma Ligue' },
  { id: 'boosters', label: 'Boosters' },
  { id: 'team', label: 'Mon équipe' },
  { id: 'marche', label: 'Marché' },
  { id: 'collection', label: 'Collection' },
]

// Pages existantes mais secondaires : seulement dans le menu
const EXTRA = [
  { id: 'classement', label: 'Classement' },
]

// Pages pas encore faites, seulement dans le menu
const MORE = [
  { id: 'missions', label: 'Missions' },
  { id: 'amis', label: 'Amis' },
  { id: 'wiki', label: 'Wiki' },
]

export default function Navbar({ session, route }) {
  const [open, setOpen] = useState(false)
  const { name, avatar } = getDiscordProfile(session)
  const stock = useStock()

  const nav = (id) => { setOpen(false); go(id) }

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="logo" href="#/accueil">Foot<b>X</b></a>

        <nav className="nav-links">
          {NAV.map((n) => (
            <a key={n.id} href={'#/' + n.id} className={route === n.id ? 'active' : ''}>
              {n.label}
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
                  {MORE.includes(n) && <em>bientôt</em>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
