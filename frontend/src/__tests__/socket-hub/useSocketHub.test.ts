import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { ServerEvents, ClientEvents } from '@semaphore-chat/shared';
import { useSocketHub } from '../../socket-hub/useSocketHub';
import { createEventBus } from '../../socket-hub/emitter';
import { createMockSocket } from '../test-utils/mockSocket';
import { createTestWrapper } from '../test-utils/wrappers';

describe('useSocketHub', () => {
  let queryClient: QueryClient;
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSocket = createMockSocket();
  });

  it('subscribes to all ServerEvents on the socket', () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });

    renderHook(() => useSocketHub(eventBus), { wrapper });

    // Should have called socket.on for every ServerEvent value
    const allEvents = Object.values(ServerEvents);
    for (const event of allEvents) {
      expect(mockSocket.on).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it('emits SUBSCRIBE_ALL and PRESENCE_ONLINE on connect', async () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });

    renderHook(() => useSocketHub(eventBus), { wrapper });

    // Simulate socket connect
    await act(async () => {
      await mockSocket.simulateEvent('connect');
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.SUBSCRIBE_ALL);
    expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.PRESENCE_ONLINE, { idle: expect.any(Boolean) });
  });

  it('re-emits socket events on the event bus', async () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });
    const handler = vi.fn();

    renderHook(() => useSocketHub(eventBus), { wrapper });

    eventBus.on(ServerEvents.USER_ONLINE, handler);

    const payload = { userId: 'u1' };
    await act(async () => {
      await mockSocket.simulateEvent(ServerEvents.USER_ONLINE, payload);
    });

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('runs the registered cache handler for a community asset event', async () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });

    renderHook(() => useSocketHub(eventBus), { wrapper });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await mockSocket.simulateEvent(ServerEvents.CUSTOM_EMOJI_CREATED, {
        communityId: 'c1',
        emojiId: 'e1',
      });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        {
          _id: 'customEmojiControllerListCommunityEmojis',
          path: { communityId: 'c1' },
        },
      ],
    });
  });

  it('registers exactly one listener per ServerEvent (completeness check)', () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });

    renderHook(() => useSocketHub(eventBus), { wrapper });

    const allEvents = Object.values(ServerEvents);

    // Verify every single ServerEvent has exactly one socket.on registration
    for (const event of allEvents) {
      const registrations = mockSocket.on.mock.calls.filter(
        ([e]) => e === event,
      );
      expect(registrations).toHaveLength(1);
    }

    // Verify we didn't register any extra events beyond ServerEvents + 'connect'
    const registeredEvents = new Set(
      mockSocket.on.mock.calls.map(([e]) => e),
    );
    const expectedEvents = new Set([...allEvents, 'connect']);
    expect(registeredEvents).toEqual(expectedEvents);
  });

  it('re-emits every ServerEvent through the event bus', async () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });
    const received = new Map<string, unknown>();

    renderHook(() => useSocketHub(eventBus), { wrapper });

    // Subscribe to every event on the bus
    const allEvents = Object.values(ServerEvents);
    for (const event of allEvents) {
      eventBus.on(event, ((payload: unknown) => {
        received.set(event, payload);
      }) as never);
    }

    // Fire every event through the mock socket
    for (const event of allEvents) {
      const payload = { _event: event };
      await act(async () => {
        await mockSocket.simulateEvent(event, payload);
      });
    }

    // Every event should have been re-emitted on the bus
    for (const event of allEvents) {
      expect(received.has(event)).toBe(true);
      expect(received.get(event)).toEqual({ _event: event });
    }

    expect(received.size).toBe(allEvents.length);
  });

  it('cleans up socket listeners on unmount', () => {
    const eventBus = createEventBus();
    const wrapper = createTestWrapper({ queryClient, socket: mockSocket });

    const { unmount } = renderHook(() => useSocketHub(eventBus), { wrapper });

    const offCallCountBefore = mockSocket.off.mock.calls.length;
    unmount();

    // off should have been called for all events + the 'connect' listener
    expect(mockSocket.off.mock.calls.length).toBeGreaterThan(offCallCountBefore);
  });
});
