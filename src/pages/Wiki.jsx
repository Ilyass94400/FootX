import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { RARITIES, RARITY_LABEL, getBorderColor } from '../lib/rarity'
import { fmtCoins } from '../lib/economy/config'
import { loadCatalogue, useOwned, normRarity } from '../lib/collection'
import { PAGE, SORTS, value, fetchPage } from '../lib/cards'
import HeroCard from '../components/HeroCard'
import CardDossier from '../components/CardDossier'
import './wiki.css'

// ============================================================================
// Le Wiki = l'encyclopédie de TOUTES les cartes du jeu.
//   clic sur une carte  → la carte en détail (rareté, traits, valeur, chances)
//   re-clic sur la carte → elle se retourne : la fiche du vrai joueur
//   #/wiki/<id>          ouvre directement la fiche d'une carte
// ============================================================================
export default function Wiki({ route = 'wiki' }) {
  const deepId = route.split('/')[1] || ''
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [rarity, setRarity] = useState('')
  const [club, setClub] = useState('')
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('footx_wiki_sort') || 'rarity_desc' } catch { return 'rarity_desc' } })
  const [clubs, setClubs] = useState([])
  const [list, setList] = useState([])
  const [total, setTotal] = useState(null)
  const [pg, setPg] = useState({ key: '', page: 0 })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  const owned = useOwned()

  useEffect(() => { loadCatalogue().then(setClubs) }, [])
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 280); return () => clearTimeout(t) }, [q])
  // la page repart à 0 dès qu'un filtre ou le tri change (sans requête périmée)
  const fkey = JSON.stringify([dq, rarity, club, sort])
  const page = pg.key === fkey ? pg.page : 0
  useEffect(() => { try { localStorage.setItem('footx_wiki_sort', sort) } catch { /* rien */ } }, [sort])

  // requête paginée côté serveur (tient la charge avec des milliers de cartes)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPage({ dq, rarity, club }, sort, page)
      .then(({ data, total: n }) => {
        if (!alive) return
        setList((l) => (page ? [...l, ...data] : data))
        setTotal(n)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [fkey, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // lien direct #/wiki/<id>
  useEffect(() => {
    if (!deepId) return
    let alive = true
    Promise.resolve(supabase.from('cards').select('*').eq('id', /^\d+$/.test(deepId) ? Number(deepId) : deepId).limit(1))
      .then(({ data }) => alive && data?.[0] && setOpen(data[0])).catch(() => {})
    return () => { alive = false }
  }, [deepId])

  const close = useCallback(() => setOpen(null), [])
  const clubNames = useMemo(() => [...clubs].sort((a, b) => a.name.localeCompare(b.name)), [clubs])
  const have = (c) => owned?.byCard.get(String(c.id)) || 0

  return (
    <div className="wk">
      <header className="wk-head">
        <div>
          <span className="wk-kicker">L'encyclopédie FootX</span>
          <h1>Wiki des joueurs</h1>
          <p>{total != null ? `${total.toLocaleString('fr-FR')} carte${total > 1 ? 's' : ''}` : 'Chargement…'} · clique sur une carte pour la voir en détail, puis clique encore dessus pour découvrir le joueur.</p>
        </div>
      </header>

      <div className="wk-tools">
        <input className="wk-search" placeholder="Chercher un joueur…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club">
          <option value="">Tous les clubs</option>
          {clubNames.map((c) => <option key={c.key} value={c.name}>{c.name}</option>)}
        </select>
        <label className="wk-sort">
          <span>Trier</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier les cartes">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="wk-rar">
        <button className={!rarity ? 'on' : ''} style={{ '--rc': '#e4ff3c' }} onClick={() => setRarity('')}><i />Toutes</button>
        {[...RARITIES].reverse().map((r) => (
          <button key={r} className={rarity === r ? 'on' : ''} style={{ '--rc': getBorderColor(r) }} onClick={() => setRarity(rarity === r ? '' : r)}><i />{RARITY_LABEL[r]}</button>
        ))}
      </div>

      <div className="wk-grid">
        {list.map((c, i) => (
          <button key={c.id} className="wk-card" style={{ '--i': i % PAGE, '--rc': getBorderColor(normRarity(c.rarity)) }} onClick={() => setOpen(c)} aria-label={c.name}>
            <HeroCard card={c} tilt={false} />
            {have(c) > 0 && <span className="wk-own" title="Dans ta collection">✓{have(c) > 1 ? ` ×${have(c)}` : ''}</span>}
            {sort.startsWith('price') && <span className="wk-price" title="Valeur estimée sur le Marché"><CoinDot />{fmtCoins(value(c))}</span>}
          </button>
        ))}
        {loading && Array.from({ length: page ? 6 : 12 }, (_, i) => <div key={'s' + i} className="wk-card skel" />)}
      </div>
      {!loading && !list.length && <p className="wk-empty">Aucune carte ne correspond.</p>}
      {!loading && total != null && list.length < total && (
        <button className="wk-more" onClick={() => setPg({ key: fkey, page: page + 1 })}>Afficher plus ({(total - list.length).toLocaleString('fr-FR')} restantes)</button>
      )}

      {open && <CardDossier c={open} n={have(open)} onClose={close} />}
    </div>
  )
}


const CoinDot = () => <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#f5c542" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#6b4a00" strokeWidth="1.6" strokeLinecap="round" /></svg>
