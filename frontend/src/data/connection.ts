/**
 * The app's connection to the server, for chrome in either shell. Headless.
 *
 * One socket for the whole app. `connecting` until it has connected once this session, `reconnecting`
 * when a connection that was up is lost, `connected` otherwise. The browser having no network at all is
 * a separate fact (data/pwa `useBrowserOnline`).
 */
import { useEffect } from 'react';
import { useSocketConnected } from '../hooks/useSocket';

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting';

/** Set once the socket has connected in this session (AppShell records it, above both shells). */
let everConnected = false;

/** For the session teardown: the next session starts as `connecting`. */
export function forgetConnectionHistory(): void {
  everConnected = false;
}

/** Mounted once, above both shells (AppShell): remembers that the socket has connected. */
export function useRecordConnectionHistory(): void {
  const connected = useSocketConnected();
  useEffect(() => {
    if (connected) everConnected = true;
  }, [connected]);
}

export function useConnectionState(): ConnectionState {
  const connected = useSocketConnected();
  if (connected) return 'connected';
  return everConnected ? 'reconnecting' : 'connecting';
}
