import { useEffect, useMemo } from 'react'
import { loadSavedTeam } from '../lib/useTeam'
import { autoFill, SLOTS, cardRating, roleOf } from '../lib/collectif'
import { useOwned } from '../lib/collection'
import { useLeague } from '../lib/league/useLeague'
import { splitMs } from '../lib/league/scoring'
import { useCareer } from '../lib/career'
import { seasonLabel } from '../lib/career/rules'
import { crestUrl } from '../lib/career/crest'
import { Portal, ArenaScene, LeagueScene, Digit, Arrow } from './Hub'
import './hub.css'
import './jouer.css'

// ============================================================================
// « Jouer » : tous les modes de jeu au même endroit (bouton unique de la barre).
//   Arène (match rapide) · Ma Ligue (fantasy du week-end) · Carrière (solo)
//   Raccourcis clavier : 1, 2, 3
// ============================================================================
const ARENA = '#ff4d5e'
const LEAGUE = '#f2c230'
const CAREER = '#5fd3ff'
const RANK = { commune: 1, atypique: 2, rare: 3, epique: 4, legendaire: 5, iconique: 6 }
const pad = (n) => String(n).padStart(2, '0')
const readNum = (k) => { try { return parseFloat(localStorage.getItem(k)) || 0 } catch { return 0 } }
function rewardsToday() {
  try {
    const r = JSON.parse(localStorage.getItem('footx_match_rewards') || '{}')
    return r.day === new Date().toISOString().slice(0, 10) ? r.n : 0
  } catch { return 0 }
}

export default function Jouer() {
  const lg = useLeague()
  const career = useCareer()
  const owned = useOwned()

  // ton 5 (ou une compo automatique avec tes cartes si tu n'en as pas encore)
  const saved = useMemo(loadSavedTeam, [])
  const hasTeam = !!saved && SLOTS.every((s) => saved[s.id])
  const team = useMemo(() => {
    if (hasTeam) return saved
    const mine = owned ? [...new Map(owned.items.filter((i) => i.card).map((i) => [String(i.card.id), i.card])).values()] : []
    const auto = autoFill(mine)
    return Object.fromEntries(SLOTS.map((s) => [s.id, saved?.[s.id] || auto[s.id] || null]))
  }, [hasTeam, saved, owned])
  const star = useMemo(() => {
    const list = SLOTS.map((s) => team[s.id]).filter(Boolean)
    const atk = list.filter((c) => roleOf(c.position) === 'ATT')
    return (atk.length ? atk : list).sort((a, b) => (RANK[String(b.rarity).toLowerCase()] || 0) - (RANK[String(a.rarity).toLowerCase()] || 0) || cardRating(b) - cardRating(a))[0] || null
  }, [team])

  const streak = readNum('footx_win_streak')
  const won = rewardsToday()
  const t = splitMs(lg.gw.msLeft)

  // raccourcis 1 / 2 / 3
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0) document.querySelectorAll('.jo-modes .hb-portal')[i]?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="jo">
      <header className="jo-head">
        <div>
          <span className="hb-kicker">Saison 1 · Journée {lg.gw.number}</span>
          <h1>Jouer<span>.</span></h1>
        </div>
        <p className="jo-lede">Choisis ton mode de jeu</p>
      </header>

      <div className="hb-portals jo-modes">
        {/* ------------------------------ ARÈNE ------------------------------ */}
        <Portal kind="arena" color={ARENA} route="match" label="L'Arène">
          <ArenaScene star={star} />
          <Key n={1} />
          <div className="hb-p-content">
            <span className="hb-p-kicker"><i className="hb-live" />Joueur contre joueur · en direct</span>
            <h2>L'Arène</h2>
            <p className="hb-p-sub">Ton 5 contre un vrai joueur en direct (ou l'IA si personne n'est dispo). 6 actions décisives, environ 2 minutes.</p>
            <div className="hb-chips">
              <span className={'hb-chip' + (streak >= 2 ? ' hot' : '')}><b>{streak}</b> {streak > 1 ? 'victoires de suite' : 'victoire de suite'}</span>
              <span className="hb-chip"><b>{won}/5</b> boosters gagnés aujourd'hui</span>
            </div>
            <span className="hb-cta"><span>Lancer un match</span><Arrow /></span>
          </div>
        </Portal>

        {/* ------------------------------ LIGUE ------------------------------ */}
        <Portal kind="league" color={LEAGUE} route="ligue" label="Ma Ligue">
          <LeagueScene lineup={lg.lock ? lg.lock.team : team} locked={!!lg.lock} />
          <Key n={2} />
          <div className="hb-p-content">
            <span className="hb-p-kicker">Le week-end · entre potes</span>
            <h2>Ma Ligue</h2>
            <p className="hb-p-sub">Tes 5 cartes marquent des points avec les vrais matchs du week-end.</p>
            <div className="hb-count" aria-label="Temps restant">
              <span className="hb-count-l">{lg.gw.phase === 'open' ? (lg.lock ? 'Équipe verrouillée · coup d\'envoi dans' : 'Verrouillage dans') : 'Matchs en cours · résultats dans'}</span>
              <div className="hb-digits">
                {t.d > 0 && <Digit v={t.d} u="j" />}
                <Digit v={pad(t.h)} u="h" />
                <Digit v={pad(t.m)} u="min" />
                <Digit v={pad(t.s)} u="s" tick />
              </div>
            </div>
            <span className="hb-cta"><span>{lg.lock ? 'Voir ma ligue' : 'Verrouiller mon 5'}</span><Arrow /></span>
          </div>
        </Portal>

        {/* ------------------------------ CARRIÈRE ------------------------------ */}
        <Portal kind="career" color={CAREER} route="carriere" label="Mode Carrière">
          <CareerScene career={career} />
          <Key n={3} />
          <div className="hb-p-content">
            <span className="hb-p-kicker">Solo · ton propre joueur</span>
            <h2>Carrière</h2>
            {career ? (
              <>
                <p className="hb-p-sub">{career.player.name}, niveau {career.player.level} · {career.clubName}, saison {seasonLabel(career.season)}.</p>
                <div className="hb-chips">
                  {career.unread > 0 && <span className="hb-chip hot"><b>{career.unread}</b> lettre{career.unread > 1 ? 's' : ''} non lue{career.unread > 1 ? 's' : ''}</span>}
                  <span className="hb-chip">{career.next ? <>Prochain match : <b>{career.next.oppName}</b></> : 'Fin de saison : mercato'}</span>
                </div>
              </>
            ) : (
              <p className="hb-p-sub">Crée ton joueur, signe dans un club et grimpe jusqu'au sommet. Saison après saison.</p>
            )}
            <span className="hb-cta"><span>{career ? 'Reprendre' : 'Créer mon joueur'}</span><Arrow /></span>
          </div>
        </Portal>
      </div>
    </div>
  )
}

const Key = ({ n }) => <kbd className="jo-key" aria-hidden="true">{n}</kbd>

// Scène de la Carrière : l'écusson de ton club sous les projecteurs (ou un écusson vide à écrire).
function CareerScene({ career }) {
  return (
    <div className={'hb-scene jo-career-scene' + (career ? '' : ' empty')} aria-hidden="true">
      <div className="jo-rays" />
      <div className="jo-steps">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--i': i }} />)}</div>
      <div className="jo-crest">
        {career
          ? <img src={crestUrl(career.clubName, { tier: 2 })} alt="" />
          : <svg viewBox="0 0 100 116"><path d="M50 4 92 18v38c0 30-20 47-42 56C28 103 8 86 8 56V18Z" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="9 7" /><text x="50" y="70" textAnchor="middle" fontSize="40" fontWeight="900" fill="currentColor">?</text></svg>}
        {career && <span className="jo-lvl">Niv {career.player.level}</span>}
      </div>
    </div>
  )
}
