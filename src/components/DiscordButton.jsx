import { useState } from 'react'
import { signInWithDiscord } from '../lib/useSession'

export default function DiscordButton({ big }) {
  const [error, setError] = useState(null)

  const login = async () => {
    const { error } = await signInWithDiscord()
    if (error) setError(error.message)
  }

  return (
    <div>
      <button className={'btn-discord' + (big ? ' big' : '')} onClick={login}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
        </svg>
        Se connecter avec Discord
      </button>
      {error && <p className="login-error">Erreur : {error}</p>}
    </div>
  )
}
