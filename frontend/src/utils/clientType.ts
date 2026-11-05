import { isElectron } from './platform';

export const CLIENT_TYPE_HEADER = 'X-Client-Type';

/**
 * What this app says it is on auth requests (see the client-type contract in
 * the docs' auth-clients page). The web app says nothing: no header means web,
 * and cookie-based delivery is the only kind it may ever ask for.
 */
export function clientTypeHeaders(): Record<string, string> {
  return isElectron() ? { [CLIENT_TYPE_HEADER]: 'electron' } : {};
}
