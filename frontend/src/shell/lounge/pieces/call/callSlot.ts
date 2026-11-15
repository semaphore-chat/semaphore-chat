/**
 * What the call slot holds, from the voice state alone (cheap: no LiveKit, no speaking): the call (joining
 * or in it: the same condition `useCallBarModel` returns a model for), else the voice notice (out of a call
 * and not joining, as the classic bar shows it), else nothing.
 */
import type { VoiceState } from '../../../../contexts/VoiceContext';
import { describeVoiceNotice } from '../../../../features/voice/voiceNoticeModel';

export type CallSlotContent = 'call' | 'notice' | null;

export function callSlotContent(
  state: Pick<
    VoiceState,
    'isConnected' | 'isConnecting' | 'currentChannelId' | 'currentDmGroupId' | 'joinFailure' | 'lastEnded'
  >,
): CallSlotContent {
  const inPlace = !!state.currentChannelId || !!state.currentDmGroupId;
  if ((state.isConnected || state.isConnecting) && inPlace) return 'call';
  if (!state.isConnecting && describeVoiceNotice(state) !== null) return 'notice';
  return null;
}
