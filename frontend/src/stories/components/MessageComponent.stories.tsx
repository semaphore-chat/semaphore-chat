import MessageComponent from '../../components/Message/MessageComponent';
import { defineComponent } from '../fixtures/componentStory';
import { createMessage, createSpan, createReaction } from '../../__tests__/test-utils/factories';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { SpanType } from '../../types/message.type';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

const author = bigCommunityScenario.users[0];
const common = { channelId: generalChannel.id, authorId: author.id };
const contextProps = {
  contextId: generalChannel.id,
  communityId: primaryCommunity.id,
  contextType: VoiceSessionType.Channel,
};

export const Single = defineComponent(bigCommunityScenario, () => (
  <MessageComponent message={createMessage({ ...common, spans: [createSpan({ text: 'Just a normal one-line message.' })] })} {...contextProps} />
));

export const GroupedRun = defineComponent(bigCommunityScenario, () => (
  <>
    {[0, 1, 2].map((i) => (
      <MessageComponent
        key={i}
        message={createMessage({ ...common, spans: [createSpan({ text: `Consecutive message #${i + 1} from the same author.` })] })}
        {...contextProps}
      />
    ))}
  </>
));

export const WithReactions = defineComponent(bigCommunityScenario, () => (
  <MessageComponent
    message={createMessage({
      ...common,
      spans: [createSpan({ text: 'That launch went really well 🎉' })],
      reactions: [
        createReaction({ emoji: '🎉', userIds: [author.id, bigCommunityScenario.me.id] }),
        createReaction({ emoji: '🔥', userIds: [bigCommunityScenario.users[1].id] }),
        createReaction({ emoji: '👍', userIds: [bigCommunityScenario.users[2].id, bigCommunityScenario.users[3].id, author.id] }),
      ],
    })}
    {...contextProps}
  />
));

export const WithAttachment = defineComponent(bigCommunityScenario, () => (
  <MessageComponent
    message={createMessage({
      ...common,
      spans: [createSpan({ text: 'here is the screenshot I mentioned' })],
      attachments: [{ id: 'story-attach-1', filename: 'screenshot.png', mimeType: 'image/png', fileType: 'IMAGE', size: 245_760 } as never],
    })}
    {...contextProps}
  />
));

export const LongTextAndCode = defineComponent(bigCommunityScenario, () => (
  <MessageComponent
    message={createMessage({
      ...common,
      spans: [
        createSpan({
          text:
            "Here's a longer message with a lot of detail, meant to show how the bubble wraps across several lines when someone writes a proper paragraph instead of a one-liner. It should wrap naturally within the max width and stay readable.",
        }),
        createSpan({ type: SpanType.CODE_BLOCK, text: 'function retry(fn, attempts = 3) {\n  return fn().catch(err =>\n    attempts > 1 ? retry(fn, attempts - 1) : Promise.reject(err)\n  );\n}' }),
      ],
    })}
    {...contextProps}
  />
));
