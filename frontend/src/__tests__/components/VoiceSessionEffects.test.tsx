/**
 * The call's behaviour runs from VoiceSessionLayer while a call is active,
 * with no voice bar on screen: push-to-talk, keep-alive, wake lock, Media
 * Session, the presence heartbeat, deafen, server mute and per-user volume.
 * Before, these lived in VoiceBottomBarContent and stopped with the bar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { VoiceSessionLayer } from '../../components/Voice/VoiceSessionLayer';
import { voiceSessionEffectsChunk } from '../../components/Voice/voiceSessionEffectsChunk';
import { logger } from '../../utils/logger';
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

  it('runs none of them with no call and no Room', async () => {
    voice.state = { ...IN_A_CHANNEL, isConnected: false, room: null };
    const { unmount } = renderLayerAlone();
    // The chunk is loaded, so a (wrong) mount would show up now.
    await settleLazyChunk();
    unmount();

    voice.state = { ...IN_A_CHANNEL, currentChannelId: null, room: null };
    renderLayerAlone();
    await settleLazyChunk();

    for (const hook of SESSION_HOOKS) expect(hook).not.toHaveBeenCalled();
  });

  it('enforces deafen and per-user volume as soon as a Room exists, before the call is active; the rest waits', async () => {
    // setRoom() has run, the mic is being set up: isConnected is still false.
    voice.state = { ...IN_A_CHANNEL, isConnected: false, isConnecting: true };
    renderLayerAlone();

    await waitFor(() => expect(useDeafenEffect).toHaveBeenCalled());
    expect(useRemoteVolumeEffect).toHaveBeenCalled();
    for (const hook of [
      usePushToTalk,
      useBackgroundVoiceKeepAlive,
      useWakeLock,
      useVoiceMediaSession,
      useVoicePresenceHeartbeat,
      useServerMuteEffect,
    ]) {
      expect(hook).not.toHaveBeenCalled();
    }
  });

  it('renders the children beside it (the layer adds no UI of its own)', () => {
    const { getByTestId } = renderLayerAlone();
    expect(getByTestId('no-voice-ui')).toBeInTheDocument();
  });
});

/** Records anything that reaches it: the app-level boundary in miniature. */
class OuterBoundary extends React.Component<{ onError: (e: unknown) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <div data-testid="app-crashed" /> : this.props.children;
  }
}

describe('VoiceSessionEffects chunk failing to load', () => {
  const chunkError = () => new Error('Failed to fetch dynamically imported module');
  let appErrors: unknown[];

  function renderInApp() {
    appErrors = [];
    return render(
      <OuterBoundary onError={(e) => appErrors.push(e)}>
        <VoiceSessionLayer>
          <div data-testid="no-voice-ui" />
        </VoiceSessionLayer>
      </OuterBoundary>,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads it again after one failure, and the call gets its effects', async () => {
    const load = vi.spyOn(voiceSessionEffectsChunk, 'load').mockRejectedValueOnce(chunkError());
    const { queryByTestId } = renderInApp();

    await waitFor(() => expect(useVoicePresenceHeartbeat).toHaveBeenCalled());
    expect(load).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(appErrors).toEqual([]);
    expect(queryByTestId('app-crashed')).toBeNull();
  });

  it('after the retry fails too: logs, renders nothing, and the error never reaches the app', async () => {
    const load = vi.spyOn(voiceSessionEffectsChunk, 'load').mockRejectedValue(chunkError());
    const { getByTestId, queryByTestId } = renderInApp();

    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(load).toHaveBeenCalledTimes(2);
    expect(appErrors).toEqual([]);
    expect(queryByTestId('app-crashed')).toBeNull();
    expect(getByTestId('no-voice-ui')).toBeInTheDocument();
    for (const hook of SESSION_HOOKS) expect(hook).not.toHaveBeenCalled();
  });

  it('after giving up, the next call tries again', async () => {
    const load = vi.spyOn(voiceSessionEffectsChunk, 'load').mockRejectedValue(chunkError());
    const { rerender } = renderInApp();
    await waitFor(() => expect(logger.error).toHaveBeenCalled());

    // The call ends, the network is back, a new call starts.
    load.mockRestore();
    voice.state = { ...IN_A_CHANNEL, isConnected: false, room: null };
    rerender(
      <OuterBoundary onError={(e) => appErrors.push(e)}>
        <VoiceSessionLayer>
          <div data-testid="no-voice-ui" />
        </VoiceSessionLayer>
      </OuterBoundary>,
    );
    await settleLazyChunk();
    voice.state = { ...IN_A_CHANNEL };
    rerender(
      <OuterBoundary onError={(e) => appErrors.push(e)}>
        <VoiceSessionLayer>
          <div data-testid="no-voice-ui" />
        </VoiceSessionLayer>
      </OuterBoundary>,
    );

    await waitFor(() => expect(useVoicePresenceHeartbeat).toHaveBeenCalled());
    expect(appErrors).toEqual([]);
  });
});
