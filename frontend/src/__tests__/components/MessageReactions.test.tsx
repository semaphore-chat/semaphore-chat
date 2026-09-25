import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MessageReactions } from '../../components/Message/MessageReactions';
import type { Reaction } from '../../types/message.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Message/ReactionTooltip', () => ({
  ReactionTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('MessageReactions', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when reactions array is empty', () => {
    const { container } = renderWithProviders(
      <MessageReactions messageId="msg-1" reactions={[]} onReactionClick={vi.fn()} />
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders reaction chip with emoji and count', async () => {
    const reactions: Reaction[] = [
      { emoji: '👍', userIds: ['u1', 'u2'] },
    ];

    renderWithProviders(
      <MessageReactions messageId="msg-1" reactions={reactions} onReactionClick={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('👍 2')).toBeInTheDocument();
    });
  });

  it('calls onReactionClick with the emoji when chip is clicked', async () => {
    const onReactionClick = vi.fn();
    const reactions: Reaction[] = [
      { emoji: '🔥', userIds: ['u1'] },
    ];

    const { user } = renderWithProviders(
      <MessageReactions messageId="msg-1" reactions={reactions} onReactionClick={onReactionClick} />
    );

    await waitFor(() => {
      expect(screen.getByText('🔥 1')).toBeInTheDocument();
    });

    await user.click(screen.getByText('🔥 1'));
    expect(onReactionClick).toHaveBeenCalledWith('🔥');
  });

  it('renders current user reaction (userIds includes current-user-1)', async () => {
    const reactions: Reaction[] = [
      { emoji: '❤️', userIds: ['current-user-1', 'u2'] },
    ];

    renderWithProviders(
      <MessageReactions messageId="msg-1" reactions={reactions} onReactionClick={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('❤️ 2')).toBeInTheDocument();
    });

    // The chip should still be rendered (we don't assert exact styles)
    const chip = screen.getByText('❤️ 2').closest('.MuiChip-root');
    expect(chip).toBeInTheDocument();
  });

  it('renders multiple reaction chips', async () => {
    const reactions: Reaction[] = [
      { emoji: '👍', userIds: ['u1', 'u2', 'u3'] },
      { emoji: '😂', userIds: ['u1'] },
      { emoji: '🎉', userIds: ['u1', 'u2'] },
    ];

    renderWithProviders(
      <MessageReactions messageId="msg-1" reactions={reactions} onReactionClick={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('👍 3')).toBeInTheDocument();
    });
    expect(screen.getByText('😂 1')).toBeInTheDocument();
    expect(screen.getByText('🎉 2')).toBeInTheDocument();
  });

  it('renders a custom (custom:{id}) reaction as an inline image', async () => {
    const emojiById = new Map([
      ['e1', { id: 'e1', communityId: 'c1', name: 'party_blob', fileId: 'file-9', createdBy: null, createdAt: '2026-01-01' }],
    ]);
    const reactions: Reaction[] = [{ emoji: 'custom:e1', userIds: ['u1', 'u2'] }];

    renderWithProviders(
      <MessageReactions
        messageId="msg-1"
        reactions={reactions}
        onReactionClick={vi.fn()}
        emojiById={emojiById}
      />
    );

    const img = await screen.findByRole('img', { name: ':party_blob:' });
    expect(img).toHaveAttribute('src', '/api/file/file-9');
    // Count is still shown alongside the image.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('sends the custom sentinel back on click', async () => {
    const emojiById = new Map([
      ['e1', { id: 'e1', communityId: 'c1', name: 'party_blob', fileId: 'file-9', createdBy: null, createdAt: '2026-01-01' }],
    ]);
    const onReactionClick = vi.fn();
    const reactions: Reaction[] = [{ emoji: 'custom:e1', userIds: ['u1'] }];

    const { user } = renderWithProviders(
      <MessageReactions
        messageId="msg-1"
        reactions={reactions}
        onReactionClick={onReactionClick}
        emojiById={emojiById}
      />
    );

    const img = await screen.findByRole('img', { name: ':party_blob:' });
    await user.click(img);
    expect(onReactionClick).toHaveBeenCalledWith('custom:e1');
  });
});
