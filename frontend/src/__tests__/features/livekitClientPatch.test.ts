/**
 * Pins patches/livekit-client@2.22.3.patch (see patches/README.md). These
 * tests drive livekit-client's real RTCEngine, so they fail without the patch.
 *
 * The bug: RTCEngine.waitForRestarted() resolved at once whenever pcState was
 * Connected. In a full reconnect the new peer connection reaches `connected`
 * within milliseconds of the join, while the engine is still inside
 * restartConnection(), which sleeps a fixed 2 s (minReconnectWait) before it
 * emits Restarted. So Room.handleSignalRestarted declared the room Reconnected
 * and flushed its event buffer while engine.pendingReconnect was still true,
 * and Room.emitWhenConnected put every RoomEvent of the next ~2 s
 * (TrackSubscriptionStatusChanged, TrackMuted, ...) into Room.bufferedEvents,
 * which nothing flushes again. Since livekit-client 2.18.1 (#1860) that
 * includes TrackSubscribed: after a full reconnect the app never saw it for
 * the mics it re-subscribes, AudioRenderer attached no <audio> element, and
 * the user heard nobody (the nightly voice E2E full-reconnect specs).
 *
 * The patch keeps waitForRestarted() waiting for the real Restarted event
 * while a reconnect attempt is in flight, the same "connected and not
 * attempting a reconnect" test RTCEngine already uses elsewhere.
 */
import { describe, it, expect } from 'vitest';
import { Room } from 'livekit-client';

// RTCEngine's internal PCState enum (not exported): New = 0, Connected = 1.
const PC_STATE_CONNECTED = 1;

interface EngineInternals {
  pcState: number;
  attemptingReconnect: boolean;
  waitForRestarted: () => Promise<void>;
  emit: (event: string, ...args: unknown[]) => boolean;
}

function engineOf(room: Room): EngineInternals {
  return (room as unknown as { engine: EngineInternals }).engine;
}

/** Whether `promise` settles within one macrotask. */
async function settlesNow(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

describe('livekit-client patch: RTCEngine.waitForRestarted during a full reconnect', () => {
  it('waits for Restarted while a reconnect attempt is in flight, even though the PC already connected', async () => {
    const engine = engineOf(new Room());
    engine.pcState = PC_STATE_CONNECTED;
    engine.attemptingReconnect = true;

    const restarted = engine.waitForRestarted();
    expect(await settlesNow(restarted)).toBe(false);

    engine.emit('restarted');
    await expect(restarted).resolves.toBeUndefined();
  });

  it('still resolves at once when connected and no reconnect attempt is running', async () => {
    const engine = engineOf(new Room());
    engine.pcState = PC_STATE_CONNECTED;
    engine.attemptingReconnect = false;

    expect(await settlesNow(engine.waitForRestarted())).toBe(true);
  });
});
