import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { EMPTY_MESSAGE_FIELDS, SpanType, type Message } from '../../types/message.type';

/**
 * An optimistic row starts from EMPTY_MESSAGE_FIELDS, where it used to leave those
 * fields out. A row that hasn't reached the server must look the same either way.
 */
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));
vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => ({
    canEdit: true,
    canDelete: true,
    canPin: true,
    canReact: true,
    isOwnMessage: true,
  }),
}));

const SENT = '2026-01-02T03:04:05.000Z';

/** What the optimistic senders built before: only what the payload carries. */
const partial = (extra: Record<string, unknown>) =>
  ({
    id: 'pending-1',
    clientId: 'pending-1',
    channelId: 'channel-1',
    authorId: 'user-1',
    spans: [{ type: SpanType.PLAINTEXT, text: 'hello' }],
    attachments: [],
    reactions: [],
    sentAt: SENT,
    sendStatus: 'pending',
    ...extra,
  }) as unknown as Message;

/** What they build now. */
const filled = (extra: Record<string, unknown>) =>
  ({ ...EMPTY_MESSAGE_FIELDS, ...partial(extra) }) as Message;

// useId values differ between renders; nothing else should.
const html = (message: Message) => {
  const { container, unmount } = renderWithProviders(<MessageComponent message={message} />);
  const out = container.innerHTML.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_/g, ':id:');
  unmount();
  return out;
};

describe('an optimistic row renders the same with the empty fields filled in', () => {
  it('the comparison notices a field that does change what renders', () => {
    expect(html(filled({ editedAt: SENT }))).not.toBe(html(partial({})));
  });

  it.each([
    ['a pending send', {}],
    ['a failed send', { sendStatus: 'failed' }],
    ['a pending reply', { replyToId: 'quoted-1' }],
    ['a send with files on the way', { pendingAttachments: 2 }],
    ['a pending DM', { channelId: undefined, directMessageGroupId: 'dm-1' }],
    ['a promoted row, before its echo', { id: 'real-1', sendStatus: undefined }],
  ])('%s', (_label, extra) => {
    const before = html(partial(extra));
    expect(before).toContain('hello');
    expect(html(filled(extra))).toBe(before);
  });
});
