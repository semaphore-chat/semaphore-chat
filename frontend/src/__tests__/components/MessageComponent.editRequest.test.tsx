/** ↑ in an empty composer raises an edit request; the matching row opens its edit form. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';
import { EditRequestContext } from '../../contexts/EditRequestContext';

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

describe('MessageComponent edit requests (↑ to edit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.canEdit = true;
  });

  const message = createMessage({
    id: 'm-1',
    authorId: 'user-1',
    spans: [{ type: SpanType.PLAINTEXT, text: 'hello' }],
  });

  function renderWithRequest(messageId: string) {
    const clear = vi.fn();
    renderWithProviders(
      <EditRequestContext.Provider value={{ request: { messageId, seq: 7 }, clear }}>
        <MessageComponent message={message} isAuthor onQuoteReply={vi.fn()} onOpenThread={vi.fn()} />
      </EditRequestContext.Provider>,
    );
    return clear;
  }

  it('opens the edit form for the requested message and clears the request', () => {
    const clear = renderWithRequest('m-1');
    expect(mockActions.handleEditClick).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(7);
  });

  it('ignores requests for other messages', () => {
    const clear = renderWithRequest('m-2');
    expect(mockActions.handleEditClick).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears but does not edit when you may not edit the message', () => {
    mockPermissions.canEdit = false;
    const clear = renderWithRequest('m-1');
    expect(mockActions.handleEditClick).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith(7);
  });
});
