import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { DMChatHeader } from '../../components/DirectMessages/DMChatHeader';

const mockJoinDmVoice = vi.fn();
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, contextType: null, currentDmGroupId: null },
    actions: {
      joinDmVoice: mockJoinDmVoice,
      leaveVoiceChannel: vi.fn(),
      toggleVideo: vi.fn(),
      revealVideoTiles: vi.fn(),
    },
  }),
}));

describe('DMChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the conversation name', () => {
    renderWithProviders(<DMChatHeader dmGroupId="dm-1" dmGroupName="Bob Builder" />);

    expect(screen.getByRole('heading', { name: 'Bob Builder' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Loading conversation' })).not.toBeInTheDocument();
  });

  it('shows a neutral placeholder, never "Unknown", while the name is loading', () => {
    renderWithProviders(<DMChatHeader dmGroupId="dm-1" />);

    expect(screen.getByRole('progressbar', { name: 'Loading conversation' })).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it('keeps the call buttons disabled until the name is known', () => {
    renderWithProviders(<DMChatHeader dmGroupId="dm-1" />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });

  it('says the conversation is unavailable and offers no calls when it failed to load', () => {
    renderWithProviders(<DMChatHeader dmGroupId="dm-1" unavailable />);

    expect(screen.getByRole('heading', { name: 'Conversation unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a call with the loaded name', async () => {
    const { user } = renderWithProviders(<DMChatHeader dmGroupId="dm-1" dmGroupName="Bob Builder" />);

    await user.click(screen.getByTestId('PhoneIcon'));

    expect(mockJoinDmVoice).toHaveBeenCalledWith('dm-1', 'Bob Builder');
  });
});
