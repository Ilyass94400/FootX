import './App.css'
import './transitions.css'
import { useSession } from './lib/useSession'
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

const PAGES = {
  accueil: Hub,
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
}

// Connexion Discord obligatoire. Pour la couper en local : VITE_DISCORD_AUTH=false dans .env
const AUTH_ENABLED = import.meta.env.VITE_DISCORD_AUTH !== 'false'
const GUEST_SESSION = { guest: true, user: { user_metadata: { full_name: 'Invité' } } }

function App() {
  const realSession = useSession()
  const session = AUTH_ENABLED ? realSession : GUEST_SESSION
  const route = useRoute()

  // Chargement de la session
  if (session === undefined) {
    return <div className="splash">Chargement…</div>
  }

  // Pas connecté -> page de connexion Discord obligatoire
  if (!session) return <Login />

  const Page = PAGES[route] || ComingSoon

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

export default App
