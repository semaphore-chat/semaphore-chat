import { useEffect } from 'react';
import { useVoiceDispatch, VoiceActionType } from '../contexts/VoiceContext';

/**
 * Tracks whether the embedded voice stage is currently mounted, so other UI
 * (e.g. the float card) knows when it can rely on the stage being on-screen
 * instead of rendering its own copy of the active session's video.
 *
 * Uses the dispatch-only voice context so this hook never re-renders on
 * VoiceState changes. Only one stage can exist at a time (a session is
 * Channel xor Dm), so a plain boolean set/clear is correct — StrictMode's
 * mount -> cleanup -> mount sequence still ends with `stageMounted: true`.
 */
export function useStagePresence(active: boolean): void {
  const { dispatch } = useVoiceDispatch();

  useEffect(() => {
    if (!active) return;

    dispatch({ type: VoiceActionType.SetStageMounted, payload: true });

    return () => {
      dispatch({ type: VoiceActionType.SetStageMounted, payload: false });
    };
  }, [active, dispatch]);
}
