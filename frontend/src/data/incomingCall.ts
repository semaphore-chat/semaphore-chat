/**
 * The ringing direct-message call, with what answering and declining it do. Headless: the old
 * shell's IncomingCallBanner and the new shell's banner both render from it.
 */
import { useIncomingCall } from '../contexts/IncomingCallContext';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { playSound, Sounds } from '../hooks/useSound';
import { logger } from '../utils/logger';
import { dmVoicePresenceControllerDeclineDmVoiceCall } from '../api-client/sdk.gen';

export interface IncomingCallPrompt {
  callerName: string;
  /** The caller's avatar file id (an authenticated file), or null. */
  callerAvatarFileId: string | null;
  groupName: string;
  /** Joins the call, then stops the ringing. A failed join is logged and the prompt stays. */
  accept(): Promise<void>;
  /** Stops the ringing now and tells the caller (best effort). */
  decline(): void;
}

/** The call ringing for this user, or null when nothing rings. */
export function useIncomingCallPrompt(): IncomingCallPrompt | null {
  const { incomingCall, dismissCall } = useIncomingCall();
  const { actions } = useVoiceConnection();
  if (!incomingCall) {
    return null;
  }
  return {
    callerName: incomingCall.callerName,
    callerAvatarFileId: incomingCall.callerAvatar,
    groupName: incomingCall.dmGroupName,
    accept: async () => {
      try {
        await actions.joinDmVoice(incomingCall.dmGroupId, incomingCall.dmGroupName);
        dismissCall();
      } catch (error) {
        logger.error('Failed to accept incoming DM voice call:', error);
      }
    },
    decline: () => {
      playSound(Sounds.callEnded);
      // Stop ringing here whatever the server answers: the request only tells
      // the caller and this account's other devices.
      dismissCall();
      dmVoicePresenceControllerDeclineDmVoiceCall({
        path: { dmGroupId: incomingCall.dmGroupId },
        throwOnError: true,
      }).catch((error: unknown) => {
        logger.warn('Failed to decline the incoming DM voice call:', error);
      });
    },
  };
}
