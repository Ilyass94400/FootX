import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { getBorderColor, RARITIES, RARITY_LABEL } from '../lib/rarity'
import { useStock, setStockFromServer, formatTime, MAX_STOCK } from '../lib/boosterStock'
import PlayerCard from '../components/PlayerCard'
import './boosters.css'

const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const rank = (c) => RANK[c.rarity?.toLowerCase()] || 0

function Boosters() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [newIds, setNewIds] = useState(new Set())
  const [pulledCards, setPulledCards] = useState([])
  const [openedCount, setOpenedCount] = useState(1)
  const [step, setStep] = useState('idle')
  const [walkoutStep, setWalkoutStep] = useState('none')

  const [qty, setQty] = useState(1)
  const [quick, setQuick] = useState(() => localStorage.getItem('footx_quick') === '1')
  const stock = useStock()

  useEffect(() => { localStorage.setItem('footx_quick', quick ? '1' : '0') }, [quick])

  const maxQty = Math.min(MAX_STOCK, stock.n)
  const q = Math.max(1, Math.min(qty, maxQty || 1))

  // Le tirage est fait par Supabase (fonction open_boosters) : stock, pity et collection
  // sont vérifiés et enregistrés côté serveur, impossible de tricher depuis le navigateur.
  const buyBooster = async () => {
    if (step !== 'idle' || busy || stock.n < 1) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('open_boosters', { qty: q })
    setBusy(false)
    if (error) { setError(error.message); return }

    setStockFromServer(data)
    const cards = [...data.cards].sort((a, b) => rank(b) - rank(a))
    setNewIds(new Set((data.new_ids || []).map(String)))
    setPulledCards(cards)
    setOpenedCount(q)
    setStep(quick ? 'cards_revealed' : 'pack_ready')
  }

  const clickToOpen = () => {
    if (step !== 'pack_ready') return
    setStep('opening')

    setTimeout(() => {
      setStep('walkout')
      setWalkoutStep('nation')

      setTimeout(() => {
        setWalkoutStep('position')
        setTimeout(() => {
          setWalkoutStep('club')
          setTimeout(() => {
            setStep('cards_revealed')
            setWalkoutStep('none')
          }, 1500)
        }, 1200)
      }, 1200)
    }, 2500)
  }

  const resetBooster = () => {
    setStep('idle')
    setWalkoutStep('none')
    setPulledCards([])
  }

  const getBestRarityColor = () => {
    if (pulledCards.length === 0) return '#1e90ff'
    return getBorderColor(pulledCards[0].rarity)
  }

  const presets = [1, 5, 10, 25, 50, 100].filter((n) => n <= maxQty)

  return (
    <div className={'boosters-page ' + (step === 'opening' ? 'screen-shake' : '')}>
      <PityBar count={stock.opened} />

      {(step === 'opening' || step === 'walkout') && (
        <div className="flash-overlay" style={{ '--rarity-color': getBestRarityColor() }}></div>
      )}

      {step === 'idle' && (
        <div className="open-zone">
          <div
            className={'booster-card-ui ' + (stock.n > 0 ? 'booster-idle' : 'booster-empty')}
            onClick={buyBooster}
            style={{ '--rarity-color': '#e4ff3c' }}
          >
            <div style={{ fontSize: '12px', letterSpacing: '2px', color: '#888', textTransform: 'uppercase' }}>FootX Series</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '60px', marginBottom: '10px' }}>⚽</div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '28px', letterSpacing: '2px' }}>FOOTX</h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#777' }}>Édition Top 5 Ligues</p>
            </div>
            <div className="booster-qty-badge">{q > 1 ? `× ${q}` : '10 cartes'}</div>
          </div>

          <div className="open-panel">
            <div className="stock-line">
              <span><b>{stock.n}</b> booster{stock.n > 1 ? 's' : ''} dispo</span>
              {stock.nextIn !== null && <small>+1 dans {formatTime(stock.nextIn)}</small>}
            </div>

            {stock.n > 0 ? (
              <>
                <label className="qty-label">Combien ?</label>
                <div className="qty">
                  <button onClick={() => setQty(Math.max(1, q - 1))} disabled={q <= 1}>−</button>
                  <input
                    type="number" min="1" max={maxQty} value={q}
                    onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                  />
                  <button onClick={() => setQty(Math.min(maxQty, q + 1))} disabled={q >= maxQty}>+</button>
                </div>
                <input
                  className="qty-range" type="range" min="1" max={Math.max(1, maxQty)} value={q}
                  onChange={(e) => setQty(parseInt(e.target.value))}
                />
                <div className="qty-presets">
                  {presets.map((n) => (
                    <button key={n} className={q === n ? 'on' : ''} onClick={() => setQty(n)}>{n}</button>
                  ))}
                  {maxQty > 1 && !presets.includes(maxQty) && (
                    <button className={q === maxQty ? 'on' : ''} onClick={() => setQty(maxQty)}>max</button>
                  )}
                </div>

                <label className="quick">
                  <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />
                  Ouverture rapide <small>(sans animation)</small>
                </label>

                <button className="btn open-btn" onClick={buyBooster} disabled={busy}>
                  {busy ? 'Ouverture…' : q > 1 ? `Ouvrir ${q} boosters` : 'Ouvrir le booster'}
                </button>
                {error && <p className="open-error">{error}</p>}
              </>
            ) : !stock.ready ? (
              <p className="muted">Chargement de ton stock…</p>
            ) : (
              <p className="muted">Plus de boosters. Le prochain arrive dans {formatTime(stock.nextIn)}.</p>
            )}
          </div>
        </div>
      )}

      {(step === 'pack_ready' || step === 'opening') && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', position: 'relative', zIndex: 2 }}>
          {step === 'pack_ready' && (
            <p style={{ color: getBestRarityColor(), textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '20px', animation: 'floatBooster 2s infinite', fontWeight: 'bold', fontSize: '14px' }}>
              Clique sur le booster pour déchirer
            </p>
          )}
          <div
            onClick={clickToOpen}
            className={step === 'pack_ready' ? 'booster-card-ui booster-idle' : 'booster-card-ui booster-exploding'}
            style={{ '--rarity-color': getBestRarityColor(), border: `2px solid ${step === 'pack_ready' ? getBestRarityColor() : '#333'}` }}
          >
            <div style={{ fontSize: '12px', letterSpacing: '2px', color: getBestRarityColor(), textTransform: 'uppercase' }}>Prêt à ouvrir</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '70px', marginBottom: '10px' }}>⚽</div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '30px', letterSpacing: '2px' }}>PACK FOOTX</h2>
            </div>
            <div className="booster-qty-badge" style={{ color: getBestRarityColor(), borderColor: getBestRarityColor() }}>
              {openedCount > 1 ? `${openedCount} boosters` : '10 joueurs'}
            </div>
          </div>
          {step === 'pack_ready' && (
            <button className="link" style={{ marginTop: 18 }} onClick={() => setStep('cards_revealed')}>passer l'animation</button>
          )}
        </div>
      )}

      {step === 'walkout' && (
        <div onClick={() => setStep('cards_revealed')} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', position: 'relative', zIndex: 10, cursor: 'pointer', '--rarity-color': getBestRarityColor() }}>
          {(walkoutStep === 'nation' || walkoutStep === 'position' || walkoutStep === 'club') && (
            <h1 key="nation" className="walkout-text" style={{ fontSize: '60px', color: 'white' }}>{pulledCards[0].country}</h1>
          )}
          {(walkoutStep === 'position' || walkoutStep === 'club') && (
            <h1 key="position" className="walkout-text" style={{ fontSize: '75px', color: getBestRarityColor() }}>{pulledCards[0].position}</h1>
          )}
          {walkoutStep === 'club' && (
            <h1 key="club" className="walkout-text" style={{ fontSize: '55px', color: 'white' }}>{pulledCards[0].club}</h1>
          )}
        </div>
      )}

      {step === 'cards_revealed' && (
        openedCount === 1
          ? <SingleResult cards={pulledCards} newIds={newIds} color={getBestRarityColor()} onAgain={resetBooster} />
          : <MultiResult cards={pulledCards} newIds={newIds} boosters={openedCount} onAgain={resetBooster} />
      )}
    </div>
  )
}

// Résultat d'un seul booster : les 10 cartes avec l'animation de retournement
function SingleResult({ cards, newIds, color, onAgain }) {
  const legendary = ['iconique', 'legendaire'].includes(cards[0].rarity?.toLowerCase())
  return (
    <div className="result">
      <div className="result-head">
        <h2 style={{ color }}>{legendary ? 'Walkout légendaire' : 'Résultat du pack'}</h2>
        <button className="btn" onClick={onAgain}>Rouvrir</button>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {cards.map((card, index) => {
          const isBestCard = index === 0
          const iconic = card.rarity?.toLowerCase() === 'iconique'
          return (
            <div key={index + '-' + card.id} className="card-container" style={{ zIndex: isBestCard ? 5 : 1 }}>
              <div
                className={'card-3d-reveal' + (iconic ? ' iconic-border' : '')}
                style={{
                  border: `${isBestCard ? '4px' : '2px'} solid ${getBorderColor(card.rarity)}`,
                  backgroundColor: '#0f1015', padding: '10px', width: isBestCard ? '190px' : '150px',
                  borderRadius: '12px', textAlign: 'center',
                  '--rarity-color': getBorderColor(card.rarity),
                  animation: `cardFlip3D 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards ${index * 0.12}s${isBestCard ? ', bestCardLevitate 3s infinite 1s' : ''}${iconic ? ', iconicSpin 3s linear infinite' : ''}`,
                  position: 'relative', overflow: 'hidden',
                }}
              >
                {newIds.has(String(card.id)) && <span className="new-badge">Nouveau</span>}
                <h4 style={{ margin: '5px 0', fontSize: isBestCard ? '15px' : '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {card.name}
                </h4>
                <div style={{ position: 'relative' }}>
                  <img
                    src={card.image_url}
                    alt={card.name}
                    onError={(e) => { e.target.src = 'https://images.fifaindex.com/fc27/players/default.png' }}
                    style={{ width: '100%', borderRadius: '6px', height: isBestCard ? '180px' : '140px', objectFit: 'cover', backgroundColor: '#1a1c23' }}
                  />
                  <div style={{ position: 'absolute', bottom: '5px', right: '5px', backgroundColor: 'rgba(0,0,0,0.85)', padding: '2px 6px', borderRadius: '4px', fontSize: '9px', color: getBorderColor(card.rarity), fontWeight: 'bold', border: `1px solid ${getBorderColor(card.rarity)}` }}>
                    {card.rarity}
                  </div>
                </div>
                <p style={{ margin: '6px 0 0 0', fontSize: '10px', color: '#aaa' }}>{card.country}</p>
                <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: '#777', fontWeight: 'bold' }}>{card.club}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Résultat de plusieurs boosters : récap par rareté + cartes regroupées (×2, ×3…)
function MultiResult({ cards, newIds, boosters, onAgain }) {
  const [filter, setFilter] = useState('all')

  const counts = useMemo(() => {
    const c = {}
    cards.forEach((x) => { const r = x.rarity?.toLowerCase(); c[r] = (c[r] || 0) + 1 })
    return c
  }, [cards])

  const grouped = useMemo(() => {
    const map = new Map()
    cards.forEach((c) => {
      const g = map.get(c.id)
      if (g) g.n++
      else map.set(c.id, { card: c, n: 1 })
    })
    return [...map.values()]
  }, [cards])

  const shown = filter === 'all' ? grouped : grouped.filter((g) => g.card.rarity?.toLowerCase() === filter)

  return (
    <div className="result">
      <div className="result-head">
        <div>
          <h2>{boosters} boosters · {cards.length} cartes</h2>
          <span className="muted">{newIds.size} nouvelle{newIds.size > 1 ? 's' : ''} dans ta collection</span>
        </div>
        <button className="btn" onClick={onAgain}>Rouvrir</button>
      </div>

      <div className="recap">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          <b>{grouped.length}</b><span>différentes</span>
        </button>
        {[...RARITIES].reverse().map((r) => (
          <button
            key={r}
            className={filter === r ? 'on' : ''}
            style={{ '--c': getBorderColor(r) }}
            onClick={() => setFilter(r)}
            disabled={!counts[r]}
          >
            <b>{counts[r] || 0}</b><span>{RARITY_LABEL[r]}</span>
          </button>
        ))}
      </div>

      <div className="card-grid">
        {shown.map((g, i) => (
          <div key={g.card.id} className="multi-card" style={{ animationDelay: `${Math.min(i, 40) * 0.03}s` }}>
            <PlayerCard card={g.card} />
            {g.n > 1 && <span className="dup">×{g.n}</span>}
            {newIds.has(String(g.card.id)) && <span className="new-badge">Nouveau</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Barre de progression de la pity (Épique+ tous les 10, Iconique tous les 200)
function PityBar({ count }) {
  const epic = count % 10
  const iconic = count % 200
  return (
    <div className="pity-bar">
      <div>
        <span>Épique+ garantie</span>
        <div className="bar"><i style={{ width: (epic / 10) * 100 + '%', background: 'var(--r-epique)' }} /></div>
        <small>{epic}/10</small>
      </div>
      <div>
        <span>Iconique garantie</span>
        <div className="bar"><i style={{ width: (iconic / 200) * 100 + '%', background: 'var(--gold)' }} /></div>
        <small>{iconic}/200</small>
      </div>
      <div className="pity-total">{count} ouverts</div>
    </div>
  )
}

export default Boosters
