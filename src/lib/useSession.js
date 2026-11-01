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

export function signInWithDiscord() {
  return supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin },
  })
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
