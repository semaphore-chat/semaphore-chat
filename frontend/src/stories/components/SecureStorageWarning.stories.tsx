import { useEffect } from 'react';
import { SecureStorageWarning } from '../../components/Electron/SecureStorageWarning';
import { storeElectronRefreshToken } from '../../utils/tokenService';
import { defineComponent } from '../fixtures/componentStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario } from '../fixtures/scenarios';

/*
 * The one-time warning Electron shows when the OS keychain is unavailable
 * (e.g. no keyring daemon on Linux) and the refresh token falls back to
 * unencrypted localStorage. AuthGate mounts <SecureStorageWarning />; here
 * the fake bridge's storeRefreshToken reports the keychain unavailable and
 * tokenService raises the warning. Tablet and desktop only (Electron).
 */

// tokenService's localStorage keys this story touches: the warning is shown
// once per browser profile, and the fallback stores the token itself.
const TOUCHED_KEYS = [
  'semaphore:secureStorageWarningShown',
  'semaphore:secureStorageWarningPending',
  'refreshToken',
];

/** Persists a token through the fake keychain, then puts localStorage back. */
function PersistTokenOnMount() {
  useEffect(() => {
    const saved = TOUCHED_KEYS.map((key) => [key, localStorage.getItem(key)] as const);
    TOUCHED_KEYS.forEach((key) => localStorage.removeItem(key));
    void storeElectronRefreshToken('ladle-refresh-token');
    return () => {
      saved.forEach(([key, value]) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
    };
  }, []);
  return null;
}

/** Keychain unavailable: the warning snackbar. */
export const KeychainUnavailable = asElectron(
  defineComponent(
    bigCommunityScenario,
    () => (
      <>
        <SecureStorageWarning />
        <PersistTokenOnMount />
      </>
    ),
    { maxWidth: false },
  ),
  {
    storeRefreshToken: () => Promise.resolve({ stored: false, availability: 'unavailable' }),
    getSecureStorageAvailability: () => Promise.resolve('unavailable'),
  },
);
KeychainUnavailable.meta = { viewports: ['tablet', 'desktop'] };
