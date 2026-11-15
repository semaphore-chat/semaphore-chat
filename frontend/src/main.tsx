import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { QueryClientProvider } from "@tanstack/react-query";

import App from "./App.tsx";
import { HashRouter } from "react-router-dom";
import { configureApiClient } from "./api-client-config";
import { settleOwedServerSignOut } from "./utils/serverSignOut";
import { isElectron } from "./utils/platform";
import { queryClient } from "./queryClient";

// Configure the generated API client (auth interceptors, base URL)
configureApiClient();

// A web sign-out whose logout call never reached the server: retry it now
// (until then no refresh restores that session; see serverSignOut.ts)
void settleOwedServerSignOut();

// Capture the PWA install prompt as early as possible — the browser can
// fire beforeinstallprompt before React mounts (side-effect import)
import "./utils/installPrompt";

// Register service worker only in web browser (not Electron file:// context).
// registerType is "prompt": instead of silently reloading, we surface an
// "Update available" toast (UpdateToast) and apply the update on user consent.
if (!isElectron()) {
  Promise.all([
    import("virtual:pwa-register"),
    import("./utils/swUpdate"),
  ])
    .then(([{ registerSW }, { setUpdateSW, setUpdateAvailable }]) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          setUpdateAvailable(true);
        },
      });
      setUpdateSW(updateSW);
    })
    .catch((error) => {
      console.error("Failed to register service worker:", error);
    });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>
);
