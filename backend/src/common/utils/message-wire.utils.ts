import { MessageDto } from '@/messages/dto/message-response.dto';
import { Message } from '@semaphore-chat/shared';
import { blankRemovedMessage } from './removed-message.utils';

/**
 * A message as it goes out on the socket. A broadcast has one payload for its
 * whole room, so a removed message always goes out blank here, whoever is in
 * the room.
 */
export function toWireMessage(message: MessageDto): Message {
  return blankRemovedMessage(message);
}
