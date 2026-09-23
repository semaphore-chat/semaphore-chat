import MessageInput, { ComposerUnavailableNotice } from '../../components/Message/MessageInput';
import ReplyComposerBanner from '../../components/Message/ReplyComposerBanner';
import { defineComponent } from '../fixtures/componentStory';
import { AttachFileOnMount, TypeIntoTextareaOnMount } from '../fixtures/interactions';
import { createMessage, createSpan } from '../../__tests__/test-utils/factories';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

const commonProps = {
  contextType: VoiceSessionType.Channel,
  contextId: generalChannel.id,
  communityId: primaryCommunity.id,
  userMentions: bigCommunityScenario.users.slice(0, 5).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName ?? undefined })),
};

export const Empty = defineComponent(bigCommunityScenario, () => <MessageInput {...commonProps} onSendMessage={() => {}} />);

export const MultiLine = defineComponent(bigCommunityScenario, () => (
  <>
    <TypeIntoTextareaOnMount text={'Line one of the message.\nLine two, still typing.\nAnd a third line to show the composer growing.'} />
    <MessageInput {...commonProps} onSendMessage={() => {}} />
  </>
));

export const WithReplyBanner = defineComponent(bigCommunityScenario, () => {
  const replyToMessage = createMessage({
    channelId: generalChannel.id,
    authorId: bigCommunityScenario.users[1].id,
    spans: [createSpan({ text: 'the original message being replied to' })],
  });
  return (
    <>
      <ReplyComposerBanner replyToMessage={replyToMessage} onCancel={() => {}} />
      <MessageInput {...commonProps} onSendMessage={() => {}} />
    </>
  );
});

export const WithFilePreviews = defineComponent(bigCommunityScenario, () => (
  <>
    <AttachFileOnMount filename="photo.png" type="image/png" />
    <MessageInput {...commonProps} onSendMessage={() => {}} />
  </>
));

// ── Composer unavailable (useComposerAvailability) ───────────────────────
// The edge-voice-permissions stories show these in the real screen; these
// isolate the notice, including `banned`, which no screen can reach today.

export const NoPermission = defineComponent(bigCommunityScenario, () => (
  <ComposerUnavailableNotice availability={{ state: 'no-permission', channelName: generalChannel.name }} />
));

export const TimedOut = defineComponent(bigCommunityScenario, () => (
  <ComposerUnavailableNotice availability={{ state: 'timed-out', remainingMs: 12 * 60_000 }} />
));

export const TimedOutWithReason = defineComponent(bigCommunityScenario, () => (
  <ComposerUnavailableNotice
    availability={{ state: 'timed-out', remainingMs: (2 * 60 + 5) * 60_000, reason: 'Posting the same link in every channel' }}
  />
));

export const Banned = defineComponent(bigCommunityScenario, () => (
  <ComposerUnavailableNotice availability={{ state: 'banned' }} />
));
