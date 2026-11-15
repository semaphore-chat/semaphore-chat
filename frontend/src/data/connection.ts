/**
 * The app's connection to the server, for chrome in either shell. Headless.
 *
 * One socket for the whole app: `'reconnecting'` while it is down (also before the first connect),
 * which is when the old shell shows its "Reconnecting..." chip and the new one its offline banner.
 */
import { useSocketConnected } from '../hooks/useSocket';

export type ConnectionState = 'connected' | 'reconnecting';

export function useConnectionState(): ConnectionState {
  return useSocketConnected() ? 'connected' : 'reconnecting';
}
