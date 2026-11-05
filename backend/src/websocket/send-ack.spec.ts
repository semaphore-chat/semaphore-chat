import { ClientEvents } from '@semaphore-chat/shared';
import type { Socket } from 'socket.io';
import { answersFailureWithAck, sendSuccessAck } from './send-ack';

const client = (protocol?: unknown) =>
  ({ handshake: { auth: { protocol } } }) as unknown as Socket;

describe('send acks', () => {
  it.each([undefined, 1, '2', null])(
    'a client with protocol %s keeps the plain id',
    (protocol) => {
      expect(sendSuccessAck(client(protocol), 'msg-1')).toBe('msg-1');
    },
  );

  it.each([2, 3])('a client with protocol %s gets a SendAck', (protocol) => {
    expect(sendSuccessAck(client(protocol), 'msg-1')).toEqual({
      ok: true,
      messageId: 'msg-1',
    });
  });

  it('only answers failures of send events, for clients that asked', () => {
    expect(answersFailureWithAck(client(2), ClientEvents.SEND_MESSAGE)).toBe(
      true,
    );
    expect(answersFailureWithAck(client(2), ClientEvents.SEND_DM)).toBe(true);
    expect(
      answersFailureWithAck(client(2), ClientEvents.SEND_THREAD_REPLY),
    ).toBe(true);
    expect(answersFailureWithAck(client(2), ClientEvents.ADD_REACTION)).toBe(
      false,
    );
    expect(answersFailureWithAck(client(), ClientEvents.SEND_MESSAGE)).toBe(
      false,
    );
    expect(answersFailureWithAck(client(2), undefined)).toBe(false);
  });
});
