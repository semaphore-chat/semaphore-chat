/**
 * Ladle UX sandbox config. See docs/superpowers/specs/2026-09-22-ladle-ux-sandbox-design.md
 * for the design this implements.
 *
 * - `addons.msw.enabled: true` turns on Ladle's built-in MSW addon: any
 *   story exporting `.msw` (see `src/stories/fixtures/screenStory.tsx`)
 *   gets those request handlers installed automatically, and unmatched
 *   requests are logged loudly in the browser console
 *   (`onUnhandledRequest: 'warn'`, msw's own default) so gaps are visible.
 * - `viteConfig` points at a dedicated, minimal Vite config (NOT the app's
 *   real `vite.config.ts`, which brings in the PWA plugin and dev proxy —
 *   irrelevant/harmful here) so `mockServiceWorker.js` gets copied into
 *   `.ladle/public/`, not the real app's `public/` PWA assets directory.
 * - Bound to 0.0.0.0:61000 so the `ux-shots` container can reach it at
 *   `http://ladle:61000` over the Docker network.
 * - `outDir: 'build-ladle'`: Ladle's default (`build/`) is where the
 *   committed Electron icons and Linux packaging scripts live, and
 *   `ladle build` empties it first.
 */
export default {
  stories: 'src/stories/**/*.stories.tsx',
  port: 61000,
  host: '0.0.0.0',
  viteConfig: '.ladle/vite.config.ts',
  outDir: 'build-ladle',
  addons: {
    msw: { enabled: true },
    theme: { defaultState: 'dark' },
    a11y: { enabled: true },
  },
};
