import MessageActionsSheet from '../../components/Message/MessageActionsSheet';
import { defineComponent } from '../fixtures/componentStory';
import { createMessage, createSpan } from '../../__tests__/test-utils/factories';
import { bigCommunityScenario, generalChannel } from '../fixtures/scenarios';

const message = createMessage({
  channelId: generalChannel.id,
  authorId: bigCommunityScenario.me.id,
  spans: [createSpan({ text: 'Long-press (or right-click) brings up this sheet.' })],
});

export const Open = defineComponent(
  bigCommunityScenario,
  () => (
    <MessageActionsSheet
      open
      anchorPosition={null}
      onClose={() => {}}
      message={message}
      canEdit
      canDelete
      canPin
      canReact
      canThread
      isPinned={false}
      onEdit={() => {}}
      onDelete={() => {}}
      onPin={() => {}}
      onUnpin={() => {}}
      onReplyInThread={() => {}}
      onQuoteReply={() => {}}
      onAddReaction={() => {}}
      onEmojiSelect={() => {}}
    />
  ),
  { maxWidth: false },
);
