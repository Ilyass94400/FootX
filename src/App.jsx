import './App.css'
import './transitions.css'
import { useEffect, useState } from 'react'
import { useSession, signOut } from './lib/useSession'
import { cloudBoot } from './lib/cloud'
import { LIVE } from './lib/economy'
import { useRoute } from './lib/useRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Hub from './pages/Hub'
import League from './pages/League'
import Defis from './pages/Defis'
import Carriere from './pages/Carriere'
import Boosters from './pages/Boosters'
import Collection from './pages/Collection'
import Marche from './pages/Marche'
import Classement from './pages/Classement'
import Match from './pages/Match'
import Team from './pages/Team'
import ComingSoon from './pages/ComingSoon'
import Amis from './pages/Amis'
import Wiki from './pages/Wiki'
import Jouer from './pages/Jouer'

const PAGES = {
  accueil: Hub,
  jouer: Jouer,
  ligue: League,
  defis: Defis,
  carriere: Carriere,
  'carriere-arbre': Carriere,
  'carriere-courrier': Carriere,
  'carriere-match': Match,
  vestiaire: Carriere, // ancien lien
  boosters: Boosters,
  collection: Collection,
  marche: Marche,
  classement: Classement,
  match: Match,
  team: Team,
  amis: Amis,
  wiki: Wiki,
}

// Connexion Discord obligatoire. Pour la couper en local : VITE_DISCORD_AUTH=false dans .env
const AUTH_ENABLED = import.meta.env.VITE_DISCORD_AUTH !== 'false'
const GUEST_SESSION = { guest: true, user: { user_metadata: { full_name: 'Invité' } } }

function App() {
  const realSession = useSession()
  const session = AUTH_ENABLED ? realSession : GUEST_SESSION
  const route = useRoute()

  // Sauvegarde en ligne : on charge la partie du joueur AVANT d'afficher le jeu
  const uid = session && !session.guest ? session.user?.id : null
  const [cloud, setCloud] = useState({ uid: null, status: 'idle', error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!LIVE || !uid) return
    let alive = true
    setCloud({ uid, status: 'loading', error: null })
    cloudBoot(session)
      .then(() => alive && setCloud({ uid, status: 'ready', error: null }))
      .catch((error) => alive && setCloud({ uid, status: 'error', error }))
    return () => { alive = false }
  }, [uid, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Chargement de la session
  if (session === undefined) {
    return <div className="splash">Chargement…</div>
  }

  // Pas connecté -> page de connexion Discord obligatoire
  if (!session) return <Login />

  if (LIVE && uid && (cloud.uid !== uid || cloud.status !== 'ready')) {
    if (cloud.status === 'error') return <CloudError error={cloud.error} onRetry={() => setAttempt((n) => n + 1)} />
    return <div className="splash"><div className="splash-sync"><i aria-hidden="true" />Chargement de ta partie…</div></div>
  }

  // sous-pages : #/collection/fc-barcelone, #/wiki/arene…
  const Page = PAGES[route] || PAGES[route.split('/')[0]] || ComingSoon

  return (
    <div className="app">
      <Navbar session={session} route={route} />
      <main className="page">
        {/* key = route : chaque écran rejoue son entrée (transition fluide, zéro écran blanc) */}
        <div className="route-view" key={route}>
          <Page session={session} route={route} />
        </div>
      </main>
      <footer className="footer">FootX — projet perso, aucun lien avec les clubs ou les ligues.</footer>
    </div>
  )
}

// Le serveur ne répond pas, ou la sauvegarde en ligne n'est pas encore installée
function CloudError({ error, onRetry }) {
  return (
    <div className="splash">
      <div className="cloud-err" role="alert">
        <h1>{error?.setup ? 'Sauvegarde en ligne pas encore prête' : 'Impossible de charger ta partie'}</h1>
        <p>{error?.setup
          ? 'Le serveur du jeu n\'est pas encore à jour. Réessaie dans quelques minutes.'
          : 'Vérifie ta connexion internet, puis réessaie. Ta progression est en sécurité sur le serveur.'}</p>
        {import.meta.env.DEV && error?.setup && <p className="cloud-dev">Dev : exécute supabase/migrations/20261110_sauvegarde.sql dans Supabase &gt; SQL Editor.</p>}
        <div className="cloud-btns">
          <button className="btn" onClick={onRetry}>Réessayer</button>
          <button className="btn ghost" onClick={() => signOut()}>Se déconnecter</button>
        </div>
      </div>
    </div>
  )
}

export default App
