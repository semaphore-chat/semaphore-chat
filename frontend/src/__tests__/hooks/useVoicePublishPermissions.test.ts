import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVoicePublishPermissions } from '../../hooks/useVoicePublishPermissions';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { ChannelCapability } from '../../hooks/useChannelPermissions';

let voice: { contextType: VoiceSessionType | null; communityId: string | null; currentChannelId: string | null };
let denied: ChannelCapability[] = [];
let timedOutUntil: Date | undefined;
const useChannelPermissions = vi.fn((_communityId?: string, _channelId?: string) => ({
  can: (c: ChannelCapability) => !denied.includes(c),
  timedOutUntil,
}));

vi.mock('../../contexts/VoiceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/VoiceContext')>()),
  useVoice: () => voice,
}));
vi.mock('../../hooks/useChannelPermissions', () => ({
  useChannelPermissions: (communityId?: string, channelId?: string) =>
    useChannelPermissions(communityId, channelId),
}));

describe('useVoicePublishPermissions', () => {
  beforeEach(() => {
    voice = { contextType: VoiceSessionType.Channel, communityId: 'c1', currentChannelId: 'v1' };
    denied = [];
    timedOutUntil = undefined;
    useChannelPermissions.mockClear();
  });

  it('reads the connected channel from the voice context', () => {
    renderHook(() => useVoicePublishPermissions());
    expect(useChannelPermissions).toHaveBeenCalledWith('c1', 'v1');
  });

  it('maps speak / video / share and explains a denial', () => {
    denied = ['video', 'share'];
    const { result } = renderHook(() => useVoicePublishPermissions());
    expect(result.current).toMatchObject({
      canSpeak: true,
      canVideo: false,
      canShare: false,
      videoBlockedReason: "You can't use video in this channel",
      shareBlockedReason: "You can't share your screen in this channel",
    });
  });

  it('a timeout explains itself with the end time', () => {
    denied = ['speak', 'video', 'share'];
    timedOutUntil = new Date(2026, 9, 5, 15, 42);
    const { result } = renderHook(() => useVoicePublishPermissions());
    expect(result.current.canSpeak).toBe(false);
    expect(result.current.speakBlockedReason).toMatch(/^Timed out — you can listen until 3:42\s?PM$/);
  });

  it('DM calls are never restricted', () => {
    voice = { contextType: VoiceSessionType.Dm, communityId: null, currentChannelId: null };
    denied = ['speak', 'video', 'share'];
    const { result } = renderHook(() => useVoicePublishPermissions());
    expect(result.current).toMatchObject({ canSpeak: true, canVideo: true, canShare: true });
    expect(useChannelPermissions).toHaveBeenCalledWith(undefined, undefined);
  });
});
