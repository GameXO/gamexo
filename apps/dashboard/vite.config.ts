import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned, and strict. This used to be unset, which meant Vite's default 5173
    // and a silent bump to the next free port when that was taken — landing the
    // dashboard on 5174, which is the POS's configured port. `/pos/` then hit this
    // app's SPA fallback and served the dashboard, so the counter tablet appeared
    // to ignore its own login and render the wrong product entirely.
    //
    // strictPort turns that into a refusal to start. A port collision is a mistake
    // worth failing on, not one worth papering over: the alternative is two apps
    // quietly swapping URLs and half an hour spent debugging the wrong one.
    port: 5173,
    strictPort: true,
  },
})
