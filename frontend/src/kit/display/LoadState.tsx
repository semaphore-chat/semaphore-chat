import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import type { LoadController } from '../behaviour/hosts/loadState';
import { visuallyHidden } from '../theme/a11y';
import { kitTheme } from '../theme/KitProvider';
import { focusRing } from '../theme/states';
import { Alert } from './Alert';

export interface LoadStateProps {
  /** From `useLoadState` or `useQueryLoadState`. */
  state: LoadController;
  /** Names the region: "Members" reads "Loading members". */
  label: string;
  /** Skeletons in the shape of the content. */
  skeleton: ReactNode;
  /** What shows when there is nothing to show. */
  empty: ReactNode;
  /** The error's first line: "Couldn't load members". */
  errorTitle: string;
  /** The content, shown when ready and while refreshing. */
  children: ReactNode;
}

const Region = styled('div')(({ theme }) => ({
  minWidth: 0,
  // Focus lands here only by script (after Try again): no ring for a pointer user, the kit ring
  // for a keyboard user, who would otherwise see nothing focused.
  '&:focus': { outline: 'none' },
  '&:focus-visible': focusRing(kitTheme(theme).palette),
}));

const Hidden = styled('span')({ ...visuallyHidden });

/** "Members" reads "loading members"; an acronym ("API keys") keeps its capitals. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Shows one of five things for a screen that loads from the server: a skeleton,
 * the content, the empty state, an error with Try again, or the content while it
 * refreshes. An error only takes over when there is nothing else to show.
 *
 * The "Loading ..." status sits outside the busy region (a screen reader may
 * hold back changes inside `aria-busy`), exists before its text arrives, and
 * gets its text one commit after it mounts, so it is announced. After Try again
 * focus moves to the region, which is named by `label`, instead of falling to
 * the page when the button goes.
 */
export function LoadState({ state, label, skeleton, empty, errorTitle, children }: LoadStateProps): JSX.Element {
  const { status } = state;
  const region = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  // Every commit: a retry that left the error face (it failed at once, or did nothing) clears the
  // mark, so a later refresh cannot take focus. Focus moves only if it fell with the button.
  useLayoutEffect(() => {
    if (!retried.current) return;
    retried.current = false;
    if (status === 'error') return;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) region.current?.focus({ preventScroll: true });
  });

  const retry = () => {
    retried.current = true;
    state.retry();
  };

  let face: ReactNode;
  if (status === 'error') {
    face = (
      <Alert
        severity="danger"
        title={errorTitle}
        action={state.retryable ? { label: 'Try again', onClick: retry } : undefined}
      >
        {state.error ?? undefined}
      </Alert>
    );
  } else if (status === 'loading') face = skeleton;
  else if (status === 'empty') face = empty;
  else face = children;

  return (
    <>
      <Hidden role="status">{armed && status === 'loading' ? `Loading ${lowerFirst(label)}` : ''}</Hidden>
      <Region
        ref={region}
        role="group"
        aria-label={label}
        tabIndex={-1}
        aria-busy={status === 'loading' || status === 'refreshing' || undefined}
      >
        {face}
      </Region>
    </>
  );
}
