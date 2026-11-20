import { createContext } from 'react';

/**
 * PLACEHOLDER plumbing (PR 3): the shell's pieces are not built yet (PRs 5-7). Each placeholder renders
 * nothing in the app; stories set this to true so the frame's slots show as labelled, empty places.
 * Goes when the last placeholder is replaced.
 */
export const ShowPlaceholdersContext = createContext(false);
