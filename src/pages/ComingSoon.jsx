import { go } from '../lib/useRoute'

export default function ComingSoon({ route }) {
  return (
    <div className="coming">
      <h1>Pas encore là</h1>
      <p className="muted">La page « {route} » est en cours. Reviens plus tard.</p>
      <button className="btn" onClick={() => go('accueil')}>Retour à l'accueil</button>
    </div>
  )
}
