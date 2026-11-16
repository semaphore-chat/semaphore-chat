/**
 * The chat's message list: the shared scroll machine (`features/chat/MessageListCore`, the same one the old chat
 * uses) with kit rows. `renderRow` hands each row only scalars from the core's context (never the context
 * object), so `ChatRow`'s memo holds.
 */
import { useCallback, type JSX } from 'react';
import MessageListCore, { type MessageRowContext } from '../../../../features/chat/MessageListCore';
import type { Conversation } from '../../../../data/chat/useConversation';
import type { Message } from '../../../../types/message.type';
import { ChatRow } from './ChatRow';

export function ChatList({ conversation }: { conversation: Conversation }): JSX.Element {
  const renderRow = useCallback(
    (message: Message, ctx: MessageRowContext) => (
      <ChatRow
        message={message}
        index={ctx.index}
        grouped={ctx.grouped}
        dayShownAbove={ctx.dayShownAbove}
        showDaySeparator={ctx.showDaySeparator}
        showUnreadDivider={ctx.showUnreadDivider}
        isHighlighted={ctx.isHighlighted}
        tabStop={ctx.isRovingFocused}
        onRovingKeyDown={ctx.onRovingKeyDown}
        onRovingFocus={ctx.onRovingFocus}
      />
    ),
    [],
  );
  return (
    <MessageListCore
      ref={conversation.listRef}
      orderedMessages={conversation.orderedMessages}
      renderRow={renderRow}
      {...conversation.list}
    />
  );
}
