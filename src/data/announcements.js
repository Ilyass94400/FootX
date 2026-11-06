// Bannières de la page d'accueil (mises à jour, events...). Modifier ici.
export const ANNOUNCEMENTS = [
  {
    tag: 'Nouveau',
    title: 'Ta partie est sauvegardée',
    text: 'Cartes, X-Coins, équipe et carrière sont gardés en ligne : joue depuis n\'importe quel appareil.',
    cta: { label: 'Ma collection', route: 'collection' },
  },
  {
    tag: 'Nouveau',
    title: 'Jouer',
    text: 'L\'Arène, Ma Ligue et le Mode Carrière sont réunis au même endroit.',
    cta: { label: 'Choisir un mode', route: 'jouer' },
  },
  {
    tag: 'Marché',
    title: 'Vends tes doublons',
    text: 'Mets tes cartes en vente aux enchères et rachète celles qui te manquent.',
    cta: { label: 'Voir le marché', route: 'marche' },
  },
  {
    tag: 'Bêta',
    title: 'Un bug, une idée ?',
    text: 'Dis-le-nous sur le Discord : le jeu évolue avec vous.',
    cta: { label: 'Ouvrir un booster', route: 'boosters' },
  },
]
