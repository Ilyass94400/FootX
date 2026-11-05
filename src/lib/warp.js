import { go } from './useRoute'

// Transition "warp" entre écrans : un voile de la couleur du mode jaillit du point cliqué,
// couvre l'écran, on change de page au pic, puis le voile se dissout sur la nouvelle page.
// Pur DOM (hors React) : il survit au démontage de la page de départ.
let busy = false
export function warpTo(route, { color = '#e4ff3c', x, y, label = '' } = {}) {
  if (busy) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduce) { go(route); return }
  busy = true
  const el = document.createElement('div')
  el.className = 'warp'
  el.style.setProperty('--wc', color)
  el.style.setProperty('--wx', (x ?? window.innerWidth / 2) + 'px')
  el.style.setProperty('--wy', (y ?? window.innerHeight / 2) + 'px')
  if (label) {
    const t = document.createElement('span')
    t.className = 'warp-label'
    t.textContent = label
    el.appendChild(t)
  }
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('in'))
  setTimeout(() => {
    go(route)
    setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => { el.remove(); busy = false }, 520)
    }, 140)
  }, 430)
}
