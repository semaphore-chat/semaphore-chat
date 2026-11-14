import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageComponent from '../../components/Message/MessageComponent';
import { createMessage } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice' } }),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));

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

const gifUrl = 'https://media.giphy.com/media/abc123/giphy.gif';

describe('MessageComponent GIF embed rendering', () => {
  it('renders an inline img for a lone GIF URL and suppresses link text + preview card', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: gifUrl }],
      linkPreviews: [
        { url: gifUrl, imageUrl: gifUrl, title: 'A cat GIF', siteName: 'media.giphy.com' },
      ],
    });

    renderWithProviders(<MessageComponent message={message} />);

    const img = screen.getByRole('img', { name: 'GIF' }) as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe(gifUrl);
    // Third-party host: don't tell it which page (instance) the reader is on
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');

    // Raw URL text is not shown anywhere.
    expect(screen.queryByText(gifUrl)).not.toBeInTheDocument();
    // The generic link-preview card is not rendered (LinkPreviewCard uses role="link").
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders normally (text + auto-linked URL) when the message has a URL plus other text', () => {
    const text = `check this out ${gifUrl}`;
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text }],
      linkPreviews: [{ url: gifUrl, imageUrl: gifUrl }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.queryByRole('img', { name: 'GIF' })).not.toBeInTheDocument();
    expect(screen.getByText(/check this out/)).toBeInTheDocument();
    // Raw URL is auto-linked as an anchor (normal MessageSpan rendering) —
    // a link-preview card for the same URL may also legitimately render, so
    // scope this assertion to the actual <a> tag rather than getByRole,
    // which would find both.
    const links = screen.getAllByRole('link', { name: gifUrl });
    expect(links.some((el) => el.tagName === 'A')).toBe(true);
  });

  it('falls back to link text + link preview when the GIF image fails to load', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: gifUrl }],
      linkPreviews: [{ url: gifUrl, imageUrl: gifUrl, title: 'A cat GIF' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    const img = screen.getByRole('img', { name: 'GIF' });
    fireEvent.error(img);

    // Embed is gone; fell back to the raw link + link-preview card.
    expect(screen.queryByRole('img', { name: 'GIF' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: gifUrl })).toBeInTheDocument();
    expect(screen.getByText('A cat GIF')).toBeInTheDocument();
  });

  it('renders normally for a plain-text message with no URL at all', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: 'hello world' }],
    });

    renderWithProviders(<MessageComponent message={message} />);

    expect(screen.queryByRole('img', { name: 'GIF' })).not.toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });
});
