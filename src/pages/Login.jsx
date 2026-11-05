import DiscordButton from '../components/DiscordButton'
import Pitch from '../components/Pitch'

export default function Login() {
  return (
    <div className="login">
      <header className="login-top">
        <span className="logo">Foot<b>X</b></span>
      </header>

      <section className="login-hero">
        <Pitch className="login-pitch" />
        <h1>Ouvre des boosters,<br />chope les meilleurs joueurs.</h1>
        <p className="login-sub">
          Tous les joueurs des 5 grands championnats en cartes. Tu ouvres, tu collectionnes,
          tu revends tes doublons.
        </p>
        <DiscordButton big />
        <p className="login-note">On passe par Discord pour sauvegarder ta collection.</p>
      </section>

      <section className="rules">
        <h2>Les règles</h2>
        <ul>
          <li><b>10 cartes</b> par booster, dont au moins une Rare.</li>
          <li>Une Épique ou mieux garantie au plus tard au <b>20e booster</b>.</li>
          <li>Une Iconique garantie au plus tard au <b>200e booster</b>.</li>
          <li>Revends tes doublons sur le <b>marché des transferts</b>.</li>
        </ul>
      </section>
    </div>
  )
}
