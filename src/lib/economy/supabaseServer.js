// ============================================================================
// Adaptateur PRODUCTION : mêmes méthodes que localServer, mais tout passe par
// Postgres (RPC SECURITY DEFINER de 20261105_economie.sql). Le client n'écrit
// jamais un solde : il demande une action, le serveur vérifie et l'exécute.
// Activer avec VITE_ECONOMY=supabase dans .env.local, après avoir exécuté les migrations.
// ============================================================================
import { supabase } from '../../supabase'
import { EcoError } from './localServer'

const ROLE_POSITIONS = {
  GK: ['GK', 'GB', 'G'],
  MID: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'DEF', 'MIL', 'DC', 'DG', 'DD', 'MDC', 'MC', 'MOC'],
  ATT: ['ST', 'CF', 'LW', 'RW', 'ATT', 'BU', 'AVC', 'AIG', 'AID'],
}
const fail = (error) => {
  if (!error) return
  throw new EcoError(error.hint || error.code || 'error', error.message || 'Erreur serveur')
}
const emit = (detail) => window.dispatchEvent(new CustomEvent('footx:eco', { detail }))
const uidOf = async () => (await supabase.auth.getUser()).data.user?.id

// ligne SQL → forme utilisée par l'interface
const toListing = (r, me) => ({
  id: r.id, demo: false, seller: r.seller_id === me ? 'me' : r.seller_id, sellerName: r.seller_id === me ? 'Toi' : 'Joueur',
  uid: r.user_card_id,
  card: { id: r.card_id, name: r.card_name, rarity: r.rarity, position: r.position, club: r.club, country: r.country, image_url: r.cards?.image_url, rating: r.cards?.rating },
  startPrice: r.start_price, buyNowPrice: r.buy_now_price, currentBid: r.current_bid,
  bidder: r.current_bidder === me ? 'me' : r.current_bidder, bidCount: r.bid_count, status: r.status,
  createdAt: Date.parse(r.created_at), endsAt: Date.parse(r.ends_at), buyer: r.buyer_id === me ? 'me' : r.buyer_id, finalPrice: r.final_price,
})

let channel = null
let lastBalance = null

export const supabaseServer = {
  mode: 'live',

  async init() {
    const w = await this.wallet()
    // solde poussé en temps réel (achat sur un autre appareil, vente conclue…)
    if (!channel) {
      const me = await uidOf()
      channel = supabase.channel('eco-' + me)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_balances', filter: `user_id=eq.${me}` }, ({ new: row }) => {
          const delta = lastBalance == null ? 0 : row.balance - lastBalance
          lastBalance = row.balance
          emit({ type: 'coins', delta, balance: row.balance })
        })
        .subscribe()
    }
    return w
  },

  async wallet() {
    const [{ data: b, error }, { data: ledger }] = await Promise.all([
      supabase.from('user_balances').select('balance').maybeSingle(),
      supabase.from('transactions_history').select('id, amount, balance_after, kind, ref_id, created_at').order('created_at', { ascending: false }).limit(50),
    ])
    fail(error)
    lastBalance = b?.balance ?? 0
    emit({ type: 'sync', balance: lastBalance })
    return { balance: lastBalance, mode: 'live', ledger: (ledger || []).map((t) => ({ id: t.id, amount: t.amount, after: t.balance_after, kind: t.kind, ref: t.ref_id, at: Date.parse(t.created_at) })) }
  },

  async inventory() {
    const { data, error } = await supabase.from('user_cards').select('id, listing_id, source, obtained_at, cards(*)').order('obtained_at', { ascending: false })
    fail(error)
    return (data || []).map((r) => ({ uid: r.id, card: r.cards, at: Date.parse(r.obtained_at), source: r.source, listingId: r.listing_id }))
  },

  // Filtrage côté serveur (index SQL) : tient la charge avec 18 000+ joueurs.
  async listings({ scope = 'market', q = '', rarity = [], role = '', country = '', club = '', minPrice = '', maxPrice = '', buyNowOnly = false, sort = 'ending', page = 0, size = 24 } = {}) {
    const me = await uidOf()
    let req = supabase.from('market_listings').select('*, cards(image_url, rating)', { count: 'exact' })
    if (scope === 'market') req = req.eq('status', 'active').gt('ends_at', new Date().toISOString())
    if (scope === 'mine') req = req.eq('seller_id', me)
    if (scope === 'bids') req = req.or(`current_bidder.eq.${me},buyer_id.eq.${me}`)
    if (q.trim()) req = req.ilike('card_name', `%${q.trim()}%`)
    if (rarity.length) req = req.in('rarity', rarity)
    if (role) req = req.in('position', ROLE_POSITIONS[role] || [])
    if (country) req = req.ilike('country', country)
    if (club) req = req.ilike('club', club)
    const col = buyNowOnly ? 'buy_now_price' : 'start_price'
    if (minPrice !== '') req = req.gte(col, +minPrice)
    if (maxPrice !== '') req = req.lte(col, +maxPrice)
    const order = { ending: ['ends_at', true], priceAsc: [col, true], priceDesc: [col, false], new: ['created_at', false] }[sort] || ['ends_at', true]
    req = req.order(order[0], { ascending: order[1] }).range(page * size, page * size + size - 1)
    const { data, count, error } = await req
    fail(error)
    return { items: (data || []).map((r) => toListing(r, me)), total: count || 0 }
  },

  async addCards() {
    // En production, les cartes d'un booster sont tirées ET insérées par une Edge Function
    // (le client ne peut pas écrire dans user_cards). Rien à faire ici.
  },
  async buyBoosters(n, requestId) { const { error } = await supabase.rpc('buy_boosters', { p_n: n, p_request_id: requestId }); fail(error); return this.wallet() },
  async claimMatchReward(matchId) { const { data, error } = await supabase.rpc('claim_match_reward', { p_match: matchId }); fail(error); return { amount: data } },
  async quicksell(uids) { const { error } = await supabase.rpc('quicksell_cards', { p_cards: uids }); fail(error); await this.wallet() },
  async createListing(uid, start, buyNow, hours) { const { data, error } = await supabase.rpc('create_listing', { p_card: uid, p_start: start, p_buy_now: buyNow, p_hours: hours }); fail(error); return data },
  async placeBid(id, amount) { const { error } = await supabase.rpc('place_bid', { p_listing: id, p_amount: amount }); fail(error); await this.wallet(); emit({ type: 'bid', listing: id, amount }) },
  async buyNow(id) { const { data, error } = await supabase.rpc('buy_now', { p_listing: id }); fail(error); await this.wallet(); emit({ type: 'bought', listing: id, price: data }) },
  async cancelListing(id) { const { error } = await supabase.rpc('cancel_listing', { p_listing: id }); fail(error) },
  async tick() { return [] }, // la clôture est faite par pg_cron chaque minute
}
