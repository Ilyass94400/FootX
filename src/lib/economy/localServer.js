// ============================================================================
// "Serveur" d'économie LOCAL (mode démo, dans le navigateur).
// Il reproduit exactement les règles des fonctions SQL (prix plancher/plafond,
// enchère minimale, argent bloqué, remboursement, taxe, anti-snipe…) pour que
// l'interface soit jouable dès maintenant.
// ⚠ Rien n'est sécurisé ici (localStorage est modifiable) : en production,
//   VITE_ECONOMY=supabase bascule sur supabaseServer.js, et c'est Postgres qui
//   fait foi. Les vendeurs/enchérisseurs de ce mode sont des bots de démo.
// ============================================================================
import { ECONOMY, RARITY_ECO, ecoOf, minNextBid, afterTax, suggestedPrice } from './config'
import { roleOf } from '../collectif'
import { getStock, spendStock, addStock, MAX_STOCK } from '../boosterStock'
import { rollPack, makePicker, loadPity, savePity } from '../drops'

const KEY = 'footx_eco'
const ME = 'me'
const MARKET_SIZE = 72

export class EcoError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const now = () => Date.now()
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + now().toString(36))
const r50 = (n) => Math.max(50, Math.round(n / 50) * 50)
const snap = (c) => ({ id: c.id, name: c.name, club: c.club, country: c.country, position: c.position, rarity: String(c.rarity || 'commune').toLowerCase(), image_url: c.image_url, rating: c.rating })

function blank() {
  return { v: 1, balance: 0, ledger: [], inventory: [], listings: [], rewards: { day: '', n: 0 }, started: false, lastBot: 0, requests: {} }
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 ? s : blank() } catch { return blank() }
}
let cache = null
let catalogueRef = []
const state = () => (cache ||= load())
function save(events = []) {
  const s = state()
  if (s.ledger.length > 300) s.ledger = s.ledger.slice(0, 300)
  s.listings = s.listings.filter((l) => l.status === 'active' || l.seller === ME || l.bidder === ME || l.buyer === ME || now() - (l.settledAt || 0) < 3600e3).slice(-400)
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* stockage plein */ }
  for (const e of events) window.dispatchEvent(new CustomEvent('footx:eco', { detail: { ...e, balance: s.balance } }))
  if (!events.length) window.dispatchEvent(new CustomEvent('footx:eco', { detail: { type: 'sync', balance: s.balance } }))
}

// équivalent de _move_coins : refuse un solde négatif, écrit le grand livre.
function move(amount, kind, ref) {
  const s = state()
  if (s.balance + amount < 0) throw new EcoError('insufficient_funds', 'Solde insuffisant')
  s.balance += amount
  s.ledger.unshift({ id: uid(), amount, after: s.balance, kind, ref, at: now() })
  return { type: 'coins', delta: amount, kind }
}

// ---------------------------------------------------------------- bots de démo
const NAMES = ['LeMaestro', 'Ultra_92', 'Pibe10', 'Kaiser', 'LucarneFC', 'Gegenpress', 'TikiTaka', 'ElCapitan', 'Panenka', 'Catenaccio', 'Bicyclette', 'Petit_Pont', 'Sombrero', 'Râteau', 'Roulette', 'Talonnade']
const botName = () => NAMES[(Math.random() * NAMES.length) | 0] + (Math.random() < 0.5 ? '' : '_' + ((Math.random() * 99) | 0))
const fairValue = (card) => suggestedPrice(card).start * 1.35

function botListing(card) {
  const e = ecoOf(card)
  const sug = suggestedPrice(card)
  const start = Math.min(e.max - 50, r50(sug.start * (0.8 + Math.random() * 0.5)))
  const buyNow = Math.min(e.max, Math.max(start + 50, r50(start * (1.5 + Math.random() * 0.9))))
  const t = now()
  const life = [3600e3, 6 * 3600e3, 24 * 3600e3][(Math.random() * 3) | 0]
  const left = Math.random() < 0.18 ? 40e3 + Math.random() * 6 * 60e3 : Math.random() * life
  const hasBid = Math.random() < 0.35
  const bid = hasBid ? Math.min(buyNow - 50, r50(start * (1 + Math.random() * 0.25))) : null
  return { id: uid(), demo: true, seller: 'bot', sellerName: botName(), card: snap(card), startPrice: start, buyNowPrice: buyNow,
    currentBid: bid, bidder: hasBid ? 'bot' : null, bidCount: hasBid ? 1 + ((Math.random() * 4) | 0) : 0,
    status: 'active', createdAt: t - (life - left), endsAt: t + left }
}

// ---------------------------------------------------------------- API (mêmes noms que les RPC SQL)
// Pack de bienvenue (mêmes règles que _welcome_pack en SQL) : de quoi jouer en Arène tout de suite
function welcomePack(catalogue) {
  const mixed = [...catalogue].sort(() => Math.random() - 0.5)
  const low = (c) => ['commune', 'atypique'].includes(String(c.rarity || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  const picked = []
  const take = (role, n) => {
    const list = mixed.filter((c) => roleOf(c.position) === role && !picked.includes(c))
    picked.push(...[...list.filter(low), ...list.filter((c) => !low(c))].slice(0, n))
  }
  take('GK', 1); take('MID', 2); take('ATT', 2)
  return [...picked, ...mixed.filter((c) => !picked.includes(c)).slice(0, 10 - picked.length)]
}

export const localServer = {
  mode: 'demo',

  async init(catalogue = []) {
    const s = state()
    const events = []
    if (!s.started) {
      s.started = true
      events.push(move(ECONOMY.startBalance, 'start', null))
    }
    // pack de bienvenue : 10 cartes dont une équipe jouable (1 gardien, 2 déf/milieux, 2 attaquants).
    // Donné dès que le catalogue est connu (l'accueil démarre l'économie sans catalogue).
    if (!s.welcomed && s.inventory.length) s.welcomed = true
    if (!s.welcomed && catalogue.length) {
      s.welcomed = true
      for (const c of welcomePack(catalogue)) s.inventory.push({ uid: uid(), card: snap(c), at: now(), source: 'bienvenue', listingId: null })
      events.push({ type: 'inventory' })
    }
    if (catalogue.length) catalogueRef = catalogue
    if (catalogue.length) {
      const active = s.listings.filter((l) => l.status === 'active' && l.seller !== ME).length
      for (let i = active; i < MARKET_SIZE; i++) s.listings.push(botListing(catalogue[(Math.random() * catalogue.length) | 0]))
    }
    save(events)
    return this.wallet()
  },

  wallet() {
    const s = state()
    return { balance: s.balance, ledger: s.ledger.slice(0, 50), mode: 'demo' }
  },

  inventory() {
    return state().inventory
  },

  listings({ scope = 'market', q = '', rarity = [], role = '', country = '', club = '', minPrice = '', maxPrice = '', buyNowOnly = false, sort = 'ending', page = 0, size = 24 } = {}) {
    const t = now()
    const s = q.trim().toLowerCase()
    let list = state().listings.filter((l) => {
      if (scope === 'market') return l.status === 'active' && l.endsAt > t
      if (scope === 'mine') return l.seller === ME
      if (scope === 'bids') return l.bidder === ME || (l.buyer === ME)
      return false
    })
    const price = (l) => (buyNowOnly ? l.buyNowPrice : l.currentBid ?? l.startPrice)
    list = list.filter((l) => (!s || l.card.name?.toLowerCase().includes(s))
      && (!rarity.length || rarity.includes(l.card.rarity))
      && (!role || roleOf(l.card.position) === role)
      && (!country || l.card.country?.toLowerCase() === country.toLowerCase())
      && (!club || l.card.club?.toLowerCase() === club.toLowerCase())
      && (minPrice === '' || price(l) >= +minPrice)
      && (maxPrice === '' || price(l) <= +maxPrice))
    const by = {
      ending: (a, b) => a.endsAt - b.endsAt,
      priceAsc: (a, b) => price(a) - price(b),
      priceDesc: (a, b) => price(b) - price(a),
      new: (a, b) => b.createdAt - a.createdAt,
    }[sort] || ((a, b) => a.endsAt - b.endsAt)
    if (scope !== 'market') list.sort((a, b) => (b.status === 'active') - (a.status === 'active') || b.createdAt - a.createdAt)
    else list.sort(by)
    return { items: list.slice(page * size, page * size + size), total: list.length }
  },

  // Boutique / sources de cartes
  async addCards(cards, source = 'pack') {
    const s = state()
    for (const c of cards) s.inventory.push({ uid: uid(), card: snap(c), at: now(), source, listingId: null })
    save([{ type: 'inventory', n: cards.length }])
  },

  async buyBoosters(n, requestId) {
    if (!(n >= 1 && n <= 10)) throw new EcoError('invalid', 'Quantité invalide')
    if (getStock().n + n > MAX_STOCK) throw new EcoError('stock_full', `Stock plein (${MAX_STOCK} boosters max)`)
    const s = state()
    if (requestId && s.requests[requestId]) return this.wallet()
    const ev = move(-n * ECONOMY.boosterPrice, 'booster', String(n))
    if (requestId) s.requests[requestId] = true
    save([ev])
    addStock(n)
    return this.wallet()
  },

  // Récompense de défi (idempotente : la même clé ne paie qu'une fois, comme claim_quest en SQL).
  async grantQuestReward(key, coins) {
    const s = state()
    if (s.requests['quest:' + key]) return this.wallet()
    const ev = move(coins, 'quest_reward', key)
    s.requests['quest:' + key] = true
    save([ev])
    return this.wallet()
  },

  async claimMatchReward(matchId, win) {
    const s = state()
    const key = 'match:' + matchId
    if (s.requests[key]) return { amount: 0, already: true }
    const day = new Date().toISOString().slice(0, 10)
    if (s.rewards.day !== day) s.rewards = { day, n: 0 }
    if (s.rewards.n >= ECONOMY.matchDailyCap) return { amount: 0, capped: true }
    const amount = win ? ECONOMY.matchWin : ECONOMY.matchLoss
    const ev = move(amount, 'match_reward', matchId)
    s.rewards.n++
    s.requests[key] = true
    save([ev])
    return { amount }
  },

  // Ouverture de boosters (démo : tirage dans le navigateur, mêmes règles que open_boosters en SQL)
  async openBoosters(n, requestId, catalogue = catalogueRef) {
    if (!(n >= 1 && n <= 10)) throw new EcoError('invalid', 'Quantité invalide')
    if (!catalogue?.length) throw new EcoError('empty_catalogue', 'Catalogue en cours de chargement')
    if (!spendStock(n)) throw new EcoError('no_stock', 'Pas assez de boosters')
    const pick = makePicker(catalogue)
    let pity = loadPity()
    const cards = []
    const forced = []
    for (let i = 0; i < n; i++) {
      const r = rollPack(pity)
      cards.push(...r.rarities.map(pick))
      forced.push(r.forced)
      pity = r.pity
    }
    savePity(pity)
    let opened = 0
    try {
      opened = (parseInt(localStorage.getItem('footx_booster_count') || '0', 10) || 0) + n
      localStorage.setItem('footx_booster_count', String(opened))
    } catch { /* stockage indisponible */ }
    await this.addCards(cards, 'pack')
    return { cards, forced, pity, opened }
  },

  // Match contre l'IA (démo) : rien à réserver côté serveur
  async matchStart() {
    return { id: 'local-' + uid(), seed: null }
  },

  // Fin de match (démo) : série, booster de victoire (5/jour), X-Coins plafonnés — comme arena_ai_finish
  async matchFinish(id, { win }) {
    const num = (k) => { try { return parseFloat(localStorage.getItem(k)) || 0 } catch { return 0 } }
    const streak = win ? num('footx_win_streak') + 1 : 0
    try { localStorage.setItem('footx_win_streak', String(streak)) } catch { /* stockage indisponible */ }
    let booster = false
    let full = false
    let left = null
    if (win) {
      const today = new Date().toISOString().slice(0, 10)
      let r = {}
      try { r = JSON.parse(localStorage.getItem('footx_match_rewards') || '{}') } catch { /* rien */ }
      const got = r.day === today ? r.n : 0
      if (got >= ECONOMY.winBoostersPerDay) left = 0
      else if (!addStock(1)) { full = true; left = ECONOMY.winBoostersPerDay - got }
      else {
        booster = true
        left = ECONOMY.winBoostersPerDay - got - 1
        try { localStorage.setItem('footx_match_rewards', JSON.stringify({ day: today, n: got + 1 })) } catch { /* rien */ }
      }
    }
    const c = await this.claimMatchReward(id, win)
    return { coins: c.amount || 0, capped: !!c.capped, booster, full, left, streak }
  },

  async quicksell(uids) {
    const s = state()
    const items = s.inventory.filter((i) => uids.includes(i.uid))
    if (items.length !== uids.length || items.some((i) => i.listingId)) throw new EcoError('not_owner', 'Carte introuvable, déjà vendue ou en vente')
    const total = items.reduce((a, i) => a + ecoOf(i.card).quicksell, 0)
    s.inventory = s.inventory.filter((i) => !uids.includes(i.uid))
    const ev = move(total, 'quicksell', uids.join(','))
    save([ev, { type: 'quicksell', n: items.length, amount: total }])
    return total
  },

  async createListing(cardUid, start, buyNow, hours) {
    const s = state()
    if (!ECONOMY.durations.includes(hours)) throw new EcoError('invalid', 'Durée invalide (1h, 6h ou 24h)')
    const item = s.inventory.find((i) => i.uid === cardUid)
    if (!item) throw new EcoError('not_owner', 'Cette carte ne t\'appartient pas')
    if (item.listingId) throw new EcoError('listed', 'Carte déjà en vente')
    if (s.listings.filter((l) => l.seller === ME && l.status === 'active').length >= ECONOMY.maxListings) throw new EcoError('too_many', 'Trop d\'annonces actives')
    const e = RARITY_ECO[item.card.rarity] || RARITY_ECO.commune
    if (start < e.min || buyNow > e.max || buyNow <= start) throw new EcoError('price_range', `Prix hors fourchette (${e.min} – ${e.max})`)
    const l = { id: uid(), seller: ME, sellerName: 'Toi', uid: item.uid, card: item.card, startPrice: start, buyNowPrice: buyNow,
      currentBid: null, bidder: null, bidCount: 0, status: 'active', createdAt: now(), endsAt: now() + hours * 3600e3 }
    s.listings.push(l)
    item.listingId = l.id
    save([{ type: 'listed', listing: l.id }])
    return l.id
  },

  async placeBid(id, amount) {
    const s = state()
    const l = s.listings.find((x) => x.id === id)
    if (!l || l.status !== 'active' || l.endsAt <= now()) throw new EcoError('closed', 'Enchère terminée')
    if (l.seller === ME) throw new EcoError('own', 'Tu ne peux pas enchérir sur ta propre carte')
    if (l.bidder === ME) throw new EcoError('leading', 'Tu es déjà le meilleur enchérisseur')
    const min = minNextBid(l)
    if (amount < min) throw new EcoError('bid_too_low', `Enchère minimale : ${min}`)
    if (amount >= l.buyNowPrice) throw new EcoError('use_buy_now', 'Utilise l\'achat immédiat')
    const ev = move(-amount, 'bid_hold', id) // argent bloqué
    l.currentBid = amount
    l.bidder = ME
    l.bidCount++
    l.endsAt = Math.max(l.endsAt, now() + ECONOMY.antiSnipeSec * 1000)
    save([ev, { type: 'bid', listing: id, amount }])
    return amount
  },

  async buyNow(id) {
    const s = state()
    const l = s.listings.find((x) => x.id === id)
    if (!l || l.status !== 'active' || l.endsAt <= now()) throw new EcoError('closed', 'Déjà vendu ou terminé')
    if (l.seller === ME) throw new EcoError('own', 'C\'est ta propre carte')
    const events = [move(-l.buyNowPrice, 'market_buy', id)]
    if (l.bidder === ME) events.push(move(l.currentBid, 'bid_refund', id))
    Object.assign(l, { status: 'sold', buyer: ME, finalPrice: l.buyNowPrice, settledAt: now() })
    s.inventory.push({ uid: uid(), card: l.card, at: now(), source: 'marché', listingId: null })
    save([...events, { type: 'bought', listing: id, card: l.card, price: l.buyNowPrice }])
    return l.buyNowPrice
  },

  async cancelListing(id) {
    const s = state()
    const l = s.listings.find((x) => x.id === id)
    if (!l || l.seller !== ME) throw new EcoError('not_found', 'Annonce introuvable')
    if (l.status !== 'active') throw new EcoError('closed', 'Annonce déjà terminée')
    if (l.bidder) throw new EcoError('has_bid', 'Impossible : il y a déjà une enchère')
    Object.assign(l, { status: 'cancelled', settledAt: now() })
    const item = s.inventory.find((i) => i.uid === l.uid)
    if (item) item.listingId = null
    save([{ type: 'cancelled', listing: id }])
  },

  // Clôture des enchères échues + activité des bots. Appelée chaque seconde par l'interface.
  async tick() {
    const s = state()
    const t = now()
    const events = []
    // bots : de temps en temps, une enchère ou un achat
    if (t - s.lastBot > 3500) {
      s.lastBot = t
      const active = s.listings.filter((l) => l.status === 'active' && l.endsAt > t)
      const mine = active.filter((l) => l.seller === ME)
      for (const l of mine) {
        const fair = fairValue(l.card)
        if (l.buyNowPrice <= fair * 0.95 && Math.random() < 0.06) {
          // un bot achète immédiatement ta carte
          if (l.bidder === 'bot') { /* argent bot : rien à rembourser côté joueur */ }
          Object.assign(l, { status: 'sold', buyer: 'bot', buyerName: botName(), finalPrice: l.buyNowPrice, settledAt: t })
          s.inventory = s.inventory.filter((i) => i.uid !== l.uid)
          events.push(move(afterTax(l.buyNowPrice), 'market_sale', l.id), { type: 'sold', listing: l.id, card: l.card, price: l.buyNowPrice })
        } else if (minNextBid(l) <= fair && minNextBid(l) < l.buyNowPrice && Math.random() < 0.12) {
          l.currentBid = minNextBid(l); l.bidder = 'bot'; l.bidCount++
          l.endsAt = Math.max(l.endsAt, t + ECONOMY.antiSnipeSec * 1000)
          events.push({ type: 'bid_received', listing: l.id, amount: l.currentBid })
        }
      }
      const others = active.filter((l) => l.seller !== ME)
      for (let i = 0; i < 2 && others.length; i++) {
        const l = others[(Math.random() * others.length) | 0]
        const next = minNextBid(l)
        if (next >= l.buyNowPrice || next > fairValue(l.card) * 1.15) continue
        if (l.bidder === ME) {
          events.push(move(l.currentBid, 'bid_refund', l.id), { type: 'outbid', listing: l.id, card: l.card })
        }
        l.currentBid = next; l.bidder = 'bot'; l.bidCount++
        l.endsAt = Math.max(l.endsAt, t + ECONOMY.antiSnipeSec * 1000)
      }
    }
    // clôtures
    for (const l of s.listings) {
      if (l.status !== 'active' || l.endsAt > t) continue
      if (l.bidder) {
        Object.assign(l, { status: 'sold', buyer: l.bidder, finalPrice: l.currentBid, settledAt: t })
        if (l.bidder === ME) {
          s.inventory.push({ uid: uid(), card: l.card, at: t, source: 'marché', listingId: null })
          events.push({ type: 'won', listing: l.id, card: l.card, price: l.currentBid })
        }
        if (l.seller === ME) {
          s.inventory = s.inventory.filter((i) => i.uid !== l.uid)
          events.push(move(afterTax(l.currentBid), 'market_sale', l.id), { type: 'sold', listing: l.id, card: l.card, price: l.currentBid })
        }
      } else {
        Object.assign(l, { status: 'expired', settledAt: t })
        if (l.seller === ME) {
          const item = s.inventory.find((i) => i.uid === l.uid)
          if (item) item.listingId = null
          events.push({ type: 'expired', listing: l.id, card: l.card })
        }
      }
    }
    // le marché reste vivant : de nouvelles annonces remplacent celles qui se terminent
    if (catalogueRef.length) {
      const live = s.listings.filter((l) => l.status === 'active' && l.seller !== ME).length
      for (let i = live; i < MARKET_SIZE * 0.85; i++) s.listings.push(botListing(catalogueRef[(Math.random() * catalogueRef.length) | 0]))
      if (live < MARKET_SIZE * 0.85) save(events)
      else if (events.length) save(events)
    } else if (events.length) save(events)
    return events
  },
}
