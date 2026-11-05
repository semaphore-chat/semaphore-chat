import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@semaphore-chat/shared';
import { renderWithProviders, createMockSocket } from '../test-utils';
import { ThreadMessageInput } from '../../components/Thread/ThreadMessageInput';

vi.mock('../../hooks/useComposerAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComposerAvailability: () => ({ state: 'ok' }),
}));

const mockShowNotification = vi.fn();
vi.mock('../../contexts/NotificationContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

describe('ThreadMessageInput sending', () => {
  let socket: ReturnType<typeof createMockSocket>;
  const acks: unknown[] = [];

  const payloads = () =>
    socket.emit.mock.calls.map((call) => call[1] as { clientNonce: string });

  const setup = () => {
    socket.connected = true;
    return renderWithProviders(<ThreadMessageInput parentMessageId="msg-1" />, {
      socket: socket as never,
    });
  };

  const send = async (user: ReturnType<typeof setup>['user'], text?: string) => {
    if (text) await user.type(screen.getByRole('textbox'), text);
    await user.click(screen.getByRole('button', { name: /send/i }));
  };

  beforeEach(() => {
    mockShowNotification.mockReset();
    acks.length = 0;
    socket = createMockSocket();
    socket.emit.mockImplementation((_event, _payload, ack) => {
      (ack as (answer: unknown) => void)(acks.shift());
    });
  });

  it('clears the box when the reply is sent', async () => {
    acks.push({ ok: true, messageId: 'reply-1' });
    const { user } = setup();

    await send(user, 'hello');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('accepts the plain id an older server acks', async () => {
    acks.push('reply-1');
    const { user } = setup();

    await send(user, 'hello');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('says why a reply failed, keeps the text, and can send again', async () => {
    acks.push({
      ok: false,
      error: {
        errorCode: ErrorCode.SLOWMODE,
        message: 'Slowmode is on',
        retryable: true,
      },
    });
    const { user } = setup();

    await send(user, 'hello');

    await waitFor(() =>
      expect(mockShowNotification).toHaveBeenCalledWith('Slowmode is on', 'error'),
    );
    expect(screen.getByRole('textbox')).toHaveValue('hello');
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('sending the same text again reuses its nonce; new text gets a new one', async () => {
    const refused = {
      ok: false,
      error: { errorCode: ErrorCode.INTERNAL, message: 'x', retryable: true },
    };
    acks.push(refused, refused, refused);
    const { user } = setup();

    await send(user, 'hello');
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    await send(user);
    await waitFor(() => expect(payloads()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    await send(user, ' there');
    await waitFor(() => expect(payloads()).toHaveLength(3));

    const [first, second, third] = payloads();
    expect(first.clientNonce).toEqual(expect.any(String));
    expect(second.clientNonce).toBe(first.clientNonce);
    expect(third.clientNonce).not.toBe(first.clientNonce);
  });

  it('a reply deleted meanwhile clears the box and says so', async () => {
    acks.push({
      ok: false,
      error: {
        errorCode: ErrorCode.MESSAGE_DELETED,
        message: 'Gone',
        retryable: false,
      },
    });
    const { user } = setup();

    await send(user, 'hello');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(mockShowNotification).toHaveBeenCalledWith(
      'That reply was deleted',
      'error',
    );
  });
});
