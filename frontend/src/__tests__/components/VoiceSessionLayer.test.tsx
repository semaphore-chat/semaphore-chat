/**
 * The call survives a change of layout: resizing across the phone / tablet /
 * desktop breakpoints swaps the layout component (Layout.tsx), but the audio
 * elements, the track subscriptions, the call's behaviour and voice recovery
 * live in VoiceSessionLayer above it and must not remount.
 *
 * Real: Layout, the three layouts, VoiceSessionLayer, TrackSubscriptionProvider,
 * VoiceEventLogProvider, AudioRenderer, VoiceProvider. Fake: the LiveKit Room
 * (one remote participant with a mic track) and leaf UI (markers).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, screen } from '@testing-library/react';
import type { Room } from 'livekit-client';
import { renderWithProviders } from '../test-utils';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';
import { VoiceSessionType } from '../../contexts/VoiceContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => false,
  isWeb: () => true,
}));

vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => false,
}));

// Mount counters for the pieces that must stay mounted.
const counts = vi.hoisted(() => ({ recoveryMounts: 0, effectsMounts: 0, effectsUnmounts: 0 }));

vi.mock('../../hooks/useVoiceRecovery', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    useVoiceRecovery: () => {
      useMountEffect(() => {
        counts.recoveryMounts += 1;
      }, []);
    },
  };
});
vi.mock('../../components/Voice/VoiceSessionEffects', async () => {
  const { useEffect: useMountEffect } = await import('react');
  const FakeVoiceSessionEffects = () => {
    useMountEffect(() => {
      counts.effectsMounts += 1;
      return () => {
        counts.effectsUnmounts += 1;
      };
    }, []);
    return null;
  };
  return { default: FakeVoiceSessionEffects };
});

// The bar's content is UI only; a marker is enough.
vi.mock('../../components/Voice/VoiceBottomBarContent', () => ({
  default: () => <div data-testid="voice-bar-content" />,
}));

vi.mock('../../hooks/useVoiceForegroundResync', () => ({ useVoiceForegroundResync: vi.fn() }));
vi.mock('../../hooks/useThemeSync', () => ({ useThemeSync: vi.fn() }));
vi.mock('../../hooks/useAppBadge', () => ({ useAppBadge: vi.fn() }));
vi.mock('../../hooks/usePushResync', () => ({ usePushResync: vi.fn() }));
vi.mock('../../hooks/useDesktopSignInNotice', () => ({ useDesktopSignInNotice: vi.fn() }));
vi.mock('../../components/LayoutProviders', () => ({
  LayoutProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: undefined, isLoading: false, isError: false }),
}));

vi.mock('../../components/CommunityList/CommunityToggle', () => ({
  default: () => <div data-testid="rail" />,
}));
vi.mock('../../components/Notifications/NotificationCenter', () => ({ default: () => null }));
vi.mock('../../components/Mobile/Navigation/MobileCommunityDrawer', () => ({ default: () => null }));
vi.mock('../../components/Mobile/Screens/MobileScreenContainer', () => ({
  MobileScreenContainer: () => <div data-testid="mobile-screen" />,
}));
vi.mock('../../components/Mobile/Navigation/MobileBottomNavigation', () => ({
  MobileBottomNavigation: () => null,
}));
vi.mock('../../components/Mobile/Tablet/TabletSidebar', () => ({ TabletSidebar: () => null }));
vi.mock('../../components/Mobile/Tablet/TabletContentArea', () => ({
  TabletContentArea: () => <div data-testid="tablet-content" />,
}));

import Layout from '../../Layout';

// --- A viewport whose width can change, with real media-query listeners ------

interface FakeMediaQueryList {
  media: string;
  matches: boolean;
  listeners: Set<(e: { matches: boolean }) => void>;
}

function evaluate(query: string, width: number): boolean {
  if (query.includes('pointer') || query.includes('hover')) return false;
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (!min && !max) return false;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

function createViewport(initialWidth: number) {
  let width = initialWidth;
  const lists: FakeMediaQueryList[] = [];
  const matchMedia = vi.fn((query: string) => {
    const list: FakeMediaQueryList = { media: query, matches: evaluate(query, width), listeners: new Set() };
    lists.push(list);
    return {
      get matches() {
        return list.matches;
      },
      media: query,
      onchange: null,
      addListener: (l: (e: { matches: boolean }) => void) => list.listeners.add(l),
      removeListener: (l: (e: { matches: boolean }) => void) => list.listeners.delete(l),
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => list.listeners.add(l),
      removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => list.listeners.delete(l),
      dispatchEvent: vi.fn(),
    };
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    setWidth(next: number) {
      width = next;
      for (const list of lists) {
        const matches = evaluate(list.media, width);
        if (matches === list.matches) continue;
        list.matches = matches;
        list.listeners.forEach((l) => l({ matches }));
      }
    },
  };
}

// --- A fake Room with one remote participant speaking ------------------------

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
  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

function createRoom() {
  const track = {
    kind: 'audio',
    mediaStreamTrack: { enabled: true },
    attach: vi.fn((el: HTMLMediaElement) => el),
    detach: vi.fn((el?: HTMLMediaElement) => el),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 1),
  };
  const micPublication = {
    source: 'microphone',
    trackSid: 'TR_alice_mic',
    trackName: 'microphone',
    kind: 'audio',
    isSubscribed: true,
    isMuted: false,
    track,
    setSubscribed: vi.fn(),
  };
  const alice = Object.assign(new FakeEmitter(), {
    identity: 'alice',
    name: 'Alice',
    trackPublications: new Map([[micPublication.trackSid, micPublication]]),
    audioTrackPublications: new Map([[micPublication.trackSid, micPublication]]),
  });
  const room = Object.assign(new FakeEmitter(), {
    state: 'connected',
    remoteParticipants: new Map([['alice', alice]]),
    localParticipant: Object.assign(new FakeEmitter(), {
      identity: 'me',
      trackPublications: new Map(),
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => undefined),
    }),
  });
  return { room, track, micPublication };
}

const IN_A_CALL = {
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  currentChannelId: 'ch-1',
  channelName: 'general',
  communityId: 'c-1',
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderInACall(room: ReturnType<typeof createRoom>['room']) {
  const roomContext = {
    room: room as unknown as Room,
    setRoom: vi.fn(),
    getRoom: () => room as unknown as Room,
  };
  return renderWithProviders(
    <BottomChromeProvider>
      <VoiceProvider initialState={IN_A_CALL}>
        <RoomContext.Provider value={roomContext}>
          <Layout />
        </RoomContext.Provider>
      </VoiceProvider>
    </BottomChromeProvider>,
    { routerProps: { initialEntries: ['/community/c-1/channel/ch-1'] } },
  );
}

/** Lets the lazy VoiceSessionEffects chunk resolve. */
async function flushLazy() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  counts.recoveryMounts = 0;
  counts.effectsMounts = 0;
  counts.effectsUnmounts = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoiceSessionLayer across layout changes', () => {
  it('keeps the same <audio> element, attached once, from desktop to tablet to phone and back', async () => {
    const viewport = createViewport(1440);
    const { room, track } = createRoom();
    const { container } = renderInACall(room);
    await flushLazy();

    expect(screen.getByTestId('rail')).toBeInTheDocument();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    for (const [width, layoutMarker] of [
      [820, 'tablet-content'],
      [390, 'mobile-screen'],
      [1440, 'rail'],
    ] as const) {
      act(() => viewport.setWidth(width));
      await flushLazy();
      expect(screen.getByTestId(layoutMarker)).toBeInTheDocument();
      expect(container.querySelectorAll('audio')).toHaveLength(1);
      expect(container.querySelector('audio')).toBe(audio);
    }

    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
  });

  it('applies the subscription policy once and keeps its room listeners across layout changes', async () => {
    const viewport = createViewport(1440);
    const { room, micPublication } = createRoom();
    renderInACall(room);
    await flushLazy();

    const subscribeCalls = micPublication.setSubscribed.mock.calls.length;
    expect(subscribeCalls).toBeGreaterThan(0);
    const published = room.listenerCount('trackPublished');

    act(() => viewport.setWidth(820));
    act(() => viewport.setWidth(390));
    await flushLazy();

    expect(micPublication.setSubscribed).toHaveBeenCalledTimes(subscribeCalls);
    expect(room.listenerCount('trackPublished')).toBe(published);
  });

  it("mounts the call's behaviour once and never remounts it on a layout change", async () => {
    const viewport = createViewport(1440);
    const { room } = createRoom();
    renderInACall(room);
    await flushLazy();
    expect(counts.effectsMounts).toBe(1);

    act(() => viewport.setWidth(820));
    act(() => viewport.setWidth(390));
    act(() => viewport.setWidth(1440));
    await flushLazy();

    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('tries voice recovery from one place only, however often the layout changes', async () => {
    const viewport = createViewport(390);
    const { room } = createRoom();
    renderInACall(room);
    await flushLazy();
    expect(counts.recoveryMounts).toBe(1);

    act(() => viewport.setWidth(820));
    act(() => viewport.setWidth(1440));
    act(() => viewport.setWidth(390));
    await flushLazy();

    expect(counts.recoveryMounts).toBe(1);
  });
});
