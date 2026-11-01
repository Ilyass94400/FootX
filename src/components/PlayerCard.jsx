import { getBorderColor, RARITY_LABEL, FALLBACK_IMG } from '../lib/rarity'

export default function PlayerCard({ card, small }) {
  const color = getBorderColor(card.rarity)
  return (
    <div className={'pcard' + (small ? ' small' : '') + (card.rarity?.toLowerCase() === 'iconique' ? ' iconic' : '')} style={{ '--c': color }}>
      <img
        src={card.image_url}
        alt={card.name}
        loading="lazy"
        onError={(e) => { e.target.src = FALLBACK_IMG }}
      />
      <div className="pcard-body">
        <strong>{card.name}</strong>
        {!small && <small>{card.club}</small>}
        <span className="pcard-rarity">{RARITY_LABEL[card.rarity?.toLowerCase()] || card.rarity}</span>
      </div>
    </div>
  )
}
