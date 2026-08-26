import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 is the dashboard and 5174 is the POS, so the marketing site takes 5175.
    // All three run side by side against one backend during local dev — which this
    // flow actually needs, since signup ends by redirecting into the dashboard.
    port: 5175,
    // See the dashboard's config: a silent port bump puts one app on another's
    // URL, and the resulting confusion costs far more than a failed start.
    strictPort: true,
    host: true,
  },
})
