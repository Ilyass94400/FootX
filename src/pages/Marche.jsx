import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import PlayerCard from '../components/PlayerCard'

// Maquette du marché : les annonces sont fictives tant que la table "market_listings" n'existe pas.
export default function Marche() {
  const [cards, setCards] = useState([])

  useEffect(() => {
    supabase.from('cards').select('*').in('rarity', ['epique', 'legendaire', 'iconique']).limit(8)
      .then(({ data }) => setCards(data || []))
  }, [])

  return (
    <div>
      <div className="page-head">
        <h1>Le marché</h1>
        <p>Vends tes doublons, enchéris sur ce qui te manque.</p>
      </div>

      <div className="notice">
        Le marché n'est pas encore ouvert. Les annonces en dessous sont là pour l'exemple, on peut rien acheter.
      </div>

      <div className="tabs">
        <button className="tab on">Ça se termine bientôt</button>
        <button className="tab">Nouvelles annonces</button>
        <button className="tab">Mes ventes</button>
      </div>

      <div className="market-grid">
        {cards.map((c, i) => (
          <div key={c.id} className="listing">
            <PlayerCard card={c} small />
            <div className="listing-info">
              <span className="price">{(i + 1) * 125} crédits</span>
              <small>{i % 3} enchère(s)</small>
              <button className="btn-line sm" disabled>Enchérir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
