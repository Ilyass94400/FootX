import { useEffect, useState } from 'react'

// Mini routeur par hash (#/boosters, #/collection...) : pas de dépendance en plus.
const read = () => window.location.hash.replace(/^#\/?/, '') || 'accueil'

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
