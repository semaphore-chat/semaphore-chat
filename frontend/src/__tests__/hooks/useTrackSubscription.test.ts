import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// --- Mock livekit-client ---
vi.mock('livekit-client', () => ({
  RoomEvent: {
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    ParticipantConnected: 'participantConnected',
    Reconnected: 'reconnected',
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
  RemoteTrackPublication: class MockRemoteTrackPublication {},
}));

// --- Event emitter helpers ---
type Handler = (...args: unknown[]) => void;
let roomEventHandlers: Map<string, Set<Handler>>;

function emitRoomEvent(event: string, ...args: unknown[]) {
  roomEventHandlers.get(event)?.forEach((h) => h(...args));
}

// --- Mock publication factory ---
// We need publications to be instanceof RemoteTrackPublication.
// Import the mocked class to use as prototype.
const { RemoteTrackPublication: MockRTP } = await import('livekit-client');

function createMockPublication(source: string) {
  const pub = Object.create(MockRTP.prototype);
  pub.source = source;
  pub.trackSid = `sid-${source}-${Math.random().toString(36).slice(2)}`;
  pub.isSubscribed = false;
  pub.subscriptionStatus = 'unsubscribed';
  pub.setSubscribed = vi.fn((subscribed: boolean) => {
    pub.isSubscribed = subscribed;
    pub.subscriptionStatus = subscribed ? 'subscribed' : 'unsubscribed';
  });
  return pub;
}

function createMockParticipant(identity: string, publications: ReturnType<typeof createMockPublication>[] = []) {
  const pubMap = new Map<string, ReturnType<typeof createMockPublication>>();
  publications.forEach((p) => pubMap.set(p.trackSid, p));
  return {
    identity,
    trackPublications: pubMap,
  };
}

// --- Mock room ---
let mockRoom: {
  remoteParticipants: Map<string, ReturnType<typeof createMockParticipant>>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} | null = null;

function buildMockRoom() {
  roomEventHandlers = new Map();
  const room = {
    remoteParticipants: new Map<string, ReturnType<typeof createMockParticipant>>(),
    on: vi.fn((event: string, handler: Handler) => {
      if (!roomEventHandlers.has(event)) roomEventHandlers.set(event, new Set());
      roomEventHandlers.get(event)!.add(handler);
      return room;
    }),
    off: vi.fn((event: string, handler: Handler) => {
      roomEventHandlers.get(event)?.delete(handler);
      return room;
    }),
  };
  mockRoom = room;
  return room;
}

// --- Mock hooks ---
vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ room: mockRoom })),
}));

const mockDispatch = vi.fn();
vi.mock('../../contexts/VoiceContext', () => ({
  useVoiceDispatch: vi.fn(() => ({ dispatch: mockDispatch })),
  VoiceActionType: {
    StopWatchingCamera: 'STOP_WATCHING_CAMERA',
    StopWatchingScreenShare: 'STOP_WATCHING_SCREEN_SHARE',
    WatchCamera: 'WATCH_CAMERA',
    StopWatchingCamera2: 'STOP_WATCHING_CAMERA',
    WatchScreenShare: 'WATCH_SCREEN_SHARE',
    StopWatchingScreenShare2: 'STOP_WATCHING_SCREEN_SHARE',
    SetShowVideoTiles: 'SET_SHOW_VIDEO_TILES',
    SetPipCollapsed: 'SET_PIP_COLLAPSED',
  },
}));

import { useTrackSubscription } from '../../hooks/useTrackSubscription';

describe('useTrackSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMockRoom();
  });

  describe('on mount', () => {
    it('subscribes to existing mic tracks', () => {
      const micPub = createMockPublication('microphone');
      const participant = createMockParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      renderHook(() => useTrackSubscription());

      expect(micPub.setSubscribed).toHaveBeenCalledWith(true);
    });

    it('unsubscribes existing camera tracks', () => {
      const camPub = createMockPublication('camera');
      camPub.isSubscribed = true;
      camPub.subscriptionStatus = 'desired';
      const participant = createMockParticipant('user-1', [camPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      renderHook(() => useTrackSubscription());

      expect(camPub.setSubscribed).toHaveBeenCalledWith(false);
    });

    it('unsubscribes existing screen share tracks', () => {
      const screenPub = createMockPublication('screen_share');
      screenPub.isSubscribed = true;
      screenPub.subscriptionStatus = 'desired';
      const screenAudioPub = createMockPublication('screen_share_audio');
      screenAudioPub.isSubscribed = true;
      screenAudioPub.subscriptionStatus = 'desired';
      const participant = createMockParticipant('user-1', [screenPub, screenAudioPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      renderHook(() => useTrackSubscription());

      expect(screenPub.setSubscribed).toHaveBeenCalledWith(false);
      expect(screenAudioPub.setSubscribed).toHaveBeenCalledWith(false);
    });
  });

  describe('on TrackPublished', () => {
    it('subscribes to newly published mic tracks', () => {
      renderHook(() => useTrackSubscription());

      const micPub = createMockPublication('microphone');
      Object.setPrototypeOf(micPub, MockRTP.prototype);
      const participant = createMockParticipant('user-1', [micPub]);

      act(() => {
        emitRoomEvent('trackPublished', micPub, participant);
      });

      expect(micPub.setSubscribed).toHaveBeenCalledWith(true);
    });

    it('does not call setSubscribed(false) on never-subscribed camera tracks', () => {
      renderHook(() => useTrackSubscription());

      const camPub = createMockPublication('camera');
      // camPub.isSubscribed is false by default (never subscribed)
      const participant = createMockParticipant('user-1', [camPub]);

      act(() => {
        emitRoomEvent('trackPublished', camPub, participant);
      });

      // With the guard, setSubscribed(false) is NOT called on never-subscribed tracks
      // to avoid sending redundant signals to the SFU
      expect(camPub.setSubscribed).not.toHaveBeenCalled();
    });

    it('does not call setSubscribed(false) on never-subscribed screen share tracks', () => {
      renderHook(() => useTrackSubscription());

      const screenPub = createMockPublication('screen_share');
      // screenPub.isSubscribed is false by default (never subscribed)
      const participant = createMockParticipant('user-1', [screenPub]);

      act(() => {
        emitRoomEvent('trackPublished', screenPub, participant);
      });

      expect(screenPub.setSubscribed).not.toHaveBeenCalled();
    });

    it('opens the video panel when a screen share is published', () => {
      renderHook(() => useTrackSubscription());

      const screenPub = createMockPublication('screen_share');
      const participant = createMockParticipant('user-1', [screenPub]);

      act(() => {
        emitRoomEvent('trackPublished', screenPub, participant);
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'SET_SHOW_VIDEO_TILES',
        payload: true,
      });
      // Both dispatched together — a show-true-only dispatch could surface
      // only a collapsed pill, leaving a viewer looking at nothing new.
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'SET_PIP_COLLAPSED',
        payload: false,
      });
    });

    it('does not open the video panel for mic, camera, or screen share audio publishes', () => {
      renderHook(() => useTrackSubscription());

      const micPub = createMockPublication('microphone');
      const camPub = createMockPublication('camera');
      const screenAudioPub = createMockPublication('screen_share_audio');
      const participant = createMockParticipant('user-1', [micPub, camPub, screenAudioPub]);

      act(() => {
        emitRoomEvent('trackPublished', micPub, participant);
        emitRoomEvent('trackPublished', camPub, participant);
        emitRoomEvent('trackPublished', screenAudioPub, participant);
      });

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_SHOW_VIDEO_TILES' }),
      );
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_PIP_COLLAPSED' }),
      );
    });

    it('unsubscribes previously-subscribed opt-in tracks on re-publish', () => {
      renderHook(() => useTrackSubscription());

      const camPub = createMockPublication('camera');
      camPub.isSubscribed = true; // simulate a previously subscribed track
      const participant = createMockParticipant('user-1', [camPub]);

      act(() => {
        emitRoomEvent('trackPublished', camPub, participant);
      });

      expect(camPub.setSubscribed).toHaveBeenCalledWith(false);
    });
  });

  describe('on TrackUnpublished', () => {
    it('dispatches StopWatchingCamera when camera is unpublished', () => {
      renderHook(() => useTrackSubscription());

      const camPub = createMockPublication('camera');
      const participant = createMockParticipant('user-1');

      act(() => {
        emitRoomEvent('trackUnpublished', camPub, participant);
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'STOP_WATCHING_CAMERA',
        payload: 'user-1',
      });
    });

    it('dispatches StopWatchingScreenShare when screen share is unpublished', () => {
      renderHook(() => useTrackSubscription());

      const screenPub = createMockPublication('screen_share');
      const participant = createMockParticipant('user-1');

      act(() => {
        emitRoomEvent('trackUnpublished', screenPub, participant);
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'STOP_WATCHING_SCREEN_SHARE',
        payload: 'user-1',
      });
    });
  });

  describe('on ParticipantConnected', () => {
    it('subscribes mic and unsubscribes video for newly connected participant', () => {
      renderHook(() => useTrackSubscription());

      const micPub = createMockPublication('microphone');
      const camPub = createMockPublication('camera');
      camPub.isSubscribed = true;
      camPub.subscriptionStatus = 'desired';
      const participant = createMockParticipant('user-1', [micPub, camPub]);

      act(() => {
        emitRoomEvent('participantConnected', participant);
      });

      expect(micPub.setSubscribed).toHaveBeenCalledWith(true);
      expect(camPub.setSubscribed).toHaveBeenCalledWith(false);
    });
  });

  describe('watch/stop actions', () => {
    it('watchCamera subscribes to camera track and dispatches', () => {
      const camPub = createMockPublication('camera');
      const participant = createMockParticipant('user-1', [camPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      const { result } = renderHook(() => useTrackSubscription());

      act(() => {
        result.current.watchCamera('user-1');
      });

      // setSubscribed called twice: once with false on mount, once with true on watch
      expect(camPub.setSubscribed).toHaveBeenLastCalledWith(true);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'WATCH_CAMERA',
        payload: 'user-1',
      });
    });

    it('stopWatchingCamera unsubscribes camera track and dispatches', () => {
      const camPub = createMockPublication('camera');
      camPub.isSubscribed = true;
      const participant = createMockParticipant('user-1', [camPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      const { result } = renderHook(() => useTrackSubscription());

      act(() => {
        result.current.stopWatchingCamera('user-1');
      });

      expect(camPub.setSubscribed).toHaveBeenLastCalledWith(false);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'STOP_WATCHING_CAMERA',
        payload: 'user-1',
      });
    });

    it('watchScreenShare subscribes to both screen share and screen share audio', () => {
      const screenPub = createMockPublication('screen_share');
      const screenAudioPub = createMockPublication('screen_share_audio');
      const participant = createMockParticipant('user-1', [screenPub, screenAudioPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      const { result } = renderHook(() => useTrackSubscription());

      act(() => {
        result.current.watchScreenShare('user-1');
      });

      expect(screenPub.setSubscribed).toHaveBeenLastCalledWith(true);
      expect(screenAudioPub.setSubscribed).toHaveBeenLastCalledWith(true);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'WATCH_SCREEN_SHARE',
        payload: 'user-1',
      });
    });

    it('does not crash when participant is not found', () => {
      const { result } = renderHook(() => useTrackSubscription());

      expect(() => {
        act(() => {
          result.current.watchCamera('nonexistent-user');
        });
      }).not.toThrow();
    });
  });

  describe('on Reconnected', () => {
    it('re-applies subscription policy to all participants with force=true', () => {
      // Pre-populate room with one participant whose mic is already subscribed
      // (mirroring the steady-state right before a reconnect)
      const micPub = createMockPublication('microphone');
      micPub.isSubscribed = true;
      micPub.subscriptionStatus = 'subscribed';
      const participant = createMockParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      renderHook(() => useTrackSubscription());
      // setSubscribed call from the initial mount
      const initialCallCount = micPub.setSubscribed.mock.calls.length;

      act(() => {
        emitRoomEvent('reconnected');
      });

      // forceResubscribePublication toggles false→true to force a fresh signal,
      // so we expect TWO additional setSubscribed calls after Reconnected.
      const newCalls = micPub.setSubscribed.mock.calls.slice(initialCallCount);
      expect(newCalls).toEqual([[false], [true]]);
    });

    it('force-resubscribes mics for multiple participants', () => {
      const micA = createMockPublication('microphone');
      micA.isSubscribed = true;
      const micB = createMockPublication('microphone');
      micB.isSubscribed = true;
      mockRoom!.remoteParticipants.set('a', createMockParticipant('a', [micA]));
      mockRoom!.remoteParticipants.set('b', createMockParticipant('b', [micB]));

      renderHook(() => useTrackSubscription());
      const aBefore = micA.setSubscribed.mock.calls.length;
      const bBefore = micB.setSubscribed.mock.calls.length;

      act(() => {
        emitRoomEvent('reconnected');
      });

      expect(micA.setSubscribed.mock.calls.slice(aBefore)).toEqual([[false], [true]]);
      expect(micB.setSubscribed.mock.calls.slice(bBefore)).toEqual([[false], [true]]);
    });
  });

  describe('on TrackSubscriptionStatusChanged', () => {
    it('forces re-subscribe when a mic transitions to unsubscribed', () => {
      renderHook(() => useTrackSubscription());

      const micPub = createMockPublication('microphone');
      micPub.isSubscribed = false; // post-status-change state
      const participant = createMockParticipant('user-1', [micPub]);

      act(() => {
        emitRoomEvent('trackSubscriptionStatusChanged', micPub, 'unsubscribed', participant);
      });

      // forceResubscribePublication: skips the false call (already false), then sets true
      expect(micPub.setSubscribed).toHaveBeenCalledWith(true);
    });

    it('ignores non-mic publication status changes', () => {
      renderHook(() => useTrackSubscription());

      const camPub = createMockPublication('camera');
      const participant = createMockParticipant('user-1', [camPub]);

      act(() => {
        emitRoomEvent('trackSubscriptionStatusChanged', camPub, 'unsubscribed', participant);
      });

      // No re-subscribe attempt for camera tracks via the status-changed path
      expect(camPub.setSubscribed).not.toHaveBeenCalled();
    });

    it('ignores subscribed→subscribed (not a drop)', () => {
      renderHook(() => useTrackSubscription());

      const micPub = createMockPublication('microphone');
      micPub.isSubscribed = true;
      const participant = createMockParticipant('user-1', [micPub]);

      act(() => {
        emitRoomEvent('trackSubscriptionStatusChanged', micPub, 'subscribed', participant);
      });

      expect(micPub.setSubscribed).not.toHaveBeenCalled();
    });
  });

  describe('forceResubscribeMic action', () => {
    it('toggles a subscribed mic false→true to issue a fresh subscribe', () => {
      const micPub = createMockPublication('microphone');
      micPub.isSubscribed = true;
      const participant = createMockParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      const { result } = renderHook(() => useTrackSubscription());
      const before = micPub.setSubscribed.mock.calls.length;

      act(() => {
        result.current.forceResubscribeMic('user-1');
      });

      expect(micPub.setSubscribed.mock.calls.slice(before)).toEqual([[false], [true]]);
    });

    it('does nothing when participant not found', () => {
      const { result } = renderHook(() => useTrackSubscription());
      expect(() => {
        act(() => {
          result.current.forceResubscribeMic('nonexistent');
        });
      }).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('removes all event listeners on unmount', () => {
      const { unmount } = renderHook(() => useTrackSubscription());

      unmount();

      expect(mockRoom!.off).toHaveBeenCalledWith('trackPublished', expect.any(Function));
      expect(mockRoom!.off).toHaveBeenCalledWith('trackUnpublished', expect.any(Function));
      expect(mockRoom!.off).toHaveBeenCalledWith('participantConnected', expect.any(Function));
      expect(mockRoom!.off).toHaveBeenCalledWith('reconnected', expect.any(Function));
      expect(mockRoom!.off).toHaveBeenCalledWith('trackSubscriptionStatusChanged', expect.any(Function));
      expect(mockRoom!.off).toHaveBeenCalledWith('trackSubscriptionFailed', expect.any(Function));
    });

    it('does nothing when room is null', () => {
      mockRoom = null;
      const { result } = renderHook(() => useTrackSubscription());

      // Should return actions without crashing
      expect(result.current.watchCamera).toBeDefined();
      expect(result.current.stopWatchingCamera).toBeDefined();
      expect(result.current.forceResubscribeMic).toBeDefined();
    });
  });
});
