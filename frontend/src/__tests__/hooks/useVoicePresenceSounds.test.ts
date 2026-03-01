import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVoicePresenceSounds } from '../../hooks/useVoicePresenceSounds';
import { playSound } from '../../hooks/useSound';

let mockVoiceState = {
  isConnected: false,
  currentChannelId: null as string | null,
  currentDmGroupId: null as string | null,
};
let mockUser: { id: string } | null = null;

// Capture callbacks per event name
const serverEventCallbacks: Record<string, ((payload: unknown) => void)> = {};

vi.mock('@kraken/shared', () => ({
  ServerEvents: {
    VOICE_CHANNEL_USER_JOINED: 'voiceChannelUserJoined',
    VOICE_CHANNEL_USER_LEFT: 'voiceChannelUserLeft',
    DM_VOICE_USER_JOINED: 'dmVoiceUserJoined',
    DM_VOICE_USER_LEFT: 'dmVoiceUserLeft',
  },
}));

vi.mock('../../socket-hub/useServerEvent', () => ({
  useServerEvent: vi.fn((event: string, callback: (payload: unknown) => void) => {
    serverEventCallbacks[event] = callback;
  }),
}));

vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: vi.fn(() => mockVoiceState),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({ user: mockUser })),
}));

vi.mock('../../hooks/useSound', () => ({
  playSound: vi.fn(),
  Sounds: {
    voiceUserJoined: 'voiceUserJoined',
    voiceUserLeft: 'voiceUserLeft',
  },
}));

describe('useVoicePresenceSounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(serverEventCallbacks).forEach((k) => delete serverEventCallbacks[k]);
    mockUser = { id: 'user-1' };
    mockVoiceState = {
      isConnected: false,
      currentChannelId: null,
      currentDmGroupId: null,
    };
  });

  it('registers four server event listeners', () => {
    renderHook(() => useVoicePresenceSounds());

    expect(serverEventCallbacks['voiceChannelUserJoined']).toBeDefined();
    expect(serverEventCallbacks['voiceChannelUserLeft']).toBeDefined();
    expect(serverEventCallbacks['dmVoiceUserJoined']).toBeDefined();
    expect(serverEventCallbacks['dmVoiceUserLeft']).toBeDefined();
  });

  describe('channel voice', () => {
    it('plays voiceUserJoined when another user joins your channel', () => {
      mockVoiceState = { isConnected: true, currentChannelId: 'ch-1', currentDmGroupId: null };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['voiceChannelUserJoined']({
        channelId: 'ch-1',
        user: { id: 'user-2' },
      });

      expect(playSound).toHaveBeenCalledWith('voiceUserJoined');
    });

    it('plays voiceUserLeft when another user leaves your channel', () => {
      mockVoiceState = { isConnected: true, currentChannelId: 'ch-1', currentDmGroupId: null };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['voiceChannelUserLeft']({
        channelId: 'ch-1',
        userId: 'user-2',
      });

      expect(playSound).toHaveBeenCalledWith('voiceUserLeft');
    });

    it('does not play sound for own join event', () => {
      mockVoiceState = { isConnected: true, currentChannelId: 'ch-1', currentDmGroupId: null };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['voiceChannelUserJoined']({
        channelId: 'ch-1',
        user: { id: 'user-1' },
      });

      expect(playSound).not.toHaveBeenCalled();
    });

    it('does not play sound for a different channel', () => {
      mockVoiceState = { isConnected: true, currentChannelId: 'ch-1', currentDmGroupId: null };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['voiceChannelUserJoined']({
        channelId: 'ch-other',
        user: { id: 'user-2' },
      });

      expect(playSound).not.toHaveBeenCalled();
    });

    it('does not play sound when not connected to voice', () => {
      mockVoiceState = { isConnected: false, currentChannelId: null, currentDmGroupId: null };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['voiceChannelUserJoined']({
        channelId: 'ch-1',
        user: { id: 'user-2' },
      });

      expect(playSound).not.toHaveBeenCalled();
    });
  });

  describe('DM voice', () => {
    it('plays voiceUserJoined when another user joins your DM call', () => {
      mockVoiceState = { isConnected: true, currentChannelId: null, currentDmGroupId: 'dm-1' };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['dmVoiceUserJoined']({
        dmGroupId: 'dm-1',
        user: { id: 'user-2' },
      });

      expect(playSound).toHaveBeenCalledWith('voiceUserJoined');
    });

    it('plays voiceUserLeft when another user leaves your DM call', () => {
      mockVoiceState = { isConnected: true, currentChannelId: null, currentDmGroupId: 'dm-1' };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['dmVoiceUserLeft']({
        dmGroupId: 'dm-1',
        userId: 'user-2',
      });

      expect(playSound).toHaveBeenCalledWith('voiceUserLeft');
    });

    it('does not play sound for own DM join event', () => {
      mockVoiceState = { isConnected: true, currentChannelId: null, currentDmGroupId: 'dm-1' };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['dmVoiceUserJoined']({
        dmGroupId: 'dm-1',
        user: { id: 'user-1' },
      });

      expect(playSound).not.toHaveBeenCalled();
    });

    it('does not play sound for a different DM group', () => {
      mockVoiceState = { isConnected: true, currentChannelId: null, currentDmGroupId: 'dm-1' };
      renderHook(() => useVoicePresenceSounds());

      serverEventCallbacks['dmVoiceUserJoined']({
        dmGroupId: 'dm-other',
        user: { id: 'user-2' },
      });

      expect(playSound).not.toHaveBeenCalled();
    });
  });
});
