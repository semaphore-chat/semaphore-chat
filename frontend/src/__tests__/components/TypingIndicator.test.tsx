import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import TypingIndicator from '../../components/Message/TypingIndicator';
import { TYPING_INDICATOR_HEIGHT } from '../../constants/layout';
import { useTypingUsers } from '../../hooks/useTypingUsers';

vi.mock('../../hooks/useTypingUsers', () => ({
  useTypingUsers: vi.fn(() => [] as string[]),
}));
vi.mock('../../hooks/useUser', () => ({
  useUsers: vi.fn((ids: string[]) =>
    ids.map((id) => ({ data: { id, username: id, displayName: `User ${id}` } })),
  ),
}));

const mockTyping = vi.mocked(useTypingUsers);

describe('TypingIndicator', () => {
  beforeEach(() => {
    mockTyping.mockReset();
    mockTyping.mockReturnValue([]);
  });

  it('renders nothing when nobody is typing', () => {
    renderWithProviders(<TypingIndicator channelId="c1" />);
    expect(screen.queryByTestId('typing-indicator')).toBeNull();
  });

  it('names a single typist', () => {
    mockTyping.mockReturnValue(['a']);
    renderWithProviders(<TypingIndicator channelId="c1" />);
    expect(screen.getByText('User a is typing...')).toBeInTheDocument();
  });

  it('is exactly TYPING_INDICATOR_HEIGHT tall — the height the message list reserves for it', () => {
    mockTyping.mockReturnValue(['a', 'b', 'c']);
    renderWithProviders(<TypingIndicator channelId="c1" />);
    const indicator = screen.getByTestId('typing-indicator');
    expect(indicator).toHaveStyle({ height: `${TYPING_INDICATOR_HEIGHT}px`, boxSizing: 'border-box' });
    expect(screen.getByText('User a and 2 others are typing...')).toBeInTheDocument();
  });
});
