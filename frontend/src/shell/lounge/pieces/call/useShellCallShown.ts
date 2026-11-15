/**
 * Whether the call-bar slot has anything to show: the template leaves no row (and no gap) without it.
 *
 * PLACEHOLDER (PR 3): true only in stories that show the placeholders. PR 7 makes it "in a call, or a
 * voice notice to show" from the data layer (`useCallBarModel`, `useVoiceNotice`).
 */
import { useContext } from 'react';
import { ShowPlaceholdersContext } from '../placeholderContext';

export function useShellCallShown(): boolean {
  return useContext(ShowPlaceholdersContext);
}
