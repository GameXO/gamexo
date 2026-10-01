import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), assetCdn()],
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

/**
 * Images and icons are not bundled — they are served from the asset CDN (see
 * /assets/README.md and src/lib/asset.ts).
 *
 * In dev this serves the repo's /assets folder at /cdn, so a new icon shows up
 * without uploading anything. A production build must be told where the CDN is:
 * without VITE_ASSET_BASE_URL every image would point at /cdn, which does not
 * exist once deployed, so the build refuses rather than ship broken images.
 */
function assetCdn(): Plugin {
  const root = fileURLToPath(new URL('../../assets/', import.meta.url))
  const types: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  return {
    name: 'gamexo-asset-cdn',
    config(_, { command, mode }) {
      const base = loadEnv(mode, process.cwd(), 'VITE_').VITE_ASSET_BASE_URL
      if (command === 'build' && !base) {
        throw new Error(
          'VITE_ASSET_BASE_URL is not set. Point it at the asset CDN, e.g. ' +
            'VITE_ASSET_BASE_URL=https://cdn.example.com pnpm build',
        )
      }
    },
    configureServer(server) {
      server.middlewares.use('/cdn', (req, res) => {
        const file = path.join(root, decodeURIComponent((req.url ?? '').split('?')[0]))
        // A 404 like the real CDN, not the SPA's index.html: a sport with no photo
        // must fail to load so the card can fall back to the sport's icon.
        if (!file.startsWith(root) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}
