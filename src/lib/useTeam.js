import { useState, useMemo, useCallback } from 'react'
import { SLOTS, emptyTeam, fits, computeCollectif, autoFill } from './collectif'

// Hook d'état du Team Builder.
//   const t = useTeam()
//   t.team, t.collectif, t.assign(slotId, card), t.removeFrom(slotId),
//   t.place(card) (auto-slot), t.fill(collection), t.clear(), t.isInTeam(card)
export function useTeam(initial) {
  const [team, setTeam] = useState(initial || emptyTeam())

  const collectif = useMemo(() => computeCollectif(team), [team])

  const isInTeam = useCallback(
    (card) => SLOTS.some((s) => team[s.id]?.id === card?.id),
    [team]
  )

  // Retire une carte partout où elle se trouve (évite les doublons).
  const stripCard = (t, card) => {
    const next = { ...t }
    for (const s of SLOTS) if (next[s.id]?.id === card?.id) next[s.id] = null
    return next
  }

  const assign = useCallback((slotId, card) => {
    const slot = SLOTS.find((s) => s.id === slotId)
    if (!slot || !fits(card, slot)) return false
    setTeam((t) => ({ ...stripCard(t, card), [slotId]: card }))
    return true
  }, [])

  const removeFrom = useCallback((slotId) => {
    setTeam((t) => ({ ...t, [slotId]: null }))
  }, [])

  // Place une carte dans le premier slot compatible libre (sinon le premier compatible).
  const place = useCallback((card) => {
    setTeam((t) => {
      const cleaned = stripCard(t, card)
      const free = SLOTS.find((s) => !cleaned[s.id] && fits(card, s))
      const target = free || SLOTS.find((s) => fits(card, s))
      if (!target) return t
      return { ...cleaned, [target.id]: card }
    })
  }, [])

  const fill = useCallback((collection) => setTeam(autoFill(collection)), [])
  const clear = useCallback(() => setTeam(emptyTeam()), [])

  return { team, collectif, assign, removeFrom, place, fill, clear, isInTeam, slots: SLOTS }
}
