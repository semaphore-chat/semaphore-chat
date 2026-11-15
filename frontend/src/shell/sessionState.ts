/**
 * The new design's per-session state in this browser, forgotten when a session ends (review I5).
 *
 * The shared session teardown (`utils/endLocalSession.ts`) calls it, so every path that ends a session
 * on this tab clears it: a sign-out, the server ending it mid-session, "Sign in again", and a page-load
 * refresh refused while a token was held. Two paths end a session without that teardown and call it
 * themselves: a page load with no token whose refresh is refused (keeping a `?design=` link opened now),
 * and the switch to another server in Settings (which clears the tokens and reloads).
 */
import type { QueryClient } from '@tanstack/react-query';
import { forgetNewDesignSetting } from '../contexts/newDesignCache';
import { dismissDesktopSignInNotice } from '../data/signInNotice';
import { forgetConnectionHistory } from '../data/connection';
import { clearDesignPreview } from './designPreview';
import { forgetAllAnnouncements } from './bannerMemory';

export interface ClearShellSessionStateOptions {
  /**
   * Keep this tab's design preview: a page load that finds no session must not drop a `?design=` link
   * opened before signing in (it is meant to survive the login redirect, PR B M3).
   */
  keepDesignPreview?: boolean;
}

/**
 * Forgets the cached "new design" setting (storage, the appearance query, the ThemeProvider's value,
 * without telling the server), this tab's design preview, the desktop sign-in notice, the connection
 * history and which banners were read out.
 */
export function clearShellSessionState(queryClient: QueryClient, options: ClearShellSessionStateOptions = {}): void {
  forgetNewDesignSetting(queryClient);
  if (!options.keepDesignPreview) clearDesignPreview();
  dismissDesktopSignInNotice();
  forgetConnectionHistory();
  forgetAllAnnouncements();
}
