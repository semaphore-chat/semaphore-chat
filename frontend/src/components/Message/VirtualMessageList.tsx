import { forwardRef, useCallback } from "react";
import { LinearProgress } from "@mui/material";
import MessageListCore, {
  type MessageListCoreHandle,
  type MessageListCoreProps,
  type MessageRowContext,
} from "../../features/chat/MessageListCore";
import MessageComponent from "./MessageComponent";
import { UnreadMessageDivider } from "./UnreadMessageDivider";
import { DaySeparator } from "./DaySeparator";
import type { Message } from "../../types/message.type";
import { VoiceSessionType } from "../../contexts/VoiceContext";

export type VirtualMessageListHandle = MessageListCoreHandle;

export interface VirtualMessageListProps
  extends Omit<MessageListCoreProps, "renderRow" | "renderLoadingOlder" | "renderLoadingNewer"> {
  authorId: string;

  // Thread / reply handling
  contextId?: string;
  communityId?: string;
  directMessageGroupId?: string;
  onOpenThread?: (message: Message) => void;
  onQuoteReply?: (message: Message) => void;
}

const renderLoadingOlder = () => <PageLoadBar edge="top" testId="load-older-progress" />;
const renderLoadingNewer = () => <PageLoadBar edge="bottom" testId="load-newer-progress" />;

/**
 * The classic message list: the shared scroll core (features/chat/MessageListCore)
 * with MessageComponent rows, the classic day and unread separators, and MUI
 * page-load bars.
 */
const VirtualMessageList = forwardRef<VirtualMessageListHandle, VirtualMessageListProps>(
  (
    { authorId, contextId, communityId, directMessageGroupId, onOpenThread, onQuoteReply, ...coreProps },
    ref,
  ) => {
    const renderRow = useCallback(
      (message: Message, ctx: MessageRowContext) => (
        <>
          {ctx.showDaySeparator && <DaySeparator date={message.sentAt} />}
          {ctx.showUnreadDivider && (
            <UnreadMessageDivider unreadCount={ctx.unreadCount} />
          )}
          <MessageComponent
            message={message}
            grouped={ctx.grouped}
            dayShownAbove={ctx.dayShownAbove}
            isAuthor={message.authorId === authorId}
            isSearchHighlight={ctx.isHighlighted}
            contextId={contextId}
            communityId={communityId}
            onOpenThread={onOpenThread}
            onQuoteReply={onQuoteReply}
            contextType={
              directMessageGroupId
                ? VoiceSessionType.Dm
                : VoiceSessionType.Channel
            }
            rowIndex={ctx.index}
            isRovingFocused={ctx.isRovingFocused}
            onRovingKeyDown={ctx.onRovingKeyDown}
            onRovingFocus={ctx.onRovingFocus}
            listContainerRef={ctx.listContainerRef}
          />
        </>
      ),
      [authorId, contextId, communityId, directMessageGroupId, onOpenThread, onQuoteReply],
    );

    return (
      <MessageListCore
        ref={ref}
        {...coreProps}
        renderRow={renderRow}
        renderLoadingOlder={renderLoadingOlder}
        renderLoadingNewer={renderLoadingNewer}
      />
    );
  },
);

VirtualMessageList.displayName = "VirtualMessageList";

/** Thin indeterminate bar overlaid on one edge of the message list. */
const PageLoadBar = ({
  edge,
  testId,
}: {
  edge: "top" | "bottom";
  testId: string;
}) => (
  <LinearProgress
    aria-hidden="true"
    data-testid={testId}
    sx={{
      position: "absolute",
      left: 0,
      right: 0,
      [edge]: 0,
      height: 2,
      zIndex: 1,
      pointerEvents: "none",
    }}
  />
);

export default VirtualMessageList;
