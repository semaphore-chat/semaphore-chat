import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceChannelJoinButton } from '../../components/Voice/VoiceChannelJoinButton';
import { voiceJoinMode } from '../../components/Voice/voiceJoinMode';
import { ChannelType, type Channel } from '../../types/channel.type';
import type { ChannelPermissions } from '../../hooks/useChannelPermissions';

const mockJoin = vi.fn().mockResolvedValue(undefined);
let mockVoiceState: Record<string, unknown> = { isConnecting: false, currentChannelId: null };
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: mockVoiceState, actions: { joinVoiceChannel: mockJoin } }),
}));

let mockCaps: Record<string, boolean> = {};
let mockTimedOutUntil: Date | undefined;
vi.mock('../../hooks/useChannelPermissions', () => ({
  useChannelPermissions: (): Partial<ChannelPermissions> => ({
    can: (c) => mockCaps[c] ?? true,
    timedOutUntil: mockTimedOutUntil,
  }),
}));

const mockShowNotification = vi.fn();
vi.mock('../../contexts/NotificationContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNotification: () => ({ showNotification: mockShowNotification }),
}));

vi.mock('../../hooks/useSound', () => ({ playSound: vi.fn(), Sounds: { error: 'error' } }));

const channel = {
  id: 'voice-1',
  name: 'Hangout',
  type: ChannelType.VOICE,
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2025-01-01T00:00:00Z',
} as unknown as Channel;

describe('voiceJoinMode', () => {
  it.each([
    [{ connect: true, speak: true }, 'full'],
    [{ connect: true, speak: false }, 'listen-only'],
    [{ connect: false, speak: true }, 'none'],
    [{ connect: false, speak: false }, 'none'],
  ] as const)('%o → %s', (can, mode) => {
    expect(voiceJoinMode(can)).toBe(mode);
  });
});

describe('VoiceChannelJoinButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaps = {};
    mockTimedOutUntil = undefined;
    mockVoiceState = { isConnecting: false, currentChannelId: null };
  });

  it('offers "Join voice" and "Join muted" with full permissions', async () => {
    const { user } = renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    await user.click(screen.getByRole('button', { name: 'Join voice' }));
    expect(mockJoin).toHaveBeenLastCalledWith('voice-1', 'Hangout', 'c1', false, '2025-01-01T00:00:00Z', { startMuted: false });

    await user.click(screen.getByRole('button', { name: 'Join muted' }));
    expect(mockJoin).toHaveBeenLastCalledWith('voice-1', 'Hangout', 'c1', false, '2025-01-01T00:00:00Z', { startMuted: true });
  });

  it('without SPEAK: a single listen-only join, muted, and no "Join muted"', async () => {
    mockCaps = { speak: false };
    const { user } = renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    expect(screen.queryByRole('button', { name: 'Join muted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join voice' })).not.toBeInTheDocument();
    expect(screen.getByText("You can listen but not speak here")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Join to listen' }));
    expect(mockJoin).toHaveBeenCalledWith('voice-1', 'Hangout', 'c1', false, '2025-01-01T00:00:00Z', { startMuted: true });
  });

  it('timed out: says until when you can only listen', () => {
    mockCaps = { speak: false };
    mockTimedOutUntil = new Date('2030-01-01T14:30:00');
    renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    expect(screen.getByRole('button', { name: 'Join to listen' })).toBeInTheDocument();
    expect(screen.getByText(/^Timed out — you can listen until /)).toBeInTheDocument();
  });

  it('without CONNECT: no button, just an explanation', () => {
    mockCaps = { connect: false };
    renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText("You don't have permission to join this voice channel.")).toBeInTheDocument();
  });

  it('disables both buttons while connecting to this channel', () => {
    mockVoiceState = { isConnecting: true, currentChannelId: 'voice-1' };
    renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    expect(screen.getByRole('button', { name: 'Join voice' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Join muted' })).toBeDisabled();
  });

  it('leaves a failed join to the voice notice (no generic toast)', async () => {
    mockJoin.mockRejectedValueOnce(new Error('nope'));
    const { user } = renderWithProviders(<VoiceChannelJoinButton channel={channel} />);

    await user.click(screen.getByRole('button', { name: 'Join voice' }));
    await waitFor(() => expect(mockJoin).toHaveBeenCalled());
    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Join voice' })).toBeEnabled();
  });

  it('renders nothing for a text channel', () => {
    const { container } = renderWithProviders(
      <VoiceChannelJoinButton channel={{ ...channel, type: ChannelType.TEXT } as Channel} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
