import { VoiceBottomBar } from '../../components/Voice';
import {
  VoiceEndReason,
  VoiceFailureKind,
  type VoiceJoinTarget,
  type VoiceState,
} from '../../contexts/VoiceContext';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario, primaryCommunity, primaryVoiceChannel } from '../fixtures/scenarios';

/**
 * The voice notice: what went wrong with a join (with Retry when it can help),
 * or why a call ended. Shown by the voice bar shell, where the bar would be,
 * when you're not in a call.
 */

const target: VoiceJoinTarget = {
  type: 'channel',
  channelId: primaryVoiceChannel.id,
  channelName: primaryVoiceChannel.name,
  communityId: primaryCommunity.id,
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const AT = Date.UTC(2026, 0, 1);

function joinFailed(kind: VoiceFailureKind) {
  const voiceState: Partial<VoiceState> = { joinFailure: { kind, error: null, target, at: AT } };
  const story = defineComponent(bigCommunityScenario, () => <VoiceBottomBar />, { maxWidth: false, voiceState });
  story.meta = { viewports: ['phone', 'desktop'] };
  return story;
}

function callEnded(reason: VoiceEndReason) {
  const voiceState: Partial<VoiceState> = { lastEnded: { reason, error: null, at: AT, target } };
  const story = defineComponent(bigCommunityScenario, () => <VoiceBottomBar />, { maxWidth: false, voiceState });
  story.meta = { viewports: ['phone', 'desktop'] };
  return story;
}

/** UDP/media blocked: the actionable "try another network / ask about TURN" message, with Retry. */
export const MediaUnreachable = joinFailed(VoiceFailureKind.MediaUnreachable);
/** The voice server can't be reached at all. */
export const ServerUnreachable = joinFailed(VoiceFailureKind.ServerUnreachable);
/** No permission to connect: no Retry. */
export const NoPermission = joinFailed(VoiceFailureKind.Permission);
/** The session is gone: sign in again. */
export const SessionEnded = joinFailed(VoiceFailureKind.Session);
/** A server error: Retry. */
export const ServerError = joinFailed(VoiceFailureKind.ServerError);

/** Newest join wins: this device was replaced. */
export const JoinedFromAnotherDevice = callEnded(VoiceEndReason.DuplicateIdentity);
export const RemovedFromChannel = callEnded(VoiceEndReason.ParticipantRemoved);
export const AccessLost = callEnded(VoiceEndReason.AccessLost);
export const ChannelGone = callEnded(VoiceEndReason.ChannelNotFound);
export const SessionExpired = callEnded(VoiceEndReason.SessionExpired);
/** Every automatic rejoin failed: Retry. */
export const ReconnectFailed = callEnded(VoiceEndReason.ReconnectFailed);
