import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), assetCdn()],
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
