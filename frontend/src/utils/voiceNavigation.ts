import { VoiceSessionType, type VoiceState } from '../contexts/VoiceContext';

export type VoiceNavigationState = Pick<
  VoiceState,
  'isConnected' | 'contextType' | 'communityId' | 'currentChannelId' | 'currentDmGroupId'
>;

/**
 * Resolves the route to navigate to when floating back to the active voice
 * session's stage. Returns null when there's no connected session to navigate
 * to (or the ids needed to build the route are missing).
 *
 * DM sessions deliberately target the `?group=` deep link rather than
 * `/direct-messages/:dmGroupId` — DirectMessagesPage's path-param effect only
 * fires when the param changes, while the `?group=` effect selects
 * unconditionally, so it's the only form that reliably re-selects the group.
 */
export function getFloatNavigationTarget(s: VoiceNavigationState): string | null {
  if (!s.isConnected) return null;

  if (s.contextType === VoiceSessionType.Channel) {
    if (!s.communityId || !s.currentChannelId) return null;
    return `/community/${s.communityId}/channel/${s.currentChannelId}`;
  }

  if (s.contextType === VoiceSessionType.Dm) {
    if (!s.currentDmGroupId) return null;
    return `/direct-messages?group=${s.currentDmGroupId}`;
  }

  return null;
}
