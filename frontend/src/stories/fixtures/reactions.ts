/**
 * Adds reactions to a loaded message in the sandbox: pushes `reactionAdded`
 * events through the fake socket (see `fakeSocket.ts#receive`) into the real
 * socket hub, exactly as the server does when someone reacts.
 *
 * Waits for the message's row to render, then `settleMs` more, so the list
 * has finished its initial positioning (pinned to the bottom) before the row
 * grows. Timers only: the review freezes `Date`, but timers run.
 */
import { useEffect } from 'react';
import { ServerEvents } from '@semaphore-chat/shared';
import type { ReactionAddedPayload } from '@semaphore-chat/shared';
import { useSocket } from '../../hooks/useSocket';
import type { Reaction } from '../../types/message.type';
import type { FakeSocket } from './fakeSocket';

export function useSimulateReactions(
  context: { channelId?: string; directMessageGroupId?: string },
  messageId: string,
  reactions: Reaction[],
  { settleMs = 1000, pollMs = 100 } = {},
): void {
  const socket = useSocket() as unknown as FakeSocket | null;
  const { channelId, directMessageGroupId } = context;
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      for (const reaction of reactions) {
        const payload: ReactionAddedPayload = { messageId, reaction, channelId, directMessageGroupId };
        socket.receive(ServerEvents.REACTION_ADDED, payload);
      }
    };
    const waitForRow = () => {
      if (document.querySelector(`[data-message-id="${messageId}"]`)) {
        timer = setTimeout(send, settleMs);
      } else {
        timer = setTimeout(waitForRow, pollMs);
      }
    };
    waitForRow();
    return () => clearTimeout(timer);
    // `reactions` is fixed per story; keyed by the message instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, channelId, directMessageGroupId, messageId, settleMs, pollMs]);
}
