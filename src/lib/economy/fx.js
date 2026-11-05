// Effets "argent" : bruit de pièces (synthétisé, aucun fichier audio) et pièces qui volent
// jusqu'au compteur du header.

let ctx = null
const audio = () => {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch { return null }
}

// Un "cling" de pièce : deux partiels métalliques très courts.
function ping(ac, t, freq, gain = 0.12) {
  for (const [mult, g] of [[1, 1], [2.76, 0.45], [5.4, 0.18]]) {
    const o = ac.createOscillator()
    const v = ac.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq * mult, t)
    v.gain.setValueAtTime(0.0001, t)
    v.gain.exponentialRampToValueAtTime(gain * g, t + 0.004)
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + 0.1 / mult)
    o.connect(v).connect(ac.destination)
    o.start(t)
    o.stop(t + 0.35)
  }
}

let muted = false
try { muted = localStorage.getItem('footx_mute') === '1' } catch { /* ignore */ }
export const isMuted = () => muted
export function setMuted(v) { muted = v; try { localStorage.setItem('footx_mute', v ? '1' : '0') } catch { /* ignore */ } }

// Cascade de pièces : plus le montant est gros, plus il y en a.
export function coinSound(amount = 500) {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const n = Math.max(3, Math.min(14, Math.round(Math.log10(Math.max(10, amount)) * 3)))
  const t0 = ac.currentTime + 0.02
  for (let i = 0; i < n; i++) ping(ac, t0 + i * 0.055 + Math.random() * 0.03, 1900 + Math.random() * 900, 0.09 + Math.random() * 0.05)
}

// Son plus grave et sec pour une dépense.
export function spendSound() {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  ping(ac, t0, 1300, 0.1)
  ping(ac, t0 + 0.07, 1050, 0.08)
}

// Pièces qui volent d'un point de l'écran vers le compteur du header.
export function flyCoins(from, n = 10) {
  const target = document.querySelector('.cc-wallet .cc-coin')
  if (!target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  // le compteur attend l'arrivée de la 1re pièce avant de faire rouler ses chiffres
  window.dispatchEvent(new CustomEvent('footx:coins-incoming', { detail: { ms: 820 } }))
  const to = target.getBoundingClientRect()
  const sx = from?.x ?? window.innerWidth / 2
  const sy = from?.y ?? window.innerHeight / 2
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i')
    el.className = 'cc-fly'
    const dx = to.left + to.width / 2 - sx
    const dy = to.top + to.height / 2 - sy
    el.style.left = sx + 'px'
    el.style.top = sy + 'px'
    el.style.setProperty('--dx', dx + 'px')
    el.style.setProperty('--dy', dy + 'px')
    el.style.setProperty('--sx', (Math.random() - 0.5) * 160 + 'px')
    el.style.setProperty('--sy', -60 - Math.random() * 120 + 'px')
    el.style.animationDelay = i * 45 + 'ms'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1300 + i * 45)
  }
  setTimeout(() => target.closest('.cc-wallet')?.classList.add('cc-hit'), 700)
  setTimeout(() => target.closest('.cc-wallet')?.classList.remove('cc-hit'), 1200)
}
