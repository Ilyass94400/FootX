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
          <li>Tous les <b>10 boosters</b>, une Épique ou mieux est garantie.</li>
          <li>Tous les <b>200 boosters</b>, une Iconique est garantie.</li>
          <li>Les doublons pourront être vendus au marché (bientôt).</li>
        </ul>
      </section>
    </div>
  )
}
