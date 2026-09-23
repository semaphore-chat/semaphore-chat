import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { createTestQueryClient } from '../test-utils/queryClient';
import { userControllerGetUserByIdQueryKey } from '../../api-client/@tanstack/react-query.gen';
import { THEME_MATRIX, themeLabel, withMatrixTheme } from '../test-utils/themeMatrix';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('../../hooks/useMessagePermissions', () => ({
  useMessagePermissions: () => ({
    canEdit: false,
    canDelete: false,
    canPin: false,
    canReact: false,
    isOwnMessage: false,
  }),
}));

vi.mock('../../components/Message/useMessageActions', () => ({
  useMessageActions: () => ({
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
  }),
}));

const LONG_NAME = 'Maximilianalexanderfeatherstonex'; // 32 chars, no spaces
const ARABIC_NAME = 'عبد الرحمن بن محمد الهاشمي القرشي';

let displayName = 'Liam Nilsson';

function msg(overrides = {}) {
  return createMessage({
    authorId: 'author-1',
    sentAt: new Date().toISOString(),
    spans: [{ type: SpanType.PLAINTEXT, text: 'hello there' }],
    ...overrides,
  });
}

describe('MessageComponent grouping and author line', () => {
  beforeEach(() => {
    displayName = 'Liam Nilsson';
  });

  /** Author profile pre-seeded in the cache (no network). */
  function withAuthor() {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'author-1' } }), {
      id: 'author-1',
      username: 'liam',
      displayName,
    } as never);
    return { queryClient };
  }

  it('shows the avatar, author and a short time on an ungrouped message', async () => {
    renderWithProviders(<MessageComponent message={msg()} />, withAuthor());

    expect(await screen.findByRole('button', { name: 'Liam Nilsson' })).toBeInTheDocument();
    expect(screen.getByTestId('user-avatar')).toBeInTheDocument();
    const time = screen.getByTestId('message-time');
    // Today → time only, e.g. "4:12 PM" — never the full locale date string.
    expect(time.textContent).not.toMatch(/\d{4}/);
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('hides the avatar and author on a grouped message but keeps a hover time', () => {
    renderWithProviders(<MessageComponent message={msg()} grouped />);

    expect(screen.queryByTestId('user-avatar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liam Nilsson' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('message-time')).not.toBeInTheDocument();
    const hoverTime = screen.getByTestId('message-hover-time');
    expect(hoverTime.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('still shows "(edited)" and the pin on a grouped message', () => {
    renderWithProviders(
      <MessageComponent message={msg({ editedAt: new Date().toISOString(), pinned: true })} grouped />,
    );
    expect(screen.getByText('(edited)')).toBeInTheDocument();
    expect(screen.getByTestId('PushPinIcon')).toBeInTheDocument();
  });

  it('marks grouped rows so styling can tighten spacing', () => {
    const { container } = renderWithProviders(<MessageComponent message={msg()} grouped />);
    expect(container.querySelector('[data-grouped="true"]')).not.toBeNull();
  });

  it.each([
    ['a 32-character name with no spaces', LONG_NAME],
    ['an Arabic name', ARABIC_NAME],
  ])('keeps %s on one line with an ellipsis', async (_label, name) => {
    displayName = name;
    renderWithProviders(<MessageComponent message={msg()} />, withAuthor());

    const author = await screen.findByRole('button', { name });
    expect(author).toHaveClass('MuiTypography-noWrap');
    // The time never shrinks, so the name is what truncates.
    expect(screen.getByTestId('message-time')).toHaveClass('MuiTypography-noWrap');
    expect(screen.getByTestId('message-author-line')).toBeInTheDocument();
  });

  it('keeps a long webhook name on one line too', () => {
    renderWithProviders(
      <MessageComponent
        message={msg({ authorId: null, webhook: { id: 'w', name: LONG_NAME, avatarUrl: null } })}
      />,
    );
    expect(screen.getByText(LONG_NAME)).toHaveClass('MuiTypography-noWrap');
  });

  it('renders grouped and ungrouped rows in every theme', () => {
    for (const entry of THEME_MATRIX) {
      for (const grouped of [false, true]) {
        try {
          renderWithProviders(withMatrixTheme(<MessageComponent message={msg()} grouped={grouped} />, entry));
          expect(screen.getByText('hello there')).toBeInTheDocument();
        } catch (error) {
          throw new Error(`[${themeLabel(entry)} grouped=${grouped}] ${(error as Error).message}`);
        } finally {
          cleanup();
        }
      }
    }
  });
});
