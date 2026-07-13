import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Bundle visualizer — dev-only, opt-in via `pnpm run build:analyze`
    // (ANALYZE=true). Writes dist/stats.html; never runs in normal builds/CI.
    // Cast: rollup-plugin-visualizer's published types target an older
    // Rollup than the one Vite 6 bundles, so its Plugin shape doesn't
    // structurally match Vite's PluginOption — harmless at runtime.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: "dist/stats.html",
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
          }) as PluginOption,
        ]
      : []),
    VitePWA({
      // "prompt": a waiting SW is surfaced via UpdateToast and applied on user
      // consent (SKIP_WAITING message) instead of silently reloading mid-session.
      registerType: "prompt",
      injectRegister: false,
      // Use injectManifest for custom service worker with push notification handling
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw-custom.ts",
      includeAssets: ["favicon.ico", "favicon-32x32.png", "favicon-16x16.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Semaphore Chat",
        short_name: "Semaphore Chat",
        description: "Self-hosted voice and text chat",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        display_override: ["standalone"],
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        categories: ["social"],
        shortcuts: [
          {
            name: "Messages",
            short_name: "Messages",
            description: "Open direct messages",
            url: "/#/direct-messages",
            icons: [
              {
                src: "shortcut-messages-96.png",
                sizes: "96x96",
                type: "image/png",
              },
            ],
          },
          {
            name: "Notifications",
            short_name: "Notifications",
            description: "Open notifications",
            url: "/#/notifications",
            icons: [
              {
                src: "shortcut-notifications-96.png",
                sizes: "96x96",
                type: "image/png",
              },
            ],
          },
        ],
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-192x192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        screenshots: [
          {
            src: "screenshots/mobile-chat.png",
            sizes: "412x915",
            type: "image/png",
            form_factor: "narrow",
            label: "Semaphore Chat on mobile — a community text channel",
          },
          {
            src: "screenshots/desktop-chat.png",
            sizes: "1920x1080",
            type: "image/png",
            form_factor: "wide",
            label: "Semaphore Chat on desktop — a community text channel",
          },
        ],
      },
      injectManifest: {
        // Post PR-11 (livekit/hls/mui split into their own chunks + several
        // voice-session components lazy-loaded), the largest chunk is the
        // entry (~1.3MB); this comfortably covers it with headroom without
        // reverting to the old 6MB bloat allowance.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB
        // rollup-plugin-visualizer's dist/stats.html (only written when
        // building with ANALYZE=true) can be several MB of inlined treemap
        // JSON — exclude it so a stray `pnpm run build:analyze` never leaks
        // it into the service worker's precache manifest.
        globIgnores: ["stats.html"],
      },
      devOptions: {
        enabled: true, // Enable PWA in dev mode for testing
        type: "module",
        // Required with injectManifest in dev: without it the dev SW gets an
        // empty __WB_MANIFEST and createHandlerBoundToURL('index.html')
        // throws non-precached-url, so the SW never installs in dev.
        navigateFallback: "index.html",
      },
    }),
  ],
  resolve: {
    alias: {
      "@semaphore-chat/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Force these heavyweight, voice/video-only (or MUI, used broadly but
        // separately cacheable) dependencies into their own chunks regardless
        // of whether they're reached via static or dynamic import. This is
        // what keeps the entry chunk free of livekit/hls code even from the
        // few remaining eager (always-mounted) call sites documented in
        // PR-11 — manualChunks placement is independent of import style.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("livekit-client") || id.includes("@livekit/components-react")) {
              return "livekit";
            }
            if (id.includes("hls.js")) {
              return "hls";
            }
            if (
              id.includes("@mui/material") ||
              id.includes("@mui/icons-material") ||
              id.includes("@emotion/")
            ) {
              return "mui";
            }
          }
        },
      },
    },
  },
  // Use relative paths for Electron file:// protocol compatibility
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://backend:3000",
        changeOrigin: true,
        secure: false, // Set to true if using HTTPS
      },
      // Proxy websocket requests
      "/socket.io": {
        target: (() => {
          const url = new URL(process.env.VITE_BACKEND_URL || "http://backend:3000");
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          return url.toString().replace(/\/$/, "");
        })(),
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
