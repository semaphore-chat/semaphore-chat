/**
 * Chat content edge cases — long history (400 messages, real cursor
 * pagination) with the last-read point ~340 messages back.
 *
 * There is no "jump to unread" control in the app; the ways to land far
 * back are `?highlight=` deep links (notifications, pins, search, quote
 * previews), which switch the list into anchored mode with a "Jump to
 * Present" FAB.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { defineScreen } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  historyChannel,
  historyLastReadId,
  historyUnreadCount,
  findMessageRow,
  useDriver,
} from '../../fixtures/edge/chat';

const unread = [{ channelId: historyChannel.id, unreadCount: historyUnreadCount, lastReadMessageId: historyLastReadId }];
const FIRST_UNREAD_ID = 'edge-chat-history-61';

/** Opening a channel with 340 unread: the latest page (25) loads at the bottom; the last-read point is ~14 pages back, so no divider. */
export const OpenWithHundredsUnread = defineScreen(edgeChatScenario, channelPath(historyChannel), {
  extraHandlers: chatHandlers(edgeChatScenario, { unread }),
});

/** Once the channel has loaded, follow a `?highlight=` link to the first unread message (like clicking its notification). */
const JumpAfterLoad: React.FC = () => {
  const navigate = useNavigate();
  useDriver([
    () => !!findMessageRow('history message #400'),
    () => {
      void navigate(`${channelPath(historyChannel)}?highlight=${FIRST_UNREAD_ID}`);
    },
  ]);
  return null;
};

/** Jump ~340 messages back from a loaded channel: anchored window, "340 NEW MESSAGES" divider, "Jump to Present" FAB. */
export const JumpFarBack = defineScreen(edgeChatScenario, channelPath(historyChannel), {
  extraHandlers: chatHandlers(edgeChatScenario, { unread }),
  overlay: <JumpAfterLoad />,
});

/**
 * The same `?highlight=` link opened cold (channel not yet loaded): the jump
 * waits for the first page, anchors on the target and highlights it, and
 * only then clears the URL param.
 */
export const ColdDeepLink = defineScreen(edgeChatScenario, `${channelPath(historyChannel)}?highlight=${FIRST_UNREAD_ID}`, {
  extraHandlers: chatHandlers(edgeChatScenario, { unread }),
});
