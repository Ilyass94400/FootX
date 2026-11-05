// ============================================================================
// FootX — catalogue des Défis. MIROIR de la table `quest_templates`
// (supabase/migrations/20261106_defis.sql). Côté serveur, c'est la table qui fait foi.
//
//   event  : type d'événement qui fait avancer le défi (voir EVENTS)
//   mode   : 'inc' = on additionne (3 matchs joués) · 'max' = on garde la meilleure valeur
//            (50 Iconiques possédées, collectif 3/3 atteint)
//   filter : conditions sur l'événement (ex. buts marqués par un joueur français)
// ============================================================================

export const EVENTS = {
  match_played: 'Match d\'Arène joué',
  match_won: 'Match d\'Arène gagné',
  goal_scored: 'But marqué en Arène',
  perfect_qte: 'Timing parfait',
  booster_opened: 'Booster ouvert',
  market_buy: 'Achat sur le Marché',
  market_sale: 'Vente sur le Marché',
  market_list: 'Carte mise en vente',
  quicksell: 'Vente rapide',
  league_lock: 'Compo de Ligue verrouillée',
  team_chem: 'Meilleur collectif individuel',
  team_chem_total: 'Collectif d\'équipe',
  collection_iconique: 'Iconiques possédées',
  collection_legendaire: 'Légendaires possédées',
}

// Quotidiens : 3 tirés chaque jour dans ce pool (tirage fixe pour la journée, propre à chaque joueur).
export const DAILY_SLOTS = 3
export const DAILY = [
  { id: 'd_play3', title: 'Échauffement', desc: 'Joue 3 matchs dans l\'Arène', event: 'match_played', target: 3, coins: 300, icon: 'ball' },
  { id: 'd_win1', title: 'Premier sang', desc: 'Gagne 1 match d\'Arène', event: 'match_won', target: 1, coins: 250, icon: 'trophy' },
  { id: 'd_goals3', title: 'Buteur du jour', desc: 'Marque 3 buts dans l\'Arène', event: 'goal_scored', target: 3, coins: 300, icon: 'boot' },
  { id: 'd_perfect2', title: 'Sang-froid', desc: 'Réussis 2 timings parfaits', event: 'perfect_qte', target: 2, coins: 250, icon: 'target' },
  { id: 'd_booster1', title: 'Déchire-le', desc: 'Ouvre 1 booster', event: 'booster_opened', target: 1, coins: 150, icon: 'pack' },
  { id: 'd_buy1', title: 'Mercato', desc: 'Achète un joueur sur le Marché', event: 'market_buy', target: 1, coins: 200, icon: 'cart' },
  { id: 'd_list1', title: 'Vitrine', desc: 'Mets une carte en vente sur le Marché', event: 'market_list', target: 1, coins: 150, icon: 'tag' },
]

// Hebdomadaires : tous actifs, réinitialisés le lundi.
export const WEEKLY = [
  { id: 'w_win10', title: 'Série en cours', desc: 'Gagne 10 matchs d\'Arène', event: 'match_won', target: 10, coins: 2500, boosters: 1, icon: 'trophy' },
  { id: 'w_goals_fr', title: 'Les Bleus', desc: 'Marque 5 buts avec des joueurs français', event: 'goal_scored', target: 5, filter: { country: 'France' }, coins: 1500, icon: 'flag' },
  { id: 'w_league', title: 'Coach du week-end', desc: 'Verrouille ta composition de Ligue', event: 'league_lock', target: 1, coins: 1000, icon: 'lock' },
  { id: 'w_boosters10', title: 'Collectionneur', desc: 'Ouvre 10 boosters', event: 'booster_opened', target: 10, coins: 1000, icon: 'pack' },
  { id: 'w_sales3', title: 'Agent de joueurs', desc: 'Vends 3 cartes sur le Marché', event: 'market_sale', target: 3, coins: 1200, icon: 'coins' },
]

// Carrière : ne se réinitialisent jamais.
export const MILESTONES = [
  { id: 'm_first_win', title: 'Première victoire', desc: 'Gagne ton premier match d\'Arène', event: 'match_won', target: 1, coins: 500, icon: 'trophy' },
  { id: 'm_chem3', title: 'Connexion parfaite', desc: 'Aligne un joueur avec un collectif de 3/3', event: 'team_chem', mode: 'max', target: 3, coins: 1000, icon: 'link' },
  { id: 'm_chem15', title: 'Onze… cinq de légende', desc: 'Atteins un collectif d\'équipe parfait de 15/15', event: 'team_chem_total', mode: 'max', target: 15, coins: 5000, boosters: 1, icon: 'link' },
  { id: 'm_legend10', title: 'Panthéon', desc: 'Possède 10 joueurs Légendaires', event: 'collection_legendaire', mode: 'max', target: 10, coins: 5000, icon: 'star' },
  { id: 'm_transfers10', title: 'Directeur sportif', desc: 'Réalise 10 achats sur le Marché', event: 'market_buy', target: 10, coins: 3000, icon: 'cart' },
  { id: 'm_wins100', title: 'Centurion', desc: 'Atteins 100 victoires en Arène', event: 'match_won', target: 100, coins: 20000, boosters: 2, icon: 'crown' },
  { id: 'm_iconic50', title: 'Musée vivant', desc: 'Possède 50 joueurs Iconiques', event: 'collection_iconique', mode: 'max', target: 50, coins: 25000, boosters: 3, icon: 'crown' },
]

export const ALL = [
  ...DAILY.map((q) => ({ ...q, category: 'daily' })),
  ...WEEKLY.map((q) => ({ ...q, category: 'weekly' })),
  ...MILESTONES.map((q) => ({ ...q, category: 'milestone' })),
].map((q) => ({ mode: 'inc', filter: null, boosters: 0, ...q }))

export const BY_ID = Object.fromEntries(ALL.map((q) => [q.id, q]))
