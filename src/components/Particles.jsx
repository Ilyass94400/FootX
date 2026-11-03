import { useEffect, useRef } from 'react'

// Particules d'ambiance (poussière / braises de stade) rendues en canvas.
// Léger (requestAnimationFrame, ~45 particules) et respecte prefers-reduced-motion.
// Mission 1 : à poser derrière l'ouverture de boosters comme derrière l'arène de match.
export default function Particles({ color = '#e4ff3c', density = 46, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    let w, h, parts, raf
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = w * DPR; cv.height = h * DPR
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    const spawn = () => Array.from({ length: density }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 2 + 0.4,
      vy: -(Math.random() * 0.4 + 0.1), vx: (Math.random() - 0.5) * 0.25,
      a: Math.random() * 0.5 + 0.1, tw: Math.random() * Math.PI * 2,
    }))

    resize(); parts = spawn()

    const loop = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.y += p.vy; p.x += p.vx; p.tw += 0.03
        if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7)
        ctx.fillStyle = color
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.tw))
        ctx.fill()
      }
      ctx.globalAlpha = 1
      if (!reduce) raf = requestAnimationFrame(loop)
    }
    loop()

    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [color, density])

  return <canvas ref={ref} className={'fx-particles ' + className} aria-hidden="true" />
}
