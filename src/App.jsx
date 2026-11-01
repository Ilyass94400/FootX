import './App.css'
import { useSession } from './lib/useSession'
import { useRoute } from './lib/useRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Home from './pages/Home'
import Boosters from './pages/Boosters'
import Collection from './pages/Collection'
import Marche from './pages/Marche'
import Classement from './pages/Classement'
import ComingSoon from './pages/ComingSoon'

const PAGES = {
  accueil: Home,
  boosters: Boosters,
  collection: Collection,
  marche: Marche,
  classement: Classement,
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
        <Page session={session} route={route} />
      </main>
      <footer className="footer">FootX — projet perso, aucun lien avec les clubs ou les ligues.</footer>
    </div>
  )
}

export default App
