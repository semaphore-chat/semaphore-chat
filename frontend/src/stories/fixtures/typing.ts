/**
 * Drives the "X is typing..." indicator in the sandbox: pushes `userTyping`
 * events through the fake socket (see `fakeSocket.ts#receive`) into the real
 * socket hub, exactly as the server would.
 *
 * Re-sent every 2 s: `useTypingUsers` clears a typist after 8 s without a
 * fresh event, and timers keep running while the review's clock is frozen.
 * The first send also retries until the hub has subscribed (routes mount
 * lazily, after the story overlay).
 */
import { useEffect } from 'react';
import { ServerEvents } from '@semaphore-chat/shared';
import type { UserTypingPayload } from '@semaphore-chat/shared';
import { useSocket } from '../../hooks/useSocket';
import type { FakeSocket } from './fakeSocket';

export function useSimulateTyping(
  context: { channelId?: string; directMessageGroupId?: string },
  userIds: string[],
): void {
  const socket = useSocket() as unknown as FakeSocket | null;
  const { channelId, directMessageGroupId } = context;
  const key = userIds.join(',');
  useEffect(() => {
    if (!socket) return;
    const send = () => {
      for (const userId of key.split(',').filter(Boolean)) {
        const payload: UserTypingPayload = { userId, channelId, directMessageGroupId, isTyping: true };
        socket.receive(ServerEvents.USER_TYPING, payload);
      }
    };
    // Frequent at first (the hub subscribes once the lazy routes mount),
    // then a keep-alive well inside the 8 s typing timeout.
    const early = [100, 300, 600, 1000, 1500].map((ms) => setTimeout(send, ms));
    const keepAlive = setInterval(send, 2000);
    return () => {
      early.forEach(clearTimeout);
      clearInterval(keepAlive);
    };
  }, [socket, channelId, directMessageGroupId, key]);
}
