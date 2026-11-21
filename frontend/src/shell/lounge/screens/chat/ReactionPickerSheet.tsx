/**
 * "More reactions" (PR 10d-C): the emoji picker in reaction mode, from a message's actions. A pick toggles the
 * reader's reaction with that emoji (a custom emoji as its `custom:<id>` sentinel, as the old chat), as a quick
 * reaction does; the picker closes and focus returns to the message's row. One host per conversation.
 */
import { useCallback, type JSX } from 'react';
import { pickReaction, type EmojiPick } from '../../../../data/chat/useEmojiPicker';
import { useMessageActions } from '../../../../data/chat/useMessageActions';
import type { Message } from '../../../../types/message.type';
import { EmojiPickerSheet } from './EmojiPickerSheet';

export interface ReactionPickerRequest {
  message: Message;
  /** The row the actions were opened from: focus returns there. */
  returnTo: HTMLElement | null;
}

export interface ReactionPickerSheetProps {
  request: ReactionPickerRequest | null;
  me: string;
  communityId: string;
  touch: boolean;
  onDone: () => void;
}

export function ReactionPickerSheet({ request, ...rest }: ReactionPickerSheetProps): JSX.Element | null {
  if (request === null) return null;
  return <PickerFor key={request.message.id} request={request} {...rest} />;
}

function PickerFor({ request, me, communityId, touch, onDone }: ReactionPickerSheetProps & { request: ReactionPickerRequest }): JSX.Element {
  const actions = useMessageActions(request.message, me);
  const { handleReactionClick } = actions;
  const onPick = useCallback((pick: EmojiPick) => void handleReactionClick(pickReaction(pick)), [handleReactionClick]);
  return (
    <EmojiPickerSheet
      title="Add reaction"
      communityId={communityId}
      touch={touch}
      opener={request.returnTo}
      onPick={onPick}
      onDone={onDone}
    />
  );
}
