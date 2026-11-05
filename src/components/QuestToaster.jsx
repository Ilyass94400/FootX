import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { onQuestEvent, startQuestTracking } from '../lib/quests'
import { fmtCoins } from '../lib/economy/config'
import { go } from '../lib/useRoute'
import { CoinIcon } from './CoinCounter'
import './quests.css'

// Notification globale "Défi terminé !" (sur toutes les pages, y compris pendant l'Arène en plein écran).
// Démarre aussi le suivi des événements du Marché et de la collection.
export default function QuestToaster() {
  const [items, setItems] = useState([])
  useEffect(() => {
    startQuestTracking()
    return onQuestEvent((e) => {
      if (e?.type !== 'completed') return
      const id = Date.now() + Math.random()
      setItems((l) => [...l.slice(-2), { id, q: e.quest }])
      setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 5200)
    })
  }, [])
  if (!items.length) return null
  return createPortal(
    <div className="qt-stack" aria-live="polite">
      {items.map(({ id, q }) => (
        <button key={id} className="qt" onClick={() => { setItems((l) => l.filter((x) => x.id !== id)); go('defis') }}>
          <span className="qt-check"><svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="qt-txt">
            <em>Défi terminé !</em>
            <b>{q.title}</b>
          </span>
          <span className="qt-rew"><span><CoinIcon className="qt-c" />{fmtCoins(q.coins)}</span><small>Récupérer</small></span>
          <i className="qt-bar" />
        </button>
      ))}
    </div>,
    document.body,
  )
}
