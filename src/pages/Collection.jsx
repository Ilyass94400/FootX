import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { RARITIES, RARITY_LABEL, getBorderColor } from '../lib/rarity'
import PlayerCard from '../components/PlayerCard'

const PAGE_SIZE = 48

// Pour l'instant : catalogue complet filtrable.
// À faire : table "user_cards" (user_id, card_id, quantity) pour n'afficher que les cartes possédées.
export default function Collection() {
  const [cards, setCards] = useState([])
  const [rarity, setRarity] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      let q = supabase.from('cards').select('*', { count: 'exact' })
      if (rarity !== 'all') q = q.eq('rarity', rarity)
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
      const { data, count } = await q.order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (cancelled) return
      setCards(data || [])
      setCount(count || 0)
      setLoading(false)
    }
    const t = setTimeout(load, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [rarity, search, page])

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <div>
      <div className="page-head">
        <h1>Ma collection</h1>
        <p>{count} joueurs. Pour l'instant ça affiche tout le catalogue, pas encore tes cartes à toi.</p>
      </div>

      <div className="filters">
        <input
          className="search"
          placeholder="Chercher un joueur"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        />
        <div className="chips">
          <button className={rarity === 'all' ? 'chip on' : 'chip'} onClick={() => { setRarity('all'); setPage(0) }}>Toutes</button>
          {RARITIES.map((r) => (
            <button
              key={r}
              className={rarity === r ? 'chip on' : 'chip'}
              style={{ '--c': getBorderColor(r) }}
              onClick={() => { setRarity(r); setPage(0) }}
            >
              {RARITY_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="muted center">Chargement…</p>
      ) : cards.length === 0 ? (
        <p className="muted center">Aucun joueur trouvé.</p>
      ) : (
        <div className="card-grid">
          {cards.map((c) => <PlayerCard key={c.id} card={c} />)}
        </div>
      )}

      {pages > 1 && (
        <div className="pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>←</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>→</button>
        </div>
      )}
    </div>
  )
}
