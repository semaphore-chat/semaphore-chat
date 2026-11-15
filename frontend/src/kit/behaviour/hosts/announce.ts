import { useCallback, useContext } from 'react';
import type { Politeness } from '../toastQueue';
import { BehaviourHostContext } from './hostContext';

/**
 * Have screen readers read `text`: `polite` (default) waits for a pause, `assertive` interrupts. It goes
 * through the host's announcer, so it is heard from inside a Dialog or Sheet too. Outside a `KitProvider`
 * it does nothing.
 */
export function useAnnounce(): (text: string, politeness?: Politeness) => void {
  const announcer = useContext(BehaviourHostContext)?.announcer;
  return useCallback(
    (text: string, politeness: Politeness = 'polite') => {
      announcer?.say(text, politeness);
    },
    [announcer],
  );
}
