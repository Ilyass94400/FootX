import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { getCatalogue } from '../lib/catalogue'
import { RARITIES, RARITY_LABEL, getBorderColor } from '../lib/rarity'
import { go } from '../lib/useRoute'
import PlayerCard from '../components/PlayerCard'

const PAGE_SIZE = 60
const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const rk = (c) => RANK[c.rarity?.toLowerCase()] || 0

const VIEWS = [
  { id: 'owned', label: 'Mes cartes' },
  { id: 'missing', label: 'Manquantes' },
  { id: 'all', label: 'Tout le catalogue' },
]

const SORTS = {
  rarity: { label: 'Rareté', fn: (a, b) => rk(b) - rk(a) || a.name.localeCompare(b.name) },
  name: { label: 'Nom', fn: (a, b) => a.name.localeCompare(b.name) },
  qty: { label: 'Doublons', fn: (a, b) => (b.qty || 0) - (a.qty || 0) || rk(b) - rk(a) },
}

// Cartes possédées par le joueur connecté (RLS : il ne voit que les siennes)
async function fetchOwned() {
  const owned = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('user_cards').select('card_id,quantity').range(from, from + 999)
    if (error) throw error
    data.forEach((r) => owned.set(String(r.card_id), r.quantity))
    if (data.length < 1000) break
  }
  return owned
}

export default function Collection({ session }) {
  const [catalogue, setCatalogue] = useState([])
  const [owned, setOwned] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [view, setView] = useState('owned')
  const [rarity, setRarity] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('rarity')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (session?.guest) { setLoading(false); return }
    Promise.all([getCatalogue(), fetchOwned()])
      .then(([cards, own]) => { setCatalogue(cards); setOwned(own) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [session])

  // On reset la pagination quand un filtre change
  useEffect(() => { setPage(0) }, [view, rarity, search, sort])

  const withQty = useMemo(
    () => catalogue.map((c) => ({ ...c, qty: owned.get(String(c.id)) || 0 })),
    [catalogue, owned]
  )

  // Stats globales et par rareté
  const stats = useMemo(() => {
    const s = { total: withQty.length, have: 0, cards: 0, by: {} }
    RARITIES.forEach((r) => { s.by[r] = { total: 0, have: 0 } })
    withQty.forEach((c) => {
      const r = c.rarity?.toLowerCase()
      if (s.by[r]) { s.by[r].total++; if (c.qty) s.by[r].have++ }
      if (c.qty) { s.have++; s.cards += c.qty }
    })
    return s
  }, [withQty])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withQty
      .filter((c) => view === 'all' || (view === 'owned' ? c.qty > 0 : c.qty === 0))
      .filter((c) => rarity === 'all' || c.rarity?.toLowerCase() === rarity)
      .filter((c) => !q || c.name?.toLowerCase().includes(q) || c.club?.toLowerCase().includes(q))
      .sort(SORTS[sort].fn)
  }, [withQty, view, rarity, search, sort])

  if (session?.guest) {
    return (
      <div>
        <div className="page-head"><h1>Ma collection</h1></div>
        <div className="notice">Connecte-toi avec Discord pour avoir ta propre collection.</div>
      </div>
    )
  }

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const shown = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const pct = stats.total ? Math.floor((stats.have / stats.total) * 100) : 0

  return (
    <div>
      <div className="page-head">
        <h1>Ma collection</h1>
        <p>{stats.have} / {stats.total} joueurs · {stats.cards} cartes au total</p>
      </div>

      <section className="completion">
        <div className="completion-main">
          <b>{pct}%</b>
          <span>complété</span>
          <div className="bar"><i style={{ width: pct + '%' }} /></div>
        </div>
        <div className="completion-rarities">
          {[...RARITIES].reverse().map((r) => {
            const { have, total } = stats.by[r]
            return (
              <button
                key={r}
                className={rarity === r ? 'on' : ''}
                style={{ '--c': getBorderColor(r) }}
                onClick={() => setRarity(rarity === r ? 'all' : r)}
              >
                <span>{RARITY_LABEL[r]}</span>
                <b>{have}<small>/{total}</small></b>
                <div className="bar"><i style={{ width: total ? (have / total) * 100 + '%' : 0 }} /></div>
              </button>
            )
          })}
        </div>
      </section>

      <div className="tabs">
        {VIEWS.map((v) => (
          <button key={v.id} className={'tab' + (view === v.id ? ' on' : '')} onClick={() => setView(v.id)}>
            {v.label}
            <small>{v.id === 'owned' ? stats.have : v.id === 'missing' ? stats.total - stats.have : stats.total}</small>
          </button>
        ))}
      </div>

      <div className="filters row">
        <input
          className="search"
          placeholder="Chercher un joueur ou un club"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="sort">
          Trier par
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </label>
        {rarity !== 'all' && (
          <button className="chip on" style={{ '--c': getBorderColor(rarity) }} onClick={() => setRarity('all')}>
            {RARITY_LABEL[rarity]} ×
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted center">Chargement…</p>
      ) : error ? (
        <div className="notice">Erreur : {error}. As-tu bien lancé le SQL dans Supabase ?</div>
      ) : list.length === 0 ? (
        <div className="empty">
          {view === 'owned' && stats.have === 0 ? (
            <>
              <p>Ta collection est vide pour l'instant.</p>
              <button className="btn" onClick={() => go('boosters')}>Ouvrir des boosters</button>
            </>
          ) : view === 'missing' && stats.have === stats.total ? (
            <p>Tu as tout. Respect.</p>
          ) : (
            <p className="muted">Aucune carte ne correspond.</p>
          )}
        </div>
      ) : (
        <div className="card-grid">
          {shown.map((c) => (
            <div key={c.id} className={'coll-card' + (c.qty ? '' : ' missing')}>
              <PlayerCard card={c} />
              {c.qty > 1 && <span className="dup">×{c.qty}</span>}
            </div>
          ))}
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
