import { createContext, useContext } from 'react';
import type { Announcer } from './announcer';
import type { Ids } from './ids';
import type { DocumentRouter } from './router';
import type { TimerService } from './timers';

/** What the one `BehaviourHost` of a document offers to kit components and hooks. */
export interface BehaviourHostValue {
  /** The key of this host in the document router and the timer service. */
  readonly owner: object;
  readonly announcer: Announcer;
  readonly ids: Ids;
  readonly timers: TimerService;
  readonly router: DocumentRouter;
}

export const BehaviourHostContext = createContext<BehaviourHostValue | null>(null);

/** The host a kit component runs under. Throws outside a `KitProvider`, like `kitTheme`. */
export function useBehaviourHost(): BehaviourHostValue {
  const host = useContext(BehaviourHostContext);
  if (host === null) {
    throw new Error('Kit components must be rendered inside <KitProvider>.');
  }
  return host;
}
