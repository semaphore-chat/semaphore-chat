/**
 * Chat content edge cases — threads: 0 / 1 / 200 replies, watched vs not,
 * and the thread panel open with long replies.
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  threadsChannel,
  useDriver,
  clickButtonByText,
  type DriverStep,
} from '../../fixtures/edge/chat';

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
