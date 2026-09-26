import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';
import { setPendingUpload, resetPendingUploadsForTests } from '../../utils/pendingUploadStore';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));

// Real (own-message) permissions — proves the pending/failed gating inside
// MessageComponent is what suppresses the toolbar, not the permission hook.
const mockPermissions = {
  canEdit: true,
  canDelete: true,
  canPin: true,
  canReact: true,
  isOwnMessage: true,
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

const mockRetry = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../hooks/useOptimisticSendMessage', () => ({
  useOptimisticMessageRetry: () => ({ retry: mockRetry, remove: mockRemove }),
}));

describe('MessageComponent optimistic states (PR-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a pending message with a clock indicator and no action toolbar', () => {
    const message = createMessage({
      id: 'pending-1',
      clientId: 'pending-1',
      sendStatus: 'pending',
      authorId: 'user-1',
      spans: [{ type: SpanType.PLAINTEXT, text: 'sending soon' }],
    });

    renderWithProviders(<MessageComponent message={message} isAuthor onQuoteReply={vi.fn()} onOpenThread={vi.fn()} />);

    expect(screen.getByText('sending soon')).toBeInTheDocument();
    expect(screen.getByTestId('message-pending-icon')).toBeInTheDocument();
    // Real API-backed actions must be unreachable for an unpersisted message.
    expect(screen.queryByLabelText('Edit message')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete message')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quote reply')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reply in thread')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to send')).not.toBeInTheDocument();
  });

  it('renders a failed message with always-visible, keyboard-reachable Retry/Delete actions', async () => {
    const message = createMessage({
      id: 'pending-2',
      clientId: 'pending-2',
      sendStatus: 'failed',
      authorId: 'user-1',
      spans: [{ type: SpanType.PLAINTEXT, text: 'oops' }],
    });

    const { user } = renderWithProviders(<MessageComponent message={message} isAuthor />);

    expect(screen.getByText('Failed to send')).toBeInTheDocument();
    // No pending clock on a failed row.
    expect(screen.queryByTestId('message-pending-icon')).not.toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry sending message' });
    const deleteButton = screen.getByRole('button', { name: 'Delete message' });

    // Real <button> elements rendered unconditionally (not opacity-gated
    // behind hover like MessageToolbar) — always in the tab order.
    expect(retryButton).toBeVisible();
    expect(deleteButton).toBeVisible();
    expect(retryButton.tabIndex).not.toBe(-1);
    expect(deleteButton.tabIndex).not.toBe(-1);

    await user.click(retryButton);
    expect(mockRetry).toHaveBeenCalledTimes(1);

    await user.click(deleteButton);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('does not warn about setting state on an unmounted component when unmounted mid-retry (Minor 4, fix round 1)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveRetry: (() => void) | undefined;
    mockRetry.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveRetry = resolve;
      }),
    );

    const message = createMessage({
      id: 'pending-3',
      clientId: 'pending-3',
      sendStatus: 'failed',
      authorId: 'user-1',
      spans: [{ type: SpanType.PLAINTEXT, text: 'oops' }],
    });

    const { user, unmount } = renderWithProviders(<MessageComponent message={message} isAuthor />);
    const retryButton = screen.getByRole('button', { name: 'Retry sending message' });

    await user.click(retryButton);
    expect(mockRetry).toHaveBeenCalledTimes(1);

    // Unmount while the retry promise is still pending, then resolve it —
    // the finally-block's setIsRetrying(false) must be skipped (guarded by
    // the mounted ref), not fire on an unmounted component.
    unmount();
    await act(async () => {
      resolveRetry!();
      await Promise.resolve();
    });

    const unmountedStateWarning = consoleError.mock.calls.some(call =>
      String(call[0]).includes("Can't perform a React state update on an unmounted component"),
    );
    expect(unmountedStateWarning).toBe(false);
    consoleError.mockRestore();
  });

  it('renders a settled (real) message with no pending/failed chrome', () => {
    const message = createMessage({
      authorId: 'user-1',
      spans: [{ type: SpanType.PLAINTEXT, text: 'a normal message' }],
    });

    renderWithProviders(<MessageComponent message={message} isAuthor />);

    expect(screen.getByText('a normal message')).toBeInTheDocument();
    expect(screen.queryByTestId('message-pending-icon')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to send')).not.toBeInTheDocument();
  });

  describe('with files uploading', () => {
    afterEach(() => {
      act(() => resetPendingUploadsForTests());
    });

    function seedFiles(clientId: string, messageId: string | null) {
      setPendingUpload({
        clientId,
        messageId,
        hasText: true,
        files: [
          {
            localId: 'f0', file: new File(['x'], 'IMG_1.png'), name: 'IMG_1.png', size: 4096, mimeType: 'image/png',
            previewUrl: null, status: messageId ? 'uploading' : 'waiting', progress: messageId ? 0.5 : 0, fileId: null, error: null,
          },
        ],
      });
    }

    it('a pending channel message shows its files waiting under its text', () => {
      seedFiles('pending-4', null);
      const message = createMessage({
        id: 'pending-4', clientId: 'pending-4', sendStatus: 'pending', authorId: 'user-1', channelId: 'ch-1',
        spans: [{ type: SpanType.PLAINTEXT, text: 'photos' }], pendingAttachments: 1,
      });
      renderWithProviders(<MessageComponent message={message} isAuthor />);
      expect(screen.getByTestId('message-pending-icon')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Uploading IMG_1.png' })).toHaveAttribute('aria-valuenow', '0');
      expect(screen.getByText('Waiting to upload…')).toBeInTheDocument();
    });

    it('an acked DM message keeps showing upload progress, keyed by its clientId', () => {
      seedFiles('pending-5', 'msg-5');
      const message = createMessage({
        id: 'msg-5', clientId: 'pending-5', authorId: 'user-1', channelId: null, directMessageGroupId: 'dm-1',
        spans: [{ type: SpanType.PLAINTEXT, text: 'photos' }], pendingAttachments: 1,
      });
      renderWithProviders(<MessageComponent message={message} isAuthor />);
      expect(screen.getByRole('progressbar', { name: 'Uploading IMG_1.png' })).toHaveAttribute('aria-valuenow', '50');
      expect(screen.getByRole('button', { name: 'Cancel uploading IMG_1.png' })).toBeInTheDocument();
    });
  });
});
