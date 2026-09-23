import MessageInput from '../../components/Message/MessageInput';
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
