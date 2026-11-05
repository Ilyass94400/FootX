import { useMemo } from 'react'
import { buildPitch, VB } from '../../lib/match/pitchGeometry'

// Terrain en perspective (SVG). `hit` : compteur, chaque incrément fait onduler le filet.
const LED = 'FOOTX TCG  ◆  ÉDITION TOP 5  ◆  FOOTX TCG  ◆  5 CONTRE 5  ◆  '
export default function Pitch({ hit = 0 }) {
  const g = useMemo(buildPitch, [])
  const ledY = (g.boardsTop + g.boardsBottom) / 2
  const ledSize = (g.boardsBottom - g.boardsTop) * 0.62
  return (
    <svg className="mx-pitch" viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="mxNet" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 0L8 8M8 0L0 8" stroke="rgba(255,255,255,.42)" strokeWidth="1" />
        </pattern>
        <radialGradient id="mxPool" cx=".5" cy=".62" r=".55">
          <stop offset="0" stopColor="#fffbe0" stopOpacity=".2" />
          <stop offset="1" stopColor="#fffbe0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="mxFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".2" stopColor="#000" stopOpacity=".55" />
          <stop offset=".45" stopColor="#000" stopOpacity="0" />
          <stop offset=".9" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
        <clipPath id="mxBoardsClip"><polygon points={g.boards} /></clipPath>
      </defs>

      {/* pelouse */}
      <polygon points={g.behind} fill="#0f2c17" />
      {g.stripes.map((p, i) => <polygon key={i} points={p} fill={i % 2 ? '#1c6a33' : '#227d3c'} />)}
      <rect width={VB.w} height={VB.h} fill="url(#mxPool)" />

      {/* lignes */}
      <g fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
        <polyline points={g.goalLine} />
        <polyline points={g.sixYard} />
        <polyline points={g.box} />
        {g.arc && <polyline points={g.arc} />}
      </g>
      <ellipse cx={g.spot.x} cy={g.spot.y} rx="7" ry="3" fill="rgba(255,255,255,.85)" />

      {/* panneaux LED */}
      <polygon points={g.boards} fill="#06080b" />
      <g clipPath="url(#mxBoardsClip)">
        <g className="mx-led">
          <text x="-40" y={ledY} dominantBaseline="middle" fontSize={ledSize} className="mx-led-txt">{LED.repeat(6)}</text>
        </g>
      </g>
      <polygon points={g.boards} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />

      {/* but */}
      <g key={hit} className={'mx-goal' + (hit ? ' hit' : '')}>
        <g className="mx-net">
          <polygon points={g.netRoof} fill="url(#mxNet)" />
          <polygon points={g.netBack} fill="url(#mxNet)" />
          <polygon points={g.netLeft} fill="url(#mxNet)" />
          <polygon points={g.netRight} fill="url(#mxNet)" />
        </g>
        <polyline points={g.posts} fill="none" stroke="#f3f3ec" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={g.posts} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="2" transform="translate(2 2)" />
      </g>

      <rect width={VB.w} height={VB.h} fill="url(#mxFar)" />
    </svg>
  )
}
