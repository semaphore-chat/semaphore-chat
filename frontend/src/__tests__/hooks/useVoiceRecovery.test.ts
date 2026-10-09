import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVoiceRecovery } from '../../hooks/useVoiceRecovery';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { SavedVoiceConnection } from '../../features/voice/voiceActions';

const mockJoin = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, isConnecting: false },
    actions: { joinVoiceChannel: mockJoin, joinDmVoice: vi.fn() },
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: () => ({ data: { id: 'me' }, isLoading: false }),
}));

let mockSaved: SavedVoiceConnection | null = null;
vi.mock('../../features/voice/voiceActions', () => ({
  getSavedConnection: () => mockSaved,
  clearSavedConnection: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const base: SavedVoiceConnection = {
  contextType: VoiceSessionType.Channel,
  channelId: 'ch-1',
  channelName: 'Hangout',
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2025-01-01T00:00:00Z',
  timestamp: Date.now(),
};

describe('useVoiceRecovery — mic state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejoins muted when the saved connection had the mic off', async () => {
    mockSaved = { ...base, micMuted: true };
    renderHook(() => useVoiceRecovery());
    await waitFor(() => expect(mockJoin).toHaveBeenCalled());
    expect(mockJoin).toHaveBeenCalledWith('ch-1', 'Hangout', 'c1', false, '2025-01-01T00:00:00Z', { startMuted: true });
  });

  it('rejoins with the mic on when it was on', async () => {
    mockSaved = { ...base, micMuted: false };
    renderHook(() => useVoiceRecovery());
    await waitFor(() => expect(mockJoin).toHaveBeenCalled());
    expect(mockJoin).toHaveBeenCalledWith('ch-1', 'Hangout', 'c1', false, '2025-01-01T00:00:00Z', { startMuted: false });
  });

  it('treats an older saved record without micMuted as unmuted', async () => {
    mockSaved = { ...base };
    renderHook(() => useVoiceRecovery());
    await waitFor(() => expect(mockJoin).toHaveBeenCalled());
    expect(mockJoin.mock.calls[0][5]).toEqual({ startMuted: false });
  });
});
