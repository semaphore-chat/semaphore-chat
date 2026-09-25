/**
 * Chat content edge cases — threads: 0 / 1 / 200 replies, watched vs not,
 * and the thread panel open with long replies.
 */
import React from 'react';
import { Box } from '@mui/material';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import { defineComponent } from '../../fixtures/componentStory';
import {
  edgeChatScenario,
  edgeCommunityId,
  chatHandlers,
  channelPath,
  threadsChannel,
  THREAD_IDS,
  composed,
  useDriver,
  clickButtonByText,
  type DriverStep,
} from '../../fixtures/edge/chat';
import { ThreadPanel } from '../../../components/Thread/ThreadPanel';
import type { Message } from '../../../types/message.type';

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

function threadStory(openBadge?: RegExp): LadleStoryComponent {
  return defineScreen(edgeChatScenario, channelPath(threadsChannel), {
    extraHandlers: chatHandlers(),
    overlay: openBadge ? <Drive steps={[() => clickButtonByText(openBadge)]} /> : undefined,
  });
}

/** Thread badges in the channel: no replies, "1 reply", "200 replies", "8 replies". */
export const ReplyCountBadges = threadStory();

/** Thread panel open on a single reply (not watched). */
export const OneReplyOpen = threadStory(/^1 reply/);

/** Thread panel open on 200 replies (watched; first page of 50 loaded oldest-first, like the API). */
export const TwoHundredRepliesWatched = threadStory(/^200 replies/);

/** Thread panel open on 8 long replies (walls of text, mentions, wide code) — not watched. */
export const LongRepliesUnwatched = threadStory(/^8 replies/);

/** The "8 long replies" thread's parent, rewritten as a wall of text. */
const longThreadParent: Message = {
  ...edgeChatScenario.messagesByChannel[threadsChannel.id].find((m) => m.id === THREAD_IDS.long)!,
  spans: composed(
    'design review: queue consumer v2. Before anyone replies, the context: the old consumer acknowledged messages ' +
      'before the downstream write committed, so a transient database error silently dropped the message. v2 moves ' +
      'the ack after the commit, bounds the in-flight window, and sends anything that fails five times to the ' +
      'dead-letter queue with the original headers intact. What I need from this thread: (1) does ack-after-commit ' +
      'hold up under a slow database, (2) is 120 s the right visibility timeout, (3) who owns the replay runbook, and ' +
      '(4) anything I missed about ordering guarantees for the billing topic. Please keep it in the thread so the ' +
      'channel stays readable.',
  ),
};

/**
 * Phone: a long original message scrolls with the replies instead of staying
 * pinned above them, and the thread opens at the top, with the first reply's
 * name row fully visible below the original message.
 */
export const PhoneLongOriginalMessage = defineComponent(
  edgeChatScenario,
  () => (
    <Box sx={{ height: '100dvh' }}>
      <ThreadPanel
        parentMessage={longThreadParent}
        channelId={threadsChannel.id}
        communityId={edgeCommunityId}
        fullScreen
      />
    </Box>
  ),
  { maxWidth: false, extraHandlers: chatHandlers() },
);
PhoneLongOriginalMessage.meta = { viewports: ['phone'] };
