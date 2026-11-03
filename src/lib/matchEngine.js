// Moteur de duel FootX — logique pure, sans dépendance React.
// Testable à part, réutilisable côté serveur pour un vrai PvP (validation des coups).

import { getTraits, applyAtkTraits, applyDefTraits } from './traits'

// --- Les trois tactiques de l'attaquant -------------------------------------
export const TACTICS = {
  force:   { id: 'force',   name: 'Tir en force',    ic: '💥', beats: 'passe',   beatLabel: 'perce la sortie',       key: '1' },
  finesse: { id: 'finesse', name: 'Frappe finesse',  ic: '🎯', beats: 'force',   beatLabel: 'prend à contre-pied',   key: '2' },
  passe:   { id: 'passe',   name: 'Passe décisive',  ic: '🅿️', beats: 'finesse', beatLabel: 'exploite le placement', key: '3' },
}

// --- Les trois lectures du gardien (mêmes clés que les tactiques) ------------
export const READS = {
  force:   { id: 'force',   name: 'Plongeon anticipé', ic: '🧤' },
  finesse: { id: 'finesse', name: 'Reste sur sa ligne', ic: '🧍' },
  passe:   { id: 'passe',   name: 'Sortie agressive',  ic: '🏃' },
}

// --- Matrice Pierre-Feuille-Ciseaux (avantage attaquant) ---------------------
// Cycle : force > passe > finesse > force.  +1 = l'attaquant gagne le duel de lecture,
// -1 = le gardien a lu le coup, 0 = duel neutre.
export const ADV = {
  force:   { passe: +1, finesse: -1, force: 0 },
  finesse: { force: +1, passe: -1,   finesse: 0 },
  passe:   { finesse: +1, force: -1, passe: 0 },
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// --- Résolution d'un duel ----------------------------------------------------
// atkCard / defCard : cartes au format Supabase (on en dérive les Traits).
// Renvoie l'avantage final + les paramètres du QTE (fenêtre de temps + zone de réussite).
export function resolveDuel(tactic, read, atkCard, defCard) {
  const atkTraits = getTraits(atkCard)
  const defTraits = getTraits(defCard)
  const log = []

  let adv = ADV[tactic][read]
  log.push(`PFC ${TACTICS[tactic].name} vs ${READS[read].name} → ${adv > 0 ? 'avantage attaquant' : adv < 0 ? 'avantage gardien' : 'neutre'}`)

  // Les Traits décalent l'avantage brut
  adv = applyAtkTraits(adv, tactic, atkTraits, log)
  adv = clamp(adv, -2, 2)

  // L'avantage pilote la difficulté du QTE : fenêtre de temps (ms) + taille de la zone
  let windowMs = 1000 + adv * 230
  let zone     = 0.25 + adv * 0.07
  ;({ windowMs, zone } = applyDefTraits({ windowMs, zone }, defTraits, atkTraits, log))

  zone     = clamp(zone, 0.10, 0.46)
  windowMs = clamp(windowMs, 620, 1600)

  return {
    adv, windowMs, zone,
    won: adv > 0, lost: adv < 0,
    verdict: adv > 0 ? 'win' : adv < 0 ? 'lose' : 'neutral',
    tactic, read, log,
  }
}

// --- IA gardien --------------------------------------------------------------
// Choisit une lecture. Le Trait "Lecture du jeu" lui fait plus souvent poser
// la lecture qui contre la tactique du joueur.
export function keeperChoose(playerTactic, defCard) {
  const defTraits = getTraits(defCard)
  const keys = ['force', 'finesse', 'passe']
  if (defTraits.includes('lecture') && Math.random() < 0.55) {
    for (const r of keys) if (ADV[playerTactic][r] < 0) return r
  }
  return keys[Math.floor(Math.random() * keys.length)]
}

// --- Issue finale : avantage + réussite du QTE -> dénouement -----------------
export function outcome(adv, qteHit, perfect) {
  if (qteHit && (adv >= 0 || perfect))
    return { kind: 'goal', head: 'BUUUT !', desc: adv > 0 ? 'Lecture parfaite et sang-froid : le ballon finit au fond.' : perfect ? 'Geste de classe mondiale : il marque contre le cours du duel !' : "Il conclut proprement l'occasion." }
  if (qteHit && adv < 0)
    return { kind: 'goal', head: 'BUUUT !', desc: 'Exploit individuel : mal embarqué, il plante quand même sur un réflexe de génie.' }
  if (!qteHit && adv > 0)
    return { kind: 'miss', head: 'OCCASION !', desc: 'Position idéale mais la frappe fuit le cadre. À oublier vite.' }
  if (!qteHit && adv === 0)
    return { kind: 'save', head: 'ARRÊT !', desc: 'Le gardien reste maître du face-à-face. Bien lu.' }
  return { kind: 'save', head: 'STOPPÉ !', desc: "Le gardien avait tout anticipé : le duel était perdu d'avance." }
}

// Calcule si le QTE est réussi à partir de la position du marqueur (0..1).
export function evalQte(markerPos, zone) {
  const center = 0.5
  const half = zone / 2
  const perfectHalf = Math.max(0.03, zone * 0.18)
  const d = Math.abs(markerPos - center)
  return { hit: d <= half, perfect: d <= perfectHalf }
}

// --- Scénarios (moments-clés) ------------------------------------------------
export const SCENARIOS = [
  { id: '1v1',     kicker: 'Minute 67',   title: 'Face-à-face',                 sub: 'Lancé dans la profondeur, seul face au gardien.' },
  { id: 'corner',  kicker: 'Minute 90+3', title: 'Corner de la dernière chance', sub: 'Dernière action du match, tout le monde est monté.' },
  { id: 'penalty', kicker: 'Minute 78',   title: 'Penalty',                     sub: 'Le stade retient son souffle sur le point de penalty.' },
]

export const pickScenario = () => SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]

// Durées des phases (ms) — ajustables pour le game feel
export const TIMING = { INTRO: 1700, CHOICE: 3200, CLASH: 1500, SWEEP: 1400 }
