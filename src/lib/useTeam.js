import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { SLOTS, emptyTeam, fitsSlot, computeCollectif, autoFill } from './collectif'
import { canPlace, computeChemistry, validateTeam } from './chemistry'

// La compo est sauvegardée dans le navigateur : le match et la Ligue l'utilisent directement.
const TEAM_KEY = 'footx_team'
export function loadSavedTeam() {
  try {
    const t = JSON.parse(localStorage.getItem(TEAM_KEY))
    return t && typeof t === 'object' ? { ...emptyTeam(), ...t } : null
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

  useEffect(() => {
    ref.current = team
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(team)) } catch { /* stockage indisponible */ }
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
