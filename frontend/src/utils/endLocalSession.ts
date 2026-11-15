import type { QueryClient } from "@tanstack/react-query";
import { clearSavedConnection } from "../features/voice/voiceActions";
import { disconnectSocket } from "./socketSingleton";
import { clearTokens } from "./tokenService";
import { clearComposerDrafts } from "../hooks/useComposerDraft";
import { clearDesignPreview } from "../shell/designPreview";
import { clearSessionCaches } from "./clearSessionCaches";

/**
 * The local teardown that ends a session on this tab: the one function every
 * session-ending path calls (a manual sign-out after its server logout call;
 * AuthGate when the server ended the session, refused it on load, or the
 * user chose "Sign in again"), so no path can skip a step. In order:
 *
 * 1. forget the saved voice connection (no rejoin into this account's call),
 * 2. disconnect the socket,
 * 3. clear the tokens (and mark the session ended, see hasSessionEnded),
 * 4. drop the composer drafts (per tab, not per user),
 * 5. drop this tab's design preview,
 * 6. clear the query cache and abort pending uploads.
 *
 * Idempotent. Navigation to the login page is the caller's.
 */
export function endLocalSession(queryClient: QueryClient): void {
  clearSavedConnection();
  disconnectSocket();
  clearTokens();
  clearComposerDrafts();
  clearDesignPreview();
  clearSessionCaches(queryClient);
}
