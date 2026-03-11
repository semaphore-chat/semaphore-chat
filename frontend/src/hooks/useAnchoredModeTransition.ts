import { useEffect, useRef } from "react";

interface UseAnchoredModeTransitionOptions {
  mode: 'normal' | 'anchored';
  atBottom: boolean;
  hasNewer?: boolean;
  isLoadingNewer?: boolean;
  jumpToPresent?: () => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Handles automatic transition from anchored mode back to normal mode.
 *
 * - Auto-calls jumpToPresent when user scrolls to bottom and all newer messages
 *   are loaded (hasNewer === false).
 * - Scrolls to visual bottom when the mode transition completes.
 * - Guards against false triggers on initial render via hasBeenAwayFromBottom tracking.
 */
export const useAnchoredModeTransition = ({
  mode,
  atBottom,
  hasNewer,
  isLoadingNewer,
  jumpToPresent,
  scrollContainerRef,
}: UseAnchoredModeTransitionOptions) => {
  // Only auto-transition after the user has scrolled away from the initial
  // highlight position at least once. Without this guard, atBottom starts as
  // true before the scroll-to-highlight fires, causing an immediate transition.
  const hasBeenAwayFromBottomRef = useRef(false);
  useEffect(() => {
    if (mode !== 'anchored') {
      hasBeenAwayFromBottomRef.current = false;
    } else if (!atBottom) {
      hasBeenAwayFromBottomRef.current = true;
    }
  }, [mode, atBottom]);

  useEffect(() => {
    if (
      mode === 'anchored' &&
      atBottom &&
      hasNewer === false &&
      !isLoadingNewer &&
      jumpToPresent &&
      hasBeenAwayFromBottomRef.current
    ) {
      jumpToPresent();
    }
  }, [mode, atBottom, hasNewer, isLoadingNewer, jumpToPresent]);

  // Scroll to bottom when transitioning anchored → normal.
  // Column-reverse preserves scrollTop from anchored mode; reset to 0 (visual bottom).
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === 'anchored' && mode === 'normal') {
      scrollContainerRef.current?.scrollTo({ top: 0 });
    }
    prevModeRef.current = mode;
  }, [mode, scrollContainerRef]);
};
