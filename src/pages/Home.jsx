import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { go } from '../lib/useRoute'
import { getDiscordProfile } from '../lib/useSession'
import { useStock } from '../lib/boosterStock'
import { ANNOUNCEMENTS } from '../data/announcements'
import PlayerCard from '../components/PlayerCard'
import Pitch from '../components/Pitch'

export default function Home({ session }) {
  const { name } = getDiscordProfile(session)
  const [slide, setSlide] = useState(0)
  const [total, setTotal] = useState(0)
  const [preview, setPreview] = useState([])
  const boosters = useStock().opened

  // Les bannières tournent toutes les 7s
  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % ANNOUNCEMENTS.length), 7000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    supabase.from('cards').select('*', { count: 'exact', head: true }).then(({ count }) => setTotal(count || 0))
    supabase.from('cards').select('*').in('rarity', ['legendaire', 'iconique']).limit(6)
      .then(({ data }) => setPreview(data || []))
  }, [])

  const a = ANNOUNCEMENTS[slide]

  return (
    <div className="home">
      <section className="banner">
        <Pitch className="banner-pitch" />
        <div className="banner-content" key={slide}>
          <span className="tag">{a.tag}</span>
          <h1>{a.title}</h1>
          <p>{a.text}</p>
          <div className="banner-actions">
            <button className="btn" onClick={() => go(a.cta.route)}>{a.cta.label}</button>
            <button className="link" onClick={() => go('collection')}>ma collection →</button>
          </div>
        </div>
        <div className="banner-nav">
          {ANNOUNCEMENTS.map((x, i) => (
            <button key={i} className={i === slide ? 'on' : ''} onClick={() => setSlide(i)}>
              {String(i + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
      </section>

      <p className="welcome">Salut {name}.</p>

      <section className="score">
        <div><b>{boosters}</b><span>boosters ouverts</span></div>
        <div><b>{10 - (boosters % 10)}</b><span>avant une Épique garantie</span></div>
        <div><b>{200 - (boosters % 200)}</b><span>avant une Iconique garantie</span></div>
        <div><b>{total}</b><span>joueurs dans le jeu</span></div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Boosters</h2>
          <a href="#/boosters">tout voir →</a>
        </div>
        <div className="packs">
          <button className="pack" onClick={() => go('boosters')} style={{ '--c': 'var(--accent)' }}>
            <span className="pack-name">FootX Series</span>
            <span className="pack-info">Top 5 ligues · 10 cartes</span>
            <span className="pack-open">ouvrir</span>
          </button>
          <div className="pack locked" style={{ '--c': 'var(--gold)' }}>
            <span className="pack-name">Légendes</span>
            <span className="pack-info">les anciens</span>
            <span className="pack-open">bientôt</span>
          </div>
          <div className="pack locked" style={{ '--c': 'var(--r-atypique)' }}>
            <span className="pack-name">Pépites</span>
            <span className="pack-info">moins de 21 ans</span>
            <span className="pack-open">bientôt</span>
          </div>
        </div>
      </section>

      {preview.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>À chasser</h2>
            <a href="#/collection">le catalogue →</a>
          </div>
          <div className="card-grid">
            {preview.map((c) => <PlayerCard key={c.id} card={c} />)}
          </div>
        </section>
      )}
    </div>
  )
}
