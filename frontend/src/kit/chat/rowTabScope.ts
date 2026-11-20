/**
 * How a message row shares Tab with the controls inside it (links, mentions, reactions, a quote, attachments,
 * Retry). A message list is one Tab stop: the row that holds it (the list's roving focus). Only that row's own
 * controls, and the controls of a row focus is in, are Tab stops; every other row's controls are `tabIndex -1`,
 * still clickable and still reachable by a screen reader's own navigation. So Tab from the focused row walks its
 * controls and then leaves the list, instead of walking every link of every rendered message.
 *
 * One context per row with a boolean value: a focus move re-renders only the two rows whose value changed.
 * Outside a row that joins a list's roving focus (no provider) everything is a Tab stop as usual.
 */
import { createContext, useContext } from 'react';

/** Whether the controls of the surrounding message row are Tab stops now. */
export const RowTabScopeContext = createContext<boolean>(true);

/** The `tabIndex` for a control inside a message row: undefined (its natural one) or -1 in a row Tab skips. */
export function useRowTabIndex(): -1 | undefined {
  return useContext(RowTabScopeContext) ? undefined : -1;
}
