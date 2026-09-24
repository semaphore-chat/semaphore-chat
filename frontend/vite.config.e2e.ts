import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

/**
 * Vite configuration for E2E testing
 *
 * This config is used when running E2E tests in Docker.
 * It proxies API requests to the backend-test container.
 *
 * Served over plain HTTP. The voice E2E runs the browser against
 * http://localhost:<port>, which browsers treat as a *secure context* (so
 * getUserMedia works) without any TLS — see frontend/e2e/voice/README.md.
 *
 * E2E_BACKEND_URL sets the proxy target. docker-compose.e2e.yml points it at
 * its run's backend container (<E2E_STACK>-backend: the shared semaphore-test
 * network can hold several e2e stacks, so the generic `backend-test` service
 * name is ambiguous there); the CI Playwright job runs the backend directly on
 * the runner and points this at localhost instead.
 */
const backendUrl = process.env.E2E_BACKEND_URL || "http://backend-test:3000";
const backendWsUrl = backendUrl.replace(/^http/, "ws");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw-custom.ts",
      includeAssets: ["favicon.ico", "favicon-32x32.png", "favicon-16x16.png", "apple-touch-icon.png"],
      manifest: {
        name: "Semaphore Chat",
        short_name: "Semaphore Chat",
        description: "Self-hosted voice and text chat",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: false, // Disable PWA in E2E tests
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@semaphore-chat/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  base: "/",
  server: {
    host: "0.0.0.0",
    // Vite otherwise 403s unknown Hosts. The dockerized Playwright runner
    // shares this container's network namespace and uses "localhost".
    allowedHosts: ["frontend-test", "localhost"],
    proxy: {
      // Proxy to this run's backend (E2E_BACKEND_URL)
      "/api": {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: backendWsUrl,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
