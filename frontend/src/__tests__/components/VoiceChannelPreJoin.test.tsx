import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { VoiceChannelPreJoin } from '../../components/Voice/VoiceChannelPreJoin';
import { ChannelType, type Channel } from '../../types/channel.type';
import type { VoicePresenceUserDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Voice/VoiceChannelJoinButton', () => ({
  VoiceChannelJoinButton: () => <button>Join voice</button>,
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ userId }: { userId?: string }) => <div data-testid="user-avatar" data-user-id={userId} />,
}));

const mockOpenProfile = vi.fn();
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: mockOpenProfile }),
}));

let mockVoice: Record<string, unknown> = { isConnected: false, currentChannelId: null, channelName: null };
vi.mock('../../contexts/VoiceContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVoice: () => mockVoice,
}));

const channel = {
  id: 'voice-1',
  name: 'Hangout',
  type: ChannelType.VOICE,
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2025-01-01T00:00:00Z',
} as unknown as Channel;

function user(i: number, extra: Partial<VoicePresenceUserDto> = {}): VoicePresenceUserDto {
  return {
    id: `u${i}`,
    username: `user${i}`,
    displayName: `Person ${i}`,
    joinedAt: '2025-01-01T00:00:00Z',
    isDeafened: false,
    isServerMuted: false,
    ...extra,
  };
}

function presence(users: VoicePresenceUserDto[]) {
  server.use(
    http.get('*/api/channels/voice-1/voice-presence', () =>
      HttpResponse.json({ channelId: 'voice-1', users, count: users.length }),
    ),
  );
}

describe('VoiceChannelPreJoin', () => {
  beforeEach(() => {
    mockVoice = { isConnected: false, currentChannelId: null, channelName: null };
  });

  it('shows the channel, the join controls and EVERYONE in it, without "Joined" times', async () => {
    presence(Array.from({ length: 25 }, (_, i) => user(i)));
    renderWithProviders(<VoiceChannelPreJoin channel={channel} />);

    expect(screen.getByRole('heading', { name: 'Hangout' })).toBeInTheDocument();
    expect(await screen.findByText('25 people here')).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'People in this voice channel' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(25);
    expect(screen.getByRole('button', { name: 'Join voice' })).toBeInTheDocument();
    expect(screen.queryByText(/Joined/)).not.toBeInTheDocument();
    // The old copy that told you to click what you just clicked is gone
    expect(screen.queryByText(/Click on this voice channel/)).not.toBeInTheDocument();
  });

  it('flags only unusual states: deafened (grey) and server-muted (red)', async () => {
    presence([user(1), user(2, { isDeafened: true }), user(3, { isServerMuted: true })]);
    renderWithProviders(<VoiceChannelPreJoin channel={channel} />);

    const p1 = (await screen.findByRole('button', { name: 'Person 1' })).closest('li')!;
    const p2 = screen.getByRole('button', { name: 'Person 2' }).closest('li')!;
    const p3 = screen.getByRole('button', { name: 'Person 3' }).closest('li')!;
    expect(within(p1).queryByTestId(/voice-badge-/)).not.toBeInTheDocument();
    expect(within(p2).getByTestId('voice-badge-deafened')).toHaveAttribute('data-tone', 'neutral');
    expect(within(p3).getByTestId('voice-badge-server-muted')).toHaveAttribute('data-tone', 'danger');
  });

  it('opens a profile from the grid', async () => {
    presence([user(1)]);
    const { user: ue } = renderWithProviders(<VoiceChannelPreJoin channel={channel} />);

    await ue.click(await screen.findByRole('button', { name: 'Person 1' }));
    expect(mockOpenProfile).toHaveBeenCalledWith('u1');
  });

  it('says when nobody is there', async () => {
    presence([]);
    renderWithProviders(<VoiceChannelPreJoin channel={channel} />);

    expect(await screen.findByText("Nobody's here yet")).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('warns that joining moves you when connected to another channel', async () => {
    presence([user(1)]);
    mockVoice = { isConnected: true, currentChannelId: 'other', channelName: 'Lobby' };
    renderWithProviders(<VoiceChannelPreJoin channel={channel} />);

    expect(await screen.findByText(`You're in "Lobby". Joining moves you here.`)).toBeInTheDocument();
  });
});
