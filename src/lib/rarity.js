export const RARITIES = ['commune', 'atypique', 'rare', 'epique', 'legendaire', 'iconique']

export const RARITY_LABEL = {
  commune: 'Commune',
  atypique: 'Atypique',
  rare: 'Rare',
  epique: 'Épique',
  legendaire: 'Légendaire',
  iconique: 'Iconique',
}

const COLORS = {
  commune: '#a4b0be',
  atypique: '#2ed573',
  rare: '#1e90ff',
  epique: '#9c88ff',
  legendaire: '#ffa502',
  iconique: '#ffffff',
}

export const getBorderColor = (rarity) => COLORS[rarity?.toLowerCase()] || COLORS.commune

export const FALLBACK_IMG = 'https://images.fifaindex.com/fc27/players/default.png'
