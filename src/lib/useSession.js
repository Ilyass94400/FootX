import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

// Session Supabase (connexion Discord). undefined = en cours de chargement.
export function useSession() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  return session
}

// Retour vers l'adresse ACTUELLE du site (localhost en dev, ton domaine Vercel en prod).
// Cette adresse doit figurer dans Supabase > Authentication > URL Configuration > Redirect URLs,
// sinon Supabase renvoie vers la "Site URL" (souvent restée sur localhost).
export function signInWithDiscord() {
  return supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + '/' },
  })
}

// Erreur renvoyée dans l'adresse après un aller-retour Discord/Supabase
// (?error=…&error_description=… ou #error=…). Lue une seule fois, puis l'adresse est nettoyée.
let urlError
export function readAuthError() {
  if (urlError !== undefined) return urlError
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  const desc = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error')
  urlError = desc || null // URLSearchParams décode déjà (%20, +)
  if (urlError) window.history.replaceState(null, '', window.location.pathname + '#/accueil')
  return urlError
}

export function signOut() {
  return supabase.auth.signOut()
}

// Infos Discord renvoyées par Supabase
export function getDiscordProfile(session) {
  const m = session?.user?.user_metadata || {}
  return {
    name: m.custom_claims?.global_name || m.full_name || m.name || 'Joueur',
    avatar: m.avatar_url || null,
  }
}
