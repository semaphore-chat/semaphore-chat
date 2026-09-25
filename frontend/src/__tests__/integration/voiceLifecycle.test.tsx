/**
 * Voice lifecycle integration tests.
 *
 * The voice subsystem is composed of multiple cooperating hooks
 * (useTrackSubscription, useDeafenEffect, useRemoteVolumeEffect) and a
 * top-level renderer (AudioRenderer). Per-hook unit tests exist, but bugs in
 * this area tend to live in the *interactions* between them — and the most
 * painful symptom (asymmetric audio in 3-person voice calls) is exactly that
 * kind of cross-hook bug.
 *
 * These tests exercise the whole stack against a fake LiveKit Room, asserting
 * the externally-observable behaviour: did we tell the SFU to subscribe? did
 * we attach the track to an <audio> element? did deafen mute the right tracks?
 * did Reconnected re-issue subscription requests? They are intentionally
 * loose about implementation detail and tight about the contract that
 * downstream WebRTC behaviour depends on.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock livekit-client BEFORE importing app code -------------------------
//
// We mirror the live enums and provide a `RemoteTrackPublication` class so
// the duck-type check in useTrackSubscription works against our fakes.
vi.mock('livekit-client', () => {
  class RemoteTrackPublication {}
  return {
    RoomEvent: {
      TrackPublished: 'trackPublished',
      TrackUnpublished: 'trackUnpublished',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted',
      ParticipantConnected: 'participantConnected',
      ParticipantDisconnected: 'participantDisconnected',
      Reconnected: 'reconnected',
      Reconnecting: 'reconnecting',
      SignalConnected: 'signalConnected',
      Disconnected: 'disconnected',
      ConnectionQualityChanged: 'connectionQualityChanged',
      TrackSubscriptionStatusChanged: 'trackSubscriptionStatusChanged',
      TrackSubscriptionFailed: 'trackSubscriptionFailed',
    },
    Track: {
      Source: {
        Microphone: 'microphone',
        Camera: 'camera',
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio',
      },
    },
    RemoteTrackPublication,
    ConnectionQuality: {
      Excellent: 'excellent',
      Good: 'good',
      Poor: 'poor',
      Lost: 'lost',
    },
  };
});

// Import AFTER the mock. These resolve the mocked module above.
import { RoomEvent, Track } from 'livekit-client';
import type { Room as LKRoom, RemoteParticipant as LKRemoteParticipant } from 'livekit-client';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';
import { TrackSubscriptionProvider } from '../../components/Voice/TrackSubscriptionProvider';
import { useTrackSubscriptionActions } from '../../hooks/useTrackSubscription';
import { AudioRenderer } from '../../components/Voice/AudioRenderer';
import { useDeafenEffect } from '../../hooks/useDeafenEffect';
import { useRemoteVolumeEffect } from '../../hooks/useRemoteVolumeEffect';
import { useVoiceDispatch, VoiceActionType } from '../../contexts/VoiceContext';
import { VOLUME_STORAGE_PREFIX } from '../../constants/voice';

// =========================================================================
// Fake LiveKit primitives
// =========================================================================

type Listener = (...args: unknown[]) => void;

class FakeEmitter {
  private listeners = new Map<string, Set<Listener>>();
  on(event: string, l: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(l);
    return this;
  }
  off(event: string, l: Listener) {
    this.listeners.get(event)?.delete(l);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((l) => l(...args));
  }
}

interface FakeAudioTrack {
  mediaStreamTrack: { enabled: boolean };
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
  attachedElements: HTMLMediaElement[];
}

function createFakeAudioTrack(): FakeAudioTrack {
  const attachedElements: HTMLMediaElement[] = [];
  return {
    mediaStreamTrack: { enabled: true },
    attachedElements,
    attach: vi.fn((el: HTMLMediaElement) => {
      attachedElements.push(el);
      return el;
    }),
    detach: vi.fn((el?: HTMLMediaElement) => {
      if (el) {
        const i = attachedElements.indexOf(el);
        if (i >= 0) attachedElements.splice(i, 1);
      }
      return el;
    }),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 1.0),
  };
}

// Use a class so `instanceof RemoteTrackPublication` from the mock passes for
// objects created via Object.create(prototype) when we extend it.
import { RemoteTrackPublication } from 'livekit-client';

// At runtime this is the bare mock class above (no ctor args, no accessors),
// but TS sees the real livekit-client type — cast to a loose base so our fake
// fields don't clash with the real class's accessors and constructor.
const MockRTP = RemoteTrackPublication as unknown as new () => object;

class FakeRemoteTrackPublication extends MockRTP {
  source: string;
  trackSid: string;
  kind: 'audio' | 'video';
  isSubscribed: boolean;
  subscriptionStatus: string;
  isMuted: boolean;
  track?: FakeAudioTrack;
  setSubscribedSpy: Mock<(subscribed: boolean) => void>;

  constructor(source: string, opts: { withTrack?: boolean; isMuted?: boolean } = {}) {
    super();
    this.source = source;
    this.trackSid = `sid-${source}-${Math.random().toString(36).slice(2)}`;
    this.kind =
      source === Track.Source.Camera || source === Track.Source.ScreenShare ? 'video' : 'audio';
    this.isSubscribed = false;
    this.subscriptionStatus = 'unsubscribed';
    this.isMuted = opts.isMuted ?? false;
    if (opts.withTrack && this.kind === 'audio') {
      this.track = createFakeAudioTrack();
    }
    this.setSubscribedSpy = vi.fn((subscribed: boolean) => {
      this.isSubscribed = subscribed;
      this.subscriptionStatus = subscribed ? 'subscribed' : 'unsubscribed';
    });
  }

  setSubscribed(subscribed: boolean) {
    this.setSubscribedSpy(subscribed);
  }
}

class FakeRemoteParticipant extends FakeEmitter {
  identity: string;
  name: string;
  isSpeaking = false;
  connectionQuality = 'excellent';
  trackPublications = new Map<string, FakeRemoteTrackPublication>();
  audioTrackPublications = new Map<string, FakeRemoteTrackPublication>();

  constructor(identity: string, name?: string) {
    super();
    this.identity = identity;
    this.name = name ?? identity;
  }

  addPublication(pub: FakeRemoteTrackPublication) {
    this.trackPublications.set(pub.trackSid, pub);
    if (pub.kind === 'audio') {
      this.audioTrackPublications.set(pub.trackSid, pub);
    }
  }
}

class FakeLocalParticipant extends FakeEmitter {
  identity = 'local-user';
  isSpeaking = false;
  connectionQuality = 'excellent';
  metadata = '';
  isMicrophoneEnabled = true;
  trackPublications = new Map<string, FakeRemoteTrackPublication>();
  setMetadata = vi.fn(async (m: string) => {
    this.metadata = m;
  });
  getTrackPublication = vi.fn(() => undefined);
  getTrackPublications = vi.fn(() => Array.from(this.trackPublications.values()));
  setMicrophoneEnabled = vi.fn(async () => {});
}

class FakeRoom extends FakeEmitter {
  state = 'connected';
  localParticipant = new FakeLocalParticipant();
  remoteParticipants = new Map<string, FakeRemoteParticipant>();
  numParticipants = 1;

  addRemote(p: FakeRemoteParticipant) {
    this.remoteParticipants.set(p.identity, p);
    this.numParticipants = this.remoteParticipants.size + 1;
  }
}

// =========================================================================
// Test harness
// =========================================================================

/**
 * Mounts the same provider stack the real app uses around a voice session, but
 * with a hand-rolled RoomContext.Provider so we can swap in a FakeRoom without
 * involving voiceActions/connectToLiveKitRoom.
 *
 * Crucially, this also calls useDeafenEffect + useRemoteVolumeEffect inside
 * the provider tree so cross-hook interactions are exercised, not just the
 * subscription hook in isolation.
 */
function VoiceFx({ deafened }: { deafened: boolean }) {
  const { dispatch } = useVoiceDispatch();
  // Sync the deafened prop into VoiceContext so useDeafenEffect picks it up.
  useEffect(() => {
    dispatch({ type: VoiceActionType.SetDeafened, payload: deafened });
  }, [dispatch, deafened]);

  useDeafenEffect();
  useRemoteVolumeEffect();
  return null;
}

interface HarnessProps {
  room: FakeRoom;
  deafened?: boolean;
  onActions?: (actions: ReturnType<typeof useTrackSubscriptionActions>) => void;
}

function ActionsBridge({ onActions }: { onActions?: HarnessProps['onActions'] }) {
  const actions = useTrackSubscriptionActions();
  useEffect(() => {
    onActions?.(actions);
  }, [actions, onActions]);
  return null;
}

function Harness({ room, deafened = false, onActions }: HarnessProps) {
  // Stable QueryClient + RoomContext value across rerenders so React Query
  // state isn't reset and consumers don't see a flapping context value.
  const queryClient = React.useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [],
  );
  const roomCtx = React.useMemo(
    () => ({
      room: room as unknown as LKRoom,
      setRoom: () => {},
      getRoom: () => room as unknown as LKRoom,
    }),
    [room],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <VoiceProvider>
        <RoomContext.Provider value={roomCtx}>
          <TrackSubscriptionProvider>
            <VoiceFx deafened={deafened} />
            <ActionsBridge onActions={onActions} />
            <AudioRenderer />
          </TrackSubscriptionProvider>
        </RoomContext.Provider>
      </VoiceProvider>
    </QueryClientProvider>
  );
}

// =========================================================================
// Tests
// =========================================================================

describe('voice lifecycle (integration)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  describe('initial join with existing remote participant', () => {
    it('subscribes to a remote mic that was already published when we joined', () => {
      const room = new FakeRoom();
      const remote = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      remote.addPublication(micPub);
      room.addRemote(remote);

      render(<Harness room={room} />);

      // The mount-time iteration should have asked the SFU to subscribe.
      expect(micPub.setSubscribedSpy).toHaveBeenCalledWith(true);
    });

    it('attaches the audio track to a hidden <audio> element once it has data', () => {
      const room = new FakeRoom();
      const remote = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micPub.isSubscribed = true;
      micPub.subscriptionStatus = 'subscribed';
      remote.addPublication(micPub);
      room.addRemote(remote);

      render(<Harness room={room} />);

      // Without a TrackSubscribed event the renderer's listener-based update
      // won't fire, but the initial updateAudioTracks call on mount picks it
      // up because publication.track is already populated.
      expect(micPub.track!.attach).toHaveBeenCalledTimes(1);
      expect(micPub.track!.attachedElements.length).toBe(1);
    });

    it('does NOT attach a track when the publication has no track yet (subscription in flight)', () => {
      const room = new FakeRoom();
      const remote = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      // No withTrack: track is undefined until SFU starts forwarding.
      remote.addPublication(micPub);
      room.addRemote(remote);

      const { container } = render(<Harness room={room} />);

      // No <audio> element rendered yet — AudioRenderer waits for publication.track
      expect(container.querySelector('audio')).toBeNull();
    });
  });

  describe('mid-session participant joining', () => {
    it('subscribes to a participant who connects after we joined', () => {
      const room = new FakeRoom();
      render(<Harness room={room} />);

      const bob = new FakeRemoteParticipant('bob');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      bob.addPublication(micPub);
      room.addRemote(bob);

      act(() => {
        room.emit(RoomEvent.ParticipantConnected, bob);
      });

      expect(micPub.setSubscribedSpy).toHaveBeenCalledWith(true);
    });

    it('subscribes to a mic that gets published after the participant joined', () => {
      const room = new FakeRoom();
      const bob = new FakeRemoteParticipant('bob');
      room.addRemote(bob);
      render(<Harness room={room} />);

      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      bob.addPublication(micPub);

      act(() => {
        room.emit(RoomEvent.TrackPublished, micPub, bob);
      });

      expect(micPub.setSubscribedSpy).toHaveBeenCalledWith(true);
    });

    it('attaches a remote audio element after a TrackSubscribed event', () => {
      const room = new FakeRoom();
      const bob = new FakeRemoteParticipant('bob');
      room.addRemote(bob);
      render(<Harness room={room} />);

      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micPub.isSubscribed = true;
      micPub.subscriptionStatus = 'subscribed';
      bob.addPublication(micPub);

      act(() => {
        room.emit(RoomEvent.TrackPublished, micPub, bob);
        room.emit(RoomEvent.TrackSubscribed, micPub.track, micPub, bob);
      });

      expect(micPub.track!.attach).toHaveBeenCalled();
      expect(micPub.track!.attachedElements.length).toBe(1);
    });
  });

  describe('reconnection (the asymmetric-audio root cause)', () => {
    it('force-resubscribes mics after a Reconnected event', () => {
      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const bob = new FakeRemoteParticipant('bob');

      const micA = new FakeRemoteTrackPublication(Track.Source.Microphone);
      const micB = new FakeRemoteTrackPublication(Track.Source.Microphone);
      // After mount the policy will mark these subscribed; mirror that state
      // by setting isSubscribed=true to simulate the "stale state" the SFU
      // forgets across a reconnect.
      micA.isSubscribed = true;
      micA.subscriptionStatus = 'subscribed';
      micB.isSubscribed = true;
      micB.subscriptionStatus = 'subscribed';
      alice.addPublication(micA);
      bob.addPublication(micB);
      room.addRemote(alice);
      room.addRemote(bob);

      render(<Harness room={room} />);
      const aBefore = micA.setSubscribedSpy.mock.calls.length;
      const bBefore = micB.setSubscribedSpy.mock.calls.length;

      act(() => {
        room.emit(RoomEvent.Reconnected);
      });

      // Both participants get force-resubscribed via toggle false→true
      expect(micA.setSubscribedSpy.mock.calls.slice(aBefore)).toEqual([[false], [true]]);
      expect(micB.setSubscribedSpy.mock.calls.slice(bBefore)).toEqual([[false], [true]]);
    });

    it('self-heals when SFU drops a mic subscription mid-session', () => {
      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      alice.addPublication(micPub);
      room.addRemote(alice);

      render(<Harness room={room} />);

      // Simulate SFU sending a status change that drops the subscription
      micPub.isSubscribed = false;
      micPub.subscriptionStatus = 'unsubscribed';

      act(() => {
        room.emit(RoomEvent.TrackSubscriptionStatusChanged, micPub, 'unsubscribed', alice);
      });

      // The hook should immediately re-issue setSubscribed(true)
      expect(micPub.setSubscribedSpy).toHaveBeenLastCalledWith(true);
    });
  });

  describe('deafen / undeafen', () => {
    it('mutes all remote audio tracks (volume = 0) when deafened', () => {
      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const micA = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micA.isSubscribed = true;
      alice.addPublication(micA);

      const bob = new FakeRemoteParticipant('bob');
      const micB = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micB.isSubscribed = true;
      bob.addPublication(micB);

      room.addRemote(alice);
      room.addRemote(bob);

      const { rerender } = render(<Harness room={room} deafened={false} />);
      // Reset spies to clear any volume calls fired during initial volume application
      micA.track!.setVolume.mockClear();
      micB.track!.setVolume.mockClear();

      rerender(<Harness room={room} deafened={true} />);

      expect(micA.track!.setVolume).toHaveBeenCalledWith(0);
      expect(micB.track!.setVolume).toHaveBeenCalledWith(0);
    });

    it('restores per-user stored volumes from localStorage when undeafened', () => {
      localStorage.setItem(`${VOLUME_STORAGE_PREFIX}alice`, '0.7');
      localStorage.setItem(`${VOLUME_STORAGE_PREFIX}bob`, '1.0');

      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const micA = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micA.isSubscribed = true;
      alice.addPublication(micA);

      const bob = new FakeRemoteParticipant('bob');
      const micB = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micB.isSubscribed = true;
      bob.addPublication(micB);

      room.addRemote(alice);
      room.addRemote(bob);

      const { rerender } = render(<Harness room={room} deafened={true} />);
      micA.track!.setVolume.mockClear();
      micB.track!.setVolume.mockClear();

      rerender(<Harness room={room} deafened={false} />);

      expect(micA.track!.setVolume).toHaveBeenCalledWith(0.7);
      expect(micB.track!.setVolume).toHaveBeenCalledWith(1.0);
    });
  });

  describe('manual recovery via debug action', () => {
    it('forceResubscribeMic toggles the SDK state and re-issues subscribe', () => {
      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone);
      micPub.isSubscribed = true;
      micPub.subscriptionStatus = 'subscribed';
      alice.addPublication(micPub);
      room.addRemote(alice);

      let captured: ReturnType<typeof useTrackSubscriptionActions> = null;
      render(<Harness room={room} onActions={(a) => (captured = a)} />);

      const before = micPub.setSubscribedSpy.mock.calls.length;
      act(() => {
        captured!.forceResubscribeMic('alice');
      });

      expect(micPub.setSubscribedSpy.mock.calls.slice(before)).toEqual([[false], [true]]);
    });
  });

  describe('cleanup', () => {
    it('detaches audio tracks when a participant disconnects', () => {
      const room = new FakeRoom();
      const alice = new FakeRemoteParticipant('alice');
      const micPub = new FakeRemoteTrackPublication(Track.Source.Microphone, { withTrack: true });
      micPub.isSubscribed = true;
      micPub.subscriptionStatus = 'subscribed';
      alice.addPublication(micPub);
      room.addRemote(alice);

      render(<Harness room={room} />);
      expect(micPub.track!.attach).toHaveBeenCalledTimes(1);

      // Simulate participant leaving
      room.remoteParticipants.delete('alice');
      act(() => {
        room.emit(RoomEvent.ParticipantDisconnected, alice as unknown as LKRemoteParticipant);
      });

      expect(micPub.track!.detach).toHaveBeenCalled();
    });
  });
});
