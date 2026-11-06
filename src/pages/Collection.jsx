import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { go } from '../lib/useRoute'
import { RARITIES, RARITY_LABEL, getBorderColor } from '../lib/rarity'
import { loadCatalogue, loadClubCards, useOwned, normRarity, RARITY_RANK, pct, clubKey } from '../lib/collection'
import { PAGE, SORTS as CARD_SORTS, fetchPage, filterLocal, LOCAL_SORT } from '../lib/cards'
import CardDossier from '../components/CardDossier'
import { crestUrl, clubColors } from '../lib/career/crest'
import { suggestedPrice, fmtCoins } from '../lib/economy/config'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import '../components/pack.css'
import './collection.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Ma collection — un album par club.
//   #/collection              tous les clubs du jeu (progression de chacun)
//   #/collection/<club>       l'album du club : tous ses joueurs, possédés ou non
//   #/collection/mes-cartes   toutes mes cartes (doublons regroupés)
// ============================================================================
// ============================================================================
// Ma collection.
//   #/collection              toutes les cartes du jeu : les miennes d'abord,
//                             celles qui me manquent en grisé (tri et filtres)
//   #/collection/clubs        les albums de tous les clubs
//   #/collection/<club>       l'album d'un club
// En haut à droite : les grands clubs (cartes possédées / cartes du club).
// ============================================================================
const BIG = [
  { id: 'barca', label: 'FC Barcelone', alias: ['fc barcelone', 'fc barcelona', 'barcelona', 'barcelone', 'barca'] },
  { id: 'real', label: 'Real Madrid', alias: ['real madrid', 'real madrid cf'] },
  { id: 'psg', label: 'Paris SG', alias: ['paris saint germain', 'paris saint-germain', 'paris sg', 'psg'] },
  { id: 'bayern', label: 'Bayern Munich', alias: ['bayern munich', 'fc bayern munchen', 'bayern munchen', 'fc bayern', 'bayern'] },
  { id: 'city', label: 'Manchester City', alias: ['manchester city', 'man city'] },
]
function findBig(clubs, b) {
  const keys = b.alias.map(clubKey)
  return clubs.find((c) => keys.includes(c.key)) || clubs.find((c) => keys.some((k) => c.key.includes(k))) || null
}

export default function Collection({ route = 'collection' }) {
  const sub = route.split('/')[1] || ''
  const [clubs, setClubs] = useState(null)
  const [club, setClub] = useState('') // filtre club de la grille
  const owned = useOwned()
  useEffect(() => { let alive = true; loadCatalogue().then((c) => alive && setClubs(c)); return () => { alive = false } }, [])

  const totals = useMemo(() => {
    if (!clubs || !owned) return null
    const total = clubs.reduce((a, c) => a + c.total, 0)
    let have = 0; let complete = 0
    for (const c of clubs) { const n = owned.byClub.get(c.key)?.size || 0; have += Math.min(n, c.total); if (c.total && n >= c.total) complete++ }
    return { total, have, complete, clubs: clubs.length }
  }, [clubs, owned])

  const allView = !sub || sub === 'mes-cartes'
  const pickBig = (c) => {
    if (!c) return
    if (allView) setClub((cur) => (cur === c.name ? '' : c.name))
    else go('collection/' + c.key)
  }

  return (
    <div className="co">
      <header className="co-head">
        <div className="co-head-t">
          <span className="co-kicker">L'album FootX</span>
          <h1>Ma collection</h1>
          {totals ? (
            <div className="co-global">
              <div className="co-global-bar"><i style={{ width: Math.max(0.6, (totals.have / Math.max(1, totals.total)) * 100) + '%' }} /></div>
              <span><b>{totals.have.toLocaleString('fr-FR')}</b> / {totals.total.toLocaleString('fr-FR')} joueurs · <b>{totals.complete}</b> club{totals.complete > 1 ? 's' : ''} complété{totals.complete > 1 ? 's' : ''} sur {totals.clubs}</span>
            </div>
          ) : <div className="co-global skel" />}
          <nav className="co-tabs">
            <button className={allView ? 'on' : ''} onClick={() => go('collection')}>Toutes les cartes</button>
            <button className={!allView ? 'on' : ''} onClick={() => go('collection/clubs')}>Albums par club</button>
          </nav>
          <PageHelp topic="collection" />
        </div>
        <BigClubs clubs={clubs} owned={owned} active={allView ? club : (clubs?.find((c) => c.key === sub)?.name || '')} onPick={pickBig} />
      </header>

      {!clubs || !owned ? <Loading />
        : allView ? <AllCards owned={owned} clubs={clubs} club={club} setClub={setClub} initialShow={sub === 'mes-cartes' ? 'owned' : 'all'} />
          : sub === 'clubs' ? <ClubIndex clubs={clubs} owned={owned} />
            : <ClubAlbum club={clubs.find((c) => c.key === sub)} owned={owned} />}
    </div>
  )
}

// Les grands clubs, en haut à droite
function BigClubs({ clubs, owned, active, onPick }) {
  return (
    <aside className="co-big" aria-label="Grands clubs">
      <h2>Grands clubs</h2>
      <ul>
        {BIG.map((b) => {
          const c = clubs ? findBig(clubs, b) : null
          const have = c && owned ? Math.min(owned.byClub.get(c.key)?.size || 0, c.total) : 0
          const total = c?.total || 0
          const done = total > 0 && have >= total
          return (
            <li key={b.id}>
              <button className={(active && c && active === c.name ? 'on' : '') + (done ? ' done' : '') + (!c && clubs ? ' off' : '')} disabled={!c} onClick={() => onPick(c)}
                title={c ? `${c.name} : ${have} / ${total}` : `${b.label} n'est pas dans le jeu`} style={{ '--p': total ? (have / total) * 100 : 0, '--c1': clubColors(c?.name || b.label).primary }}>
                <img src={crestUrl(c?.name || b.label, { tier: done ? 1 : 2 })} alt="" />
                <span className="co-big-t"><b>{b.label}</b><i><em style={{ width: (total ? (have / total) * 100 : 0) + '%' }} /></i></span>
                <span className="co-big-n">{clubs ? (c ? <><b>{have}</b>/{total}</> : '—') : '…'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}


function Loading() {
  return <div className="co-grid clubs">{Array.from({ length: 12 }, (_, i) => <div key={i} className="co-club skel" />)}</div>
}

// ================================================================== TOUS LES CLUBS (albums)
const SORTS = { progress: 'Progression', name: 'Nom (A → Z)', size: 'Nombre de joueurs', missing: 'Presque complets' }
const STEP = 60
function ClubIndex({ clubs, owned }) {
  const [q, setQ] = useState('')
  const [country, setCountry] = useState('')
  const [sort, setSort] = useState('progress')
  const [mine, setMine] = useState(false)
  const [shown, setShown] = useState(STEP)
  const countries = useMemo(() => {
    const n = {}
    for (const c of clubs) if (c.country) n[c.country] = (n[c.country] || 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [clubs])
  const list = useMemo(() => {
    const have = (c) => owned.byClub.get(c.key)?.size || 0
    const ql = q.trim().toLowerCase()
    const l = clubs.filter((c) => (!ql || c.name.toLowerCase().includes(ql)) && (!country || c.country === country) && (!mine || have(c) > 0))
    const by = {
      progress: (a, b) => have(b) / b.total - have(a) / a.total || have(b) - have(a) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.total - a.total || a.name.localeCompare(b.name),
      missing: (a, b) => {
        const ma = a.total - have(a); const mb = b.total - have(b)
        const ka = have(a) && ma ? ma : 1e9; const kb = have(b) && mb ? mb : 1e9
        return ka - kb || a.name.localeCompare(b.name)
      },
    }
    return l.sort(by[sort])
  }, [clubs, owned, q, country, sort, mine])
  useEffect(() => setShown(STEP), [q, country, sort, mine])

  return (
    <>
      <div className="co-tools">
        <input className="co-search" placeholder="Chercher un club (ex. Barça, Lens…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Pays">
          <option value="">Tous les pays</option>
          {countries.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className={'co-toggle' + (mine ? ' on' : '')}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /><i />Mes clubs</label>
      </div>
      <p className="co-count">{list.length} club{list.length > 1 ? 's' : ''}</p>
      <div className="co-grid clubs">
        {list.slice(0, shown).map((c, i) => <ClubTile key={c.key} c={c} have={owned.byClub.get(c.key)?.size || 0} i={i} />)}
      </div>
      {!list.length && <p className="co-empty">Aucun club ne correspond. {mine && 'Ouvre des boosters pour commencer ta collection !'}</p>}
      {shown < list.length && <button className="co-more" onClick={() => setShown((n) => n + STEP)}>Afficher plus de clubs ({list.length - shown})</button>}
    </>
  )
}

function ClubTile({ c, have, i }) {
  const p = pct(Math.min(have, c.total), c.total)
  const done = c.total > 0 && have >= c.total
  const { primary, secondary } = clubColors(c.name)
  return (
    <button className={'co-club' + (done ? ' done' : have ? ' started' : '')} style={{ '--c1': primary, '--c2': secondary, '--i': Math.min(i, 24) }} onClick={() => go('collection/' + c.key)}>
      <span className="co-club-bg" aria-hidden="true" />
      <img src={crestUrl(c.name)} alt="" loading="lazy" />
      <span className="co-club-t">
        <b>{c.name}</b>
        <small>{c.country || 'Pays inconnu'}</small>
      </span>
      <span className="co-club-p">
        <span className="co-bar"><i style={{ width: p + '%' }} /></span>
        <span className="co-club-n"><b>{Math.min(have, c.total)}</b>/{c.total}<em>{p} %</em></span>
      </span>
      {done && <span className="co-done">Complet</span>}
    </button>
  )
}

// ================================================================== L'ALBUM D'UN CLUB
const FILTERS = { all: 'Tous', owned: 'Possédés', missing: 'Manquants' }
const worth = (c) => suggestedPrice(c).buyNow // valeur estimée sur le Marché
const POS_ORDER = (p) => ({ GK: 0, MID: 1, ATT: 2 })[/^(gb|g|gk)/i.test(p || '') ? 'GK' : /^(att|bu|st|cf|lw|rw|fw)/i.test(p || '') ? 'ATT' : 'MID']
function ClubAlbum({ club, owned }) {
  const [cards, setCards] = useState(null)
  const [filter, setFilter] = useState('all')
  const [rarity, setRarity] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('rarity')
  const [open, setOpen] = useState(null)
  const closeOpen = useCallback(() => setOpen(null), [])
  const fx = useRef(null)
  useEffect(() => {
    if (!club) return
    let alive = true
    loadClubCards(club.name).then((c) => alive && setCards(c))
    return () => { alive = false }
  }, [club])

  const have = (c) => owned.byCard.get(String(c.id)) || 0
  const ALBUM_SORT = {
    price_desc: (a, b) => worth(b) - worth(a), price_asc: (a, b) => worth(a) - worth(b),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    position: (a, b) => POS_ORDER(a.position) - POS_ORDER(b.position) || String(a.name).localeCompare(String(b.name)),
    owned: (a, b) => (have(b) ? 1 : 0) - (have(a) ? 1 : 0),
  }
  const stats = useMemo(() => {
    if (!cards) return null
    const r = {}
    for (const c of cards) {
      const k = normRarity(c.rarity)
      r[k] ||= { total: 0, have: 0 }
      r[k].total++
      if (owned.byCard.get(String(c.id))) r[k].have++
    }
    const n = cards.filter((c) => owned.byCard.get(String(c.id))).length
    return { rarities: r, have: n, total: cards.length, done: cards.length > 0 && n === cards.length }
  }, [cards, owned])

  // album complété : pluie dorée à l'ouverture
  useEffect(() => {
    if (!stats?.done) return
    const t = setTimeout(() => fx.current?.burst({ x: 0.5, y: 0.2, colors: ['#f5c542', '#fff1b8', '#ffffff'], count: 140, speed: 12, kind: 'confetti' }), 400)
    return () => clearTimeout(t)
  }, [stats?.done])

  if (!club) return (
    <div className="co-empty big">
      <p>Ce club n'existe pas (ou plus) dans le jeu.</p>
      <button className="co-btn" onClick={() => go('collection')}>Voir tous les clubs</button>
    </div>
  )
  const { primary, secondary } = clubColors(club.name)
  const ql = q.trim().toLowerCase()
  const list = (cards || []).filter((c) => (filter === 'all' || (filter === 'owned' ? have(c) : !have(c)))
    && (!rarity || normRarity(c.rarity) === rarity) && (!ql || String(c.name).toLowerCase().includes(ql)))
  if (sort !== 'rarity') list.sort(ALBUM_SORT[sort])
  const p = stats ? pct(stats.have, stats.total) : 0
  return (
    <section className={'co-album' + (stats?.done ? ' done' : '')} style={{ '--c1': primary, '--c2': secondary }}>
      <button className="co-back" onClick={() => go('collection')}>← Tous les clubs</button>
      <header className="co-album-head">
        <span className="co-album-bg" aria-hidden="true" />
        <img className="co-album-crest" src={crestUrl(club.name, { tier: stats?.done ? 1 : 4 })} alt="" />
        <div className="co-album-t">
          <span className="co-kicker">{club.country || 'Club'} · Album</span>
          <h2>{club.name}</h2>
          <p>{stats ? (stats.done ? 'Album complet. Tous les joueurs du club sont à toi.' : `Il te manque ${stats.total - stats.have} joueur${stats.total - stats.have > 1 ? 's' : ''} pour compléter l'album.`) : 'Chargement des joueurs…'}</p>
        </div>
        <div className="co-ring" style={{ '--p': p }}>
          <b>{p}<small>%</small></b>
          <span>{stats ? `${stats.have}/${stats.total}` : '…'}</span>
        </div>
        {stats?.done && <span className="co-stamp">Complet</span>}
      </header>

      {stats && (
        <div className="co-rar">
          {RARITIES.filter((r) => stats.rarities[r]).sort((a, b) => RARITY_RANK[b] - RARITY_RANK[a]).map((r) => (
            <button key={r} className={rarity === r ? 'on' : ''} style={{ '--rc': getBorderColor(r) }} onClick={() => setRarity(rarity === r ? '' : r)}>
              <i />{RARITY_LABEL[r]}<b>{stats.rarities[r].have}/{stats.rarities[r].total}</b>
            </button>
          ))}
        </div>
      )}

      <div className="co-tools">
        <div className="co-seg">
          {Object.entries(FILTERS).map(([k, v]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{v}</button>)}
        </div>
        <input className="co-search" placeholder="Chercher un joueur du club" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
          <option value="rarity">Rareté</option><option value="price_desc">Prix : plus chères</option><option value="price_asc">Prix : moins chères</option>
          <option value="name">Nom</option><option value="position">Poste</option><option value="owned">Possédés d'abord</option>
        </select>
      </div>

      {!cards ? (
        <div className="co-grid cards">{Array.from({ length: 10 }, (_, i) => <div key={i} className="co-slot skel" />)}</div>
      ) : (
        <div className="co-grid cards">
          {list.map((c, i) => <Slot key={c.id} c={c} n={have(c)} i={i} onOpen={() => setOpen(c)} price={sort.startsWith('price') ? worth(c) : null} />)}
          {!list.length && <p className="co-empty">Aucun joueur dans ce filtre.</p>}
        </div>
      )}
      {open && <CardDossier c={open} n={have(open)} onClose={closeOpen} />}
      <div className="co-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </section>
  )
}

// Un emplacement de l'album : la carte si je l'ai, sa silhouette sinon
function Slot({ c, n, i, onOpen, price = null }) {
  const r = normRarity(c.rarity)
  return (
    <button className={'co-slot ' + (n ? 'have' : 'miss')} style={{ '--rc': getBorderColor(r), '--i': Math.min(i, 30) }} onClick={onOpen} aria-label={`${c.name}${n ? '' : ' (manquant)'}`}>
      <HeroCard card={c} tilt={false} />
      {n > 1 && <span className="co-dup">×{n}</span>}
      {price != null && <span className="co-price">{fmtCoins(price)}</span>}
      {!n && (
        <span className="co-lock" title="Pas encore dans ta collection">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.6" /><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor" /></svg>
        </span>
      )}
    </button>
  )
}


// ================================================================== TOUTES LES CARTES (les miennes d'abord)
const SHOW = { all: 'Toutes', owned: 'Possédées', missing: 'Manquantes' }
const OWN_STEP = 60
function AllCards({ owned, clubs, club, setClub, initialShow = 'all' }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [rarity, setRarity] = useState('')
  const [show, setShow] = useState(initialShow)
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('footx_coll_sort') || 'rarity_desc' } catch { return 'rarity_desc' } })
  const [ownShown, setOwnShown] = useState(OWN_STEP)
  const [miss, setMiss] = useState([])
  const [total, setTotal] = useState(null)
  const [pg, setPg] = useState({ key: '', page: 0 })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  const closeOpen = useCallback(() => setOpen(null), [])
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 280); return () => clearTimeout(t) }, [q])
  useEffect(() => { try { localStorage.setItem('footx_coll_sort', sort) } catch { /* rien */ } }, [sort])

  // mes cartes (doublons regroupés), filtrées et triées comme le reste
  const mine = useMemo(() => {
    const m = new Map()
    for (const it of owned.items) {
      if (!it.card) continue
      const k = String(it.card.id)
      if (!m.has(k)) m.set(k, { ...it.card, _n: 0 })
      m.get(k)._n++
    }
    return filterLocal([...m.values()], { dq, rarity, club }).sort(LOCAL_SORT[sort] || LOCAL_SORT.rarity_desc)
  }, [owned, dq, rarity, club, sort])

  // les cartes qui me manquent : catalogue paginé côté serveur, sans celles que j'ai
  const fkey = JSON.stringify([dq, rarity, club, sort])
  const page = pg.key === fkey ? pg.page : 0
  useEffect(() => { setOwnShown(OWN_STEP) }, [fkey])
  useEffect(() => {
    if (show === 'owned') { setLoading(false); return }
    let alive = true
    setLoading(true)
    fetchPage({ dq, rarity, club }, sort, page).then(({ data, total: n }) => {
      if (!alive) return
      const rest = data.filter((c) => !owned.byCard.get(String(c.id)))
      setMiss((l) => (page ? [...l, ...rest] : rest))
      setTotal(n)
      setLoading(false)
    }).catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [fkey, page, show]) // eslint-disable-line react-hooks/exhaustive-deps

  const missingCount = total != null ? Math.max(0, total - mine.length) : null
  const fetched = (page + 1) * PAGE
  const clubNames = useMemo(() => [...clubs].sort((a, b) => a.name.localeCompare(b.name)), [clubs])
  const priced = sort.startsWith('price')

  return (
    <>
      <div className="co-tools">
        <input className="co-search" placeholder="Chercher un joueur…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club">
          <option value="">Tous les clubs</option>
          {clubNames.map((c) => <option key={c.key} value={c.name}>{c.name}</option>)}
        </select>
        <label className="co-sort"><span>Trier</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
            {Object.entries(CARD_SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="co-tools">
        <div className="co-seg">{Object.entries(SHOW).map(([k, v]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{v}</button>)}</div>
        <div className="co-rar">
          <button className={!rarity ? 'on' : ''} style={{ '--rc': '#e4ff3c' }} onClick={() => setRarity('')}><i />Toutes</button>
          {[...RARITIES].reverse().map((r) => <button key={r} className={rarity === r ? 'on' : ''} style={{ '--rc': getBorderColor(r) }} onClick={() => setRarity(rarity === r ? '' : r)}><i />{RARITY_LABEL[r]}</button>)}
        </div>
      </div>
      {club && <p className="co-filter">Club : <b>{club}</b> <button onClick={() => setClub('')}>Retirer ×</button></p>}

      {show !== 'missing' && (
        <section className="co-sec">
          <h2>Dans ta collection <span>{mine.length}{total != null && show === 'all' ? ` / ${total}` : ''}</span></h2>
          {mine.length ? (
            <div className="co-grid cards">
              {mine.slice(0, ownShown).map((c, i) => <Slot key={c.id} c={c} n={c._n} i={i} onOpen={() => setOpen(c)} price={priced ? worth(c) : null} />)}
            </div>
          ) : <p className="co-empty">Aucune carte ici pour l'instant. <button className="co-btn" onClick={() => go('boosters')}>Ouvrir des boosters</button></p>}
          {ownShown < mine.length && <button className="co-more" onClick={() => setOwnShown((n) => n + OWN_STEP)}>Afficher plus ({mine.length - ownShown})</button>}
        </section>
      )}

      {show !== 'owned' && (
        <section className="co-sec">
          <h2>Il te manque <span>{missingCount != null ? missingCount.toLocaleString('fr-FR') : '…'}</span></h2>
          <div className="co-grid cards">
            {miss.map((c, i) => <Slot key={c.id} c={c} n={0} i={i % PAGE} onOpen={() => setOpen(c)} price={priced ? worth(c) : null} />)}
            {loading && Array.from({ length: page ? 6 : 12 }, (_, i) => <div key={'s' + i} className="co-slot skel" />)}
          </div>
          {!loading && !miss.length && missingCount === 0 && <p className="co-empty">Tu as toutes les cartes de cette sélection !</p>}
          {!loading && total != null && fetched < total && (
            <button className="co-more" onClick={() => setPg({ key: fkey, page: page + 1 })}>Afficher plus</button>
          )}
        </section>
      )}
      {open && <CardDossier c={open} n={owned.byCard.get(String(open.id)) || 0} onClose={closeOpen} />}
    </>
  )
}

