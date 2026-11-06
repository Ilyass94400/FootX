// ============================================================================
// Fiche d'un VRAI joueur : biographie (Wikipédia) + parcours en club (Wikidata).
// Appels directs depuis le navigateur (API publiques, CORS ouvert, sans clé),
// à la demande, puis mis en cache 30 jours dans le navigateur.
//
// Trouver le bon joueur : on cherche le nom sur Wikidata, on garde les
// footballeurs (métier Q937857 ou description "footballeur"), puis on départage
// les homonymes avec le club et la nationalité de la carte.
// ============================================================================
const WD = 'https://www.wikidata.org/w/api.php'
const CACHE = 'footx_bio_v1:'
const TTL = 30 * 864e5
const FOOTBALLER = 'Q937857'
const mem = new Map()

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
async function wd(params) {
  const r = await fetch(`${WD}?${qs({ format: 'json', origin: '*', ...params })}`)
  if (!r.ok) throw new Error('wikidata ' + r.status)
  return r.json()
}

const claimsOf = (e, p) => e?.claims?.[p] || []
const idOf = (c) => c?.mainsnak?.datavalue?.value?.id || null
const timeOf = (v) => (v?.time ? v.time.replace(/^\+/, '') : null) // "2017-08-31T00:00:00Z"
const yearOf = (t) => (t ? parseInt(t.slice(0, 4), 10) : null)
const qual = (c, p) => c?.qualifiers?.[p]?.[0]?.datavalue?.value
const amount = (v) => (v?.amount != null ? Math.round(parseFloat(v.amount)) : null)

async function labels(ids) {
  const out = {}
  const list = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < list.length; i += 50) {
    const d = await wd({ action: 'wbgetentities', ids: list.slice(i, i + 50).join('|'), props: 'labels', languages: 'fr|en' })
    for (const [id, e] of Object.entries(d.entities || {})) out[id] = e.labels?.fr?.value || e.labels?.en?.value || id
  }
  return out
}

const isNational = (label) => /^(équipe|selection|sélection)\b|national|nationale/i.test(label || '')

// Score d'un candidat : footballeur, nom proche, club et pays de la carte retrouvés
function score(e, card, L) {
  let s = 0
  const desc = norm(e.descriptions?.fr?.value || e.descriptions?.en?.value)
  if (claimsOf(e, 'P106').some((c) => idOf(c) === FOOTBALLER)) s += 5
  if (/foot|soccer|gardien/.test(desc)) s += 3
  const label = norm(e.labels?.fr?.value || e.labels?.en?.value)
  if (label === norm(card.name)) s += 2
  const club = norm(card.club)
  if (club && claimsOf(e, 'P54').some((c) => { const l = norm(L[idOf(c)]); return l && (l.includes(club) || club.includes(l)) })) s += 4
  const country = norm(card.country)
  if (country && [...claimsOf(e, 'P1532'), ...claimsOf(e, 'P27')].some((c) => norm(L[idOf(c)]).includes(country))) s += 2
  return s
}

async function lookup(card) {
  const found = await wd({ action: 'wbsearchentities', search: card.name, language: 'fr', uselang: 'fr', type: 'item', limit: 7 })
  const ids = (found.search || []).map((x) => x.id)
  if (!ids.length) return null
  const d = await wd({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|sitelinks|descriptions|labels', languages: 'fr|en' })
  const ents = ids.map((id) => d.entities?.[id]).filter(Boolean)
  const L = await labels(ents.flatMap((e) => [...claimsOf(e, 'P54'), ...claimsOf(e, 'P27'), ...claimsOf(e, 'P1532'), ...claimsOf(e, 'P413'), ...claimsOf(e, 'P552')].map(idOf)))
  const ranked = ents.map((e) => ({ e, s: score(e, card, L) })).sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || best.s < 5) return null // pas assez sûr : mieux vaut rien qu'un homonyme
  const e = best.e

  // parcours (clubs et sélection), trié par date
  const spells = claimsOf(e, 'P54').map((c) => ({
    team: L[idOf(c)] || '?',
    from: yearOf(timeOf(qual(c, 'P580'))),
    to: yearOf(timeOf(qual(c, 'P582'))),
    apps: amount(qual(c, 'P1350')),
    goals: amount(qual(c, 'P1351')),
  })).filter((x) => x.team !== '?')
    .sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999))
  const birth = timeOf(claimsOf(e, 'P569')[0]?.mainsnak?.datavalue?.value)
  const h = claimsOf(e, 'P2048')[0]?.mainsnak?.datavalue?.value
  let height = h ? parseFloat(h.amount) : null
  if (height && height < 3) height = Math.round(height * 100) // mètres → cm
  else if (height) height = Math.round(height)

  // biographie : résumé de l'article Wikipédia (français, sinon anglais)
  let bio = null
  const site = e.sitelinks?.frwiki ? ['fr', e.sitelinks.frwiki.title] : e.sitelinks?.enwiki ? ['en', e.sitelinks.enwiki.title] : null
  if (site) {
    try {
      const r = await fetch(`https://${site[0]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(site[1].replace(/ /g, '_'))}`)
      if (r.ok) { const j = await r.json(); bio = { text: j.extract || '', lang: site[0], url: j.content_urls?.desktop?.page || `https://${site[0]}.wikipedia.org/wiki/${encodeURIComponent(site[1])}` } }
    } catch { /* pas de résumé */ }
  }
  return {
    qid: e.id,
    name: e.labels?.fr?.value || e.labels?.en?.value || card.name,
    summary: e.descriptions?.fr?.value || e.descriptions?.en?.value || '',
    birth, height,
    foot: L[idOf(claimsOf(e, 'P552')[0])] || null,
    positions: claimsOf(e, 'P413').map((c) => L[idOf(c)]).filter(Boolean),
    nationality: L[idOf(claimsOf(e, 'P1532')[0])] || L[idOf(claimsOf(e, 'P27')[0])] || null,
    clubs: spells.filter((x) => !isNational(x.team)),
    national: spells.filter((x) => isNational(x.team)),
    bio,
    wikidata: `https://www.wikidata.org/wiki/${e.id}`,
  }
}

// { status: 'ok', data } | { status: 'none' } (introuvable) — lève une erreur si le réseau échoue
export function playerProfile(card) {
  const k = CACHE + card.id
  if (mem.has(k)) return mem.get(k)
  try {
    const c = JSON.parse(localStorage.getItem(k))
    if (c && Date.now() - c.at < TTL) { const p = Promise.resolve(c.v); mem.set(k, p); return p }
  } catch { /* pas de cache */ }
  const p = lookup(card).then((data) => {
    const v = data ? { status: 'ok', data } : { status: 'none' }
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })) } catch { /* plein */ }
    return v
  }).catch((err) => { mem.delete(k); throw err })
  mem.set(k, p)
  return p
}

export const ageOf = (birth) => {
  if (!birth) return null
  const b = new Date(birth)
  if (Number.isNaN(+b)) return null
  const n = new Date()
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
}
