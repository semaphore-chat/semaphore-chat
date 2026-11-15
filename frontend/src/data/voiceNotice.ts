/**
 * The voice notice as both shells show it: the last failed join or why the
 * last call ended, with Retry (when trying again can help) and Dismiss. The
 * classic `VoiceNotice` renders from this; the new shell's call slot must too,
 * or a join that fails from a new-shell piece says nothing (design F2).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback } from 'react';
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
  const retry = useCallback(async () => {
    if (!retryTarget) return;
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
