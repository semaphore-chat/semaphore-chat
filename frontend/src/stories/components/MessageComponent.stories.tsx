import MessageComponent from '../../components/Message/MessageComponent';
import { defineComponent } from '../fixtures/componentStory';
import { createMessage, createSpan, createReaction } from '../../__tests__/test-utils/factories';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { SpanType } from '../../types/message.type';
import { bigCommunityScenario, primaryCommunity, generalChannel, secondChannel } from '../fixtures/scenarios';
import { HIDDEN_CHANNEL_ID, channelMentionSpan } from '../fixtures/channelMentions';
import { WithChannelList } from '../fixtures/WithChannelList';

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

const longParagraph =
  "Long paragraphs stay readable on wide windows: message text stops at about 80 characters a line (MESSAGE_TEXT_MAX_WIDTH), measured from the text column and left-aligned under the avatar, instead of running the full width of a 1920px window. " +
  "Images, GIFs and link cards keep their own caps, and code blocks may grow to 120 characters of the code font before they scroll sideways.";

/**
 * The 80ch message cap in a full-width column (no story wrapper): a long
 * paragraph, a code block with a line past 120ch (scrolls), a grouped
 * follow-up, an image and a link card. Shot at 1280, 1440 and 1920.
 */
export const WideColumnLineLength = defineComponent(
  bigCommunityScenario,
  () => (
    <>
      <MessageComponent
        message={createMessage({
          ...common,
          spans: [
            createSpan({ text: longParagraph }),
            createSpan({
              type: SpanType.CODE_BLOCK,
              text:
                "const backoff = (attempt: number) => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) + Math.floor(Math.random() * JITTER_MS); // full jitter keeps reconnecting clients from stampeding the gateway\nretry(connect, { attempts: 5, backoff });",
            }),
          ],
        })}
        {...contextProps}
      />
      <MessageComponent
        grouped
        message={createMessage({ ...common, spans: [createSpan({ text: longParagraph })] })}
        {...contextProps}
      />
      <MessageComponent
        grouped
        message={createMessage({
          ...common,
          spans: [createSpan({ text: 'and the PR with the screenshot' })],
          attachments: [{ id: 'story-attach-wide', filename: 'screenshot.png', mimeType: 'image/png', fileType: 'IMAGE', size: 245_760 } as never],
          linkPreviews: [
            {
              url: 'https://example.com/pull/482',
              title: 'Retry socket reconnects with jittered backoff · Pull Request #482',
              description: 'Reconnects now back off exponentially with jitter, so a flaky network no longer stampedes the gateway.',
              siteName: 'GitHub',
            },
          ],
        })}
        {...contextProps}
      />
    </>
  ),
  { maxWidth: false },
);
WideColumnLineLength.meta = { viewports: ['desktop-1280', 'desktop', 'desktop-1920', 'phone'] };

/** #channel mentions: a visible channel links; a hidden one is "#private-channel". */
export const WithChannelMentions = defineComponent(bigCommunityScenario, () => (
  <WithChannelList communityId={primaryCommunity.id}>
    <MessageComponent
      message={createMessage({
        ...common,
        spans: [
          createSpan({ text: 'Notes are in ' }),
          channelMentionSpan(secondChannel.id),
          createSpan({ text: ', the rollout plan is in ' }),
          channelMentionSpan(HIDDEN_CHANNEL_ID),
          createSpan({ text: ' (ask a mod), and questions go to ' }),
          channelMentionSpan(generalChannel.id),
          createSpan({ text: '.' }),
        ],
      })}
      {...contextProps}
    />
  </WithChannelList>
));
