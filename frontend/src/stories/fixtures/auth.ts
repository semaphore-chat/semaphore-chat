/**
 * Makes the app believe it's logged in, without touching AuthGate's actual
 * token-validation state machine (see `AuthenticatedShell.tsx` for why the
 * sandbox renders its own provider stack instead of `<AuthGate/>`).
 */
import { setAccessToken } from '../../utils/tokenService';

let configured = false;

/** Idempotent — safe to call on every story render. */
export function configureMockAuth(): void {
  setAccessToken('ladle-mock-access-token');
  if (configured) return;
  configured = true;
  try {
    // Skip the Electron "secure storage unavailable" one-time warning banner —
    // irrelevant in a browser sandbox.
    localStorage.setItem('semaphore:secureStorageWarningShown', 'true');
  } catch {
    // Storage may be unavailable (rare); harmless to skip.
  }
}
