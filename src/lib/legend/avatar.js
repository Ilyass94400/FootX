// Portrait de la Légende : SVG dessiné ici (style manga sportif, création originale).
// avatarSvg(look, opts) → chaîne SVG ; avatarUrl(...) → data URL utilisable comme image_url de carte.
import { LOOKS } from './config'

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16)
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)))
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((c) => c.toString(16).padStart(2, '0')).join('')
}

const HAIR = {
  // mèches pointues "shonen"
  pics: (c, d) => `<path d="M30 58 L22 30 L38 40 L36 14 L52 32 L60 6 L68 32 L84 14 L82 40 L98 30 L90 58 C88 40 76 30 60 30 C44 30 32 40 30 58Z" fill="${c}"/>
    <path d="M40 46 L48 30 L52 44 L60 26 L64 44 L72 30 L80 46 C74 38 66 36 60 36 C54 36 46 38 40 46Z" fill="${d}" opacity=".55"/>`,
  crete: (c, d) => `<path d="M34 52 C34 36 46 28 60 28 C74 28 86 36 86 52 L80 50 C78 40 70 36 60 36 C50 36 42 40 40 50Z" fill="${d}"/>
    <path d="M50 40 L46 8 L58 22 L62 2 L68 22 L78 10 L72 40 C68 34 64 33 60 33 C56 33 52 35 50 40Z" fill="${c}"/>`,
  meche: (c, d) => `<path d="M30 60 C26 36 42 22 62 22 C82 22 94 36 90 58 C86 46 80 42 74 42 C70 52 58 58 40 56 C46 50 48 46 48 42 C40 46 34 52 30 60Z" fill="${c}"/>
    <path d="M44 36 C54 30 70 28 84 36" stroke="${d}" stroke-width="3" fill="none" opacity=".6"/>`,
  long: (c, d) => `<path d="M26 92 C20 60 30 26 60 24 C90 26 100 60 94 92 C90 78 88 64 86 54 C80 44 70 40 60 40 C50 40 40 44 34 54 C32 64 30 78 26 92Z" fill="${c}"/>
    <path d="M36 50 C44 34 76 34 84 50 C76 42 68 40 60 40 C52 40 44 42 36 50Z" fill="${d}" opacity=".5"/>`,
  bandeau: (c, d, band) => `<path d="M32 56 C30 34 44 24 60 24 C76 24 90 34 88 56 L84 44 L76 36 L66 42 L58 34 L48 42 L40 38 Z" fill="${c}"/>
    <path d="M32 50 C46 44 74 44 88 50 L88 57 C74 51 46 51 32 57Z" fill="${band}"/>
    <path d="M88 52 L104 46 L98 58 Z" fill="${band}"/>
    <path d="M40 30 L50 20 L52 30 L62 16 L66 28 L76 20 L78 32" stroke="${d}" stroke-width="2" fill="none" opacity=".6"/>`,
}

export function avatarSvg(look = {}, { number = 10, background = true, aura } = {}) {
  const skin = look.skin || LOOKS.skin[1]
  const hairC = look.hairColor || LOOKS.hairColor[0]
  const eyes = look.eyes || LOOKS.eyes[0]
  const au = aura || look.aura || LOOKS.aura[0]
  const skinD = shade(skin, 0.82)
  const hairD = shade(hairC, 0.6)
  const hair = (HAIR[look.hair] || HAIR.pics)(hairC, hairD, au)
  const bg = background
    ? `<defs><radialGradient id="g" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${au}" stop-opacity=".9"/><stop offset=".55" stop-color="${shade(au, 0.35)}"/><stop offset="1" stop-color="#07080a"/></radialGradient></defs>
       <rect width="120" height="150" fill="url(#g)"/>
       <g stroke="${au}" stroke-opacity=".35" stroke-width="1.2">${Array.from({ length: 18 }, (_, i) => {
         const a = (i / 18) * Math.PI * 2
         return `<line x1="${60 + Math.cos(a) * 30}" y1="${62 + Math.sin(a) * 30}" x2="${60 + Math.cos(a) * 110}" y2="${62 + Math.sin(a) * 110}"/>`
       }).join('')}</g>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">${bg}
  <path d="M14 150 C16 118 34 104 60 104 C86 104 104 118 106 150Z" fill="#14161a"/>
  <path d="M14 150 C16 118 34 104 60 104 C86 104 104 118 106 150Z" fill="${au}" opacity=".18"/>
  <path d="M44 106 L60 126 L76 106" fill="none" stroke="${au}" stroke-width="4"/>
  <text x="60" y="146" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="16" fill="${au}" opacity=".9">${String(number).slice(0, 2)}</text>
  <path d="M50 90 L50 108 C54 112 66 112 70 108 L70 90Z" fill="${skinD}"/>
  <ellipse cx="33" cy="66" rx="5" ry="8" fill="${skinD}"/><ellipse cx="87" cy="66" rx="5" ry="8" fill="${skinD}"/>
  <path d="M34 56 C34 38 46 30 60 30 C74 30 86 38 86 56 C86 76 78 94 60 98 C42 94 34 76 34 56Z" fill="${skin}"/>
  <path d="M60 98 C70 96 78 90 82 80 C76 90 68 94 60 95Z" fill="${skinD}" opacity=".6"/>
  <path d="M42 58 L54 61" stroke="#1b1410" stroke-width="3" stroke-linecap="round"/>
  <path d="M78 58 L66 61" stroke="#1b1410" stroke-width="3" stroke-linecap="round"/>
  <path d="M43 66 C46 62 52 62 55 66 C52 69 46 69 43 66Z" fill="#fff"/>
  <path d="M77 66 C74 62 68 62 65 66 C68 69 74 69 77 66Z" fill="#fff"/>
  <circle cx="50" cy="66" r="2.6" fill="${eyes}"/><circle cx="70" cy="66" r="2.6" fill="${eyes}"/>
  <circle cx="51" cy="65" r=".9" fill="#fff"/><circle cx="71" cy="65" r=".9" fill="#fff"/>
  <path d="M43 66 C46 62 52 62 55 66" stroke="#1b1410" stroke-width="1.6" fill="none"/>
  <path d="M77 66 C74 62 68 62 65 66" stroke="#1b1410" stroke-width="1.6" fill="none"/>
  <path d="M60 70 L58 79 L61 80" stroke="${skinD}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M54 86 C58 88 63 88 67 85" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>
  ${hair}
</svg>`
}

export const avatarUrl = (look, opts) => 'data:image/svg+xml;utf8,' + encodeURIComponent(avatarSvg(look, opts))
