import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../test-utils';
import { server } from '../msw/server';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

// UserAvatar requires FileCacheProvider; stub it out — webhook messages
// shouldn't render it at all, so this also lets us assert it's absent.
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));

const mockPermissions = {
  canEdit: false,
  canDelete: false,
  canPin: false,
  canReact: false,
  isOwnMessage: false,
};
vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => mockPermissions,
}));

const mockActions = {
  isEditing: false,
  editText: '',
  editAttachments: [],
  stagedForDelete: false,
  isDeleting: false,
  setEditText: vi.fn(),
  handleEditClick: vi.fn(),
  handleEditSave: vi.fn(),
  handleEditCancel: vi.fn(),
  handleRemoveAttachment: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleConfirmDelete: vi.fn(),
  handleCancelDelete: vi.fn(),
  handleConfirmThreadDelete: vi.fn(),
  handleCancelThreadDelete: vi.fn(),
  showThreadDeleteConfirm: false,
  handleReactionClick: vi.fn(),
  handleEmojiSelect: vi.fn(),
  handlePin: vi.fn(),
  handleUnpin: vi.fn(),
};
vi.mock('../../components/Message/useMessageActions', () => ({
  useMessageActions: () => mockActions,
}));

describe('MessageComponent webhook rendering', () => {
  let userFetchCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    userFetchCount = 0;
    server.use(
      http.get('http://localhost:3000/api/users/:id', () => {
        userFetchCount += 1;
        return HttpResponse.json({ id: 'user-1', username: 'alice' });
      }),
    );
  });

  it('renders the webhook name, avatar, and an APP chip instead of a user link', () => {
    const message = createMessage({
      authorId: null,
      webhook: { id: 'wh-1', name: 'CI Bot', avatarUrl: 'https://example.com/bot.png' },
      spans: [{ type: SpanType.PLAINTEXT, text: 'build passed' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.getByText('CI Bot')).toBeInTheDocument();
    expect(screen.getByText('APP')).toBeInTheDocument();
    expect(screen.getByText('build passed')).toBeInTheDocument();
    // Not rendered as the deleted-user fallback.
    expect(screen.queryByText('[Deleted User]')).not.toBeInTheDocument();
    // Name is not a clickable profile link.
    expect(screen.queryByRole('button', { name: 'CI Bot' })).not.toBeInTheDocument();
  });

  it('loads the webhook avatar (any host) without sending a Referer', () => {
    const message = createMessage({
      authorId: null,
      webhook: { id: 'wh-1', name: 'CI Bot', avatarUrl: 'https://example.com/bot.png' },
      spans: [{ type: SpanType.PLAINTEXT, text: 'build passed' }],
    });

    const { container } = renderWithProviders(<MessageComponent message={message} />);

    const avatar = container.querySelector('img[src="https://example.com/bot.png"]');
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('does not fetch the author or render UserAvatar for webhook messages', () => {
    const message = createMessage({
      authorId: null,
      webhook: { id: 'wh-1', name: 'CI Bot', avatarUrl: null },
      spans: [{ type: SpanType.PLAINTEXT, text: 'hello' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.queryByTestId('user-avatar')).not.toBeInTheDocument();
    expect(userFetchCount).toBe(0);
  });

  it('falls back to the first letter of the webhook name when no avatarUrl is set', () => {
    const message = createMessage({
      authorId: null,
      webhook: { id: 'wh-1', name: 'zeta', avatarUrl: null },
      spans: [{ type: SpanType.PLAINTEXT, text: 'hi' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('still shows [Deleted User] when both authorId and webhook are absent', () => {
    const message = createMessage({
      authorId: null,
      spans: [{ type: SpanType.PLAINTEXT, text: 'orphaned message' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.getByText('[Deleted User]')).toBeInTheDocument();
    expect(screen.queryByText('APP')).not.toBeInTheDocument();
  });
});
