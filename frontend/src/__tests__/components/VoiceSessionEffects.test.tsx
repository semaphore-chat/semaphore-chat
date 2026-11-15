/**
 * The call's behaviour runs from VoiceSessionLayer while a call is active,
 * with no voice bar on screen: push-to-talk, keep-alive, wake lock, Media
 * Session, the presence heartbeat, deafen, server mute and per-user volume.
 * Before, these lived in VoiceBottomBarContent and stopped with the bar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { VoiceSessionType } from '../../contexts/VoiceContext';

const voice = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  actions: { leaveVoiceChannel: vi.fn(), toggleMute: vi.fn() },
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: voice.state, actions: voice.actions }),
}));
vi.mock('../../hooks/useLocalMediaState', () => ({
  useLocalMediaState: () => ({ isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false }),
}));
const publish = vi.hoisted(() => ({ canSpeak: true }));
vi.mock('../../hooks/useVoicePublishPermissions', () => ({
  useVoicePublishPermissions: () => ({ canSpeak: publish.canSpeak, canVideo: true, canShare: true }),
}));

vi.mock('../../hooks/usePushToTalk', () => ({ usePushToTalk: vi.fn() }));
vi.mock('../../hooks/useBackgroundVoiceKeepAlive', () => ({ useBackgroundVoiceKeepAlive: vi.fn() }));
vi.mock('../../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('../../hooks/useVoiceMediaSession', () => ({ useVoiceMediaSession: vi.fn() }));
vi.mock('../../hooks/useVoicePresenceHeartbeat', () => ({ useVoicePresenceHeartbeat: vi.fn() }));
vi.mock('../../hooks/useDeafenEffect', () => ({ useDeafenEffect: vi.fn() }));
vi.mock('../../hooks/useServerMuteEffect', () => ({ useServerMuteEffect: vi.fn() }));
vi.mock('../../hooks/useRemoteVolumeEffect', () => ({ useRemoteVolumeEffect: vi.fn() }));

// The layer's other pieces are covered elsewhere (VoiceSessionLayer.test.tsx).
vi.mock('../../components/Voice/TrackSubscriptionProvider', () => ({
  TrackSubscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useVoiceEventLog', () => ({
  VoiceEventLogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../features/voice/VoiceTestHooks', () => ({ VoiceTestHooks: () => null }));
vi.mock('../../components/Voice/AudioRenderer', () => ({ AudioRenderer: () => null }));

import { VoiceSessionLayer } from '../../components/Voice/VoiceSessionLayer';
import { usePushToTalk } from '../../hooks/usePushToTalk';
import { useBackgroundVoiceKeepAlive } from '../../hooks/useBackgroundVoiceKeepAlive';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useVoiceMediaSession } from '../../hooks/useVoiceMediaSession';
import { useVoicePresenceHeartbeat } from '../../hooks/useVoicePresenceHeartbeat';
import { useDeafenEffect } from '../../hooks/useDeafenEffect';
import { useServerMuteEffect } from '../../hooks/useServerMuteEffect';
import { useRemoteVolumeEffect } from '../../hooks/useRemoteVolumeEffect';

const room = { name: 'fake-room' };

const IN_A_CHANNEL = {
  isConnected: true,
  isConnecting: false,
  contextType: VoiceSessionType.Channel,
  currentChannelId: 'ch-1',
  currentDmGroupId: null,
  channelName: 'general',
  dmGroupName: null,
  room,
};

const SESSION_HOOKS = [
  usePushToTalk,
  useBackgroundVoiceKeepAlive,
  useWakeLock,
  useVoiceMediaSession,
  useVoicePresenceHeartbeat,
  useDeafenEffect,
  useServerMuteEffect,
  useRemoteVolumeEffect,
];

/** The layer with no bar, no layout: nothing on screen but the call. */
function renderLayerAlone() {
  return render(
    <VoiceSessionLayer>
      <div data-testid="no-voice-ui" />
    </VoiceSessionLayer>,
  );
}

/** Loads the lazy chunk and flushes React, so whatever would mount has mounted. */
async function settleLazyChunk() {
  await act(async () => {
    await import('../../components/Voice/VoiceSessionEffects');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  publish.canSpeak = true;
  voice.state = { ...IN_A_CHANNEL };
});

describe('VoiceSessionEffects (mounted by VoiceSessionLayer)', () => {
  it('runs every session hook during a channel call with no voice bar mounted', async () => {
    renderLayerAlone();

    await waitFor(() => expect(useVoicePresenceHeartbeat).toHaveBeenCalled());
    for (const hook of SESSION_HOOKS) expect(hook).toHaveBeenCalled();

    expect(useVoicePresenceHeartbeat).toHaveBeenLastCalledWith({
      channelId: 'ch-1',
      dmGroupId: null,
      contextType: VoiceSessionType.Channel,
      room,
    });
    expect(useBackgroundVoiceKeepAlive).toHaveBeenLastCalledWith({ isConnected: true });
    expect(useWakeLock).toHaveBeenLastCalledWith(true);
    expect(useVoiceMediaSession).toHaveBeenLastCalledWith({
      isConnected: true,
      contextName: 'general',
      isMicrophoneEnabled: true,
      onHangup: voice.actions.leaveVoiceChannel,
      onToggleMic: voice.actions.toggleMute,
    });
    expect(usePushToTalk).toHaveBeenLastCalledWith({ canSpeak: true });
  });

  it('runs during a DM call too, named after the DM', async () => {
    voice.state = {
      ...IN_A_CHANNEL,
      contextType: VoiceSessionType.Dm,
      currentChannelId: null,
      channelName: null,
      currentDmGroupId: 'dm-1',
      dmGroupName: 'Alice',
    };
    renderLayerAlone();

    await waitFor(() => expect(useVoicePresenceHeartbeat).toHaveBeenCalled());
    expect(useVoicePresenceHeartbeat).toHaveBeenLastCalledWith(
      expect.objectContaining({ dmGroupId: 'dm-1', contextType: VoiceSessionType.Dm }),
    );
    expect(useVoiceMediaSession).toHaveBeenLastCalledWith(expect.objectContaining({ contextName: 'Alice' }));
  });

  it('passes the SPEAK permission to push-to-talk, so presses are ignored without it', async () => {
    publish.canSpeak = false;
    renderLayerAlone();

    await waitFor(() => expect(usePushToTalk).toHaveBeenCalled());
    expect(usePushToTalk).toHaveBeenLastCalledWith({ canSpeak: false });
  });

  it('runs none of them outside a call, or while connected with no channel or DM', async () => {
    voice.state = { ...IN_A_CHANNEL, isConnected: false };
    const { unmount } = renderLayerAlone();
    // The chunk is loaded, so a (wrong) mount would show up now.
    await settleLazyChunk();
    unmount();

    voice.state = { ...IN_A_CHANNEL, currentChannelId: null };
    renderLayerAlone();
    await settleLazyChunk();

    for (const hook of SESSION_HOOKS) expect(hook).not.toHaveBeenCalled();
  });

  it('renders the children beside it (the layer adds no UI of its own)', () => {
    const { getByTestId } = renderLayerAlone();
    expect(getByTestId('no-voice-ui')).toBeInTheDocument();
  });
});
