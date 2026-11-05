import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sur Vercel, ces variables doivent être déclarées dans Settings > Environment Variables,
// PUIS le site redéployé (Vite les inscrit dans le code au moment du build).
export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? 'Les variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont absentes de ce déploiement.'
  : null

export const supabase = createClient(supabaseUrl || 'https://config-manquante.supabase.co', supabaseAnonKey || 'cle-manquante', {
  auth: {
    // PKCE : Discord renvoie ?code=… dans l'adresse (et non #access_token=… dans le hash),
    // ce qui ne se mélange pas avec les routes du site (#/accueil, #/boosters…).
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})
