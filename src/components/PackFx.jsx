import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// Canvas d'effets de l'ouverture de booster :
//  - poussière d'ambiance qui flotte (couleur = rareté en cours),
//  - bursts déclenchés à la demande : étincelles (traînées), paillettes, confettis.
// API impérative : ref.current.burst({ x, y, colors, count, speed, kind, gravity, spread, angle })
//   x / y en fraction de la scène (0..1). kind : 'spark' | 'glitter' | 'confetti' | 'mix'.
const KINDS = ['spark', 'spark', 'glitter', 'confetti']

const PackFx = forwardRef(function PackFx({ ambient = '#e4ff3c' }, ref) {
  const cvRef = useRef(null)
  const parts = useRef([])
  const ambRef = useRef(ambient)
  ambRef.current = ambient

  useImperativeHandle(ref, () => ({
    burst(o = {}) {
      const cv = cvRef.current
      if (!cv) return
      const {
        x = 0.5, y = 0.5, colors = ['#ffffff'], count = 60, speed = 7, kind = 'spark',
        gravity = 0.14, spread = Math.PI * 2, angle = -Math.PI / 2,
      } = o
      const px = x * cv.clientWidth
      const py = y * cv.clientHeight
      for (let i = 0; i < count; i++) {
        const k = kind === 'mix' ? KINDS[(Math.random() * KINDS.length) | 0] : kind
        const a = angle + (Math.random() - 0.5) * spread
        const s = speed * (0.3 + Math.random() * 0.95)
        parts.current.push({
          k, x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          g: k === 'glitter' ? gravity * 0.35 : gravity,
          life: 1,
          decay: k === 'confetti' ? 0.006 + Math.random() * 0.006 : 0.011 + Math.random() * 0.016,
          size: k === 'confetti' ? 3 + Math.random() * 4 : 0.8 + Math.random() * 2.2,
          c: colors[(Math.random() * colors.length) | 0],
          r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, tw: Math.random() * 6,
        })
      }
      if (parts.current.length > 1500) parts.current.splice(0, parts.current.length - 1500)
    },
  }), [])

  useEffect(() => {
    const cv = cvRef.current
    const ctx = cv.getContext('2d')
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let raf
    const resize = () => {
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.max(1, w * DPR)
      cv.height = Math.max(1, h * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    resize()
    const dust = Array.from({ length: 64 }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.6 + 0.3,
      vy: -(Math.random() * 0.3 + 0.06), vx: (Math.random() - 0.5) * 0.15,
      a: Math.random() * 0.4 + 0.08, tw: Math.random() * 6,
    }))
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const loop = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const d of dust) {
        d.x += d.vx; d.y += d.vy; d.tw += 0.025
        if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w }
        ctx.globalAlpha = d.a * (0.55 + 0.45 * Math.sin(d.tw))
        ctx.fillStyle = ambRef.current
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill()
      }
      const ps = parts.current
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.vx *= 0.985
        p.vy = p.vy * 0.985 + p.g
        p.x += p.vx; p.y += p.vy
        p.life -= p.decay; p.r += p.vr; p.tw += 0.3
        if (p.life <= 0) { ps.splice(i, 1); continue }
        const alpha = Math.min(1, p.life * 1.4)
        if (p.k === 'spark') {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = alpha
          ctx.strokeStyle = p.c; ctx.lineWidth = p.size; ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke()
        } else if (p.k === 'glitter') {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(p.tw))
          ctx.fillStyle = p.c
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.2, 0, 6.283); ctx.fill()
        } else {
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = alpha
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r)
          ctx.fillStyle = p.c; ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9)
          ctx.restore()
        }
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(loop)
    }
    if (!reduce) loop()
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={cvRef} className="pk-fx" aria-hidden="true" />
})

export default PackFx
