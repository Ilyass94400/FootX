import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Adresse publique du site, pour l'aperçu des liens (Discord, WhatsApp…) qui exige une URL complète.
// Sur Vercel elle est fournie automatiquement (VERCEL_PROJECT_PRODUCTION_URL) ;
// tu peux aussi la forcer avec la variable SITE_URL (ex. https://footx.fr).
const siteUrl = () => {
  const u = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
  return u ? (u.startsWith('http') ? u : 'https://' + u).replace(/\/$/, '') : ''
}

const siteUrlPlugin = () => ({
  name: 'footx-site-url',
  transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl()),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
})
