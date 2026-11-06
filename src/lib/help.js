// ============================================================================
// Aide courte affichée en petit sur chaque page (composant <PageHelp topic=…/>).
// Les chiffres sont lus dans le code du jeu : l'aide ne peut pas être en retard.
// Syntaxe : **gras**
// ============================================================================
import { PACK_SIZE, FEATURED_RATES, PITY } from './drops'
import { MAX_STOCK, REGEN_MS } from './boosterStock'
import { RARITY_CAP } from './chemistry'
import { ECONOMY, COIN } from './economy/config'
import { CAPTAIN_MULT } from './league/scoring'
import { DAILY_SLOTS } from './quests/templates'
import { SEASON_LENGTH } from './career/rules'
import { RARITY_LABEL } from './rarity'

const pct = (x) => `${Math.round(x * 1000) / 10} %`.replace('.', ',')
const rate = (r) => pct(FEATURED_RATES.find(([k]) => k === r)?.[1] || 0)
const caps = Object.entries(RARITY_CAP).map(([r, n]) => `${n} ${RARITY_LABEL[r]}${n > 1 ? 's' : ''}`).join(' et ')

export const HELP = {
  boosters: {
    title: 'Comment marchent les boosters ?',
    tips: [
      `Un booster = **${PACK_SIZE} cartes** : 1 carte vedette (Rare ou mieux) et ${PACK_SIZE - 1} cartes de complément.`,
      `Carte vedette : Iconique **${rate('iconique')}**, Légendaire **${rate('legendaire')}**, Épique **${rate('epique')}**.`,
      `Garanties : une Épique ou mieux au plus tard tous les **${PITY.epicPlus} boosters**, une Iconique au plus tard au **${PITY.iconique}e**.`,
      `Stock maximum : **${MAX_STOCK} boosters**, +1 toutes les ${Math.round(REGEN_MS / 60000)} min. Un booster en plus coûte ${ECONOMY.boosterPrice} ${COIN}.`,
    ],
  },
  equipe: {
    title: 'Comment composer et jouer ?',
    tips: [
      '**5 postes** : 1 gardien, 2 défenseurs ou milieux, 2 attaquants.',
      `Limite : **${caps}** maximum par équipe.`,
      'Deux voisins **du même pays** ou **du même club** sont liés : lien vert = les deux, jaune = un seul, rouge = aucun. Un bon collectif agrandit ta zone de timing.',
      'En match : **Force** bat le gardien qui reste, **Feinte** bat celui qui plonge, **Lob** bat celui qui sort. Puis tape au bon moment dans la zone verte.',
      'L\'Arène te met face à un **vrai joueur** de ton niveau. Si personne n\'est trouvé en 20 secondes, tu joues contre l\'IA. Une victoire rapporte de l\'**elo**.',
    ],
  },
  marche: {
    title: 'Comment marche le Marché ?',
    tips: [
      `Mets une carte en vente pour ${ECONOMY.durations.join(', ')} h avec un prix de départ et un achat immédiat.`,
      `Chaque enchère doit dépasser la précédente de **${ECONOMY.bidStepPct} %**. Une enchère dans les ${ECONOMY.antiSnipeSec} dernières secondes prolonge la vente.`,
      `Taxe de **${ECONOMY.marketTaxPct} %** sur le prix de vente. La vente rapide rapporte toujours moins que le Marché.`,
    ],
  },
  defis: {
    title: 'Comment marchent les défis ?',
    tips: [
      `**${DAILY_SLOTS} défis du jour**, renouvelés à minuit. Les hebdomadaires repartent le lundi, les succès sont permanents.`,
      'Ils avancent tout seuls quand tu joues, ouvres des boosters ou utilises le Marché.',
      `Un point rouge = une récompense à récupérer (${COIN}, parfois des boosters).`,
    ],
  },
  ligue: {
    title: 'Comment marche la Ligue ?',
    tips: [
      'Choisis **5 cartes** et verrouille-les avant le coup d\'envoi du vendredi soir.',
      'Elles marquent des points selon les **vrais matchs** du week-end : buts, passes, clean sheets…',
      `Ton **capitaine** rapporte ×${String(CAPTAIN_MULT).replace('.', ',')}, et une carte rare multiplie ses points positifs.`,
    ],
  },
  carriere: {
    title: 'Comment marche le Mode Carrière ?',
    tips: [
      `Un mode **solo** : un seul joueur, une saison de **${SEASON_LENGTH} matchs**. Il n'utilise pas tes cartes.`,
      'Chaque match te donne une **note sur 10**, qui donne de l\'XP. Chaque niveau = 1 point dans l\'arbre de compétences.',
      'En fin de saison, tes notes, tes buts et ton niveau attirent des **offres de transfert** dans ta boîte de réception.',
    ],
  },
  collection: {
    title: 'Comment marche la collection ?',
    tips: [
      'Toutes les cartes du jeu : **les tiennes d\'abord**, en couleur, puis celles qui te manquent, **en gris**.',
      'Clique sur un grand club (en haut à droite) pour ne voir que ses joueurs, ou ouvre « Albums par club ».',
      'Complète un album pour le faire passer en **doré**. Revends tes doublons (×2, ×3…) sur le Marché pour financer ceux qui te manquent.',
    ],
  },
  amis: {
    title: 'Comment ajouter des amis ?',
    tips: [
      'Partage ton **code ami** (en haut à droite) ou entre celui d\'un ami.',
      'Tu peux aussi entrer son **pseudo exact**. Si vous vous êtes demandés tous les deux, vous êtes amis tout de suite.',
      'Ouvre le profil d\'un ami pour voir ses victoires et ses meilleurs joueurs.',
    ],
  },
}
