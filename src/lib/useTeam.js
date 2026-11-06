import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { SLOTS, emptyTeam, fitsSlot, computeCollectif, autoFill } from './collectif'
import { canPlace, computeChemistry, validateTeam } from './chemistry'
import { cloudSquad } from './cloud'

// La compo : copie locale (lue par le match et la Ligue) + sauvegarde en ligne (squad_save)
// quand le joueur est connecté. Au démarrage, la copie locale est remplie depuis le serveur.
const TEAM_KEY = 'footx_team'
export function loadSavedTeam() {
  try {
    const t = JSON.parse(localStorage.getItem(TEAM_KEY))
    if (!t || typeof t !== 'object') return null
    // l'ancienne carte "Légende" ne joue plus en multijoueur (elle vit dans le Mode Carrière)
    for (const k of Object.keys(t)) if (t[k]?.legend) t[k] = null
    return { ...emptyTeam(), ...t }
  } catch {
    return null
  }
}

// Compo jouable en Arène : complète ET dans les plafonds de rareté.
export function loadPlayableTeam() {
  const t = loadSavedTeam()
  return t && SLOTS.every((s) => t[s.id]) && validateTeam(t).ok ? t : null
}

// Hook d'état du Team Builder.
//   const t = useTeam()
//   t.team, t.collectif, t.chemistry, t.validity
//   t.assign(slotId, card) → { ok } | { ok:false, reason, title, message, blockers }
//   t.removeFrom(slotId), t.place(card), t.fill(collection), t.clear(), t.isInTeam(card)
export function useTeam(initial) {
  const [team, setTeam] = useState(() => initial || loadSavedTeam() || emptyTeam())
  const ref = useRef(team)

  const first = useRef(true)
  useEffect(() => {
    ref.current = team
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(team)) } catch { /* stockage indisponible */ }
    if (first.current) { first.current = false; return } // rien n'a changé : pas d'envoi au chargement
    const chem = computeChemistry(team)
    const best = Math.max(0, ...SLOTS.map((sl) => chem.cards[sl.id]?.chem ?? 0))
    cloudSquad(team, best, SLOTS.every((sl) => team[sl.id]) ? chem.total : 0)
  }, [team])

  const commit = useCallback((next) => { ref.current = next; setTeam(next) }, [])

  const collectif = useMemo(() => computeCollectif(team), [team])
  const chemistry = useMemo(() => computeChemistry(team), [team])
  const validity = useMemo(() => validateTeam(team), [team])

  const isInTeam = useCallback((card) => SLOTS.some((s) => team[s.id]?.id === card?.id), [team])

  const assign = useCallback((slotId, card) => {
    const t = ref.current
    const from = SLOTS.find((s) => t[s.id]?.id === card?.id)?.id
    if (from === slotId) return { ok: true, same: true }
    // Échange entre deux postes du terrain : les plafonds ne bougent pas.
    if (from) {
      const other = t[slotId]
      if (!fitsSlot(card, slotId)) return canPlace(t, slotId, card, fitsSlot)
      if (other && !fitsSlot(other, from)) return { ok: false, reason: 'role', title: 'Échange impossible', message: `${other.name} ne peut pas jouer à ce poste.`, blockers: [] }
      commit({ ...t, [slotId]: card, [from]: other || null })
      return { ok: true, swapped: !!other }
    }
    const res = canPlace(t, slotId, card, fitsSlot)
    if (!res.ok) return res
    commit({ ...t, [slotId]: card })
    return { ok: true }
  }, [commit])

  const removeFrom = useCallback((slotId) => commit({ ...ref.current, [slotId]: null }), [commit])

  // Place une carte dans le premier poste compatible libre (sinon le premier compatible).
  const place = useCallback((card) => {
    const t = ref.current
    const free = SLOTS.find((s) => !t[s.id] && fitsSlot(card, s.id))
    const target = free || SLOTS.find((s) => fitsSlot(card, s.id))
    return target ? assign(target.id, card) : { ok: false, reason: 'role', title: 'Aucun poste', message: 'Cette carte ne rentre dans aucun poste.' }
  }, [assign])

  const fill = useCallback((collection) => commit(autoFill(collection)), [commit])
  const clear = useCallback(() => commit(emptyTeam()), [commit])

  return { team, collectif, chemistry, validity, assign, removeFrom, place, fill, clear, isInTeam, slots: SLOTS }
}
