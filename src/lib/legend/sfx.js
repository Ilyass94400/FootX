// Sons du mode Légende, synthétisés (aucun fichier audio). Respectent le bouton "couper le son".
import { isMuted } from '../economy/fx'

let ctx = null
export const ac = () => {
  if (isMuted()) return null
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch { return null }
}

export function tone(a, t, f, dur, type = 'sine', gain = 0.12, slideTo) {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + dur + 0.05)
}

export function noise(a, t, dur, { from = 400, to = 4000, gain = 0.2, type = 'bandpass' } = {}) {
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(from, t)
  f.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(f).connect(g).connect(a.destination)
  src.start(t)
}

// Achat d'une compétence : arpège qui monte + scintillement
export function powerUp(big = false) {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  const notes = big ? [392, 523, 659, 784, 1047, 1319] : [523, 659, 784, 1047]
  notes.forEach((f, i) => tone(a, t + i * 0.055, f, 0.28, 'triangle', 0.09))
  tone(a, t, 180, 0.35, 'sawtooth', 0.05, big ? 900 : 600)
  noise(a, t + 0.05, 0.4, { from: 3000, to: 9000, gain: 0.05, type: 'highpass' })
}

// Montée de niveau : petite fanfare
export function levelUp() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.02
  ;[[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, d]) => { tone(a, t + d, f, 0.5, 'square', 0.05); tone(a, t + d, f * 2, 0.4, 'sine', 0.04) })
}

// Ultime : souffle qui monte, puis impact grave
export function ultimateCharge() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  noise(a, t, 1.2, { from: 200, to: 6000, gain: 0.18 })
  tone(a, t, 70, 1.3, 'sawtooth', 0.07, 280)
}
export function ultimateImpact() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  tone(a, t, 120, 0.7, 'sine', 0.35, 38)
  noise(a, t, 0.6, { from: 2500, to: 120, gain: 0.35, type: 'lowpass' })
  tone(a, t, 1800, 0.15, 'square', 0.04, 600)
}
