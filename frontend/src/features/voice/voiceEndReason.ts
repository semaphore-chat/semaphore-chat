import { VoiceEndReason } from '../../contexts/VoiceContext';

/** User-facing text for why a call ended without the user hanging up. */
export const VOICE_END_MESSAGES: Record<VoiceEndReason, string> = {
  [VoiceEndReason.DuplicateIdentity]: 'You joined from another device',
  [VoiceEndReason.ParticipantRemoved]: 'You were removed from the voice channel',
  [VoiceEndReason.RoomDeleted]: 'The voice channel was closed',
  [VoiceEndReason.ReconnectFailed]: 'Lost connection to voice and could not reconnect',
};

export function describeVoiceEnd(reason: VoiceEndReason): string {
  return VOICE_END_MESSAGES[reason];
}
