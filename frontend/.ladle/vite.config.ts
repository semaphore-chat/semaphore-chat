import { defineConfig } from 'vite';
import path from 'path';

/**
 * Minimal Vite config used ONLY by `ladle serve`/`ladle build` (see
 * `.ladle/config.mjs`'s `viteConfig` field) — deliberately not the app's
 * real `frontend/vite.config.ts` (VitePWA + dev API proxy, both irrelevant
 * here: the sandbox talks to MSW, not a real backend).
 *
 * The one thing that matters: `publicDir` points at `.ladle/public/`
 * instead of the default (`frontend/public/`, the real app's PWA asset
 * directory) so Ladle's MSW addon copying `mockServiceWorker.js` in never
 * touches the real app's static assets.
 */
export default defineConfig({
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    // The `ux-shots` container reaches this dev server as `http://ladle:61000`
    // (the docker-compose service name) — Vite 6's default host allowlist
    // would otherwise reject that Host header.
    allowedHosts: ['ladle', 'localhost'],
  },
});
