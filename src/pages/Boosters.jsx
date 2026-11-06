import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { getBorderColor, RARITIES, RARITY_LABEL } from '../lib/rarity'
import { useStock, addStock, getStock, formatTime, MAX_STOCK } from '../lib/boosterStock'
import PlayerCard from '../components/PlayerCard'
import PackOpening from '../components/PackOpening'
import BoosterPack from '../components/BoosterPack'
import { eco, LIVE } from '../lib/economy'
import { ECONOMY, fmtCoins } from '../lib/economy/config'
import { spendSound } from '../lib/economy/fx'
import { useWallet } from '../lib/economy'
import { CoinIcon } from '../components/CoinCounter'
import { loadPity, FEATURED_RATES, FILLER_RATES, PITY, PACK_SIZE, effectiveRate } from '../lib/drops'
import { track } from '../lib/quests'
import './boosters.css'
import PageHelp from '../components/PageHelp'

const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const rank = (c) => RANK[c.rarity?.toLowerCase()] || 0
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Charge tout le catalogue une fois (par paquets de 1000, limite Supabase)
// -> les tirages se font ensuite en local, donc 100 boosters s'ouvrent instantanément
async function loadCatalogue() {
  const { count } = await supabase.from('cards').select('*', { count: 'exact', head: true })
  const pages = Math.ceil((count || 0) / 1000)
  const res = await Promise.all(
    Array.from({ length: pages }, (_, i) => supabase.from('cards').select('*').range(i * 1000, i * 1000 + 999))
  )
  return res.flatMap((r) => r.data || [])
}

function Boosters() {
  const [catalogue, setCatalogue] = useState([])
  const [loading, setLoading] = useState(true)
  const [pulledCards, setPulledCards] = useState([])
  const [openedCount, setOpenedCount] = useState(1)
  const [step, setStep] = useState('idle')
  const [openId, setOpenId] = useState(0) // change à chaque ouverture -> PackOpening repart à zéro
  const [walkoutStep, setWalkoutStep] = useState('none')

  const [qty, setQty] = useState(1)
  const [quick, setQuick] = useState(() => localStorage.getItem('footx_quick') === '1')
  const stock = useStock()

  // Compteur de Pity sauvegardé dans le navigateur
  const [boosterCount, setBoosterCount] = useState(() => {
    const saved = localStorage.getItem('footx_booster_count')
    return saved ? parseInt(saved) : 0
  })

  useEffect(() => {
    // en ligne, le tirage se fait sur le serveur : inutile de télécharger tout le catalogue
    if (LIVE) { setLoading(false); return }
    loadCatalogue().then((cards) => { setCatalogue(cards); setLoading(false) })
  }, [])

  useEffect(() => { localStorage.setItem('footx_quick', quick ? '1' : '0') }, [quick])

  // Pity : boosters ouverts depuis la dernière Iconique / la dernière Épique+
  const [pity, setPity] = useState(loadPity)

  // Le maximum, c'est VRAIMENT tout ce que tu peux ouvrir : ton stock + ce que tes X-Coins peuvent acheter
  // (10 boosters max par ouverture). Ce qui manque au stock est acheté automatiquement à l'ouverture.
  const { balance } = useWallet()
  const price = ECONOMY.boosterPrice
  const affordable = Math.max(0, Math.floor((balance ?? 0) / price))
  const maxQty = Math.min(10, MAX_STOCK, stock.n + affordable)
  const q = Math.max(1, Math.min(qty, maxQty || 1))
  const toBuy = Math.max(0, q - stock.n)
  const cost = toBuy * price
  const [confirmBuy, setConfirmBuy] = useState(false)
  useEffect(() => {
    if (!confirmBuy) return
    const t = setTimeout(() => setConfirmBuy(false), 3500)
    return () => clearTimeout(t)
  }, [confirmBuy])
  useEffect(() => { setConfirmBuy(false) }, [q])


  const [opening, setOpening] = useState(false) // attente du tirage (serveur)
  const [openError, setOpenError] = useState(null)
  // fromStock : "Ouvrir un autre" depuis le récap → uniquement avec le stock (pas d'achat sans confirmation)
  const buyBooster = async (fromStock = false) => {
    // autorisé depuis l'écran d'accueil OU depuis le récap ("Ouvrir un autre")
    if (opening || (!LIVE && !catalogue.length) || (step !== 'idle' && step !== 'premium')) return
    const n = fromStock === true ? Math.min(q, getStock().n) : q
    if (n < 1 || n > maxQty) return
    const need = Math.max(0, n - getStock().n)
    if (need > 0 && !confirmBuy) { setConfirmBuy(true); return } // 1er clic : on confirme la dépense
    setConfirmBuy(false)
    setOpening(true)
    setOpenError(null)
    let res
    try {
      if (need > 0) {
        // achat des boosters manquants, puis ouverture de tout d'un coup
        await eco.buyBoosters(need, 'buy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
        spendSound()
      }
      // en ligne : le serveur tire les cartes, applique les garanties et décompte le stock
      res = await eco.openBoosters(n, 'open-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), catalogue)
    } catch (e) {
      setOpenError(e.message || 'Ouverture impossible')
      setOpening(false)
      return
    }
    setOpening(false)
    if (res.pity) setPity(res.pity)
    track('booster_opened', n)
    if (res.opened != null) setBoosterCount(res.opened)

    const all = [...res.cards].sort((a, b) => rank(b) - rank(a))
    setPulledCards(all)
    setOpenedCount(n)
    // ouverture premium carte par carte (1 ou plusieurs packs)
    setOpenId((n) => n + 1)
    setStep('premium')
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
      <PityBar count={boosterCount} pity={pity} />
      {step === 'idle' && <PageHelp topic="boosters" />}

      {(step === 'opening' || step === 'walkout') && (
        <div className="flash-overlay" style={{ '--rarity-color': getBestRarityColor() }}></div>
      )}

      {step === 'idle' && (
        <div className="open-zone">
          {/* Vitrine : le même booster que dans l'ouverture (pile derrière si ×5 / ×10) */}
          <div
            className={'pk-showcase' + (maxQty > 0 ? '' : ' empty')}
            onClick={() => buyBooster()}
            onKeyDown={(e) => { if (e.key === 'Enter') buyBooster() }}
            role="button" tabIndex={0}
            aria-label={q > 1 ? `Ouvrir ${q} boosters` : 'Ouvrir le booster'}
          >
            {q >= 5 && <BoosterPack packs={q} idle className="pile p2" />}
            {q >= 2 && <BoosterPack packs={q} idle className="pile p1" />}
            <div className="pk-float"><BoosterPack packs={q} idle /></div>
          </div>

          <div className="open-panel">
            <div className="stock-line">
              <span><b>{stock.n}</b>/{MAX_STOCK} booster{stock.n > 1 ? 's' : ''} dispo</span>
              {stock.nextIn !== null && <small>+1 dans {formatTime(stock.nextIn)}</small>}
              {import.meta.env.DEV && !LIVE && (
                <button className="link" onClick={() => addStock(10)} title="Visible seulement en dev">+10 (test)</button>
              )}
            </div>

            <p className="coin-line">
              <CoinIcon className="shop-coin" />
              <span>1 booster = <b>{fmtCoins(price)}</b> X-Coins</span>
              {maxQty > 0 && <small>{affordable > 0 ? `tu peux en acheter ${Math.min(affordable, MAX_STOCK)}${affordable > MAX_STOCK ? '+' : ''}` : 'pas assez de X-Coins pour en acheter'}</small>}
            </p>

            {maxQty > 0 ? (
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
                  style={{ '--own': maxQty > 1 ? Math.min(100, (Math.max(0, stock.n - 1) / (maxQty - 1)) * 100) + '%' : '100%' }}
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

                <p className={'open-split' + (toBuy ? ' buy' : '')}>
                  {toBuy
                    ? <>{Math.min(q, stock.n) > 0 ? <><b>{Math.min(q, stock.n)}</b> de ton stock + </> : null}<b>{toBuy}</b> acheté{toBuy > 1 ? 's' : ''} · <b className="gold">{fmtCoins(cost)}</b> X-Coins</>
                    : <><b>{q}</b> pris dans ton stock · gratuit</>}
                </p>
                <button className={'btn open-btn' + (confirmBuy ? ' confirm' : '')} onClick={() => buyBooster()} disabled={loading || opening}>
                  {loading ? 'Chargement…'
                    : opening ? (toBuy ? 'Achat et tirage…' : 'Tirage des cartes…')
                      : confirmBuy ? `Confirmer l'achat (${toBuy})`
                        : q > 1 ? `Ouvrir ${q} boosters` : 'Ouvrir le booster'}
                </button>
                {openError && <p className="open-error" role="alert">{openError}</p>}
              </>
            ) : (
              <p className="muted">Plus de boosters, et pas assez de X-Coins pour en acheter. Le prochain arrive dans {formatTime(stock.nextIn)}.</p>
            )}
          </div>
        </div>
      )}

      {/* Ouverture premium d'un seul booster */}
      {step === 'premium' && (
        <PackOpening
          key={openId}
          cards={pulledCards}
          quick={quick}
          packs={openedCount}
          stockLeft={stock.n}
          onAgain={resetBooster}
          onOpenAnother={() => buyBooster(true)}
        />
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
          ? <SingleResult cards={pulledCards} color={getBestRarityColor()} onAgain={resetBooster} />
          : <MultiResult cards={pulledCards} boosters={openedCount} onAgain={resetBooster} />
      )}
    </div>
  )
}

// Résultat d'un seul booster : les 10 cartes avec l'animation de retournement
function SingleResult({ cards, color, onAgain }) {
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
function MultiResult({ cards, boosters, onAgain }) {
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
        <h2>{boosters} boosters · {cards.length} cartes</h2>
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
          </div>
        ))}
      </div>
    </div>
  )
}

// Barre de progression de la pity + tableau des taux de drop
function PityBar({ count, pity }) {
  const [open, setOpen] = useState(false)
  const epic = pity.sinceEpic
  const iconic = pity.sinceIconic
  return (
    <>
      <div className="pity-bar">
        <div>
          <span>Épique+ garantie</span>
          <div className="bar"><i style={{ width: (epic / PITY.epicPlus) * 100 + '%', background: 'var(--r-epique)' }} /></div>
          <small>{epic}/{PITY.epicPlus}</small>
        </div>
        <div>
          <span>Iconique garantie</span>
          <div className="bar"><i style={{ width: (iconic / PITY.iconique) * 100 + '%', background: 'var(--gold)' }} /></div>
          <small>{iconic}/{PITY.iconique}</small>
        </div>
        <div className="pity-total">{count} ouverts</div>
        <button className={'rates-btn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open}>Taux de drop</button>
      </div>
      {open && <DropRates onClose={() => setOpen(false)} />}
    </>
  )
}

const pct = (x) => (x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %'
function DropRates({ onClose }) {
  const ico = FEATURED_RATES.find(([r]) => r === 'iconique')[1]
  const epicPlus = FEATURED_RATES.filter(([r]) => ['epique', 'legendaire', 'iconique'].includes(r)).reduce((a, [, p]) => a + p, 0)
  return (
    <div className="rates">
      <div className="rates-head">
        <h3>Taux de drop</h3>
        <button className="link" onClick={onClose}>fermer</button>
      </div>
      <p className="rates-sub">Chaque booster contient {PACK_SIZE} cartes : 1 carte vedette et {PACK_SIZE - 1} cartes de complément.</p>
      <div className="rates-cols">
        <div>
          <h4>Carte vedette <small>= chance par booster</small></h4>
          {[...FEATURED_RATES].reverse().map(([r, p]) => (
            <div key={r} className="rate-row" style={{ '--c': getBorderColor(r) }}>
              <span>{RARITY_LABEL[r]}</span><i><b style={{ width: Math.max(1.5, p * 100) + '%' }} /></i><em>{pct(p)}</em>
            </div>
          ))}
        </div>
        <div>
          <h4>{PACK_SIZE - 1} cartes de complément</h4>
          {[...FILLER_RATES].reverse().map(([r, p]) => (
            <div key={r} className="rate-row" style={{ '--c': getBorderColor(r) }}>
              <span>{RARITY_LABEL[r]}</span><i><b style={{ width: p * 100 + '%' }} /></i><em>{pct(p)}</em>
            </div>
          ))}
        </div>
      </div>
      <ul className="rates-pity">
        <li><b>Iconique garantie</b> au {PITY.iconique}e booster sans Iconique. Avec cette garantie, le taux réel est d'environ {pct(effectiveRate(ico, PITY.iconique))} par booster.</li>
        <li><b>Épique ou mieux garantie</b> au {PITY.epicPlus}e booster sans Épique+ (taux de base : {pct(epicPlus)} par booster).</li>
        <li>Les compteurs repartent à zéro dès que tu obtiens la carte.</li>
      </ul>
    </div>
  )
}

export default Boosters

