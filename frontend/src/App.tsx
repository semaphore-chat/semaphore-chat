import { Suspense, useState } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { CircularProgress, Box } from "@mui/material";
import { ThemeProvider } from "./contexts/ThemeContext";
import AutoUpdater from "./components/Electron/AutoUpdater";
import { ConnectionWizard } from "./components/Electron/ConnectionWizard";
import { AppChrome } from "./components/PWA/AppChrome";
import { hasServers } from "./utils/serverStorage";
import { isElectron } from "./utils/platform";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppErrorFallback } from "./components/AppErrorFallback";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { AppRoutes } from "./routes";

function App() {
  // Check if running in Electron and needs server configuration
  const needsServerSetup = isElectron() && !hasServers();
  const [showWizard, setShowWizard] = useState(needsServerSetup);

  // Deep link (semaphore://) listener — mounted unconditionally (not inside
  // AuthGate/Layout) so it's alive on public routes and before a server is
  // configured too. See hooks/useDeepLinks.ts for the full seam rationale.
  useDeepLinks();

  return (
    <ThemeProvider>
      <CssBaseline />
      <AutoUpdater />
      {showWizard ? (
        <ConnectionWizard
          open={true}
          onComplete={() => {
            setShowWizard(false);
            // Reload the page to pick up the new server configuration
            window.location.reload();
          }}
        />
      ) : (
        <>
          {/*
            App-level boundary: the outermost safety net for render crashes that
            escape every closer boundary (e.g. RouteErrorBoundary below). It sits
            inside ThemeProvider so the fallback is themed, and above the routes
            so it only catches what a route-level boundary didn't. QueryClient
            (main.tsx) and the auth/socket/notification providers mounted by
            AuthGate/Layout live below RouteErrorBoundary's panel-level seams, so
            ordinary page crashes never reach this far and never unmount them —
            this boundary firing means a full reload is the safest recovery.
          */}
          <ErrorBoundary fallback={(error) => <AppErrorFallback error={error} />}>
            {/* PWA install / update / offline chrome — each piece also has its
                own silent boundary, so a crash there never blanks the app. */}
            <AppChrome />
            <Suspense fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'var(--full-dvh)' }}>
                <CircularProgress />
              </Box>
            }>
              <RouteErrorBoundary>
                <AppRoutes />
              </RouteErrorBoundary>
            </Suspense>
          </ErrorBoundary>
        </>
      )}
    </ThemeProvider>
  );
}

export default App;
