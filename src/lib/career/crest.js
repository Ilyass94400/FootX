// ============================================================================
// Blasons générés (aucun logo officiel) : forme d'écu, deux couleurs et motif
// tirés du nom du club, initiales au centre, étoiles pour les clubs d'élite.
// ============================================================================

// Paires de couleurs « de club » (fond, accent)
const PALETTES = [
  ['#a50044', '#004d98'], ['#ffffff', '#1d2b5c'], ['#e30613', '#ffd200'], ['#0b2a5c', '#e4002b'],
  ['#d40000', '#ffffff'], ['#00a650', '#ffffff'], ['#1a1a1a', '#ffffff'], ['#6cabdd', '#1c2c5b'],
  ['#ffcc00', '#111111'], ['#5c0f8b', '#ffffff'], ['#0057b8', '#ffd700'], ['#c8102e', '#00205b'],
  ['#e87722', '#1d1d1b'], ['#007a33', '#f2c230'], ['#00529f', '#ffffff'], ['#8b0000', '#f5d76e'],
]
const PATTERNS = ['stripes', 'half', 'band', 'chevron', 'plain', 'quarters']
const STOP = new Set(['fc', 'cf', 'ac', 'as', 'rc', 'sc', 'ss', 'sv', 'afc', 'ogc', 'fk', 'sk', 'cd', 'ud', 'real', 'club', 'de', 'du', 'la', 'le', 'des', 'of', 'the', 'et', 'and'])

export const hashStr = (s) => {
  let h = 2166136261
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function clubColors(name) {
  const [a, b] = PALETTES[hashStr(name) % PALETTES.length]
  return { primary: a, secondary: b }
}

// "FC Barcelone" → "FCB", "Real Madrid" → "RM", "RC Lens" → "RCL", "Liverpool" → "LIV"
export function clubInitials(name = '') {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  const core = words.filter((w) => !STOP.has(w.toLowerCase()))
  const pre = words.filter((w) => STOP.has(w.toLowerCase()) && w.length <= 3).slice(0, 2)
  const letters = [...pre, ...(core.length ? core : words)].map((w) => w[0]).join('')
  return letters.slice(0, 3).toUpperCase()
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function crestSvg(name, { tier = 4 } = {}) {
  const h = hashStr(name)
  const { primary: p, secondary: s } = clubColors(name)
  const pat = PATTERNS[(h >> 5) % PATTERNS.length]
  const ini = esc(clubInitials(name))
  const shield = 'M50 4 L92 16 V52 C92 80 72 96 50 106 C28 96 8 80 8 52 V16 Z'
  let motif = ''
  if (pat === 'stripes') motif = [22, 42, 62].map((x) => `<rect x="${x}" y="0" width="10" height="120" fill="${s}"/>`).join('')
  if (pat === 'half') motif = `<rect x="50" y="0" width="60" height="120" fill="${s}"/>`
  if (pat === 'band') motif = `<rect x="0" y="40" width="100" height="22" fill="${s}" transform="rotate(-18 50 52)"/>`
  if (pat === 'chevron') motif = `<path d="M0 30 L50 62 L100 30 V50 L50 82 L0 50 Z" fill="${s}"/>`
  if (pat === 'quarters') motif = `<rect x="50" y="0" width="60" height="55" fill="${s}"/><rect x="0" y="55" width="50" height="60" fill="${s}"/>`
  const stars = tier === 1 ? '<g fill="#f5c542">' + [34, 50, 66].map((x) => `<path transform="translate(${x} -1) scale(.5)" d="M0 -9 L2.6 -2.8 L9 -2.8 L3.9 1.2 L5.8 7.6 L0 3.8 L-5.8 7.6 L-3.9 1.2 L-9 -2.8 L-2.6 -2.8 Z"/>`).join('') + '</g>' : ''
  const fs = ini.length >= 3 ? 26 : 32
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -12 100 122">
<defs><clipPath id="c"><path d="${shield}"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
${stars}
<g clip-path="url(#c)"><rect x="0" y="0" width="100" height="120" fill="${p}"/>${motif}<rect x="0" y="0" width="100" height="120" fill="url(#g)"/></g>
<path d="${shield}" fill="none" stroke="#0b0c08" stroke-width="5"/>
<path d="${shield}" fill="none" stroke="${tier <= 2 ? '#f5c542' : '#e8e6dc'}" stroke-width="2.2"/>
<circle cx="50" cy="56" r="25" fill="#0b0c08" opacity=".82"/>
<text x="50" y="${56 + fs * 0.36}" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="900" font-size="${fs}" fill="#fff" letter-spacing="1">${ini}</text>
</svg>`
}

const cache = new Map()
export function crestUrl(name, opts) {
  const k = name + '|' + (opts?.tier ?? '')
  if (!cache.has(k)) cache.set(k, 'data:image/svg+xml;utf8,' + encodeURIComponent(crestSvg(name, opts)))
  return cache.get(k)
}
