import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { getBorderColor, RARITIES, RARITY_LABEL } from '../lib/rarity'
import { roleOf } from '../lib/collectif'
import { eco, bootEconomy, useEcoEvents, useWallet } from '../lib/economy'
import { ECONOMY, ecoOf, minNextBid, afterTax, suggestedPrice, fmtCoins } from '../lib/economy/config'
import { coinSound, spendSound, flyCoins, isMuted, setMuted } from '../lib/economy/fx'
import { go } from '../lib/useRoute'
import HeroCard from '../components/HeroCard'
import PackFx from '../components/PackFx'
import { CoinIcon } from '../components/CoinCounter'
import '../components/pack.css'
import './market.css'

// ============================================================================
// Marché des transferts — achat immédiat + enchères entre joueurs.
// ============================================================================

const EMPTY = { q: '', rarity: [], role: '', country: '', club: '', minPrice: '', maxPrice: '', buyNowOnly: false, sort: 'ending' }
const ROLES = [['', 'Tous'], ['GK', 'GB'], ['MID', 'DÉF / MIL'], ['ATT', 'ATT']]
const SORTS = [['ending', 'Fin imminente'], ['priceAsc', 'Prix croissant'], ['priceDesc', 'Prix décroissant'], ['new', 'Nouveautés']]
const PAGE = 24
const URGENT = 5 * 60e3

export default function Marche() {
  const [catalogue, setCatalogue] = useState(null)
  const [tab, setTab] = useState('buy')
  const [f, setF] = useState(EMPTY)
  const [page, setPage] = useState(0)
  const [res, setRes] = useState({ items: [], total: 0 })
  const [mine, setMine] = useState({ items: [], total: 0 })
  const [bids, setBids] = useState({ items: [], total: 0 })
  const [inv, setInv] = useState([])
  const [now, setNow] = useState(Date.now())
  const [toast, setToast] = useState(null)
  const [party, setParty] = useState(null) // célébration { kind, card, price }
  const [showFilters, setShowFilters] = useState(false)
  const [muted, setMute] = useState(isMuted())
  const { balance } = useWallet()
  const fx = useRef(null)
  const toastT = useRef(0)

  // catalogue : sert au marché démo et aux suggestions Pays / Club
  useEffect(() => {
    let alive = true
    supabase.from('cards').select('*').limit(1000)
      .then(({ data }) => { if (alive) setCatalogue(data || []) })
      .catch(() => { if (alive) setCatalogue([]) })
    return () => { alive = false }
  }, [])
  useEffect(() => { if (catalogue) bootEconomy(catalogue).then(() => refresh()) }, [catalogue]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const [a, b, c, d] = await Promise.all([
      eco.listings({ ...f, scope: 'market', page, size: PAGE }),
      eco.listings({ scope: 'mine', size: 100 }),
      eco.listings({ scope: 'bids', size: 100 }),
      eco.inventory(),
    ])
    setRes(a); setMine(b); setBids(c); setInv(d)
  }, [f, page])
  useEffect(() => { refresh() }, [refresh])

  // horloge 1 s : comptes à rebours + clôture des enchères + activité du marché
  useEffect(() => {
    const t = setInterval(async () => {
      setNow(Date.now())
      const ev = await eco.tick()
      if (ev.length) refresh()
    }, 1000)
    return () => clearInterval(t)
  }, [refresh])

  const say = useCallback((t) => {
    clearTimeout(toastT.current)
    setToast({ ...t, key: Date.now() })
    toastT.current = setTimeout(() => setToast(null), t.ms || 3200)
  }, [])

  const confetti = useCallback((colors) => {
    const c = colors || ['#f5c542', '#fff6c2', '#2ed573', '#ffffff']
    fx.current?.burst({ x: 0.15, y: 0.75, colors: c, count: 110, speed: 15, kind: 'confetti', angle: -Math.PI * 0.35, spread: Math.PI * 0.35 })
    fx.current?.burst({ x: 0.85, y: 0.75, colors: c, count: 110, speed: 15, kind: 'confetti', angle: -Math.PI * 0.65, spread: Math.PI * 0.35 })
    fx.current?.burst({ x: 0.5, y: 0.42, colors: ['#fff6c2', '#f5c542'], count: 60, speed: 9, kind: 'glitter' })
  }, [])

  // événements venant du "serveur" (ventes conclues, surenchères…)
  useEcoEvents(useCallback((e) => {
    if (e.type === 'sold') {
      setParty({ kind: 'sold', card: e.card, price: e.price })
      coinSound(e.price); confetti(); flyCoins(null, 14)
    } else if (e.type === 'won') {
      setParty({ kind: 'won', card: e.card, price: e.price })
      coinSound(800); confetti([getBorderColor(e.card?.rarity), '#fff', '#f5c542'])
    } else if (e.type === 'outbid') {
      say({ tone: 'bad', title: 'Surenchéri !', text: `Quelqu'un a dépassé ton offre sur ${e.card?.name}. Ton argent t'a été rendu.` })
    } else if (e.type === 'bid_received') {
      say({ tone: 'good', title: 'Nouvelle enchère', text: `Ta carte vient de recevoir une offre à ${fmtCoins(e.amount)}.` })
    } else if (e.type === 'expired') {
      say({ tone: 'info', title: 'Vente terminée sans acheteur', text: `${e.card?.name} est revenu dans ton club.` })
    }
  }, [confetti, say]))

  const act = async (fn, ok) => {
    try { await fn(); ok?.(); refresh() } catch (err) { say({ tone: 'bad', title: 'Impossible', text: err.message }) }
  }
  const buy = (l, from) => act(() => eco.buyNow(l.id), () => {
    spendSound(); setTimeout(() => coinSound(400), 160)
    setParty({ kind: 'bought', card: l.card, price: l.buyNowPrice, from })
    confetti([getBorderColor(l.card.rarity), '#ffffff', '#f5c542'])
  })
  const bid = (l, amount) => act(() => eco.placeBid(l.id, amount), () => {
    spendSound()
    say({ tone: 'good', title: 'Enchère placée', text: `Tu mènes avec ${fmtCoins(amount)}. L'argent est bloqué jusqu'à la fin.` })
  })

  const closeParty = useCallback(() => setParty(null), [])
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setPage(0) }
  const options = useMemo(() => {
    const cs = new Set(); const cl = new Set()
    for (const c of catalogue || []) { if (c.country) cs.add(c.country); if (c.club) cl.add(c.club) }
    return { countries: [...cs].sort(), clubs: [...cl].sort() }
  }, [catalogue])
  const nFilters = ['q', 'role', 'country', 'club', 'minPrice', 'maxPrice'].filter((k) => f[k]).length + f.rarity.length + (f.buyNowOnly ? 1 : 0)
  const endingSoon = res.items.filter((l) => l.endsAt - now < URGENT).length
  const activeMine = mine.items.filter((l) => l.status === 'active').length
  const activeBids = bids.items.filter((l) => l.status === 'active').length

  return (
    <div className="mk">
      {/* ------------------------------------------------------------ en-tête bourse */}
      <header className="mk-head">
        <div>
          <span className="mk-kicker">Bourse des joueurs · {eco.mode === 'demo' ? 'mode démo' : 'en direct'}</span>
          <h1>Marché des transferts</h1>
        </div>
        <div className="mk-stats">
          <Stat label="Annonces" value={fmtCoins(res.total)} />
          <Stat label="Fin < 5 min" value={endingSoon} hot={endingSoon > 0} />
          <Stat label="Taxe vendeur" value={ECONOMY.marketTaxPct + ' %'} />
          <button className="mk-mute" onClick={() => { setMuted(!muted); setMute(!muted) }} aria-label={muted ? 'Activer le son' : 'Couper le son'}>
            {muted ? <SpeakerOff /> : <Speaker />}
          </button>
        </div>
      </header>
      {eco.mode === 'demo' && (
        <p className="mk-demo">Mode démo : le marché tourne dans ton navigateur avec des vendeurs simulés. Avec les tables Supabase, ce sont de vrais joueurs et c'est le serveur qui valide chaque X-Coin.</p>
      )}

      <nav className="mk-tabs">
        {[['buy', 'Acheter'], ['sell', 'Vendre'], ['mine', 'Mes ventes', activeMine], ['bids', 'Mes enchères', activeBids]].map(([id, label, n]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}{n > 0 && <i>{n}</i>}
          </button>
        ))}
      </nav>

      {tab === 'buy' && (
        <div className="mk-layout">
          <aside className={'mk-filters' + (showFilters ? ' open' : '')}>
            <div className="mk-f-head">
              <h2>Recherche</h2>
              {nFilters > 0 && <button className="mk-link" onClick={() => set(EMPTY)}>Réinitialiser</button>}
              <button className="mk-f-close" onClick={() => setShowFilters(false)} aria-label="Fermer">×</button>
            </div>
            <label className="mk-field">
              <span>Joueur</span>
              <input className="mk-input" placeholder="Nom du joueur…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
            </label>
            <div className="mk-field">
              <span>Rareté</span>
              <div className="mk-rar">
                {RARITIES.map((r) => {
                  const on = f.rarity.includes(r)
                  return (
                    <button key={r} className={on ? 'on' : ''} style={{ '--cc': getBorderColor(r) }}
                      onClick={() => set({ rarity: on ? f.rarity.filter((x) => x !== r) : [...f.rarity, r] })}>{RARITY_LABEL[r]}</button>
                  )
                })}
              </div>
            </div>
            <div className="mk-field">
              <span>Poste</span>
              <div className="mk-seg">
                {ROLES.map(([id, label]) => <button key={id} className={f.role === id ? 'on' : ''} onClick={() => set({ role: id })}>{label}</button>)}
              </div>
            </div>
            <label className="mk-field">
              <span>Pays</span>
              <input className="mk-input" list="mk-countries" placeholder="Tous les pays" value={f.country} onChange={(e) => set({ country: e.target.value })} />
              <datalist id="mk-countries">{options.countries.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="mk-field">
              <span>Club</span>
              <input className="mk-input" list="mk-clubs" placeholder="Tous les clubs" value={f.club} onChange={(e) => set({ club: e.target.value })} />
              <datalist id="mk-clubs">{options.clubs.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <div className="mk-field">
              <span>Prix ({f.buyNowOnly ? 'achat immédiat' : 'enchère actuelle'})</span>
              <div className="mk-range">
                <input className="mk-input" inputMode="numeric" placeholder="Min" value={f.minPrice} onChange={(e) => set({ minPrice: e.target.value.replace(/\D/g, '') })} />
                <i>—</i>
                <input className="mk-input" inputMode="numeric" placeholder="Max" value={f.maxPrice} onChange={(e) => set({ maxPrice: e.target.value.replace(/\D/g, '') })} />
              </div>
              <div className="mk-quick">
                {[[0, 1000], [1000, 5000], [5000, 25000], [25000, '']].map(([a, b]) => (
                  <button key={a} onClick={() => set({ minPrice: a ? String(a) : '', maxPrice: b ? String(b) : '' })}>
                    {b ? `${fmtShort(a)}–${fmtShort(b)}` : `${fmtShort(a)}+`}
                  </button>
                ))}
              </div>
            </div>
            <label className="mk-toggle">
              <input type="checkbox" checked={f.buyNowOnly} onChange={(e) => set({ buyNowOnly: e.target.checked })} />
              <span />Filtrer sur le prix d'achat immédiat
            </label>
            <button className="mk-apply" onClick={() => setShowFilters(false)}>Voir {fmtCoins(res.total)} annonces</button>
          </aside>

          <section className="mk-results">
            <div className="mk-toolbar">
              <button className="mk-f-open" onClick={() => setShowFilters(true)}><FilterIcon /> Filtres{nFilters > 0 && <i>{nFilters}</i>}</button>
              <span className="mk-count"><b>{fmtCoins(res.total)}</b> cartes en vente</span>
              <select className="mk-select" value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Trier">
                {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <div className="mk-grid">
              {!catalogue && Array.from({ length: 8 }, (_, i) => <div key={i} className="mk-skel" />)}
              {res.items.map((l) => <Listing key={l.id} l={l} now={now} balance={balance ?? 0} onBuy={buy} onBid={bid} />)}
              {catalogue && res.items.length === 0 && <p className="mk-empty">Aucune carte ne correspond. Élargis la fourchette de prix ou retire un filtre.</p>}
            </div>
            {res.total > PAGE && (
              <div className="mk-pager">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>←</button>
                <span>{page + 1} / {Math.ceil(res.total / PAGE)}</span>
                <button disabled={(page + 1) * PAGE >= res.total} onClick={() => setPage(page + 1)}>→</button>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'sell' && <Sell inv={inv} onDone={(msg) => { refresh(); say(msg) }} onError={(m) => say({ tone: 'bad', title: 'Impossible', text: m })} />}
      {tab === 'mine' && <Mine list={mine.items} now={now} empty="Tu n'as encore rien mis en vente." onCancel={(l) => act(() => eco.cancelListing(l.id), () => say({ tone: 'info', title: 'Annonce retirée', text: `${l.card.name} est revenu dans ton club.` }))} />}
      {tab === 'bids' && <Mine list={bids.items} now={now} bids empty="Aucune enchère pour l'instant. Trouve une bonne affaire dans l'onglet Acheter." />}

      {party && <Party p={party} onClose={closeParty} />}
      {toast && (
        <div key={toast.key} className={'mk-toast ' + toast.tone} role="status">
          <b>{toast.title}</b><span>{toast.text}</span><i />
        </div>
      )}
      <div className="mk-fx"><PackFx ref={fx} ambient="rgba(0,0,0,0)" /></div>
    </div>
  )
}

// ---------------------------------------------------------------- annonce
function Listing({ l, now, balance, onBuy, onBid }) {
  const left = l.endsAt - now
  const urgent = left < URGENT
  const mineL = l.seller === 'me'
  const leading = l.bidder === 'me'
  const ref = useRef(null)
  const [confirm, setConfirm] = useState(false)
  const [bidOpen, setBidOpen] = useState(false)
  const min = minNextBid(l)
  const [amount, setAmount] = useState(min)
  useEffect(() => { if (!bidOpen) setAmount(min) }, [min, bidOpen])
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 3000); return () => clearTimeout(t) }, [confirm])
  const step = Math.max(50, Math.round((min * 0.05) / 50) * 50)
  const price = l.currentBid ?? l.startPrice
  const total = l.endsAt - l.createdAt

  return (
    <article ref={ref} className={'mk-card' + (urgent ? ' urgent' : '') + (leading ? ' leading' : '') + (mineL ? ' own' : '')} style={{ '--cc': getBorderColor(l.card.rarity) }}>
      <div className="mk-card-art">
        <HeroCard card={l.card} />
        {leading && <span className="mk-flag lead">Tu mènes</span>}
        {mineL && <span className="mk-flag own">Ta vente</span>}
      </div>
      <div className="mk-card-body">
        <div className="mk-seller">{l.sellerName}{l.demo && <em>bot</em>}</div>
        <div className="mk-price">
          <span>{l.currentBid != null ? 'Enchère actuelle' : 'Mise à prix'}</span>
          <b key={price} className="tick"><CoinIcon className="mk-c" />{fmtCoins(price)}</b>
          <small>{l.bidCount} enchère{l.bidCount > 1 ? 's' : ''}</small>
        </div>
        <div className="mk-bn"><span>Achat immédiat</span><b><CoinIcon className="mk-c" />{fmtCoins(l.buyNowPrice)}</b></div>
        <Countdown left={left} total={total} />
        {!mineL && (bidOpen ? (
          <div className="mk-bidbox">
            <button onClick={() => setAmount(Math.max(min, amount - step))} disabled={amount <= min} aria-label="Moins">−</button>
            <input inputMode="numeric" value={fmtCoins(amount)} onChange={(e) => setAmount(+e.target.value.replace(/\D/g, '') || min)} aria-label="Montant" />
            <button onClick={() => setAmount(Math.min(l.buyNowPrice - 50, balance, amount + step))} disabled={amount + step >= l.buyNowPrice || amount + step > balance} aria-label="Plus">+</button>
            <button className="mk-go" onClick={() => { onBid(l, amount); setBidOpen(false) }}>OK</button>
            <button className="mk-x" onClick={() => setBidOpen(false)} aria-label="Annuler">×</button>
          </div>
        ) : (
          <div className="mk-actions">
            <button className="mk-bid" onClick={() => setBidOpen(true)} disabled={leading || min >= l.buyNowPrice || min > balance}>
              {leading ? 'En tête' : <>Enchérir <small>{min > balance ? 'solde insuffisant' : fmtCoins(min)}</small></>}
            </button>
            <button className={'mk-buy' + (confirm ? ' confirm' : '')} disabled={l.buyNowPrice > balance}
              onClick={() => { if (!confirm) { setConfirm(true); return } setConfirm(false); const r = ref.current?.getBoundingClientRect(); onBuy(l, r && { x: r.left + r.width / 2, y: r.top + r.height / 3 }) }}>
              {l.buyNowPrice > balance ? 'Trop cher' : confirm ? 'Confirmer ?' : 'Acheter'}
            </button>
          </div>
        ))}
      </div>
    </article>
  )
}

function Countdown({ left, total }) {
  const done = left <= 0
  const urgent = left < URGENT
  const pct = Math.max(0, Math.min(100, (left / Math.max(1, total)) * 100))
  return (
    <div className={'mk-time' + (urgent ? ' urgent' : '') + (left < 60e3 ? ' last' : '')}>
      <ClockIcon />
      <b>{done ? 'Terminée' : fmtLeft(left)}</b>
      <span className="mk-time-bar"><i style={{ width: pct + '%' }} /></span>
    </div>
  )
}

// ---------------------------------------------------------------- vendre
function Sell({ inv, onDone, onError }) {
  const [sel, setSel] = useState(null)
  const [start, setStart] = useState(0)
  const [bn, setBn] = useState(0)
  const [hours, setHours] = useState(6)
  const [qsConfirm, setQsConfirm] = useState(false)
  const item = inv.find((i) => i.uid === sel)
  const free = inv.filter((i) => !i.listingId)
  const commons = free.filter((i) => i.card.rarity === 'commune')
  const e = item ? ecoOf(item.card) : null

  useEffect(() => {
    if (!item) return
    const s = suggestedPrice(item.card)
    setStart(s.start); setBn(s.buyNow); setQsConfirm(false)
  }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = async () => {
    try {
      await eco.createListing(item.uid, start, bn, hours)
      coinSound(200)
      onDone({ tone: 'good', title: 'Carte mise en vente', text: `${item.card.name} est sur le marché pour ${hours} h.` })
      setSel(null)
    } catch (err) { onError(err.message) }
  }
  const quick = async (uids, amount, from) => {
    try {
      await eco.quicksell(uids)
      coinSound(amount); flyCoins(from, Math.min(16, 4 + uids.length))
      onDone({ tone: 'good', title: 'Vente rapide', text: `+${fmtCoins(amount)} X-Coins` })
      setSel(null)
    } catch (err) { onError(err.message) }
  }
  const valid = e && start >= e.min && bn <= e.max && bn > start

  if (!inv.length) {
    return (
      <div className="mk-emptybox">
        <h2>Ton club est vide</h2>
        <p>Ouvre des boosters : chaque carte tirée arrive ici et peut être vendue.</p>
        <button className="mk-cta" onClick={() => go('boosters')}>Ouvrir des boosters</button>
      </div>
    )
  }
  return (
    <div className="mk-sell">
      <section className="mk-inv">
        <div className="mk-inv-head">
          <h2>Mon club <small>{free.length} cartes disponibles</small></h2>
          {commons.length > 0 && (
            <button className="mk-qs-all" onClick={(ev) => quick(commons.map((i) => i.uid), commons.length * ecoOf(commons[0].card).quicksell, { x: ev.clientX, y: ev.clientY })}>
              Vente rapide des {commons.length} communes · <CoinIcon className="mk-c" />{fmtCoins(commons.length * ecoOf(commons[0].card).quicksell)}
            </button>
          )}
        </div>
        <div className="mk-inv-grid">
          {inv.map((i) => (
            <button key={i.uid} className={'mk-inv-card' + (sel === i.uid ? ' on' : '') + (i.listingId ? ' listed' : '')}
              onClick={() => !i.listingId && setSel(i.uid)} disabled={!!i.listingId}>
              <HeroCard card={i.card} />
              {i.listingId && <span className="mk-flag own">En vente</span>}
            </button>
          ))}
        </div>
      </section>
      <aside className={'mk-sellbox' + (item ? ' on' : '')}>
        {!item ? <p className="mk-hint">Choisis une carte de ton club pour la mettre en vente ou la vendre rapidement.</p> : (
          <>
            <div className="mk-sell-card"><HeroCard card={item.card} /></div>
            <h3>{item.card.name}</h3>
            <p className="mk-hint">Fourchette autorisée pour une {RARITY_LABEL[item.card.rarity]} : {fmtCoins(e.min)} – {fmtCoins(e.max)}</p>
            <PriceField label="Mise à prix" value={start} min={e.min} max={e.max - 50} onChange={setStart} />
            <PriceField label="Achat immédiat" value={bn} min={Math.max(e.min + 50, start + 50)} max={e.max} onChange={setBn} />
            <div className="mk-field">
              <span>Durée</span>
              <div className="mk-seg">{ECONOMY.durations.map((h) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{h} h</button>)}</div>
            </div>
            <div className="mk-net">
              <span>Si vendu en achat immédiat, tu touches</span>
              <b><CoinIcon className="mk-c" />{fmtCoins(afterTax(bn))}</b>
              <small>après {ECONOMY.marketTaxPct} % de taxe</small>
            </div>
            <button className="mk-cta" disabled={!valid} onClick={list}>Mettre en vente</button>
            <button className={'mk-qs' + (qsConfirm ? ' confirm' : '')}
              onClick={(ev) => { if (!qsConfirm) { setQsConfirm(true); return } quick([item.uid], e.quicksell, { x: ev.clientX, y: ev.clientY }) }}>
              {qsConfirm ? 'Confirmer la vente rapide ?' : <>Vente rapide · <CoinIcon className="mk-c" />{fmtCoins(e.quicksell)}</>}
            </button>
          </>
        )}
      </aside>
    </div>
  )
}

function PriceField({ label, value, min, max, onChange }) {
  const steps = 200
  const toPos = (v) => Math.round((Math.log(Math.max(min, v) / min) / Math.log(max / min)) * steps)
  const fromPos = (p) => Math.round((min * Math.pow(max / min, p / steps)) / 50) * 50
  return (
    <label className="mk-field mk-pricefield">
      <span>{label}</span>
      <div className="mk-pf">
        <CoinIcon className="mk-c" />
        <input inputMode="numeric" value={fmtCoins(value)} onChange={(e) => onChange(+e.target.value.replace(/\D/g, '') || 0)} />
      </div>
      <input type="range" min="0" max={steps} value={toPos(value)} onChange={(e) => onChange(fromPos(+e.target.value))} />
    </label>
  )
}

// ---------------------------------------------------------------- mes ventes / mes enchères
function Mine({ list, now, bids = false, empty, onCancel }) {
  if (!list.length) return <div className="mk-emptybox"><p>{empty}</p></div>
  return (
    <div className="mk-rows">
      {list.map((l) => {
        const active = l.status === 'active' && l.endsAt > now
        let status
        if (active) status = bids ? (l.bidder === 'me' ? ['lead', 'Tu mènes'] : ['bad', 'Surenchéri']) : (l.bidCount ? ['lead', `${l.bidCount} enchère${l.bidCount > 1 ? 's' : ''}`] : ['info', 'En vente'])
        else if (l.status === 'sold') status = bids ? (l.buyer === 'me' ? ['win', 'Gagnée'] : ['bad', 'Perdue']) : ['win', 'Vendue']
        else if (l.status === 'cancelled') status = ['info', 'Retirée']
        else status = ['info', 'Expirée']
        return (
          <div key={l.id} className={'mk-row ' + status[0]} style={{ '--cc': getBorderColor(l.card.rarity) }}>
            <div className="mk-row-card"><HeroCard card={l.card} tilt={false} /></div>
            <div className="mk-row-main">
              <b>{l.card.name}</b>
              <small>{RARITY_LABEL[l.card.rarity]} · {roleOf(l.card.position) === 'GK' ? 'Gardien' : l.card.club}</small>
            </div>
            <span className={'mk-chip ' + status[0]}>{status[1]}</span>
            <div className="mk-row-price">
              {l.status === 'sold' && !bids ? <><span>Tu as touché</span><b className="win"><CoinIcon className="mk-c" />+{fmtCoins(afterTax(l.finalPrice))}</b></>
                : l.status === 'sold' && l.buyer === 'me' ? <><span>Payé</span><b><CoinIcon className="mk-c" />{fmtCoins(l.finalPrice)}</b></>
                  : <><span>{l.currentBid != null ? 'Enchère' : 'Mise à prix'}</span><b><CoinIcon className="mk-c" />{fmtCoins(l.currentBid ?? l.startPrice)}</b></>}
            </div>
            <div className="mk-row-time">{active ? <Countdown left={l.endsAt - now} total={l.endsAt - l.createdAt} /> : <span className="mk-done">Terminé</span>}</div>
            {!bids && active && !l.bidder && onCancel && <button className="mk-link" onClick={() => onCancel(l)}>Retirer</button>}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- célébration
function Party({ p, onClose }) {
  const title = { bought: 'Transfert réussi !', sold: 'Vendu !', won: 'Enchère remportée !' }[p.kind]
  const sub = { bought: 'La carte rejoint ton club.', sold: 'Les X-Coins sont sur ton compte.', won: 'La carte rejoint ton club.' }[p.kind]
  useEffect(() => { const t = setTimeout(onClose, 5200); return () => clearTimeout(t) }, [onClose])
  return (
    <div className={'mk-party ' + p.kind} onClick={onClose}>
      <div className="mk-party-in" style={{ '--cc': getBorderColor(p.card?.rarity) }}>
        <div className="mk-party-rays" />
        <div className="mk-party-card"><HeroCard card={p.card} /></div>
        <h2>{title}</h2>
        <p className="mk-party-amount"><CoinIcon className="mk-c" />{p.kind === 'sold' ? '+' + fmtCoins(afterTax(p.price)) : fmtCoins(p.price)}</p>
        <p className="mk-party-sub">{sub}</p>
        <button className="mk-cta" onClick={onClose}>Continuer</button>
      </div>
    </div>
  )
}

function Stat({ label, value, hot }) {
  return <div className={'mk-stat' + (hot ? ' hot' : '')}><span>{label}</span><b>{value}</b></div>
}

const fmtShort = (n) => (n >= 1000 ? n / 1000 + 'k' : String(n))
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 1) return `${h} h ${String(m).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function ClockIcon() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M12 9v4l3 2M9 2h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg> }
function FilterIcon() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg> }
function Speaker() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> }
function SpeakerOff() { return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M17 9l5 6M22 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> }
