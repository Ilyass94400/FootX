// ============================================================================
// Adaptateur PRODUCTION : mêmes méthodes que localServer, mais tout passe par
// Postgres (RPC SECURITY DEFINER de 20261105_economie.sql). Le client n'écrit
// jamais un solde : il demande une action, le serveur vérifie et l'exécute.
// Actif dès que la connexion Discord est active (voir economy/index.js), après avoir
// exécuté les migrations dans Supabase (20261105 → 20261110).
// ============================================================================
import { supabase } from '../../supabase'
import { EcoError } from './localServer'
import { applyServerBoosters } from '../boosterStock'

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
        // stock de boosters modifié ailleurs (autre appareil, autre onglet)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_boosters', filter: `user_id=eq.${me}` }, () => {
          this.boosterState().catch(() => {})
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
    // Supabase renvoie 1 000 lignes maximum par requête : on lit la collection par pages
    const PAGE = 1000
    const rows = []
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await supabase.from('user_cards').select('id, listing_id, source, obtained_at, cards(*)')
        .order('obtained_at', { ascending: false }).order('id').range(from, from + PAGE - 1)
      fail(error)
      rows.push(...(data || []))
      if (!data || data.length < PAGE) break
    }
    return rows.map((r) => ({ uid: r.id, card: r.cards, at: Date.parse(r.obtained_at), source: r.source, listingId: r.listing_id }))
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
    // En ligne, le client ne crée jamais de carte : elles viennent d'open_boosters (tirage serveur).
  },
  async boosterState() {
    const { data, error } = await supabase.rpc('booster_state'); fail(error)
    applyServerBoosters(data)
    return data
  },
  // Ouverture : le SERVEUR tire les raretés et les cartes, applique les garanties et décompte le stock.
  async openBoosters(n, requestId) {
    const { data, error } = await supabase.rpc('open_boosters', { p_n: n, p_request_id: requestId }); fail(error)
    applyServerBoosters(data.state)
    emit({ type: 'inventory', n: data.cards?.length || 0 })
    return {
      cards: (data.cards || []).map((x) => ({ ...x.card, uid: x.uid })),
      forced: data.forced || [], pity: data.state?.pity, opened: data.state?.opened,
    }
  },
  async buyBoosters(n, requestId) {
    const { error } = await supabase.rpc('buy_boosters', { p_n: n, p_request_id: requestId }); fail(error)
    await this.boosterState().catch(() => {})
    return this.wallet()
  },
  // Match contre l'IA : enregistré au coup d'envoi, récompensé une seule fois à la fin.
  async matchStart(squad) {
    const { data, error } = await supabase.rpc('arena_ai_start', { p_squad: squad || {} }); fail(error)
    return data
  },
  async matchFinish(id, { win, home, away, perfect = 0, goals = [] }) {
    if (!id) throw new EcoError('not_found', 'Match non enregistré (connexion perdue au coup d\'envoi)')
    const { data, error } = await supabase.rpc('arena_ai_finish', { p_match: id, p_win: !!win, p_home: home, p_away: away, p_perfect: perfect, p_goals: goals }); fail(error)
    applyServerBoosters(data.state)
    try { localStorage.setItem('footx_win_streak', String(data.streak || 0)) } catch { /* rien */ }
    this.wallet().catch(() => {})
    return data
  },
  async claimMatchReward(matchId) { const { data, error } = await supabase.rpc('claim_match_reward', { p_match: matchId }); fail(error); return { amount: data } },
  async quicksell(uids) { const { error } = await supabase.rpc('quicksell_cards', { p_cards: uids }); fail(error); await this.wallet() },
  async createListing(uid, start, buyNow, hours) { const { data, error } = await supabase.rpc('create_listing', { p_card: uid, p_start: start, p_buy_now: buyNow, p_hours: hours }); fail(error); return data },
  async placeBid(id, amount) { const { error } = await supabase.rpc('place_bid', { p_listing: id, p_amount: amount }); fail(error); await this.wallet(); emit({ type: 'bid', listing: id, amount }) },
  async buyNow(id) { const { data, error } = await supabase.rpc('buy_now', { p_listing: id }); fail(error); await this.wallet(); emit({ type: 'bought', listing: id, price: data }) },
  async cancelListing(id) { const { error } = await supabase.rpc('cancel_listing', { p_listing: id }); fail(error) },
  async grantQuestReward() { return this.wallet() }, // en live, claim_quest crédite côté serveur
  async tick() { return [] }, // la clôture est faite par pg_cron chaque minute
}
