import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFriends, presence, FriendError } from '../lib/friends'
import { crestUrl } from '../lib/career/crest'
import { go } from '../lib/useRoute'
import HeroCard from '../components/HeroCard'
import './amis.css'
import PageHelp from '../components/PageHelp'

// ============================================================================
// Amis : mon code ami, ajouter quelqu'un, demandes reçues / envoyées, profils.
// ============================================================================
export default function Amis({ session }) {
  const { loading, me, rows, mode, reason, api, error } = useFriends(session)
  const [tab, setTab] = useState('amis')
  const [open, setOpen] = useState(null)
  const close = useCallback(() => setOpen(null), [])
  const friends = rows.filter((r) => r.status === 'accepted').sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0))
  const incoming = rows.filter((r) => r.status === 'incoming')
  const outgoing = rows.filter((r) => r.status === 'outgoing')
  const online = friends.filter((f) => presence(f.last_seen).on).length
  useEffect(() => { if (incoming.length && tab === 'amis' && !friends.length) setTab('recues') }, [incoming.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="am">
      <header className="am-head">
        <div>
          <span className="am-kicker">Communauté</span>
          <h1>Mes amis</h1>
          <p>{loading ? 'Chargement…' : `${friends.length} ami${friends.length > 1 ? 's' : ''} · ${online} en ligne`}</p>
        </div>
        {me && <MyCode me={me} />}
      </header>
      <PageHelp topic="amis" />

      {mode === 'demo' && (
        <p className="am-demo">
          {reason === 'guest' ? 'Mode invité : ces amis sont fictifs. Connecte-toi avec Discord pour ajouter tes vrais amis.' : 'Mode démo : les amis en ligne s\'activeront dès que la migration Supabase « 20261109_collection_amis » sera appliquée.'}
        </p>
      )}
      {error && <p className="am-err">{error}</p>}

      <AddFriend api={api} />

      <nav className="am-tabs">
        <button className={tab === 'amis' ? 'on' : ''} onClick={() => setTab('amis')}>Amis<i>{friends.length}</i></button>
        <button className={tab === 'recues' ? 'on' : ''} onClick={() => setTab('recues')}>Demandes reçues{incoming.length > 0 && <i className="hot">{incoming.length}</i>}</button>
        <button className={tab === 'envoyees' ? 'on' : ''} onClick={() => setTab('envoyees')}>Envoyées<i>{outgoing.length}</i></button>
      </nav>

      {loading ? (
        <div className="am-list">{Array.from({ length: 3 }, (_, i) => <div key={i} className="am-row skel" />)}</div>
      ) : tab === 'amis' ? (
        friends.length ? <div className="am-list">{friends.map((f, i) => <FriendRow key={f.id} f={f} i={i} api={api} onOpen={() => setOpen(f)} />)}</div>
          : <Empty title="Pas encore d'amis" text="Partage ton code ami ou entre celui d'un ami juste au-dessus." />
      ) : tab === 'recues' ? (
        incoming.length ? <div className="am-list">{incoming.map((f, i) => <RequestRow key={f.id} f={f} i={i} api={api} />)}</div>
          : <Empty title="Aucune demande" text="Les demandes d'amis que tu reçois apparaissent ici." />
      ) : (
        outgoing.length ? <div className="am-list">{outgoing.map((f, i) => <SentRow key={f.id} f={f} i={i} api={api} />)}</div>
          : <Empty title="Aucune demande en attente" text="Les demandes que tu envoies attendent ici d'être acceptées." />
      )}

      {open && <Profile f={open} api={api} onClose={close} />}
    </div>
  )
}

function Avatar({ name, url, size = 48, on }) {
  const hue = [...String(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <span className={'am-av' + (on ? ' on' : '')} style={{ width: size, height: size, '--h': hue }}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : <b style={{ fontSize: size * 0.42 }}>{String(name || '?').slice(0, 1).toUpperCase()}</b>}
      {on !== undefined && <i />}
    </span>
  )
}

function MyCode({ me }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(me.friend_code); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* sélection manuelle */ }
  }
  return (
    <div className="am-me">
      <Avatar name={me.username} url={me.avatar_url} size={52} />
      <div>
        <small>Ton code ami</small>
        <code onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>{me.friend_code}</code>
      </div>
      <button className={'am-copy' + (copied ? ' ok' : '')} onClick={copy}>{copied ? 'Copié !' : 'Copier'}</button>
    </div>
  )
}

function AddFriend({ api }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const send = async (e) => {
    e.preventDefault()
    if (!api || !q.trim()) return
    setBusy(true); setRes(null)
    try {
      const r = await api.send(q.trim())
      setRes({ ok: true, text: r === 'accepted' ? 'Vous êtes maintenant amis !' : 'Demande envoyée.' })
      setQ('')
    } catch (err) {
      setRes({ ok: false, text: err instanceof FriendError ? err.message : 'Impossible d\'envoyer la demande.' })
    } finally { setBusy(false) }
  }
  return (
    <form className="am-add" onSubmit={send}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <input value={q} onChange={(e) => { setQ(e.target.value); setRes(null) }} placeholder="Code ami (FX-XXXX-XXXX) ou pseudo exact" aria-label="Code ami ou pseudo" maxLength={40} />
      <button disabled={busy || !q.trim()}>{busy ? 'Envoi…' : 'Ajouter'}</button>
      {res && <span key={res.text} className={'am-res ' + (res.ok ? 'ok' : 'no')}>{res.text}</span>}
    </form>
  )
}

function Stat({ v, l }) { return <span className="am-stat"><b>{v}</b>{l}</span> }

function FriendRow({ f, i, api, onOpen }) {
  const [confirm, setConfirm] = useState(false)
  const p = presence(f.last_seen)
  return (
    <div className="am-row" style={{ '--i': i }}>
      <button className="am-who" onClick={onOpen}>
        <Avatar name={f.username} url={f.avatar_url} on={p.on} />
        <span className="am-name"><b>{f.username}</b><small className={p.on ? 'on' : ''}>{p.label}</small></span>
      </button>
      <div className="am-stats">
        <Stat v={f.wins ?? 0} l="victoires" />
        <Stat v={(f.cards ?? 0).toLocaleString('fr-FR')} l="cartes" />
      </div>
      <div className="am-acts">
        <button className="am-btn" onClick={onOpen}>Profil</button>
        {confirm
          ? <><button className="am-btn danger" onClick={() => api.remove(f.id)}>Retirer</button><button className="am-btn ghost" onClick={() => setConfirm(false)}>Annuler</button></>
          : <button className="am-btn ghost icon" onClick={() => setConfirm(true)} aria-label={`Retirer ${f.username}`} title="Retirer de mes amis">✕</button>}
      </div>
    </div>
  )
}

function RequestRow({ f, i, api }) {
  const [busy, setBusy] = useState(false)
  const act = async (ok) => { setBusy(true); try { await api.respond(f.id, ok) } finally { setBusy(false) } }
  return (
    <div className="am-row req" style={{ '--i': i }}>
      <div className="am-who"><Avatar name={f.username} url={f.avatar_url} /><span className="am-name"><b>{f.username}</b><small>veut devenir ton ami</small></span></div>
      <div className="am-acts">
        <button className="am-btn yes" disabled={busy} onClick={() => act(true)}>Accepter</button>
        <button className="am-btn ghost" disabled={busy} onClick={() => act(false)}>Refuser</button>
      </div>
    </div>
  )
}

function SentRow({ f, i, api }) {
  return (
    <div className="am-row" style={{ '--i': i }}>
      <div className="am-who"><Avatar name={f.username} url={f.avatar_url} /><span className="am-name"><b>{f.username}</b><small>En attente de réponse…</small></span></div>
      <div className="am-acts"><button className="am-btn ghost" onClick={() => api.remove(f.id)}>Annuler la demande</button></div>
    </div>
  )
}

function Empty({ title, text }) {
  return (
    <div className="am-empty">
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="44" cy="28" r="8" fill="none" stroke="currentColor" strokeWidth="3" opacity=".5" /><path d="M6 54a18 18 0 0 1 36 0M40 54a14 14 0 0 1 20-12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
      <b>{title}</b><span>{text}</span>
    </div>
  )
}

function Profile({ f, api, onClose }) {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    api.profile(f.user_id).then((x) => alive && setP(x)).catch((e) => alive && setErr(e.message))
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => { alive = false; window.removeEventListener('keydown', k) }
  }, [f, api, onClose])
  const pres = presence(f.last_seen)
  const rate = useMemo(() => (p?.matches ? Math.round((p.wins / p.matches) * 100) : 0), [p])
  return (
    <div className="am-modal" onClick={onClose} role="dialog" aria-label={`Profil de ${f.username}`}>
      <div className="am-prof" onClick={(e) => e.stopPropagation()}>
        <button className="am-x" onClick={onClose} aria-label="Fermer">×</button>
        <header>
          <Avatar name={f.username} url={f.avatar_url} size={72} on={pres.on} />
          <div><h2>{f.username}</h2><span className={pres.on ? 'on' : ''}>{pres.label}</span><code>{f.friend_code}</code></div>
        </header>
        {err && <p className="am-err">{err}</p>}
        {!p && !err && <div className="am-prof-load"><span className="am-spin" />Chargement du profil…</div>}
        {p && (
          <>
            <div className="am-kpis">
              <div><b>{p.wins}</b><span>Victoires</span></div>
              <div><b>{p.matches}</b><span>Matchs</span></div>
              <div><b>{rate} %</b><span>Taux de victoire</span></div>
              <div><b>{(p.unique ?? 0).toLocaleString('fr-FR')}</b><span>Joueurs différents</span></div>
            </div>
            {p.best?.length > 0 && (
              <section>
                <h3>Ses meilleurs joueurs</h3>
                <div className="am-best">{p.best.map((c) => <div key={c.id} className="am-best-c"><HeroCard card={c} tilt={false} /></div>)}</div>
              </section>
            )}
            {p.clubs?.length > 0 && (
              <section>
                <h3>Ses clubs favoris</h3>
                <div className="am-clubs">
                  {p.clubs.map((c) => (
                    <button key={c.club} onClick={() => go('collection/' + c.club.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}>
                      <img src={crestUrl(c.club)} alt="" /><span>{c.club}</span><b>{c.n}</b>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
