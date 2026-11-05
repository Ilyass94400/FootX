import { useEffect, useState } from 'react'

// Mini routeur par hash (#/boosters, #/collection...) : pas de dépendance en plus.
// Un hash technique laissé par la connexion (#access_token=…, #error=…) n'est pas une page.
const read = () => {
  const r = window.location.hash.replace(/^#\/?/, '')
  return !r || /^(access_token|error|code|refresh_token)=/.test(r) || r.includes('=') ? 'accueil' : r
}

export function useRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => { setRoute(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const go = (r) => { window.location.hash = '/' + r }
