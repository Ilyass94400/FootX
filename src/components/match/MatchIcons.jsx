// Icônes tactiques du match (SVG maison, lisibles à 40 px sous pression).
const S = { width: '1em', height: '1em', viewBox: '0 0 48 48', 'aria-hidden': true }

// Frappe en force : chaussure en feu
export function IconForce() {
  return (
    <svg {...S}>
      <path d="M29 3c2 4.6-2.6 6.6-1.2 10.4.9 2.3 3.6 2.8 5 .7 2 3.8.1 7.8-3.6 9.1 5.6-.3 9.8-4.4 9.8-10 0-5.3-4.3-7.6-10-10.2z" fill="#ff7a2f" />
      <path d="M33.5 12.5c.8 2.4-1.3 3.4-.6 5.2.5 1.2 1.9 1.4 2.5.3 1 1.9-.1 3.9-1.9 4.5 2.9-.2 4.9-2.3 4.9-5 0-2.6-2-3.8-4.9-5z" fill="#ffd25c" />
      <path d="M6 34.5v-9c0-2.2 1.8-4 4-4h6.5l4-7h7v9.5c7.2.4 12.5 3.6 13.3 9.6v.9z" fill="currentColor" />
      <path d="M5 39.5h36.5" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M12 39.5v3M20 39.5v3M28 39.5v3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

// Feinte : crochet en zigzag
export function IconFeinte() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="39" r="4.5" fill="currentColor" stroke="none" />
      <path d="M14 34l9-9-7-6 14-12" />
      <path d="M22 7h9v9" />
      <path d="M34 24l6 6M40 24l-6 6" strokeWidth="3" opacity=".55" />
    </svg>
  )
}

// Lob : trajectoire en cloche au-dessus du gardien
export function IconLob() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 38C11 9 34 6 41 33" strokeDasharray="1 6.5" />
      <path d="M35 31l6 3 1-7" />
      <circle cx="7" cy="40" r="4" fill="currentColor" stroke="none" />
      <rect x="20" y="30" width="8" height="12" rx="3" fill="currentColor" stroke="none" opacity=".5" />
      <circle cx="24" cy="26" r="3" fill="currentColor" stroke="none" opacity=".5" />
    </svg>
  )
}

// Plonger : gant + traînée de plongeon
export function IconPlonger() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 30h9M8 37h10M5 23h6" opacity=".55" />
      <g transform="rotate(-38 30 24)">
        <rect x="21" y="18" width="16" height="17" rx="5" fill="currentColor" stroke="none" />
        <rect x="21.5" y="9" width="4" height="11" rx="2" fill="currentColor" stroke="none" />
        <rect x="26.5" y="7" width="4" height="13" rx="2" fill="currentColor" stroke="none" />
        <rect x="31.5" y="9" width="4" height="11" rx="2" fill="currentColor" stroke="none" />
        <rect x="17" y="22" width="5" height="9" rx="2.5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}

// Sortir : le gardien jaillit vers l'attaquant
export function IconSortir() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="8" r="4.5" fill="currentColor" stroke="none" />
      <path d="M15 24c2-6 5.5-9 9-9s7 3 9 9" />
      <path d="M24 15v9" />
      <path d="M14 30l10 6 10-6" />
      <path d="M14 38l10 6 10-6" opacity=".55" />
    </svg>
  )
}

// Rester : appuis ancrés sur la ligne
export function IconRester() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="9" r="4.5" fill="currentColor" stroke="none" />
      <path d="M9 19h30" />
      <path d="M24 15v12l-7 11M24 27l7 11" />
      <path d="M5 43h38" strokeWidth="4" />
      <path d="M9 19l-2-6M39 19l2-6" />
    </svg>
  )
}

const MAP = { force: IconForce, feinte: IconFeinte, lob: IconLob, plonger: IconPlonger, sortir: IconSortir, rester: IconRester }
export function ChoiceIcon({ id }) {
  const C = MAP[id]
  return C ? <C /> : null
}

export function IconBolt() {
  return <svg {...S}><path d="M27 3L9 27h13l-3 18 20-26H25z" fill="currentColor" /></svg>
}
export function IconCheck() {
  return <svg {...S} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 25l10 10L39 13" /></svg>
}
export function IconBall() {
  return (
    <svg {...S}>
      <circle cx="24" cy="24" r="20" fill="#f5f5ef" />
      <path d="M24 14l8 6-3 9.5H19L16 20z" fill="#16181a" />
      <path d="M24 4v10M32 20l9.5-4M29 29.5l6 8M19 29.5l-6 8M16 20l-9.5-4" stroke="#16181a" strokeWidth="2" />
    </svg>
  )
}
