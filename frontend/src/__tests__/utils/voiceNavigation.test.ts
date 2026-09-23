import { describe, it, expect } from 'vitest';
import { getFloatNavigationTarget } from '../../utils/voiceNavigation';
import { VoiceSessionType } from '../../contexts/VoiceContext';

describe('getFloatNavigationTarget', () => {
  it('builds the channel route for a channel session', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: VoiceSessionType.Channel,
        communityId: 'community-1',
        currentChannelId: 'channel-1',
        currentDmGroupId: null,
      }),
    ).toBe('/community/community-1/channel/channel-1');
  });

  it('builds the ?group= deep link for a DM session', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: VoiceSessionType.Dm,
        communityId: null,
        currentChannelId: null,
        currentDmGroupId: 'group-1',
      }),
    ).toBe('/direct-messages?group=group-1');
  });

  it('returns null when not connected', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: false,
        contextType: VoiceSessionType.Channel,
        communityId: 'community-1',
        currentChannelId: 'channel-1',
        currentDmGroupId: null,
      }),
    ).toBeNull();
  });

  it('returns null for a channel session missing communityId', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: VoiceSessionType.Channel,
        communityId: null,
        currentChannelId: 'channel-1',
        currentDmGroupId: null,
      }),
    ).toBeNull();
  });

  it('returns null for a channel session missing currentChannelId', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: VoiceSessionType.Channel,
        communityId: 'community-1',
        currentChannelId: null,
        currentDmGroupId: null,
      }),
    ).toBeNull();
  });

  it('returns null for a DM session missing currentDmGroupId', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: VoiceSessionType.Dm,
        communityId: null,
        currentChannelId: null,
        currentDmGroupId: null,
      }),
    ).toBeNull();
  });

  it('returns null when contextType is null', () => {
    expect(
      getFloatNavigationTarget({
        isConnected: true,
        contextType: null,
        communityId: null,
        currentChannelId: null,
        currentDmGroupId: null,
      }),
    ).toBeNull();
  });
});
