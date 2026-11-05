// Sons du Mode Carrière (synthétisés). Respectent le bouton "couper le son".
import { ac, noise, tone } from '../legend/sfx'

// Froissement de papier (enveloppe, lettre qui se déplie)
export function paper(long = false) {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  for (let i = 0; i < (long ? 5 : 3); i++) noise(a, t + i * 0.07, 0.09 + Math.random() * 0.05, { from: 1800 + Math.random() * 1500, to: 5000, gain: 0.06, type: 'bandpass' })
}
// Le sceau de cire qui craque
export function sealCrack() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  noise(a, t, 0.08, { from: 3000, to: 800, gain: 0.3, type: 'bandpass' })
  noise(a, t + 0.05, 0.12, { from: 1500, to: 300, gain: 0.18, type: 'lowpass' })
  tone(a, t, 220, 0.08, 'square', 0.04, 90)
}
// Coup de tampon sur le contrat
export function stamp() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  tone(a, t, 110, 0.25, 'sine', 0.4, 45)
  noise(a, t, 0.18, { from: 900, to: 120, gain: 0.35, type: 'lowpass' })
}
// Stylo qui signe
export function pen() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  for (let i = 0; i < 6; i++) noise(a, t + i * 0.09, 0.07, { from: 5000, to: 7000, gain: 0.035, type: 'highpass' })
}
// Fanfare dorée : offre d'un grand club / signature
export function fanfare(big = false) {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.02
  const seq = big ? [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36], [1047, 0.52], [1319, 0.7]] : [[523, 0], [659, 0.11], [784, 0.22], [1047, 0.36]]
  seq.forEach(([f, d]) => { tone(a, t + d, f, 0.55, 'square', 0.045); tone(a, t + d, f / 2, 0.6, 'triangle', 0.05); tone(a, t + d, f * 2, 0.35, 'sine', 0.025) })
  if (big) noise(a, t + 0.5, 1.2, { from: 4000, to: 12000, gain: 0.05, type: 'highpass' })
}
// Notification : nouveau courrier
export function mailDing() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  tone(a, t, 988, 0.25, 'sine', 0.08); tone(a, t + 0.12, 1319, 0.4, 'sine', 0.07)
}
// Coup de sifflet (avant le match)
export function whistle() {
  const a = ac(); if (!a) return
  const t = a.currentTime + 0.01
  const o = a.createOscillator(); const g = a.createGain(); const l = a.createOscillator(); const lg = a.createGain()
  o.type = 'sine'; o.frequency.value = 2900; l.frequency.value = 28; lg.gain.value = 120
  l.connect(lg).connect(o.frequency)
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  o.connect(g).connect(a.destination); o.start(t); l.start(t); o.stop(t + 0.55); l.stop(t + 0.55)
}
