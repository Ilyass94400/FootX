// Lignes de terrain dessinées en SVG, utilisées en décor
export default function Pitch({ className }) {
  return (
    <svg className={className} viewBox="0 0 400 260" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="10" y="10" width="380" height="240" />
      <line x1="200" y1="10" x2="200" y2="250" />
      <circle cx="200" cy="130" r="38" />
      <circle cx="200" cy="130" r="2" fill="currentColor" />
      <rect x="10" y="70" width="56" height="120" />
      <rect x="10" y="102" width="20" height="56" />
      <rect x="334" y="70" width="56" height="120" />
      <rect x="370" y="102" width="20" height="56" />
      <path d="M66 105 a30 30 0 0 1 0 50" />
      <path d="M334 105 a30 30 0 0 0 0 50" />
    </svg>
  )
}
