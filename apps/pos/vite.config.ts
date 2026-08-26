import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served behind the reverse proxy at /pos — every asset URL and route the app
  // generates needs this prefix, both in dev and in the built output.
  base: '/pos/',
  server: {
    // Distinct from the dashboard's 5173 so both frontends can run side by side
    // against the same backend during local dev.
    port: 5174,
    // Refuse to start rather than drift onto another app's port. Without this a
    // busy 5174 silently moves the POS to 5175 (the website's), and whatever *is*
    // on 5174 answers /pos/ with its own SPA fallback — which looks exactly like
    // the POS ignoring its login and rendering the wrong app.
    strictPort: true,
    // Bind every interface, not just loopback, so a phone/tablet on the same
    // Wi-Fi can reach this for on-device testing.
    host: true,
  },
  resolve: {
    alias: {
      // lottie-react's package.json "browser" field points at its UMD build, which Vite's
      // resolver prefers over the ESM one — the UMD bundle's whole CJS `module.exports`
      // (not just the component) ends up as the default import. Force the ESM build instead.
      'lottie-react': 'lottie-react/build/index.es.js',
    },
  },
})
