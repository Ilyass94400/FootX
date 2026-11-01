import { useEffect, useState } from 'react'
import { supabase } from './supabase'

function App() {
  const [cards, setCards] = useState([])
  const [pulledCards, setPulledCards] = useState([]) 
  const [step, setStep] = useState('idle') 
  const [walkoutStep, setWalkoutStep] = useState('none')

  // 🌟 NOUVEAU : Le compteur de Pity sauvegardé dans le navigateur
  const [boosterCount, setBoosterCount] = useState(() => {
    const saved = localStorage.getItem('footx_booster_count')
    return saved ? parseInt(saved) : 0
  })

  const [totalCardsCount, setTotalCardsCount] = useState(0)
  const [rareCardsCount, setRareCardsCount] = useState(0) 
  const [epicCardsCount, setEpicCardsCount] = useState(0) // Pour la garantie tous les 10
  const [iconicCardsCount, setIconicCardsCount] = useState(0) // Pour la garantie tous les 200

  useEffect(() => {
    fetchInitialData()
  }, [])

  const fetchInitialData = async () => {
    const { count: total } = await supabase.from('cards').select('*', { count: 'exact', head: true })
    setTotalCardsCount(total || 0)
    
    const { count: rareCount } = await supabase.from('cards').select('*', { count: 'exact', head: true }).in('rarity', ['rare', 'epique', 'legendaire', 'iconique'])
    setRareCardsCount(rareCount || 0)

    // 🌟 NOUVEAU : On compte les pools supérieurs pour la Pity
    const { count: epicCount } = await supabase.from('cards').select('*', { count: 'exact', head: true }).in('rarity', ['epique', 'legendaire', 'iconique'])
    setEpicCardsCount(epicCount || 0)

    const { count: iconicCount } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('rarity', 'iconique')
    setIconicCardsCount(iconicCount || 0)

    const { data, error } = await supabase.from('cards').select('*').limit(50)
    if (!error) setCards(data)
  }

  const getBorderColor = (rarity) => {
    const colors = {
      'commune': '#a4b0be',
      'atypique': '#2ed573',
      'rare': '#1e90ff',
      'epique': '#9c88ff',
      'legendaire': '#ffa502',
      'iconique': '#ffffff'
    }
    return colors[rarity?.toLowerCase()] || '#a4b0be'
  }

  // 🌟 NOUVEAU : Fonction de tirage intelligente selon le Tier demandé
  const pullSingleCard = async (tier) => {
    let allowedRarities = []
    let maxCount = 0

    if (tier === 'iconic' && iconicCardsCount > 0) {
      allowedRarities = ['iconique']
      maxCount = iconicCardsCount
    } else if (tier === 'epic_plus' && epicCardsCount > 0) {
      allowedRarities = ['epique', 'legendaire', 'iconique']
      maxCount = epicCardsCount
    } else if (tier === 'rare_plus' && rareCardsCount > 0) {
      allowedRarities = ['rare', 'epique', 'legendaire', 'iconique']
      maxCount = rareCardsCount
    } else {
      // Carte standard aléatoire (tier === 'any')
      const randomIndex = Math.floor(Math.random() * totalCardsCount)
      const { data } = await supabase.from('cards').select('*').range(randomIndex, randomIndex)
      return data?.[0]
    }

    // Tirage dans le pool spécifique
    const randomIndex = Math.floor(Math.random() * maxCount)
    let query = supabase.from('cards').select('*')
    
    // Si ce n'est pas "Iconique" strict, on cherche dans la liste
    if (tier === 'iconic') {
      query = query.eq('rarity', 'iconique')
    } else {
      query = query.in('rarity', allowedRarities)
    }

    const { data } = await query.range(randomIndex, randomIndex)
    return data?.[0]
  }

  const buyBooster = async () => {
    if (totalCardsCount === 0 || step !== 'idle') return
    
    // 🌟 NOUVEAU : On incrémente et sauvegarde le compteur de boosters
    const newCount = boosterCount + 1
    setBoosterCount(newCount)
    localStorage.setItem('footx_booster_count', newCount.toString())

    // 🌟 LOGIQUE DE PITY
    let guaranteedTier = 'rare_plus' // Par défaut : 1 rare minimum
    if (newCount % 200 === 0) {
      guaranteedTier = 'iconic' // Tous les 200 = Iconique !
    } else if (newCount % 10 === 0) {
      guaranteedTier = 'epic_plus' // Tous les 10 = Epique+ !
    }

    const promises = []
    // 9 cartes aléatoires classiques
    for (let i = 0; i < 9; i++) promises.push(pullSingleCard('any'))
    
    // La 10ème carte (la garantie avec la Pity)
    promises.push(pullSingleCard(guaranteedTier)) 

    const newCards = await Promise.all(promises)
    const validCards = newCards.filter(c => c)
    const rarityValue = { 'commune': 1, 'atypique': 2, 'rare': 3, 'epique': 4, 'legendaire': 5, 'iconique': 6 }
    validCards.sort((a, b) => (rarityValue[b.rarity?.toLowerCase()] || 0) - (rarityValue[a.rarity?.toLowerCase()] || 0))
    
    setPulledCards(validCards)
    setStep('pack_ready')
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

  return (
    <div className={step === 'opening' ? 'screen-shake' : ''} style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#0b0c10', minHeight: '100vh', color: 'white', position: 'relative', overflow: 'hidden' }}>
      
      <style>
        {`
          @keyframes globalShake {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            10%, 30%, 50%, 70%, 90% { transform: translate(-5px, 5px) rotate(-1deg); }
            20%, 40%, 60%, 80% { transform: translate(5px, -5px) rotate(1deg); }
          }
          .screen-shake { animation: globalShake 2.5s cubic-bezier(.36,.07,.19,.97) both; }

          @keyframes floatBooster {
            0%, 100% { transform: translateY(0px) scale(1); box-shadow: 0 15px 35px rgba(0,0,0,0.6); }
            50% { transform: translateY(-15px) scale(1.02); box-shadow: 0 30px 50px rgba(0,0,0,0.5); }
          }
          
          @keyframes explodeBooster {
            0% { transform: scale(1); filter: brightness(1); }
            40% { transform: scale(0.95) rotate(-3deg); filter: brightness(1.3); }
            80% { transform: scale(1.2) rotate(3deg); filter: brightness(2) drop-shadow(0 0 80px var(--rarity-color)); }
            100% { transform: scale(2.5); opacity: 0; filter: brightness(10); }
          }

          @keyframes flashScreen {
            0% { background-color: transparent; }
            80% { background-color: transparent; }
            95% { background-color: white; opacity: 1; }
            100% { background-color: var(--rarity-color); opacity: 0.2; }
          }

          @keyframes cardFlip3D {
            0% { transform: scale(0) rotateY(180deg) translateY(300px); opacity: 0; filter: blur(5px); }
            60% { transform: scale(1.1) rotateY(20deg) translateY(-20px); opacity: 1; filter: blur(0px); }
            100% { transform: scale(1) rotateY(0deg) translateY(0); opacity: 1; box-shadow: 0px 15px 25px rgba(0,0,0,0.6); }
          }

          @keyframes bestCardLevitate {
            0%, 100% { transform: translateY(0px); box-shadow: 0 15px 35px var(--rarity-color); }
            50% { transform: translateY(-10px); box-shadow: 0 25px 50px var(--rarity-color); }
          }
          
          @keyframes walkoutImpact {
            0% { transform: scale(3); opacity: 0; filter: blur(10px); }
            50% { transform: scale(0.9); opacity: 1; filter: blur(0px); }
            100% { transform: scale(1); opacity: 1; filter: blur(0px); }
          }
          .walkout-text { 
            animation: walkoutImpact 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; 
            text-transform: uppercase; font-weight: 900; letter-spacing: 5px; 
            margin: 10px 0; text-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 40px var(--rarity-color);
          }

          .booster-card-ui {
            width: 280px; height: 420px;
            background: linear-gradient(145deg, #1f2128, #121317);
            border: 2px solid #2a2e39; border-radius: 20px;
            position: relative; overflow: hidden; display: flex; flex-direction: column;
            align-items: center; justify-content: space-between; padding: 25px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.7);
          }
          
          .booster-card-ui::before {
            content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
            background: linear-gradient(45deg, transparent 45%, rgba(255,255,255,0.03) 50%, transparent 55%);
            pointer-events: none;
          }

          .booster-idle { animation: floatBooster 3s ease-in-out infinite; cursor: pointer; transition: transform 0.3s; }
          .booster-idle:hover { transform: scale(1.03) translateY(-5px); border-color: var(--rarity-color); box-shadow: 0 0 30px var(--rarity-color)40; }
          .booster-exploding { animation: explodeBooster 2.5s forwards cubic-bezier(0.25, 0.46, 0.45, 0.94); cursor: default; }
          .flash-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 99; animation: flashScreen 2.5s forwards; }
          
          .card-container { perspective: 1000px; position: relative; }
          .card-3d-reveal { animation: cardFlip3D 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; opacity: 0; transition: transform 0.3s ease, box-shadow 0.3s ease; transform-style: preserve-3d; cursor: pointer; }
          .card-container:hover .card-3d-reveal { transform: scale(1.15) translateY(-15px) rotateX(10deg) rotateY(-10deg) !important; box-shadow: -10px 20px 30px rgba(0,0,0,0.8), 0 0 20px var(--rarity-color) !important; z-index: 10; }
          .card-3d-reveal::after { content: ''; position: absolute; top: 0; left: -150%; width: 150%; height: 100%; background: linear-gradient(115deg, transparent 20%, rgba(255, 255, 255, 0.6) 40%, rgba(255, 255, 255, 0.1) 60%, transparent 80%); transform: skewX(-20deg); transition: all 0.5s ease; pointer-events: none; z-index: 5; }
          .card-container:hover .card-3d-reveal::after { left: 150%; transition: all 0.7s ease; }
        `}
      </style>

      {(step === 'opening' || step === 'walkout') && (
        <div className="flash-overlay" style={{ '--rarity-color': getBestRarityColor() }}></div>
      )}

      {/* HEADER AVEC COMPTEUR DE PITY */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1100px', margin: '0 auto 30px auto', paddingBottom: '15px', borderBottom: '1px solid #222' }}>
        <h2 style={{ margin: 0, letterSpacing: '2px', color: '#fff' }}>⚽ FootX TCG</h2>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '4px' }}>Base : <strong>{totalCardsCount}</strong> joueurs</div>
          <div style={{ color: '#ffd700', fontSize: '12px', fontWeight: 'bold' }}>📦 Boosters ouverts : {boosterCount}</div>
        </div>
      </div>

      {step === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="booster-card-ui booster-idle" onClick={buyBooster} style={{ '--rarity-color': '#1e90ff' }}>
            <div style={{ fontSize: '12px', letterSpacing: '2px', color: '#888', textTransform: 'uppercase' }}>FootX Series</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '60px', marginBottom: '10px' }}>⚽</div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '24px', letterSpacing: '3px' }}>FOOTX</h2>
              <p style={{ margin: 0, fontSize: '11px', color: '#777' }}>Édition Top 5 Ligues</p>
            </div>
            <div style={{ backgroundColor: '#141519', border: '1px solid #333', padding: '8px 20px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', color: '#ccc' }}>
              10 cartes
            </div>
          </div>
          <p style={{ marginTop: '25px', color: '#666', fontSize: '13px' }}>Clique sur le booster pour l'ouvrir</p>
          <button onClick={buyBooster} style={{ marginTop: '15px', padding: '14px 30px', fontSize: '18px', fontWeight: '900', background: 'linear-gradient(45deg, #3b82f6, #1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', boxShadow: '0 5px 15px rgba(59, 130, 246, 0.4)', textTransform: 'uppercase', transition: 'transform 0.2s' }}>
            Ouvrir un booster
          </button>
        </div>
      )}

      {(step === 'pack_ready' || step === 'opening') && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', position: 'relative', zIndex: 2 }}>
          {step === 'pack_ready' && (
            <p style={{ color: getBestRarityColor(), textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '20px', animation: 'floatBooster 2s infinite', fontWeight: 'bold', fontSize: '14px' }}>
              ✨ Clique sur le booster pour déchirer ! ✨
            </p>
          )}
          <div 
            onClick={clickToOpen}
            className={step === 'pack_ready' ? "booster-card-ui booster-idle" : "booster-card-ui booster-exploding"} 
            style={{ '--rarity-color': getBestRarityColor(), border: `2px solid ${step === 'pack_ready' ? getBestRarityColor() : '#333'}` }}
          >
            <div style={{ fontSize: '12px', letterSpacing: '2px', color: getBestRarityColor(), textTransform: 'uppercase' }}>Prêt à ouvrir</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '70px', marginBottom: '10px' }}>⚽</div>
              <h2 style={{ margin: '0 0 5px 0', fontSize: '26px', letterSpacing: '3px' }}>PACK FOOTX</h2>
            </div>
            <div style={{ backgroundColor: '#141519', border: `1px solid ${getBestRarityColor()}`, padding: '8px 20px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', color: getBestRarityColor() }}>
              10 Joueurs
            </div>
          </div>
        </div>
      )}

      {step === 'walkout' && (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', position: 'relative', zIndex: 10, '--rarity-color': getBestRarityColor() }}>
          {(walkoutStep === 'nation' || walkoutStep === 'position' || walkoutStep === 'club') && (
            <h1 key="nation" className="walkout-text" style={{ fontSize: '60px', color: 'white' }}>🌍 {pulledCards[0].country}</h1>
          )}
          {(walkoutStep === 'position' || walkoutStep === 'club') && (
            <h1 key="position" className="walkout-text" style={{ fontSize: '75px', color: getBestRarityColor() }}>🎯 {pulledCards[0].position}</h1>
          )}
          {walkoutStep === 'club' && (
            <h1 key="club" className="walkout-text" style={{ fontSize: '55px', color: 'white' }}>🛡️ {pulledCards[0].club}</h1>
          )}
        </div>
      )}

      {step === 'cards_revealed' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '50px', padding: '30px', backgroundColor: '#13151b', borderRadius: '20px', position: 'relative', zIndex: 2, border: '1px solid #222', maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '30px' }}>
            <h2 style={{ color: getBestRarityColor(), textTransform: 'uppercase', letterSpacing: '3px', textShadow: `0px 0px 15px ${getBestRarityColor()}`, margin: 0, fontSize: '20px' }}>
              {pulledCards[0].rarity === 'Iconique' || pulledCards[0].rarity === 'Legendaire' ? '🔥 WALKOUT LÉGENDAIRE 🔥' : '🎉 RÉSULTAT DU PACK 🎉'}
            </h2>
            <button onClick={resetBooster} style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: 'background 0.2s' }} onMouseOver={e => e.target.style.backgroundColor='#1d4ed8'} onMouseOut={e => e.target.style.backgroundColor='#2563eb'}>
              🔄 Ouvrir un autre
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {pulledCards.map((card, index) => {
              const isBestCard = index === 0;
              return (
                <div key={index + card.id + Date.now()} className="card-container" style={{ zIndex: isBestCard ? 5 : 1 }}>
                  <div 
                    className="card-3d-reveal" 
                    style={{ 
                      border: `${isBestCard ? '4px' : '2px'} solid ${getBorderColor(card.rarity)}`, 
                      backgroundColor: '#0f1015', padding: '10px', width: isBestCard ? '190px' : '150px',
                      borderRadius: '12px', textAlign: 'center', 
                      '--rarity-color': getBorderColor(card.rarity),
                      animationDelay: `${index * 0.12}s`, 
                      animation: `cardFlip3D 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards ${index * 0.12}s ${isBestCard ? ', bestCardLevitate 3s infinite 1s' : ''}`,
                      position: 'relative', overflow: 'hidden'
                    }}
                  >
                    <h4 style={{ margin: '5px 0', fontSize: isBestCard ? '15px' : '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: isBestCard ? `0 0 10px ${getBorderColor(card.rarity)}` : 'none' }}>
                      {card.name}
                    </h4>
                    <div style={{ position: 'relative' }}>
                      <img 
                        src={card.image_url} 
                        alt={card.name} 
                        onError={(e) => { e.target.src = "https://images.fifaindex.com/fc27/players/default.png"; }} 
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
      )}
      
      {/* CATALOGUE */}
      <div style={{ maxWidth: '1100px', margin: '60px auto 0 auto' }}>
        <h3 style={{ color: '#555', textAlign: 'center', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '2px' }}>Aperçu du catalogue</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', opacity: 0.5, marginTop: '20px' }}>
          {cards.map((card) => (
            <div key={card.id} style={{ border: `1px solid ${getBorderColor(card.rarity)}`, backgroundColor: '#111', padding: '6px', width: '90px', borderRadius: '8px', textAlign: 'center' }}>
              <img 
                src={card.image_url} 
                alt={card.name} 
                onError={(e) => { e.target.src = "https://images.fifaindex.com/fc27/players/default.png"; }}
                style={{ width: '100%', borderRadius: '4px', height: '90px', objectFit: 'cover' }} 
              />
              <p style={{ margin: '4px 0 0 0', fontSize: '9px', color: getBorderColor(card.rarity), fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App