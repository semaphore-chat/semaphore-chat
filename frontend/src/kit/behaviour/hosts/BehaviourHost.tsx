import { useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createAnnouncer } from './announcer';
import { BehaviourHostContext, type BehaviourHostValue } from './hostContext';
import { createIds } from './ids';
import { LiveRegionSlot } from './LiveRegionSlot';
import { documentRouter } from './router';
import { browserTimers } from './timers';

/**
 * The one behaviour host of a document, mounted by `KitProvider`. A nested
 * provider reuses the host above it. It owns the announcer (and the live
 * regions in the page root), the id counters and the timer owner, and it
 * registers with the document router.
 *
 * The router has nothing to say yet: the overlay, toast, confirm, list and load
 * hosts register their handlers here as they arrive.
 */
export function BehaviourHost({ children }: { children: ReactNode }): JSX.Element {
  const outer = useContext(BehaviourHostContext);
  if (outer !== null) return <>{children}</>;
  return <RootHost>{children}</RootHost>;
}

function createHost(): BehaviourHostValue {
  return {
    owner: {},
    announcer: createAnnouncer(),
    ids: createIds(),
    timers: browserTimers,
    router: documentRouter(),
  };
}

function RootHost({ children }: { children: ReactNode }): JSX.Element {
  const [host] = useState(createHost);
  useEffect(() => {
    const off = host.router.register(host.owner, {});
    return () => {
      off();
      host.timers.disposeAll(host.owner);
    };
  }, [host]);
  return (
    <BehaviourHostContext value={host}>
      {/*
        First, so its slot registers before any layer's: the topmost slot is the
        last registered. In the body, not under the app's own root: it is a page
        sibling like MUI's modal roots, hidden with the page while a modal is
        open, and it adds nothing inside the tree a screen or a test renders.
      */}
      {createPortal(<LiveRegionSlot scope="root" />, document.body)}
      {children}
    </BehaviourHostContext>
  );
}
