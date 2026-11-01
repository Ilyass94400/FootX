import { getDiscordProfile } from '../lib/useSession'

// Maquette : nécessite une table des collections par joueur pour un vrai classement.
export default function Classement({ session }) {
  const { name, avatar } = getDiscordProfile(session)
  const boosters = parseInt(localStorage.getItem('footx_booster_count') || '0')

  return (
    <div>
      <div className="page-head">
        <h1>Classement</h1>
        <p>Qui a la plus grosse collection.</p>
      </div>
      <div className="notice">Le vrai classement arrive quand les collections seront sauvegardées en ligne. Pour l'instant il n'y a que toi.</div>
      <div className="ranking">
        <div className="rank-row me">
          <span className="rank-pos">#—</span>
          {avatar ? <img src={avatar} alt="" /> : <span className="avatar">{name[0]}</span>}
          <strong>{name}</strong>
          <span className="muted">{boosters} boosters ouverts</span>
        </div>
      </div>
    </div>
  )
}
