/**
 * The voice notice as both shells show it: the last failed join or why the
 * last call ended, with Retry (when trying again can help) and Dismiss. The
 * classic `VoiceNotice` renders from this; the new shell's call slot must too,
 * or a join that fails from a new-shell piece says nothing (design F2).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useRef } from 'react';
import { useVoiceDispatch, VoiceActionType } from '../contexts/VoiceContext';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { describeVoiceNotice, type VoiceNoticeModel } from '../features/voice/voiceNoticeModel';
import { logger } from '../utils/logger';

export type { VoiceNoticeModel };

export interface VoiceNotice extends VoiceNoticeModel {
  /** Join the failed or ended call again (no-op without a retry target). */
  retry(): Promise<void>;
  dismiss(): void;
  /** A join is running: Retry would start a second one. */
  joining: boolean;
}

/** The current notice, or null. Whether to show it (not during a call or a join) is the bar's choice. */
export function useVoiceNotice(): VoiceNotice | null {
  const { state, actions } = useVoiceConnection();
  const { dispatch } = useVoiceDispatch();
  const notice = describeVoiceNotice(state);

  const dismiss = useCallback(() => {
    dispatch({ type: VoiceActionType.ClearVoiceNotice });
  }, [dispatch]);

  const retryTarget = notice?.retryTarget ?? null;
  // The call state when Retry is pressed (never the render's): Retry never moves someone who has since gone into
  // another call.
  const stateRef = useRef(state);
  stateRef.current = state;
  const retry = useCallback(async () => {
    if (!retryTarget) return;
    const now = stateRef.current;
    const target = retryTarget.type === 'dm' ? retryTarget.dmGroupId : retryTarget.channelId;
    const current = retryTarget.type === 'dm' ? now.currentDmGroupId : now.currentChannelId;
    if ((now.isConnected || now.isConnecting) && current !== target) return;
    try {
      if (retryTarget.type === 'dm') {
        await actions.joinDmVoice(retryTarget.dmGroupId, retryTarget.dmGroupName);
      } else {
        await actions.joinVoiceChannel(
          retryTarget.channelId,
          retryTarget.channelName,
          retryTarget.communityId,
          retryTarget.isPrivate,
          retryTarget.createdAt,
        );
      }
    } catch (error) {
      logger.warn('[Voice] Retry failed:', error);
    }
  }, [actions, retryTarget]);

  if (!notice) return null;
  return { ...notice, retry, dismiss, joining: state.isConnecting };
}
